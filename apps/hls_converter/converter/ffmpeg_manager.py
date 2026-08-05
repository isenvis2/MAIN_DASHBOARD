#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RTSP → (Low-latency) HLS multi-camera manager with hot-reload
Expected structure:
  RTSP-HLS-SITUATION/
    apps/hls-converter/ffmpeg_manager.py
    shared/data/camera_list.json
    shared/media/<camId>/stream.m3u8
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import shutil
import re
import signal
import subprocess
import threading
import time
import ssl
import smtplib
from dataclasses import dataclass
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from email.message import EmailMessage
from typing import Any, Dict, Optional, Tuple

# Suppress Windows Error Reporting popups from ffmpeg/ffprobe failures.
# Converter failures must be logged and handled by the dashboard, not block the UI.
def suppress_windows_error_popups() -> None:
    if os.name != "nt":
        return
    try:
        SEM_FAILCRITICALERRORS = 0x0001
        SEM_NOGPFAULTERRORBOX = 0x0002
        SEM_NOOPENFILEERRORBOX = 0x8000
        ctypes.windll.kernel32.SetErrorMode(
            SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX
        )
    except Exception:
        pass

suppress_windows_error_popups()


def ts_now() -> str:
    now = time.time()
    lt = time.localtime(now)
    ms = int((now - int(now)) * 1000)
    return f"{lt.tm_hour:02d}:{lt.tm_min:02d}:{lt.tm_sec:02d}.{ms:03d}"


def log_line(handle, message: str) -> None:
    handle.write(f"[{ts_now()}] {message}\n")


def console_line(message: str) -> None:
    print(f"[{ts_now()}] {message}")



def read_startup_cleanup_settings(gis_config_path: Path) -> Dict[str, Any]:
    """Read startup cleanup policy.

    Dedicated RIC servers should start from a clean FFmpeg state.  By default
    this version kills every ffmpeg.exe on converter startup, not only PIDs
    registered by this project.
    """
    default = {
        "enabled": True,
        "forceKillAllFfmpegOnStartup": True,
        "cleanupMediaOnStartup": True,
        "killCommandRetry": 2,
    }
    try:
        raw = json.loads(gis_config_path.read_text(encoding="utf-8"))
        cfg = raw.get("startupCleanup") or raw.get("hlsStartupCleanup") or {}
        if isinstance(cfg, dict):
            merged = dict(default)
            merged.update(cfg)
            return merged
    except Exception:
        pass
    return default


def kill_all_ffmpeg_processes_on_startup(logs_dir: Path, reason: str = "converter_startup") -> None:
    """Force-kill all ffmpeg.exe processes before starting this converter.

    This is intentionally broad because the target deployment is a dedicated
    RIC dashboard server.  Left-over FFmpeg processes can keep writing to the
    same shared/media/<camId> directories and corrupt the new stream.m3u8 /
    segment sequence.
    """
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_path = logs_dir / "startup_cleanup.log"
    with log_path.open("a", encoding="utf-8", errors="replace") as lf:
        log_line(lf, f"[STARTUP_CLEANUP] begin reason={reason} policy=kill-all-ffmpeg")
        if os.name != "nt":
            log_line(lf, "[STARTUP_CLEANUP] skip non-windows host")
            console_line("[STARTUP_CLEANUP] non-windows host; ffmpeg.exe taskkill skipped")
            return

        killed_any = False
        # Snapshot before kill for diagnosis.
        try:
            snap = subprocess.run(
                ["tasklist", "/FI", "IMAGENAME eq ffmpeg.exe", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
            )
            before = (snap.stdout or "").strip()
            log_line(lf, f"[STARTUP_CLEANUP] tasklist_before={before if before else 'none'}")
        except Exception as e:
            log_line(lf, f"[STARTUP_CLEANUP] tasklist_before_failed={e}")

        for attempt in range(1, 3):
            try:
                proc = subprocess.run(
                    ["taskkill", "/F", "/IM", "ffmpeg.exe", "/T"],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
                )
                out = ((proc.stdout or "") + (proc.stderr or "")).strip()
                log_line(lf, f"[STARTUP_CLEANUP] taskkill attempt={attempt} rc={proc.returncode} output={out if out else 'none'}")
                if proc.returncode == 0:
                    killed_any = True
                    time.sleep(0.5)
                else:
                    # Windows returns non-zero if no matching process exists.
                    if "not found" in out.lower() or "not running" in out.lower() or "찾을 수" in out:
                        break
                    time.sleep(0.5)
            except Exception as e:
                log_line(lf, f"[STARTUP_CLEANUP] taskkill_failed attempt={attempt} error={e}")
                time.sleep(0.5)

        try:
            snap = subprocess.run(
                ["tasklist", "/FI", "IMAGENAME eq ffmpeg.exe", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
            )
            after = (snap.stdout or "").strip()
            log_line(lf, f"[STARTUP_CLEANUP] tasklist_after={after if after else 'none'}")
        except Exception as e:
            log_line(lf, f"[STARTUP_CLEANUP] tasklist_after_failed={e}")
        log_line(lf, f"[STARTUP_CLEANUP] end killedAny={killed_any}")
    console_line("[STARTUP_CLEANUP] all ffmpeg.exe processes were requested to terminate before converter startup")

# =============================
# Email alert (optional)
# =============================

class EmailAlerter:
    """Simple SMTP(S) email alerter with per-camera cooldown.

    Credentials are read from environment variables by default.
    - SMTP_HOST (e.g. smtps.hiworks.com)
    - SMTP_PORT (e.g. 465)
    - SMTP_USER
    - SMTP_PASS
    - SMTP_TO  (recipient; default=SMTP_USER)
    """

    def __init__(
        self,
        enabled: bool,
        host: str,
        port: int,
        user: str,
        password: str,
        to_addr: str,
        cooldown_sec: int = 300,
        subject_prefix: str = "[RTSP→HLS]",
    ):
        self.enabled = enabled
        self.host = host
        self.port = port
        self.user = user
        self.password = password
        self.to_addr = to_addr or user
        self.cooldown_sec = max(10, int(cooldown_sec))
        self.subject_prefix = subject_prefix
        self._last_sent: Dict[str, float] = {}

    @staticmethod
    def from_env(enabled: bool, cooldown_sec: int = 300) -> "EmailAlerter":
        host = os.environ.get("SMTP_HOST", "")
        port = int(os.environ.get("SMTP_PORT", "465") or "465")
        user = os.environ.get("SMTP_USER", "")
        password = os.environ.get("SMTP_PASS", "")
        to_addr = os.environ.get("SMTP_TO", "") or user
        return EmailAlerter(
            enabled=enabled,
            host=host,
            port=port,
            user=user,
            password=password,
            to_addr=to_addr,
            cooldown_sec=cooldown_sec,
        )

    def ready(self) -> bool:
        if not self.enabled:
            return False
        return all([self.host, self.port, self.user, self.password, self.to_addr])

    def _cooldown_ok(self, key: str) -> bool:
        now = time.time()
        last = self._last_sent.get(key, 0)
        return (now - last) >= self.cooldown_sec

    def send(self, key: str, subject: str, body: str) -> bool:
        if not self.ready():
            return False
        if not self._cooldown_ok(key):
            return False

        msg = EmailMessage()
        msg["From"] = self.user
        msg["To"] = self.to_addr
        msg["Subject"] = f"{self.subject_prefix} {subject}"
        msg.set_content(body)

        ctx = ssl.create_default_context()
        try:
            with smtplib.SMTP_SSL(self.host, self.port, context=ctx, timeout=10) as s:
                s.login(self.user, self.password)
                s.send_message(msg)
            self._last_sent[key] = time.time()
            return True
        except Exception:
            # Don't crash manager if SMTP fails
            return False


def mask_rtsp_url(url: str) -> str:
    """Mask credentials in an RTSP URL for logging/alerts."""
    if not isinstance(url, str):
        return ""
    if not url.startswith("rtsp://"):
        return url
    rest = url[len("rtsp://"):]
    if "@" not in rest:
        return url
    creds, tail = rest.split("@", 1)
    if ":" in creds:
        user, _ = creds.split(":", 1)
        creds_masked = f"{user}:***"
    else:
        creds_masked = "***"
    return "rtsp://" + creds_masked + "@" + tail


def tail_text(path: Path, max_lines: int = 80) -> str:
    """Read last N lines from a text file (best-effort)."""
    try:
        with path.open("rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            # read last up to 64KB
            f.seek(max(0, size - 65536), os.SEEK_SET)
            data = f.read().decode("utf-8", errors="replace")
        lines = data.splitlines()
        return "\n".join(lines[-max_lines:])
    except Exception:
        return ""


def classify_ffmpeg_failure(log_tail: str) -> str:
    """Best-effort classification for alert subjects."""
    t = (log_tail or "").lower()
    if "401unauthorized" in t or "unauthorized" in t:
        return "auth_failed"
    if "490account blocked" in t or "account blocked" in t:
        return "account_blocked"
    if "cuda_error" in t or "scale_cuda" in t or "h264_nvenc" in t or "nvenc" in t or "nvdec" in t:
        return "gpu_cuda_failed"
    if "option not found" in t:
        return "ffmpeg_option_not_found"
    if "error number -10054" in t or "connection reset" in t or "forcibly closed" in t:
        return "rtsp_connection_reset"
    if "immediate exit requested" in t or "received signal 2" in t:
        return "external_stop"
    if "connection refused" in t:
        return "connection_refused"
    if "timed out" in t or "timeout" in t:
        return "timeout"
    if "could not find" in t and "encoder" in t:
        return "encoder_missing"
    return "ffmpeg_exit"


BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = (BASE_DIR / ".." / ".." / "..").resolve()
SHARED_DIR = PROJECT_ROOT / "shared"

DEFAULT_CONFIG_FILE = SHARED_DIR / "data" / "camera_list.json"
DEFAULT_GIS_CONFIG_FILE = SHARED_DIR / "data" / "GISDashBoard.json"
DEFAULT_MEDIA_ROOT = SHARED_DIR / "media"
DEFAULT_LOGS_DIR = BASE_DIR / "logs"

FFMPEG_HINTS = [
    # Prefer explicit full builds before PATH so vendor-limited ffmpeg.exe
    # instances such as AxxonSoft DriverPack are not selected accidentally.
    r"C:\ffmpeg\bin\ffmpeg.exe",
    r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
    "ffmpeg",
]


def _bool_setting(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on", "enabled"}


def _as_string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _normalize_tool_path(value: Any) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw:
        return None
    expanded = os.path.expanduser(os.path.expandvars(raw))
    p = Path(expanded)
    # On Windows, C:\... is absolute. On non-Windows validation hosts, keep it
    # as-is so syntax checks do not rewrite Windows paths into project-relative paths.
    if not p.is_absolute() and not re.match(r"^[A-Za-z]:[\\/]", expanded):
        p = (PROJECT_ROOT / p).resolve()
        return str(p)
    return expanded


def read_hls_tool_settings(gis_config_path: Path) -> Dict[str, Any]:
    """Read FFmpeg/FFprobe tool paths from GISDashBoard.json.

    Priority at runtime:
    1) CLI --ffmpeg
    2) JSON hlsTools.ffmpegPath / hlsTools.ffmpegCandidates
    3) auto-detect hints only when allowPathAutoDetectFallback is true.
    """
    default = {
        "ffmpegPath": "",
        "ffmpegCandidates": [],
        "allowPathAutoDetectFallback": True,
    }
    try:
        raw = json.loads(gis_config_path.read_text(encoding="utf-8"))
        tools = raw.get("hlsTools") or raw.get("ffmpegTools") or raw.get("tools") or {}
        if not isinstance(tools, dict):
            return default
        result = dict(default)
        result["ffmpegPath"] = _normalize_tool_path(
            tools.get("ffmpegPath") or tools.get("ffmpeg") or tools.get("path")
        ) or ""
        result["ffmpegCandidates"] = [
            x for x in (_normalize_tool_path(v) for v in _as_string_list(tools.get("ffmpegCandidates") or tools.get("ffmpegPaths")))
            if x
        ]
        result["allowPathAutoDetectFallback"] = _bool_setting(
            tools.get("allowPathAutoDetectFallback"),
            _bool_setting(tools.get("allowAutoDetectFallback"), True),
        )
        return result
    except Exception:
        return default


def _resolve_executable(candidate: str) -> Optional[str]:
    candidate = str(candidate or "").strip()
    if not candidate:
        return None
    p = Path(candidate)
    if p.exists():
        return str(p)
    w = shutil.which(candidate)
    if w:
        return w
    return None


def find_ffmpeg(explicit: Optional[str] = None, gis_config_path: Optional[Path] = None) -> str:
    if explicit:
        resolved = _resolve_executable(explicit)
        if resolved:
            return resolved
        raise RuntimeError(f"FFmpeg not found at: {explicit}")

    settings = read_hls_tool_settings(gis_config_path) if gis_config_path else {}
    json_candidates = []
    if settings.get("ffmpegPath"):
        json_candidates.append(settings["ffmpegPath"])
    json_candidates.extend(settings.get("ffmpegCandidates") or [])

    checked_json_candidates = []
    for candidate in json_candidates:
        checked_json_candidates.append(candidate)
        resolved = _resolve_executable(candidate)
        if resolved:
            return resolved

    if checked_json_candidates and not _bool_setting(settings.get("allowPathAutoDetectFallback"), True):
        joined = "; ".join(checked_json_candidates)
        raise RuntimeError(
            "FFmpeg not found from GISDashBoard.json hlsTools. "
            f"Checked: {joined}. Edit hlsTools.ffmpegPath or set allowPathAutoDetectFallback=true."
        )

    for hint in FFMPEG_HINTS:
        resolved = _resolve_executable(hint)
        if resolved:
            return resolved
    raise RuntimeError("FFmpeg not found. Install FFmpeg, set hlsTools.ffmpegPath in GISDashBoard.json, or pass --ffmpeg <path>.")


def run_ffmpeg_probe_command(args: list, timeout_sec: float = 8.0) -> str:
    try:
        p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=timeout_sec, creationflags=_popen_creationflags())
        return (p.stdout or "").strip()
    except Exception as e:
        return f"<probe failed: {e}>"

def log_ffmpeg_diagnostics(ffmpeg: str, logs_dir: Path) -> None:
    try:
        logs_dir.mkdir(parents=True, exist_ok=True)
        diag_path = logs_dir / "ffmpeg_diagnostics.log"
        with diag_path.open("a", encoding="utf-8") as lf:
            log_line(lf, "===== FFMPEG DIAGNOSTICS =====")
            log_line(lf, f"PATH: {ffmpeg}")
            version = run_ffmpeg_probe_command([ffmpeg, "-version"], 8.0)
            hwaccels = run_ffmpeg_probe_command([ffmpeg, "-hide_banner", "-hwaccels"], 8.0)
            encoders = run_ffmpeg_probe_command([ffmpeg, "-hide_banner", "-encoders"], 8.0)
            nvenc = "h264_nvenc" in encoders.lower()
            cuda = "cuda" in hwaccels.lower()
            log_line(lf, "[FFMPEG_VERSION]\n" + version[:4000])
            log_line(lf, "[FFMPEG_HWACCELS]\n" + hwaccels[:2000])
            log_line(lf, f"[FFMPEG_ENCODERS] h264_nvenc={nvenc} cuda={cuda}")
    except Exception as e:
        console_line(f"[WARN] FFmpeg diagnostics log failed: {e}")

def parse_progress_file(progress_path: Path) -> Dict[str, str]:
    result: Dict[str, str] = {}
    try:
        if not progress_path.exists():
            return result
        text = progress_path.read_text(encoding="utf-8", errors="ignore")
        for line in text.splitlines()[-80:]:
            if "=" in line:
                k, v = line.split("=", 1)
                result[k.strip()] = v.strip()
    except Exception:
        return result
    return result


@dataclass(frozen=True)
class Camera:
    id: str
    rtsp: str
    name: str = ""
    source_type: str = "rtsp"
    restart_token: str = ""
    session_token: str = ""


@dataclass(frozen=True)
class ConversionSettings:
    rtsp_engine: str = "cpu"
    rtsp_plus_engine: str = "gpu"
    gpu_index: int = 0
    rtsp_gpu_index: int = 0
    rtsp_plus_gpu_index: int = 0
    fallback_to_cpu: bool = True


@dataclass(frozen=True)
class HlsOutputSettings:
    hls_time: float = 1.0
    hls_list_size: int = 24
    hls_delete_threshold: int = 12


@dataclass(frozen=True)
class HlsWatchdogSettings:
    enabled: bool = True
    startup_grace_sec: float = 45.0
    soft_stale_sec: float = 10.0
    stale_m3u8_sec: float = 25.0
    hard_stale_sec: float = 45.0
    restart_delay_sec: float = 5.0
    min_restart_interval_sec: float = 20.0
    max_restarts_per_hour: int = 6
    preserve_hls_on_restart: bool = True


@dataclass(frozen=True)
class HlsAudioSettings:
    enabled: bool = True
    rtsp_plus_audio: bool = True
    rtsp_audio: bool = False
    codec: str = "aac"
    bitrate: str = "128k"
    sample_rate: int = 44100
    channels: int = 2


@dataclass
class WorkerState:
    cam: Camera
    gpu_index: int
    engine: str
    proc: Optional[subprocess.Popen]
    thread: Optional[threading.Thread]
    stop_flag: threading.Event


workers: Dict[str, WorkerState] = {}
workers_lock = threading.Lock()
global_stop = threading.Event()


def is_worker_alive(cid: str) -> bool:
    """Return True only when the camera worker thread is still running."""
    with workers_lock:
        st = workers.get(cid)
        if not st or not st.thread:
            return False
        return st.thread.is_alive() and not st.stop_flag.is_set()


def get_worker_proc_state(cid: str) -> str:
    """Best-effort worker/proc state for logs and diagnosis."""
    with workers_lock:
        st = workers.get(cid)
        if not st:
            return "missing"
        thread_alive = bool(st.thread and st.thread.is_alive())
        if not thread_alive:
            return "thread-dead"
        if st.proc is None:
            return "proc-none"
        rc = st.proc.poll()
        return "proc-running" if rc is None else f"proc-exited:{rc}"


VALID_CONVERSION_ENGINES = {"cpu", "gpu"}


def normalize_engine(value: Any, default: str = "cpu") -> str:
    v = str(value or "").strip().lower()
    if v in ("cuda", "nvenc", "nvidia"):
        v = "gpu"
    if v in ("libx264", "software"):
        v = "cpu"
    return v if v in VALID_CONVERSION_ENGINES else default


def load_conversion_settings(gis_config_path: Path, cli_gpu_allowed: bool = True) -> ConversionSettings:
    """Read HLS conversion engine policy from GISDashBoard.json.

    Supported JSON shape:
      "hlsConversion": {
        "rtspEngine": "cpu" | "gpu",
        "rtspPlusEngine": "cpu" | "gpu",
        "gpuIndex": 0,
        "rtspGpuIndex": 0,
        "rtspPlusGpuIndex": 0,
        "fallbackToCpu": true
      }

    Backward-compatible aliases are also accepted:
      rtsp: "cpu", rtspPlus: "gpu", rtsp_plus: "gpu".
    """
    raw: Dict[str, Any] = {}
    try:
        if gis_config_path.exists():
            loaded = json.loads(gis_config_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                raw = loaded
    except Exception as e:
        print(f"[WARN] failed to read GIS conversion settings: {gis_config_path} -> {e}")

    conv = raw.get("hlsConversion") or raw.get("conversion") or raw.get("streamConversion") or {}
    if not isinstance(conv, dict):
        conv = {}

    # V77.07 default policy: keep YTN/rtsp+ on NVIDIA GPU, ordinary RTSP on CPU.
    # GTX 1650 Ti proved unstable with three simultaneous GPU HLS conversions.
    rtsp_engine = normalize_engine(conv.get("rtspEngine", conv.get("rtsp")), "cpu")
    rtsp_plus_engine = normalize_engine(conv.get("rtspPlusEngine", conv.get("rtspPlus", conv.get("rtsp_plus"))), "gpu")
    try:
        gpu_index = int(conv.get("gpuIndex", conv.get("gpu", 0)) or 0)
    except Exception:
        gpu_index = 0
    try:
        rtsp_gpu_index = int(conv.get("rtspGpuIndex", conv.get("gpuIndex", conv.get("gpu", 0))) or 0)
    except Exception:
        rtsp_gpu_index = gpu_index
    try:
        rtsp_plus_gpu_index = int(conv.get("rtspPlusGpuIndex", conv.get("gpuIndex", conv.get("gpu", 0))) or 0)
    except Exception:
        rtsp_plus_gpu_index = gpu_index
    fallback_to_cpu = bool(conv.get("fallbackToCpu", conv.get("gpuFallbackToCpu", True)))

    if not cli_gpu_allowed:
        rtsp_engine = "cpu"
        rtsp_plus_engine = "cpu"

    return ConversionSettings(
        rtsp_engine=rtsp_engine,
        rtsp_plus_engine=rtsp_plus_engine,
        gpu_index=max(0, gpu_index),
        rtsp_gpu_index=max(0, rtsp_gpu_index),
        rtsp_plus_gpu_index=max(0, rtsp_plus_gpu_index),
        fallback_to_cpu=fallback_to_cpu,
    )


def select_conversion_engine(cam: Camera, settings: ConversionSettings) -> str:
    source_type = (cam.source_type or "rtsp").strip().lower()
    if source_type == "rtsp+":
        return settings.rtsp_plus_engine
    return settings.rtsp_engine


def _positive_float(value: Any, default: float, min_value: float = 0.2, max_value: float = 10.0) -> float:
    try:
        v = float(value)
        if min_value <= v <= max_value:
            return v
    except Exception:
        pass
    return default


def _positive_int(value: Any, default: int, min_value: int = 1, max_value: int = 120) -> int:
    try:
        v = int(value)
        if min_value <= v <= max_value:
            return v
    except Exception:
        pass
    return default


def load_hls_output_settings(
    gis_config_path: Path,
    default_hls_time: float = 0.25,
    default_hls_list_size: int = 48,
    default_hls_delete_threshold: int = 24,
) -> HlsOutputSettings:
    """Read HLS segment retention policy from GISDashBoard.json.

    Supported JSON shape:
      "hlsOutput": {
        "hlsTime": 0.25,
        "hlsListSize": 48,
        "hlsDeleteThreshold": 24
      }

    These values reduce browser 404s under multi-view playback by keeping
    a wider live window and delaying deletion of older segments.
    """
    raw: Dict[str, Any] = {}
    try:
        if gis_config_path.exists():
            loaded = json.loads(gis_config_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                raw = loaded
    except Exception as e:
        print(f"[WARN] failed to read GIS HLS output settings: {gis_config_path} -> {e}")

    out = raw.get("hlsOutput") or raw.get("hlsSegment") or raw.get("hlsSegments") or {}
    if not isinstance(out, dict):
        out = {}

    hls_time = _positive_float(out.get("hlsTime", out.get("hls_time")), default_hls_time)
    hls_list_size = _positive_int(out.get("hlsListSize", out.get("hls_list_size")), default_hls_list_size)
    hls_delete_threshold = _positive_int(out.get("hlsDeleteThreshold", out.get("hls_delete_threshold")), default_hls_delete_threshold)

    # Keep a sensible relationship: deletion threshold should not be tiny when list is large.
    if hls_delete_threshold < max(2, hls_list_size // 3):
        hls_delete_threshold = max(2, hls_list_size // 3)

    return HlsOutputSettings(
        hls_time=hls_time,
        hls_list_size=hls_list_size,
        hls_delete_threshold=hls_delete_threshold,
    )


def _bool_setting(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    v = str(value).strip().lower()
    if v in ("1", "true", "yes", "y", "on", "enable", "enabled"):
        return True
    if v in ("0", "false", "no", "n", "off", "disable", "disabled"):
        return False
    return default


def _audio_codec(value: Any, default: str = "aac") -> str:
    v = str(value or "").strip().lower()
    # Browser-compatible HLS audio should remain AAC unless explicitly disabled.
    return v if v in {"aac"} else default



def load_hls_watchdog_settings(gis_config_path: Path) -> HlsWatchdogSettings:
    """Read stream restart/watchdog policy from GISDashBoard.json.

    The watchdog is intentionally conservative: it uses a soft stale warning and
    restarts only after hard stale conditions. This prevents repeated ffmpeg
    launches while the previous process is still shutting down.
    """
    raw: Dict[str, Any] = {}
    try:
        if gis_config_path.exists():
            loaded = json.loads(gis_config_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                raw = loaded
    except Exception as e:
        print(f"[WARN] failed to read GIS HLS watchdog settings: {gis_config_path} -> {e}")

    wd = raw.get("hlsWatchdog") or raw.get("watchdog") or {}
    if not isinstance(wd, dict):
        wd = {}

    stale_default = _positive_float(wd.get("staleM3u8Sec", wd.get("stale_m3u8_sec")), 25.0, 5.0, 180.0)
    hard_default = max(stale_default, _positive_float(wd.get("hardStaleSec", wd.get("hard_stale_sec")), 45.0, 10.0, 300.0))
    return HlsWatchdogSettings(
        enabled=_bool_setting(wd.get("enabled"), True),
        startup_grace_sec=_positive_float(wd.get("startupGraceSec", wd.get("startup_grace_sec")), 45.0, 10.0, 180.0),
        soft_stale_sec=_positive_float(wd.get("softStaleSec", wd.get("soft_stale_sec")), 10.0, 3.0, 120.0),
        stale_m3u8_sec=stale_default,
        hard_stale_sec=hard_default,
        restart_delay_sec=_positive_float(wd.get("restartDelaySec", wd.get("restart_delay_sec")), 5.0, 1.0, 60.0),
        min_restart_interval_sec=_positive_float(wd.get("minRestartIntervalSec", wd.get("min_restart_interval_sec")), 20.0, 5.0, 300.0),
        max_restarts_per_hour=_positive_int(wd.get("maxRestartsPerHour", wd.get("max_restarts_per_hour")), 30, 1, 120),
        preserve_hls_on_restart=_bool_setting(wd.get("preserveHlsOnRestart", wd.get("preserve_hls_on_restart")), True),
    )


def load_hls_audio_settings(gis_config_path: Path) -> HlsAudioSettings:
    """Read HLS audio policy from GISDashBoard.json.

    Supported JSON shape:
      "hlsAudio": {
        "enabled": true,
        "rtspPlusAudio": true,
        "rtspAudio": false,
        "codec": "aac",
        "bitrate": "128k",
        "sampleRate": 44100,
        "channels": 2
      }

    The default keeps audio only for RTSP+ streams such as YTN. General RTSP
    cameras stay video-only to avoid unnecessary bandwidth, CPU/GPU load,
    browser audio policies, and multi-view instability.
    """
    raw: Dict[str, Any] = {}
    try:
        if gis_config_path.exists():
            loaded = json.loads(gis_config_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                raw = loaded
    except Exception as e:
        print(f"[WARN] failed to read GIS HLS audio settings: {gis_config_path} -> {e}")

    aud = raw.get("hlsAudio") or raw.get("audio") or {}
    if not isinstance(aud, dict):
        aud = {}

    bitrate = str(aud.get("bitrate", aud.get("audioBitrate", "128k")) or "128k").strip() or "128k"
    sample_rate = _positive_int(aud.get("sampleRate", aud.get("sample_rate")), 44100, 8000, 96000)
    channels = _positive_int(aud.get("channels", aud.get("ac")), 2, 1, 8)

    return HlsAudioSettings(
        enabled=_bool_setting(aud.get("enabled"), True),
        rtsp_plus_audio=_bool_setting(aud.get("rtspPlusAudio", aud.get("rtsp_plus_audio")), True),
        rtsp_audio=_bool_setting(aud.get("rtspAudio", aud.get("rtsp_audio")), False),
        codec=_audio_codec(aud.get("codec"), "aac"),
        bitrate=bitrate,
        sample_rate=sample_rate,
        channels=channels,
    )


def should_include_audio(cam: Camera, audio_settings: HlsAudioSettings) -> bool:
    if not audio_settings.enabled:
        return False
    source_type = (cam.source_type or "rtsp").strip().lower()
    if source_type == "rtsp+":
        return audio_settings.rtsp_plus_audio
    if source_type == "rtsp":
        return audio_settings.rtsp_audio
    return False


def is_cuda_failure(log_tail: str) -> bool:
    t = (log_tail or "").lower()
    return any(
        key in t
        for key in (
            "cuda_error",
            "failed setup for format cuda",
            "scale_cuda",
            "h264_nvenc",
            "nvenc",
            "nvdec",
            "cuvidcreatedecoder",
            "hwaccel initialisation returned error",
        )
    )


def ensure_parent_dir(p: Path) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)


def ensure_config_exists(config_path: Path) -> None:
    if config_path.exists():
        return
    ensure_parent_dir(config_path)
    template = {
        "version": 1,
        "maxStreams": 20,
        "savedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "active": []
    }
    config_path.write_text(json.dumps(template, ensure_ascii=False, indent=2), encoding="utf-8")


def reset_active_config(config_path: Path) -> None:
    ensure_config_exists(config_path)
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        raw = {"version": 1, "maxStreams": 20, "active": []}

    if not isinstance(raw, dict):
        raw = {"version": 1, "maxStreams": 20, "active": []}

    raw["version"] = int(raw.get("version") or 1)
    raw["maxStreams"] = int(raw.get("maxStreams") or 20)
    active = raw.get("active", [])
    if not isinstance(active, list):
        active = []
    raw["active"] = [item for item in active if isinstance(item, dict) and item.get("alwaysOn") and (item.get("rtsp") or item.get("url"))]
    raw["savedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    config_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")


def clear_media_root(media_root: Path) -> None:
    if not media_root.exists():
        return

    for child in media_root.iterdir():
        try:
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            else:
                child.unlink(missing_ok=True)
        except Exception as e:
            console_line(f"[WARN] media cleanup failed: {child} -> {e}")


def _normalize_config(raw) -> Tuple[Dict[str, Camera], int]:
    cams: Dict[str, Camera] = {}
    max_streams = 20

    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            cid = (item.get("id") or "").strip()
            rtsp = (item.get("rtsp") or item.get("url") or "").strip()
            name = (item.get("name") or "").strip()
            if cid and rtsp:
                source_type = (item.get("sourceType") or item.get("source_type") or "rtsp").strip().lower()
                restart_token = str(item.get("restartToken") or item.get("restart_token") or item.get("lastRestartRequestedAt") or "")
                session_token = str(item.get("sessionId") or item.get("sessionToken") or restart_token or "")
                cams[cid] = Camera(id=cid, rtsp=rtsp, name=name, source_type=source_type, restart_token=restart_token, session_token=session_token)
        return cams, max_streams

    if not isinstance(raw, dict):
        return cams, max_streams

    max_streams = int(raw.get("maxStreams") or 20)
    active = raw.get("active", [])
    if isinstance(active, list):
        for item in active:
            if not isinstance(item, dict):
                continue
            cid = (item.get("id") or "").strip()
            rtsp = (item.get("rtsp") or item.get("url") or "").strip()
            name = (item.get("name") or "").strip()
            if cid and rtsp:
                source_type = (item.get("sourceType") or item.get("source_type") or "rtsp").strip().lower()
                restart_token = str(item.get("restartToken") or item.get("restart_token") or item.get("lastRestartRequestedAt") or "")
                session_token = str(item.get("sessionId") or item.get("sessionToken") or restart_token or "")
                cams[cid] = Camera(id=cid, rtsp=rtsp, name=name, source_type=source_type, restart_token=restart_token, session_token=session_token)

    return cams, max_streams


def load_camera_list(config_path: Path) -> Tuple[Dict[str, Camera], int]:
    ensure_config_exists(config_path)
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    # Backward compatibility: older configs were a plain list of cameras
    if isinstance(raw, list):
        raw = {"version": 0, "maxStreams": len(raw), "active": raw}
    return _normalize_config(raw)


def is_cam_active_in_config(config_path: Path, cam_id: str) -> bool:
    """Return True only when cam_id is still present in camera_list.json active list.

    The watchdog calls this before restarting ffmpeg. This prevents a released/closed
    normal RTSP camera from being resurrected by a stale watchdog loop.
    """
    try:
        cams, _ = load_camera_list(config_path)
        return cam_id in cams
    except Exception:
        # Fail closed for normal RTSP streams; a missing/broken runtime file should not restart old viewers.
        return False


def ensure_out_dir(media_root: Path, cid: str) -> Path:
    d = media_root / cid
    d.mkdir(parents=True, exist_ok=True)
    return d


def clear_camera_media(media_root: Path, cid: str) -> None:
    target = media_root / cid
    try:
        shutil.rmtree(target, ignore_errors=True)
    except Exception as e:
        console_line(f"[WARN] failed to remove camera media {cid}: {e}")


def clear_camera_media_if_safe(config_path: Path, media_root: Path, cid: str, old_session_token: str = "") -> bool:
    """Remove HLS files only when the camera has not been reopened with a new session.

    Close/open can overlap on Windows. A stale stop_worker must never delete the
    HLS directory that belongs to a newer active viewer session.
    """
    try:
        cams, _ = load_camera_list(config_path)
        current = cams.get(cid)
        if current is not None:
            current_token = current.session_token or current.restart_token or ""
            if current_token and current_token != (old_session_token or ""):
                console_line(f"[SKIP_CLEANUP] {cid} reopened currentSession={current_token} oldSession={old_session_token or 'none'}")
                return False
            # If it is active at all, keep the directory. The running/new worker owns it.
            console_line(f"[SKIP_CLEANUP] {cid} still active session={current_token or 'none'}")
            return False
    except Exception as e:
        console_line(f"[WARN] cleanup active check failed for {cid}: {e}")
    clear_camera_media(media_root, cid)
    return True


def build_ffmpeg_cmd(
    ffmpeg: str,
    cam: Camera,
    out_dir: Path,
    mode: str,
    use_gpu: bool,
    fps_a: int,
    fps_b: int,
    hls_time: float,
    hls_list_size: int,
    hls_delete_threshold: int,
    audio_settings: HlsAudioSettings,
    gpu_index: int = 0,
    start_number: int = 0,
) -> list:
    mode = (mode or "A").upper().strip()
    if mode not in ("A", "B"):
        mode = "A"

    if mode == "A":
        fps = fps_a
        vf = f"scale_cuda=w=-2:h=ih/2,fps={fps}" if use_gpu else f"scale=w=-2:h=ih/2,fps={fps},format=yuv420p"
    else:
        fps = fps_b
        vf = f"fps={fps}" if use_gpu else f"fps={fps},format=yuv420p"

    out_m3u8 = Path("stream.m3u8")
    seg_pat = Path("segment_%03d.m4s")
    init_name = "init.mp4"

    # RTSP+ always-on encoder streams usually benefit from lower latency.
    # General RTSP cameras are more fragile: too-small probe/analyze values can make
    # ffmpeg exit before stream.m3u8 is created, which appears in the browser as
    # repeated /media/<camId>/stream.m3u8 404 errors.
    low_latency_input = (cam.source_type or "rtsp").lower() == "rtsp+"

    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel", "info",
        "-stats",
        "-stats_period", "0.5",
        "-progress", str(out_dir / "ffmpeg_progress.txt"),
        "-rtsp_transport", "tcp",
    ]

    if low_latency_input:
        # RTSP+ encoder streams such as YTN can include late SPS/PPS or audio/data tracks.
        # Too-small probe/analyze values caused unspecified-size warnings and weak audio detection,
        # so keep a safer probe while retaining low-delay flags.
        cmd += [
            "-analyzeduration", "3000000",
            "-probesize", "3000000",
            "-fflags", "nobuffer",
            "-flags", "low_delay",
        ]
    else:
        cmd += [
            "-analyzeduration", "1000000",
            "-probesize", "1000000",
        ]

    if use_gpu:
        # Limit decoder threads to reduce NVDEC/CUDA surface pressure on notebook GPUs.
        cmd += ["-threads", "1", "-hwaccel", "cuda", "-hwaccel_device", str(max(0, int(gpu_index))), "-hwaccel_output_format", "cuda"]

    include_audio = should_include_audio(cam, audio_settings)
    cmd += ["-i", cam.rtsp, "-map", "0:v:0"]
    if include_audio:
        # Optional audio map: YTN/RTSP+ gets audio when present,
        # while cameras without an audio stream do not fail.
        cmd += ["-map", "0:a:0?"]
    cmd += ["-vf", vf]

    if use_gpu:
        cmd += ["-c:v", "h264_nvenc", "-gpu", str(max(0, int(gpu_index))), "-preset", "p1", "-tune", "ll", "-rc", "vbr", "-cq", "28", "-bf", "0"]
    else:
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-bf", "0"]

    if include_audio:
        cmd += [
            "-c:a", audio_settings.codec,
            "-b:a", audio_settings.bitrate,
            "-ac", str(audio_settings.channels),
            "-ar", str(audio_settings.sample_rate),
        ]
    else:
        # Keep ordinary RTSP cameras video-only. This avoids unnecessary
        # HLS bandwidth and browser audio-policy side effects.
        cmd += ["-an"]

    cmd += [
        "-g", str(fps),
        "-keyint_min", str(fps),
        "-sc_threshold", "0",
        "-f", "hls",
        "-hls_time", str(hls_time),
        "-hls_list_size", str(hls_list_size),
        "-hls_delete_threshold", str(hls_delete_threshold),
        "-start_number", str(max(0, int(start_number or 0))),
        "-hls_flags", "delete_segments+independent_segments",
        "-hls_segment_type", "fmp4",
        "-hls_fmp4_init_filename", init_name,
        "-hls_segment_filename", str(seg_pat),
        str(out_m3u8),
    ]
    return cmd


def _popen_creationflags() -> int:
    if os.name == "nt":
        flags = subprocess.CREATE_NEW_PROCESS_GROUP
        # CREATE_NO_WINDOW prevents ffmpeg/ffprobe error dialogs from blocking the dashboard.
        flags |= getattr(subprocess, "CREATE_NO_WINDOW", 0)
        return flags
    return 0


def latest_segment_state(out_dir: Path) -> Tuple[int, float]:
    """Return latest HLS media segment number and mtime. Best-effort."""
    latest_no = -1
    latest_mtime = 0.0
    try:
        for child in out_dir.iterdir():
            name = child.name.lower()
            if not (name.endswith(".m4s") or name.endswith(".ts")):
                continue
            # segment_123.m4s / segment_123.ts
            stem = child.stem
            digits = "".join(ch for ch in stem.split("_")[-1] if ch.isdigit())
            no = int(digits) if digits else -1
            mtime = child.stat().st_mtime
            if no > latest_no or (no == latest_no and mtime > latest_mtime):
                latest_no = no
                latest_mtime = mtime
    except Exception:
        pass
    return latest_no, latest_mtime




def hls_media_health(out_dir: Path) -> Dict[str, Any]:
    """Return HLS output health for converter-side supervision."""
    now = time.time()
    m3u8 = out_dir / "stream.m3u8"
    m3u8_age = None
    if m3u8.exists():
        try:
            m3u8_age = max(0.0, now - m3u8.stat().st_mtime)
        except Exception:
            m3u8_age = None
    seg_no, seg_mtime = latest_segment_state(out_dir)
    seg_age = None
    if seg_mtime > 0:
        seg_age = max(0.0, now - seg_mtime)
    seg_count = 0
    try:
        seg_count = len(list(out_dir.glob("segment_*.m4s"))) + len(list(out_dir.glob("segment_*.ts")))
    except Exception:
        seg_count = 0
    return {
        "m3u8_exists": m3u8.exists(),
        "m3u8_age": m3u8_age,
        "latest_segment_no": seg_no,
        "latest_segment_age": seg_age,
        "segment_count": seg_count,
    }


def hls_health_is_stale(health: Dict[str, Any], start_ts: float, watchdog_settings: HlsWatchdogSettings) -> Tuple[bool, str]:
    """Decide whether active HLS output is stale enough for converter-side restart."""
    now = time.time()
    active_age = now - start_ts
    hard = float(watchdog_settings.hard_stale_sec if watchdog_settings else 45.0)
    startup = float(watchdog_settings.startup_grace_sec if watchdog_settings else 45.0)
    if active_age <= startup:
        return False, f"startup-grace {active_age:.1f}s/{startup:.1f}s"
    if not health.get("m3u8_exists"):
        return True, f"m3u8-missing activeAge={active_age:.1f}s"
    if int(health.get("segment_count") or 0) <= 0:
        return True, f"segment-missing activeAge={active_age:.1f}s"
    seg_age = health.get("latest_segment_age")
    m3u8_age = health.get("m3u8_age")
    if seg_age is not None and seg_age > hard:
        return True, f"segment-stale {seg_age:.1f}s"
    if m3u8_age is not None and m3u8_age > hard:
        return True, f"m3u8-stale {m3u8_age:.1f}s"
    return False, "healthy"

def clear_hls_output_files(out_dir: Path) -> None:
    """Remove old HLS outputs before a controlled restart. Logs are kept elsewhere."""
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        for child in out_dir.iterdir():
            if child.is_file() and (
                child.name == "stream.m3u8"
                or child.name == "stream.m3u8.tmp"
                or child.name == "init.mp4"
                or child.name == "ffmpeg_progress.txt"
                or child.name.lower().endswith((".m4s", ".ts"))
            ):
                try:
                    child.unlink()
                except Exception:
                    pass
    except Exception as e:
        console_line(f"[WARN] HLS output cleanup failed: {out_dir} -> {e}")


def referenced_hls_media_names(out_dir: Path) -> set:
    """Return media file names currently referenced by stream.m3u8.

    FFmpeg's delete_segments only manages files that belong to the current muxer
    run. After a controlled restart with preserved output, older segment files can
    remain and confuse long-running browser live players. We keep files that are
    still referenced by the active playlist and prune only stale leftovers.
    """
    refs = set()
    m3u8 = out_dir / "stream.m3u8"
    if not m3u8.exists():
        return refs
    try:
        text = m3u8.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return refs
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#EXT-X-MAP"):
            m = re.search(r'URI="([^"]+)"', line)
            if m:
                refs.add(Path(m.group(1).split("?", 1)[0]).name)
            continue
        if line.startswith("#"):
            continue
        refs.add(Path(line.split("?", 1)[0]).name)
    return refs


def list_hls_segment_files(out_dir: Path) -> list:
    """Return HLS media segment file metadata sorted by recency/number."""
    items = []
    try:
        for child in out_dir.iterdir():
            if not child.is_file() or not child.name.lower().endswith((".m4s", ".ts")):
                continue
            no = -1
            m = re.search(r'(\d+)(?=\.(?:m4s|ts)$)', child.name, flags=re.I)
            if m:
                try:
                    no = int(m.group(1))
                except Exception:
                    no = -1
            try:
                st = child.stat()
                mtime = st.st_mtime
            except Exception:
                mtime = 0.0
            items.append({"path": child, "name": child.name, "no": no, "mtime": mtime})
    except Exception:
        pass
    items.sort(key=lambda x: (x.get("no", -1), x.get("mtime", 0.0)), reverse=True)
    return items


def prune_stale_hls_segments(
    out_dir: Path,
    hls_list_size: int,
    hls_delete_threshold: int,
    cam_id: str = "",
    force: bool = False,
) -> Tuple[int, int]:
    """Prune stale leftover segment files while keeping the active playlist safe.

    Expected live segment files are roughly hls_list_size + hls_delete_threshold.
    V77.11 keeps a safety margin above that, but removes hundreds of old segment
    files left by previous ffmpeg runs so the browser cannot loop on stale media.
    """
    segments = list_hls_segment_files(out_dir)
    total = len(segments)
    keep_recent = max(72, int(hls_list_size or 36) + int(hls_delete_threshold or 18) + 24)
    prune_threshold = max(120, keep_recent * 2)
    if not force and total <= prune_threshold:
        return 0, total

    referenced = referenced_hls_media_names(out_dir)
    keep = set(referenced)
    for item in segments[:keep_recent]:
        keep.add(item["name"])

    deleted = 0
    for item in segments:
        if item["name"] in keep:
            continue
        try:
            item["path"].unlink()
            deleted += 1
        except Exception:
            pass

    if deleted:
        console_line(f"[HLS_PRUNE] {cam_id or out_dir.name} deleted={deleted} totalBefore={total} keepRecent={keep_recent} refs={len(referenced)}")
    return deleted, total


def terminate_process(proc: subprocess.Popen, timeout_sec: float = 5.0) -> None:
    if proc.poll() is not None:
        return

    try:
        if os.name == "nt":
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            proc.send_signal(signal.SIGTERM)
    except Exception:
        pass

    t0 = time.time()
    while time.time() - t0 < timeout_sec:
        if proc.poll() is not None:
            return
        time.sleep(0.1)

    try:
        proc.kill()
    except Exception:
        pass


def worker_loop(
    ffmpeg: str,
    config_path: Path,
    cam: Camera,
    gpu_index: int,
    media_root: Path,
    logs_dir: Path,
    mode: str,
    engine: str,
    fallback_to_cpu: bool,
    fps_a: int,
    fps_b: int,
    hls_time: float,
    hls_list_size: int,
    hls_delete_threshold: int,
    audio_settings: HlsAudioSettings,
    watchdog_settings: HlsWatchdogSettings,
    stop_flag: threading.Event,
    alerter: Optional[EmailAlerter] = None,
    alert_key_prefix: str = "ffmpeg",
) -> None:
    out_dir = ensure_out_dir(media_root, cam.id)
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_path = logs_dir / f"{cam.id}.log"
    preferred_engine = normalize_engine(engine, "cpu")
    effective_engine = preferred_engine
    restart_times = []
    hls_start_failures = 0
    first_ffmpeg_run = True

    while not global_stop.is_set() and not stop_flag.is_set():
        if not is_cam_active_in_config(config_path, cam.id):
            with log_path.open("a", encoding="utf-8") as lf:
                log_line(lf, f"[SKIP] {cam.id} is no longer active in camera_list.json. Worker will stop without restart.")
            break
        use_gpu = effective_engine == "gpu"
        selected_gpu_index = gpu_index
        # V77.07: ordinary RTSP and RTSP+ may use different GPU indexes.
        if use_gpu:
            selected_gpu_index = gpu_index
        # V77.11: every ffmpeg run gets a unique HLS start number so new playlists
        # never reuse old segment_000.m4s names after a restart. For rtsp+/alwaysOn
        # streams such as video1, clear old HLS media before a new run to prevent
        # stale segment accumulation and short repeated loops. The browser keeps the
        # last decoded frame via overlay until fresh HLS output is ready.
        run_start_number = int(time.time() * 100)
        is_rtsp_plus = (cam.source_type or "rtsp").lower() == "rtsp+"
        if first_ffmpeg_run or not getattr(watchdog_settings, "preserve_hls_on_restart", True):
            clear_hls_output_files(out_dir)
        elif is_rtsp_plus:
            clear_hls_output_files(out_dir)
        else:
            prune_stale_hls_segments(out_dir, hls_list_size, hls_delete_threshold, cam.id, force=True)
        cmd = build_ffmpeg_cmd(ffmpeg, cam, out_dir, mode, use_gpu, fps_a, fps_b, hls_time, hls_list_size, hls_delete_threshold, audio_settings, selected_gpu_index, run_start_number)

        env = os.environ.copy()
        if use_gpu:
            env["CUDA_VISIBLE_DEVICES"] = str(selected_gpu_index)

        with log_path.open("a", encoding="utf-8") as lf:
            log_line(lf, "===== START =====")
            log_line(lf, f"[SESSION] session={cam.session_token or 'none'} restartToken={cam.restart_token or 'none'}")
            log_line(lf, f"ENGINE: {effective_engine} preferred={preferred_engine} fallbackToCpu={fallback_to_cpu} sourceType={cam.source_type} audio={should_include_audio(cam, audio_settings)}")
            log_line(lf, "CMD: " + " ".join(cmd))

            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=lf,
                    stderr=lf,
                    env=env,
                    cwd=str(out_dir),
                    creationflags=_popen_creationflags(),
                )
            except Exception as e:
                log_line(lf, f"[PopenError] {e}")
                time.sleep(2)
                continue

            log_line(lf, f"[FFMPEG_START] pid={getattr(proc, 'pid', 'unknown')} cam={cam.id} engine={effective_engine} session={cam.session_token or cam.restart_token or 'none'}")
            lf.flush()

            with workers_lock:
                st = workers.get(cam.id)
                if st:
                    st.proc = proc

            start_ts = time.time()
            m3u8_path = out_dir / "stream.m3u8"
            last_watchdog_note = 0.0
            last_soft_note = 0.0
            last_restart_at = restart_times[-1] if restart_times else 0.0
            last_seg_no, last_seg_mtime = latest_segment_state(out_dir)
            last_progress_ts = time.time()
            first_m3u8_logged = False
            first_segment_logged = False
            controlled_restart = False
            progress_path = out_dir / "ffmpeg_progress.txt"
            last_progress_report = {}
            last_progress_frame = ""
            last_progress_out_time = ""
            last_progress_log_at = 0.0
            last_hls_prune_at = 0.0
            while proc.poll() is None and not global_stop.is_set() and not stop_flag.is_set():
                now_ts = time.time()
                if now_ts - last_hls_prune_at >= 15.0:
                    prune_stale_hls_segments(out_dir, hls_list_size, hls_delete_threshold, cam.id)
                    last_hls_prune_at = now_ts
                if watchdog_settings.enabled:
                    restart_times = [t for t in restart_times if now_ts - t < 3600]

                    progress = parse_progress_file(progress_path)
                    if progress:
                        frame = progress.get("frame", "")
                        out_time = progress.get("out_time", progress.get("out_time_ms", ""))
                        speed = progress.get("speed", "")
                        if frame != last_progress_frame or out_time != last_progress_out_time:
                            last_progress_frame, last_progress_out_time = frame, out_time
                            last_progress_ts = now_ts
                        if now_ts - last_progress_log_at > 15:
                            log_line(lf, f"[FFMPEG_PROGRESS] frame={frame or '-'} out_time={out_time or '-'} speed={speed or '-'} progress={progress.get('progress','-')}")
                            lf.flush()
                            last_progress_log_at = now_ts
                        last_progress_report = progress

                    seg_no, seg_mtime = latest_segment_state(out_dir)
                    if seg_no > last_seg_no or seg_mtime > last_seg_mtime:
                        last_seg_no, last_seg_mtime = seg_no, seg_mtime
                        last_progress_ts = now_ts

                    m3u8_age = None
                    if m3u8_path.exists():
                        try:
                            m3u8_age = now_ts - m3u8_path.stat().st_mtime
                            if not first_m3u8_logged:
                                log_line(lf, f"[HLS] stream.m3u8 created after {now_ts - start_ts:.1f}s")
                                lf.flush()
                                first_m3u8_logged = True
                            # stream.m3u8 mtime is one signal, segment progress is another.
                            # Either one means the converter is still doing useful work.
                            if m3u8_age <= watchdog_settings.soft_stale_sec:
                                last_progress_ts = now_ts
                        except Exception:
                            pass
                    if seg_no >= 0 and not first_segment_logged:
                        log_line(lf, f"[HLS] first segment detected segment_{seg_no:03d} after {now_ts - start_ts:.1f}s")
                        lf.flush()
                        first_segment_logged = True

                    no_playlist_too_long = (not m3u8_path.exists()) and (now_ts - start_ts > watchdog_settings.startup_grace_sec)
                    progress_stale_for = now_ts - last_progress_ts
                    soft_stale = (m3u8_age is not None and m3u8_age > watchdog_settings.soft_stale_sec) or progress_stale_for > watchdog_settings.soft_stale_sec
                    hard_stale = no_playlist_too_long or progress_stale_for > watchdog_settings.hard_stale_sec or (m3u8_age is not None and m3u8_age > watchdog_settings.hard_stale_sec)

                    if soft_stale and now_ts - last_soft_note > 10:
                        log_line(lf, f"[WATCHDOG] soft stale: m3u8Age={m3u8_age if m3u8_age is not None else 'none'} progressStale={progress_stale_for:.1f}s. Waiting before restart.")
                        lf.flush()
                        last_soft_note = now_ts

                    can_restart = (now_ts - last_restart_at) >= watchdog_settings.min_restart_interval_sec
                    if hard_stale and can_restart and len(restart_times) < watchdog_settings.max_restarts_per_hour:
                        if not is_cam_active_in_config(config_path, cam.id):
                            log_line(lf, f"[WATCHDOG] {cam.id} removed from active list. Stop monitoring and do not restart.")
                            lf.flush()
                            stop_flag.set()
                            terminate_process(proc, timeout_sec=5.0)
                            break
                        if no_playlist_too_long:
                            reason = f"stream.m3u8 not created within {watchdog_settings.startup_grace_sec:.1f}s"
                            log_line(lf, f"[HLS_WAIT_FAIL] {cam.id} stream.m3u8 not created within {watchdog_settings.startup_grace_sec:.1f}s session={cam.session_token or cam.restart_token or 'none'}")
                        else:
                            reason = f"HLS progress stale for {progress_stale_for:.1f}s (m3u8Age={m3u8_age if m3u8_age is not None else 'none'}, frame={last_progress_report.get('frame','-')}, out_time={last_progress_report.get('out_time','-')}, speed={last_progress_report.get('speed','-')})"
                            log_line(lf, f"[FFMPEG_STALL] {cam.id} {reason}")
                        log_line(lf, f"[WATCHDOG] {reason}. Controlled restart: terminating existing ffmpeg before new start.")
                        lf.flush()
                        restart_times.append(now_ts)
                        last_restart_at = now_ts
                        controlled_restart = True
                        terminate_process(proc, timeout_sec=5.0)
                        break
                    elif hard_stale and not can_restart and now_ts - last_watchdog_note > 10:
                        log_line(lf, f"[WATCHDOG] hard stale but restart cooldown active ({now_ts - last_restart_at:.1f}s/{watchdog_settings.min_restart_interval_sec:.1f}s).")
                        lf.flush()
                        last_watchdog_note = now_ts
                    elif hard_stale and len(restart_times) >= watchdog_settings.max_restarts_per_hour and now_ts - last_watchdog_note > 60:
                        log_line(lf, "[WATCHDOG] restart rate limit reached; keeping current process state and not launching more ffmpeg instances.")
                        lf.flush()
                        last_watchdog_note = now_ts
                time.sleep(0.5)

            if proc.poll() is None:
                terminate_process(proc)

            log_line(lf, f"===== EXIT rc={proc.poll()} =====")
            try:
                log_line(lf, f"[FFMPEG_EXIT] cam={cam.id} rc={proc.poll()} elapsed={time.time()-start_ts:.1f}s lastFrame={last_progress_report.get('frame','-')} lastTime={last_progress_report.get('out_time','-')} lastSpeed={last_progress_report.get('speed','-')}")
            except Exception:
                pass
            if controlled_restart and not global_stop.is_set() and not stop_flag.is_set():
                if (cam.source_type or "rtsp").lower() == "rtsp+":
                    log_line(lf, "[WATCHDOG] old ffmpeg exited. Next rtsp+ run will clean HLS outputs to prevent stale segment loops; browser overlay keeps last frame.")
                else:
                    log_line(lf, "[WATCHDOG] old ffmpeg exited. Next run will prune stale HLS outputs before restart.")

        if controlled_restart and not global_stop.is_set() and not stop_flag.is_set() and not getattr(watchdog_settings, "preserve_hls_on_restart", True):
            clear_hls_output_files(out_dir)

        # Alert on failure (best-effort; never crashes worker)
        rc = proc.poll()
        if (
            alerter
            and rc not in (None, 0)
            and not global_stop.is_set()
            and not stop_flag.is_set()
        ):
            tail = tail_text(log_path)
            reason = classify_ffmpeg_failure(tail)
            subject = f"[{alert_key_prefix}] {cam.id} {reason} rc={rc}"
            body = (
                f"Camera: {cam.id} ({cam.name})\n"
                f"SourceType: {cam.source_type}\n"
                f"RTSP: {mask_rtsp_url(cam.rtsp)}\n"
                f"GPU_INDEX: {selected_gpu_index}\n"
                f"MODE: {mode}\n"
                f"ENGINE: {effective_engine} preferred={preferred_engine} fallbackToCpu={fallback_to_cpu}\n"
                f"ExitCode: {rc}\n\n"
                "--- last log lines ---\n"
                f"{tail}\n"
            )
            alerter.send(subject=subject, body=body, key=f"{alert_key_prefix}:{cam.id}")

        if global_stop.is_set() or stop_flag.is_set():
            break

        if not is_cam_active_in_config(config_path, cam.id):
            with log_path.open("a", encoding="utf-8") as lf:
                log_line(lf, f"[EXIT] {cam.id} inactive after ffmpeg exit. No restart.")
            break

        if rc not in (None, 0) and effective_engine == "gpu" and fallback_to_cpu and not controlled_restart:
            tail = tail_text(log_path)
            if is_cuda_failure(tail):
                with log_path.open("a", encoding="utf-8") as lf:
                    log_line(lf, "[FALLBACK] GPU/CUDA/NVENC failure detected. Retrying this stream with CPU/libx264.")
                effective_engine = "cpu"
                time.sleep(0.5)
                continue

        # V77.03: if ffmpeg exits/restarts without producing stream.m3u8, isolate
        # that camera with exponential backoff. This prevents cam002/cam003 from
        # churning ffmpeg processes and disturbing always-on streams such as video1/YTN.
        post_health = hls_media_health(out_dir)
        if not post_health.get("m3u8_exists") or int(post_health.get("segment_count") or 0) <= 0:
            hls_start_failures += 1
            initial = 3.0 if (cam.source_type or "").lower() == "rtsp+" else 10.0
            max_backoff = 15.0 if (cam.source_type or "").lower() == "rtsp+" else 30.0
            backoff_sec = min(max_backoff, initial * (2 ** max(0, hls_start_failures - 1)))
            with log_path.open("a", encoding="utf-8") as lf:
                log_line(lf, f"[RESTART_BACKOFF] {cam.id} hlsStartFailures={hls_start_failures} wait={backoff_sec:.1f}s m3u8={post_health.get('m3u8_exists')} segments={post_health.get('segment_count')} rc={rc}")
            slept = 0.0
            while slept < backoff_sec and not global_stop.is_set() and not stop_flag.is_set():
                if not is_cam_active_in_config(config_path, cam.id):
                    break
                time.sleep(min(1.0, backoff_sec - slept))
                slept += min(1.0, backoff_sec - slept)
            continue
        else:
            if hls_start_failures:
                with log_path.open("a", encoding="utf-8") as lf:
                    log_line(lf, f"[RECOVERY_OK] {cam.id} HLS output healthy; reset start failure counter.")
            hls_start_failures = 0

        # Watchdog restarts and normal exits both wait here. This protects Windows
        # from rapid ffmpeg process churn and avoids 0xc0000142 startup popups.
        first_ffmpeg_run = False
        time.sleep(max(0.5, float(watchdog_settings.restart_delay_sec if watchdog_settings else 2.0)))


def start_worker(
    ffmpeg: str,
    config_path: Path,
    cam: Camera,
    gpu_index: int,
    media_root: Path,
    logs_dir: Path,
    mode: str,
    engine: str,
    fallback_to_cpu: bool,
    fps_a: int,
    fps_b: int,
    hls_time: float,
    hls_list_size: int,
    hls_delete_threshold: int,
    audio_settings: HlsAudioSettings,
    watchdog_settings: HlsWatchdogSettings,
    alerter: Optional[EmailAlerter] = None,
    alert_key_prefix: str = "ffmpeg",
) -> None:
    with workers_lock:
        if cam.id in workers:
            return
        stop_flag = threading.Event()
        workers[cam.id] = WorkerState(cam=cam, gpu_index=gpu_index, engine=normalize_engine(engine, "cpu"), proc=None, thread=None, stop_flag=stop_flag)

    t = threading.Thread(
        target=worker_loop,
        args=(ffmpeg, config_path, cam, gpu_index, media_root, logs_dir, mode, engine, fallback_to_cpu, fps_a, fps_b, hls_time, hls_list_size, hls_delete_threshold, audio_settings, watchdog_settings, stop_flag, alerter, alert_key_prefix),
        daemon=True,
    )
    with workers_lock:
        workers[cam.id].thread = t
    t.start()
    console_line(f"[START] {cam.id} ({cam.name}) engine={normalize_engine(engine, 'cpu')} gpuIndex={gpu_index} fallbackToCpu={fallback_to_cpu} session={cam.session_token or cam.restart_token or 'none'}")


def stop_worker(cid: str, media_root: Optional[Path] = None, config_path: Optional[Path] = None) -> None:
    with workers_lock:
        st = workers.get(cid)
        if not st:
            if media_root is not None:
                if config_path is not None:
                    clear_camera_media_if_safe(config_path, media_root, cid, "")
                else:
                    clear_camera_media(media_root, cid)
            return
        st.stop_flag.set()
        proc = st.proc
        old_session_token = st.cam.session_token or st.cam.restart_token or ""
        try:
            log_path = (BASE_DIR / "logs" / f"{cid}.log")
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with log_path.open("a", encoding="utf-8") as lf:
                log_line(lf, f"[STOP_REQUEST] {cid} removed from watcher target list; terminating ffmpeg if running.")
        except Exception:
            pass

    if proc and proc.poll() is None:
        terminate_process(proc)

    with workers_lock:
        workers.pop(cid, None)

    if media_root is not None:
        if config_path is not None:
            clear_camera_media_if_safe(config_path, media_root, cid, old_session_token)
        else:
            clear_camera_media(media_root, cid)
    console_line(f"[STOP] {cid}")


def watcher(
    ffmpeg: str,
    config_path: Path,
    media_root: Path,
    logs_dir: Path,
    mode: str,
    gis_config_path: Path,
    cli_gpu_allowed: bool,
    fps_a: int,
    fps_b: int,
    hls_time: float,
    hls_list_size: int,
    hls_delete_threshold: int,
    poll_sec: float,
    alerter: Optional[EmailAlerter] = None,
    alert_key_prefix: str = "ffmpeg",
) -> None:
    last: Dict[str, Camera] = {}
    last_engines: Dict[str, str] = {}
    last_gpu_indexes: Dict[str, int] = {}
    last_fallbacks: Dict[str, bool] = {}
    last_hls_outputs: Dict[str, Tuple[float, int, int]] = {}
    last_hls_audios: Dict[str, Tuple[bool, bool, bool, str, str, int, int]] = {}
    last_hls_watchdogs: Dict[str, Tuple[bool, float, float, float, float, float, float, int, bool]] = {}
    last_restart_tokens: Dict[str, str] = {}

    while not global_stop.is_set():
        try:
            cams, max_streams = load_camera_list(config_path)
            conversion_settings = load_conversion_settings(gis_config_path, cli_gpu_allowed)
            hls_output_settings = load_hls_output_settings(gis_config_path, hls_time, hls_list_size, hls_delete_threshold)
            hls_audio_settings = load_hls_audio_settings(gis_config_path)
            hls_watchdog_settings = load_hls_watchdog_settings(gis_config_path)
        except Exception as e:
            console_line(f"[CONFIG ERROR] {e}")
            time.sleep(poll_sec)
            continue

        if len(cams) > max_streams:
            keep_ids = set(sorted(cams.keys())[:max_streams])
            cams = {cid: cam for cid, cam in cams.items() if cid in keep_ids}

        for cid, cam in cams.items():
            engine = select_conversion_engine(cam, conversion_settings)
            gpu_index = conversion_settings.rtsp_plus_gpu_index if (cam.source_type or "").lower() == "rtsp+" else conversion_settings.rtsp_gpu_index
            fallback_to_cpu = conversion_settings.fallback_to_cpu
            if cid in last and not is_worker_alive(cid):
                console_line(f"[WORKER_RECOVERY] {cid} active but worker is not alive ({get_worker_proc_state(cid)}). Restarting worker.")
                stop_worker(cid, media_root, config_path)
                start_worker(ffmpeg, config_path, cam, gpu_index, media_root, logs_dir, mode, engine, fallback_to_cpu, fps_a, fps_b, hls_output_settings.hls_time, hls_output_settings.hls_list_size, hls_output_settings.hls_delete_threshold, hls_audio_settings, hls_watchdog_settings, alerter, alert_key_prefix)
            elif cid not in last:
                start_worker(ffmpeg, config_path, cam, gpu_index, media_root, logs_dir, mode, engine, fallback_to_cpu, fps_a, fps_b, hls_output_settings.hls_time, hls_output_settings.hls_list_size, hls_output_settings.hls_delete_threshold, hls_audio_settings, hls_watchdog_settings, alerter, alert_key_prefix)
            else:
                changed = (
                    last[cid].rtsp != cam.rtsp
                    or last[cid].source_type != cam.source_type
                    or last[cid].restart_token != cam.restart_token
                    or last[cid].session_token != cam.session_token
                    or last_engines.get(cid) != engine
                    or last_gpu_indexes.get(cid) != gpu_index
                    or last_fallbacks.get(cid) != fallback_to_cpu
                    or last_hls_outputs.get(cid) != (hls_output_settings.hls_time, hls_output_settings.hls_list_size, hls_output_settings.hls_delete_threshold)
                    or last_hls_audios.get(cid) != (hls_audio_settings.enabled, hls_audio_settings.rtsp_plus_audio, hls_audio_settings.rtsp_audio, hls_audio_settings.codec, hls_audio_settings.bitrate, hls_audio_settings.sample_rate, hls_audio_settings.channels)
                    or last_hls_watchdogs.get(cid) != (hls_watchdog_settings.enabled, hls_watchdog_settings.startup_grace_sec, hls_watchdog_settings.soft_stale_sec, hls_watchdog_settings.stale_m3u8_sec, hls_watchdog_settings.hard_stale_sec, hls_watchdog_settings.restart_delay_sec, hls_watchdog_settings.min_restart_interval_sec, hls_watchdog_settings.max_restarts_per_hour, hls_watchdog_settings.preserve_hls_on_restart)
                )
                if changed:
                    if last[cid].restart_token != cam.restart_token:
                        console_line(f"[RESTART_TOKEN] {cid} requested restart token={cam.restart_token} session={cam.session_token or 'none'}")
                    else:
                        console_line(f"[RELOAD] {cid} conversion/session changed -> restart (engine={engine}, gpuIndex={gpu_index}, fallback={fallback_to_cpu}, session={cam.session_token or 'none'})")
                    stop_worker(cid, media_root, config_path)
                    start_worker(ffmpeg, config_path, cam, gpu_index, media_root, logs_dir, mode, engine, fallback_to_cpu, fps_a, fps_b, hls_output_settings.hls_time, hls_output_settings.hls_list_size, hls_output_settings.hls_delete_threshold, hls_audio_settings, hls_watchdog_settings, alerter, alert_key_prefix)

        for cid in list(last.keys()):
            if cid not in cams:
                stop_worker(cid, media_root, config_path)

        last = cams
        last_engines = {cid: select_conversion_engine(cam, conversion_settings) for cid, cam in cams.items()}
        last_gpu_indexes = {cid: (conversion_settings.rtsp_plus_gpu_index if (cam.source_type or "").lower() == "rtsp+" else conversion_settings.rtsp_gpu_index) for cid, cam in cams.items()}
        last_fallbacks = {cid: conversion_settings.fallback_to_cpu for cid in cams.keys()}
        last_hls_outputs = {cid: (hls_output_settings.hls_time, hls_output_settings.hls_list_size, hls_output_settings.hls_delete_threshold) for cid in cams.keys()}
        last_hls_audios = {cid: (hls_audio_settings.enabled, hls_audio_settings.rtsp_plus_audio, hls_audio_settings.rtsp_audio, hls_audio_settings.codec, hls_audio_settings.bitrate, hls_audio_settings.sample_rate, hls_audio_settings.channels) for cid in cams.keys()}
        last_hls_watchdogs = {cid: (hls_watchdog_settings.enabled, hls_watchdog_settings.startup_grace_sec, hls_watchdog_settings.soft_stale_sec, hls_watchdog_settings.stale_m3u8_sec, hls_watchdog_settings.hard_stale_sec, hls_watchdog_settings.restart_delay_sec, hls_watchdog_settings.min_restart_interval_sec, hls_watchdog_settings.max_restarts_per_hour, hls_watchdog_settings.preserve_hls_on_restart) for cid in cams.keys()}
        last_restart_tokens = {cid: cam.restart_token for cid, cam in cams.items()}
        time.sleep(poll_sec)


class SilentHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:
        return


def start_http(shared_dir: Path, host: str, port: int) -> None:
    # IMPORTANT: do not os.chdir() here; it's process-wide and breaks ffmpeg relative outputs.
    handler = lambda *args, **kwargs: SilentHandler(*args, directory=str(shared_dir), **kwargs)
    srv = ThreadingHTTPServer((host, port), handler)
    console_line(f"[HTTP] Serving {shared_dir} on http://{host}:{port}")
    srv.serve_forever()


def handle_exit(signum, frame) -> None:
    raise KeyboardInterrupt


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="RTSP→HLS converter manager (hot reload)")
    p.add_argument("--config", default=str(DEFAULT_CONFIG_FILE), help="camera_list.json path (default: shared/data)")
    p.add_argument("--gis-config", default=str(DEFAULT_GIS_CONFIG_FILE), help="GISDashBoard.json path containing hlsConversion policy")
    p.add_argument("--media", default=str(DEFAULT_MEDIA_ROOT), help="HLS output root (default: shared/media)")
    p.add_argument("--logs", default=str(DEFAULT_LOGS_DIR), help="ffmpeg log dir (default: apps/hls-converter/logs)")
    p.add_argument("--ffmpeg", default="", help="ffmpeg path (optional). If empty, auto-detect.")
    p.add_argument("--mode", default="A", choices=["A", "B"], help="A: 540p/15fps, B: original/30fps")
    p.add_argument("--no-gpu", action="store_true", help="Disable CUDA/NVENC and use libx264")
    p.add_argument("--fps-a", type=int, default=15)
    p.add_argument("--fps-b", type=int, default=30)
    p.add_argument("--hls-time", type=float, default=1.0)
    p.add_argument("--hls-list-size", type=int, default=24, help="Number of HLS segments in live playlist. Higher values reduce segment 404 during playback.")
    p.add_argument("--hls-delete-threshold", type=int, default=12, help="Extra old segments to keep before deletion. Reduces 404 when player lags behind live edge.")
    p.add_argument("--http-host", default="0.0.0.0")
    p.add_argument("--http-port", type=int, default=0, help="Optional built-in shared-folder HTTP server port. 0 disables it. Media is served by HLS API on 8080.")
    p.add_argument("--poll", type=float, default=2.0)

    # Email alerts (optional)
    p.add_argument("--email", dest="email", action="store_true", help="Send email on ffmpeg errors (uses env vars by default)")
    p.add_argument("--nomail", dest="email", action="store_false", help="Disable email alerts even if SMTP env vars are set")
    p.set_defaults(email=False)
    p.add_argument("--smtp-host", default=os.environ.get("SMTP_HOST", ""), help="SMTP host (or env SMTP_HOST)")
    p.add_argument("--smtp-port", type=int, default=int(os.environ.get("SMTP_PORT", "465")), help="SMTP port (or env SMTP_PORT)")
    p.add_argument("--smtp-user", default=os.environ.get("SMTP_USER", ""), help="SMTP user (or env SMTP_USER)")
    p.add_argument("--smtp-pass", default=os.environ.get("SMTP_PASS", ""), help="SMTP password (or env SMTP_PASS)")
    p.add_argument("--smtp-to", default=os.environ.get("SMTP_TO", ""), help="Alert recipient (or env SMTP_TO)")
    p.add_argument("--email-cooldown", type=int, default=int(os.environ.get("EMAIL_COOLDOWN_SEC", "300")), help="Per-camera cooldown seconds")
    p.add_argument("--email-prefix", default=os.environ.get("EMAIL_SUBJECT_PREFIX", "RTSP-HLS"), help="Subject prefix")

    return p.parse_args()


def main() -> None:
    args = parse_args()

    config_path = Path(args.config).resolve()
    gis_config_path = Path(args.gis_config).resolve()
    media_root = Path(args.media).resolve()
    logs_dir = Path(args.logs).resolve()

    ensure_config_exists(config_path)
    media_root.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    startup_cleanup = read_startup_cleanup_settings(gis_config_path)
    if startup_cleanup.get("enabled", True) and startup_cleanup.get("forceKillAllFfmpegOnStartup", True):
        kill_all_ffmpeg_processes_on_startup(logs_dir, reason="converter_startup")
    if startup_cleanup.get("cleanupMediaOnStartup", True):
        clear_media_root(media_root)
    reset_active_config(config_path)

    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, handle_exit)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, handle_exit)

    ffmpeg = find_ffmpeg(args.ffmpeg or None, gis_config_path)
    log_ffmpeg_diagnostics(ffmpeg, logs_dir)
    use_gpu = not args.no_gpu

    alerter: Optional[EmailAlerter] = None
    if args.email:
        if not (args.smtp_host and args.smtp_user and args.smtp_pass and args.smtp_to):
            print("[EMAIL] enabled but SMTP settings missing. Provide --smtp-* or set env SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_TO")
        else:
            alerter = EmailAlerter(
                enabled=True,
                host=args.smtp_host,
                port=args.smtp_port,
                user=args.smtp_user,
                password=args.smtp_pass,
                to_addr=args.smtp_to,
                subject_prefix=args.email_prefix,
                cooldown_sec=max(1, int(args.email_cooldown)),
            )
            print(f"[EMAIL] alerts enabled: {args.smtp_to} via {args.smtp_host}:{args.smtp_port}")
    else:
        print("[EMAIL] alerts disabled (--nomail or default)")

    print("=== RTSP → HLS 멀티 카메라 관리 시스템 시작 (A/B 테스트 가능) ===")
    print(f"[DEBUG] CONFIG = {config_path}")
    print(f"[DEBUG] GISCFG = {gis_config_path}")
    print(f"[DEBUG] MEDIA  = {media_root}")
    print(f"[DEBUG] LOGS   = {logs_dir}")
    print(f"[DEBUG] FFMPEG = {ffmpeg}")
    conv_settings = load_conversion_settings(gis_config_path, use_gpu)
    hls_out_settings = load_hls_output_settings(gis_config_path, args.hls_time, args.hls_list_size, args.hls_delete_threshold)
    hls_audio_settings = load_hls_audio_settings(gis_config_path)
    hls_watchdog_settings = load_hls_watchdog_settings(gis_config_path)
    print(f"[DEBUG] MODE   = {args.mode} (cliGpuAllowed={use_gpu})")
    print(f"[DEBUG] HLS_CONVERSION rtsp={conv_settings.rtsp_engine}, rtsp+={conv_settings.rtsp_plus_engine}, gpuIndex={conv_settings.gpu_index}, rtspGpuIndex={conv_settings.rtsp_gpu_index}, rtspPlusGpuIndex={conv_settings.rtsp_plus_gpu_index}, fallbackToCpu={conv_settings.fallback_to_cpu}")
    print(f"[DEBUG] HLS_OUTPUT time={hls_out_settings.hls_time}, listSize={hls_out_settings.hls_list_size}, deleteThreshold={hls_out_settings.hls_delete_threshold}, startNumber=epoch, stalePrune=enabled")
    print(f"[DEBUG] HLS_AUDIO enabled={hls_audio_settings.enabled}, rtsp+={hls_audio_settings.rtsp_plus_audio}, rtsp={hls_audio_settings.rtsp_audio}, codec={hls_audio_settings.codec}, bitrate={hls_audio_settings.bitrate}")
    print(f"[DEBUG] HLS_WATCHDOG enabled={hls_watchdog_settings.enabled}, startupGrace={hls_watchdog_settings.startup_grace_sec}s, softStale={hls_watchdog_settings.soft_stale_sec}s, staleM3u8={hls_watchdog_settings.stale_m3u8_sec}s, hardStale={hls_watchdog_settings.hard_stale_sec}s, minRestartInterval={hls_watchdog_settings.min_restart_interval_sec}s, maxRestartsPerHour={hls_watchdog_settings.max_restarts_per_hour}, preserveHlsOnRestart={hls_watchdog_settings.preserve_hls_on_restart}")
    if int(args.http_port or 0) > 0:
        print(f"[HTTP] Optional converter HTTP enabled: http://127.0.0.1:{args.http_port}/media/cam001/stream.m3u8")
        threading.Thread(target=start_http, args=(SHARED_DIR, args.http_host, args.http_port), daemon=True).start()
    else:
        print("[HTTP] Optional converter HTTP disabled. Use HLS API media server on http://127.0.0.1:8080/media/...")
    threading.Thread(
        target=watcher,
        args=(ffmpeg, config_path, media_root, logs_dir, args.mode, gis_config_path, use_gpu, args.fps_a, args.fps_b, args.hls_time, args.hls_list_size, args.hls_delete_threshold, args.poll, alerter, "ffmpeg"),
        daemon=True,
    ).start()

    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n[INFO] 종료 요청(CTRL+C). 정리 중...")
    finally:
        global_stop.set()
        with workers_lock:
            ids = list(workers.keys())
        for cid in ids:
            stop_worker(cid, media_root, config_path)
        time.sleep(0.5)
        reset_active_config(config_path)
        clear_media_root(media_root)
        print("[INFO] media cleanup complete")


if __name__ == "__main__":
    main()
