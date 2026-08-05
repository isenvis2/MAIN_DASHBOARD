import express from "express";
import cors from "cors";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import net from "net";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SHARED = path.join(ROOT, "shared");
const DATA_DIR = path.join(SHARED, "data");
const MEDIA_DIR = path.join(SHARED, "media");
const WEB_DIR = path.join(ROOT, "apps", "hls_converter", "web");

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:8090",
  "http://127.0.0.1:8090",
  "http://localhost:8100",
  "http://127.0.0.1:8100",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3100",
  "http://127.0.0.1:3100"
];
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const CORS_ORIGINS = new Set([...DEFAULT_ALLOWED_ORIGINS, ...ALLOWED_ORIGINS]);
function isPrivateLanHost(hostname = "") {
  const h = String(hostname).trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0" ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h);
}
function isAllowedCorsOrigin(origin = "") {
  const o = String(origin || "").trim();
  if (!o) return true;
  if (CORS_ORIGINS.has(o)) return true;
  try {
    const url = new URL(o);
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    const allowedPorts = new Set([8080, 8090, 8100, 3000, 3005, 5173, 8000, 3100]);
    return (url.protocol === "http:" || url.protocol === "https:") && allowedPorts.has(port) && isPrivateLanHost(url.hostname);
  } catch {
    return false;
  }
}
function getCorsOriginForRequest(req) {
  const origin = String(req.headers.origin || "").trim();
  if (origin && isAllowedCorsOrigin(origin)) return origin;
  // Non-browser direct requests do not have Origin. Keep them open.
  if (!origin) return "*";
  return null;
}

function applyCorsHeaders(req, res, next) {
  const corsOrigin = getCorsOriginForRequest(req);

  // Hard guard: some middleware/static handlers may try to overwrite
  // Access-Control-Allow-Origin. For API responses, the value must match
  // the browser request Origin exactly, e.g. localhost:8090 -> localhost:8090.
  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = (name, value) => {
    if (String(name || "").toLowerCase() === "access-control-allow-origin") {
      if (corsOrigin) return originalSetHeader(name, corsOrigin);
      return res;
    }
    return originalSetHeader(name, value);
  };

  if (corsOrigin) {
    originalSetHeader("Access-Control-Allow-Origin", corsOrigin);
    if (corsOrigin !== "*") originalSetHeader("Vary", "Origin");
  }
  originalSetHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  originalSetHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  originalSetHeader("Access-Control-Max-Age", "600");

  if (req.method === "OPTIONS") {
    if (!corsOrigin) return res.sendStatus(403);
    return res.sendStatus(204);
  }
  return next();
}
const app = express();
app.use(applyCorsHeaders);
app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  if (normalizeLogMode(hlsApiLogSettings.mode, "normal") === "debug") {
    const started = Date.now();
    res.on("finish", () => {
      rtDebug(`[HTTP] ${req.method} ${req.originalUrl} status=${res.statusCode} elapsedMs=${Date.now() - started} origin=${req.headers.origin || "-"}`);
    });
  }
  next();
});

console.log("====================================");
console.log("[PATH CHECK]");
console.log("__dirname =", __dirname);
console.log("ROOT      =", ROOT);
console.log("WEB_DIR   =", WEB_DIR);
console.log("DATA_DIR  =", DATA_DIR);
console.log("MEDIA_DIR =", MEDIA_DIR);
console.log("====================================");

const PATH_SITES = path.join(DATA_DIR, "sites.json");
const PATH_CAMERAS = path.join(DATA_DIR, "cameras.json");
const PATH_ACTIVE = path.join(DATA_DIR, "camera_list.json");
const PATH_GIS_DASHBOARD = path.join(DATA_DIR, "GISDashBoard.json");
const PATH_PRECHECK = path.join(DATA_DIR, "stream_precheck.json");
const TMP = (p) => `${p}.tmp`;

const LOGS_DIR = path.join(ROOT, "apps", "hls_converter", "converter", "logs");
const SHARED_LOGS_DIR = path.join(SHARED, "logs");
const API_LOG_FILE = path.join(SHARED_LOGS_DIR, "hls_api.log");
const API_VERSION = "v78.02";

function tsNow() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function normalizeLogMode(value, fallback = "normal") {
  const v = String(value || "").trim().toLowerCase();
  if (["debug", "verbose", "detail", "d"].includes(v)) return "debug";
  if (["normal", "info", "n"].includes(v)) return "normal";
  if (["quiet", "error", "warn"].includes(v)) return "quiet";
  return fallback;
}

let hlsApiLogSettings = {
  enabled: true,
  mode: normalizeLogMode(process.env.HLS_LOG_MODE || process.env.DEBUG_MODE || "normal", "normal"),
  file: API_LOG_FILE,
  maxBytes: 2 * 1024 * 1024,
  backups: 3,
  console: true
};

function logLevelRank(level) {
  const v = String(level || "INFO").toUpperCase();
  if (v === "ERROR") return 0;
  if (v === "WARN") return 1;
  if (v === "INFO") return 2;
  if (v === "DEBUG") return 3;
  return 2;
}

function shouldWriteApiLog(level) {
  if (!hlsApiLogSettings.enabled) return false;
  const mode = normalizeLogMode(hlsApiLogSettings.mode, "normal");
  if (mode === "debug") return true;
  if (mode === "quiet") return logLevelRank(level) <= logLevelRank("WARN");
  return logLevelRank(level) <= logLevelRank("INFO");
}

function stringifyLogArg(arg) {
  if (arg instanceof Error) return arg.stack || arg.message || String(arg);
  if (typeof arg === "string") return maskRtspUrl(arg);
  try { return maskRtspUrl(JSON.stringify(arg)); } catch { return maskRtspUrl(String(arg)); }
}

function rotateApiLogIfNeeded() {
  try {
    const file = hlsApiLogSettings.file || API_LOG_FILE;
    const maxBytes = Math.max(64 * 1024, Number(hlsApiLogSettings.maxBytes || 0) || (2 * 1024 * 1024));
    const backups = Math.max(1, Math.min(10, Number(hlsApiLogSettings.backups || 3)));
    if (!fsSync.existsSync(file)) return;
    const st = fsSync.statSync(file);
    if (st.size < maxBytes) return;
    for (let i = backups - 1; i >= 1; i -= 1) {
      const src = `${file}.${i}`;
      const dst = `${file}.${i + 1}`;
      if (fsSync.existsSync(src)) fsSync.renameSync(src, dst);
    }
    fsSync.renameSync(file, `${file}.1`);
  } catch {}
}

function apiLog(level, ...args) {
  const upperLevel = String(level || "INFO").toUpperCase();
  if (!shouldWriteApiLog(upperLevel)) return;
  const line = `[${tsNow()}] [${upperLevel}] ${args.map(stringifyLogArg).join(" ")}`;
  try {
    fsSync.mkdirSync(path.dirname(hlsApiLogSettings.file || API_LOG_FILE), { recursive: true });
    rotateApiLogIfNeeded();
    fsSync.appendFileSync(hlsApiLogSettings.file || API_LOG_FILE, `${line}\n`, "utf-8");
  } catch {}
  if (hlsApiLogSettings.console !== false) {
    if (upperLevel === "ERROR") console.error(line);
    else if (upperLevel === "WARN") console.warn(line);
    else console.log(line);
  }
}
function rtLog(...args) { apiLog("INFO", ...args); }
function rtDebug(...args) { apiLog("DEBUG", ...args); }
function rtWarn(...args) { apiLog("WARN", ...args); }
function rtError(...args) { apiLog("ERROR", ...args); }

function maskRtspUrl(text) {
  return String(text || "").replace(/rtsp:\/\/([^:\/@\s]+)(?::([^@\s]*))?@/gi, (_m, user) => `rtsp://${user}:***@`);
}

function classifyConverterLog(logText) {
  const t = String(logText || "").toLowerCase();
  if (!t.trim()) return "로그 없음";
  const hasSuccessfulInput = t.includes("stream #0:0: video") || t.includes("opening 'segment_") || t.includes('opening "segment_') || t.includes("opening 'init.mp4'");
  if (!hasSuccessfulInput && (t.includes("unauthorized") || t.includes("401"))) return "RTSP 인증 실패 가능성";
  if (t.includes("[watchdog]") && (t.includes("controlled restart") || t.includes("old ffmpeg exited"))) return "HLS 재시작 중 / 새 segment 대기";
  if (t.includes("connection refused")) return "RTSP 연결 거부";
  if (t.includes("error number -10054") || t.includes("connection reset") || t.includes("forcibly closed")) return "RTSP 연결 중단 / 원격 종료";
  if (t.includes("timed out") || t.includes("timeout")) return "RTSP 연결 시간 초과";
  if (t.includes("no route to host") || t.includes("network is unreachable")) return "카메라 네트워크 접근 불가";
  if (t.includes("server returned 404") || t.includes("404 not found")) return "RTSP 경로 오류 가능성";
  if (t.includes("output file does not contain any stream") || t.includes("stream specifier") && t.includes("matches no streams")) return "RTSP 영상 스트림 없음";
  if (t.includes("invalid data found") || t.includes("could not find codec parameters")) return "RTSP/코덱 분석 실패";
  if (t.includes("immediate exit requested") || t.includes("received signal 2")) return "변환 프로세스 외부 종료";
  if (t.includes("cuda_error") || t.includes("scale_cuda") || t.includes("failed setup for format cuda") || t.includes("nvenc error") || t.includes("nvdec")) return "GPU/CUDA 변환 실패";
  if (t.includes("option not found")) return "FFmpeg 옵션 호환 문제";
  if (t.includes("===== exit rc=")) return "FFmpeg 프로세스 종료";
  return "변환 로그 확인 필요";
}

async function readTextTail(filePath, maxBytes = 16000) {
  try {
    const fh = await fs.open(filePath, "r");
    try {
      const st = await fh.stat();
      const len = Math.min(st.size, maxBytes);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, Math.max(0, st.size - len));
      return buf.toString("utf-8").split(/\r?\n/).slice(-80).join("\n");
    } finally {
      await fh.close();
    }
  } catch {
    return "";
  }
}


app.use("/data", express.static(DATA_DIR, {
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-store");
  }
}));

app.get("/favicon.ico", (req, res) => res.status(204).end());

async function ensureFile(filePath, initialObj) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(initialObj, null, 2), "utf-8");
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureCanonicalCameras() {
  const dataExists = await fileExists(PATH_CAMERAS);
  if (!dataExists) {
    await fs.mkdir(path.dirname(PATH_CAMERAS), { recursive: true });
    await fs.writeFile(PATH_CAMERAS, JSON.stringify({ version: 2, cameras: [] }, null, 2), "utf-8");
    rtWarn("[CONFIG] shared/data/cameras.json was missing; created empty canonical camera list.");
  }
}

async function readJson(p) {
  const raw = await fs.readFile(p, "utf-8");
  return JSON.parse(raw);
}

const jsonWriteLocks = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueTmpPath(p) {
  const rand = Math.random().toString(16).slice(2);
  return `${p}.${process.pid}.${Date.now()}.${rand}.tmp`;
}

async function renameWithRetry(tmp, dest, { attempts = 8, delayMs = 40 } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await fs.rename(tmp, dest);
      return;
    } catch (err) {
      lastErr = err;
      if (!["EPERM", "EBUSY", "EACCES"].includes(err?.code)) throw err;
      await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr;
}

async function atomicWriteJsonUnlocked(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = uniqueTmpPath(p);
  try {
    await fs.writeFile(tmp, JSON.stringify(obj, null, 2), "utf-8");
    await renameWithRetry(tmp, p);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function atomicWriteJson(p, obj) {
  const previous = jsonWriteLocks.get(p) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => atomicWriteJsonUnlocked(p, obj));
  jsonWriteLocks.set(p, next);
  try {
    await next;
  } finally {
    if (jsonWriteLocks.get(p) === next) jsonWriteLocks.delete(p);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function makeStreamSessionId(camId) {
  const safe = isSafeCameraId(camId) ? camId : "cam";
  return `${safe}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function streamHlsPath(camId, sessionId = "") {
  const base = `/media/${encodeURIComponent(camId)}/stream.m3u8`;
  const sid = String(sessionId || "").trim();
  return sid ? `${base}?sid=${encodeURIComponent(sid)}` : base;
}

function normalizeConversionEngine(value, fallback = "cpu") {
  const v = String(value || "").trim().toLowerCase();
  if (["gpu", "cuda", "nvenc", "nvidia"].includes(v)) return "gpu";
  if (["cpu", "libx264", "software"].includes(v)) return "cpu";
  return fallback;
}

async function readHlsConversionSettings() {
  await ensureAll();
  let cfg = {};
  try {
    cfg = await readJson(PATH_GIS_DASHBOARD);
  } catch {}
  const conv = cfg?.hlsConversion && typeof cfg.hlsConversion === "object" ? cfg.hlsConversion : {};
  return {
    rtspEngine: normalizeConversionEngine(conv.rtspEngine ?? conv.rtsp, "cpu"),
    rtspPlusEngine: normalizeConversionEngine(conv.rtspPlusEngine ?? conv.rtspPlus ?? conv.rtsp_plus, "gpu"),
    gpuIndex: Number.isFinite(Number(conv.gpuIndex ?? conv.gpu)) ? Math.max(0, Number(conv.gpuIndex ?? conv.gpu)) : 0,
    rtspGpuIndex: Number.isFinite(Number(conv.rtspGpuIndex ?? conv.gpuIndex ?? conv.gpu)) ? Math.max(0, Number(conv.rtspGpuIndex ?? conv.gpuIndex ?? conv.gpu)) : 0,
    rtspPlusGpuIndex: Number.isFinite(Number(conv.rtspPlusGpuIndex ?? conv.gpuIndex ?? conv.gpu)) ? Math.max(0, Number(conv.rtspPlusGpuIndex ?? conv.gpuIndex ?? conv.gpu)) : 0,
    fallbackToCpu: conv.fallbackToCpu ?? conv.gpuFallbackToCpu ?? true
  };
}

function selectConversionEngineForSource(sourceType, settings) {
  return String(sourceType || "").toLowerCase() === "rtsp+" ? settings.rtspPlusEngine : settings.rtspEngine;
}

async function readHlsOutputSettings() {
  await ensureAll();
  let cfg = {};
  try {
    cfg = await readJson(PATH_GIS_DASHBOARD);
  } catch {}
  const out = cfg?.hlsOutput && typeof cfg.hlsOutput === "object" ? cfg.hlsOutput : {};
  const positiveNumber = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  let hlsTime = positiveNumber(out.hlsTime ?? out.hls_time, 0.25, 0.1, 10.0);
  let hlsListSize = Math.round(positiveNumber(out.hlsListSize ?? out.hls_list_size, 48, 1, 240));
  let hlsDeleteThreshold = Math.round(positiveNumber(out.hlsDeleteThreshold ?? out.hls_delete_threshold, 24, 1, 240));
  if (hlsDeleteThreshold < Math.max(2, Math.floor(hlsListSize / 3))) {
    hlsDeleteThreshold = Math.max(2, Math.floor(hlsListSize / 3));
  }
  return { hlsTime, hlsListSize, hlsDeleteThreshold };
}

async function readHlsStartupSettings() {
  await ensureAll();
  let cfg = {};
  try {
    cfg = await readJson(PATH_GIS_DASHBOARD);
  } catch {}
  const raw = cfg?.hlsStartup && typeof cfg.hlsStartup === "object" ? cfg.hlsStartup : {};
  const positiveNumber = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  const boolValue = (value, fallback) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const v = value.trim().toLowerCase();
      if (["1", "true", "yes", "y", "on", "enabled"].includes(v)) return true;
      if (["0", "false", "no", "n", "off", "disabled"].includes(v)) return false;
    }
    return fallback;
  };
  return {
    fastStart: boolValue(raw.fastStart, true),
    minSegmentsToPlay: Math.round(positiveNumber(raw.minSegmentsToPlay, 1, 1, 10)),
    maxM3u8AgeSec: Math.round(positiveNumber(raw.maxM3u8AgeSec, 6, 1, 60)),
    initialWaitMs: Math.round(positiveNumber(raw.initialWaitMs, 3000, 500, 60000)),
    backgroundWaitMs: Math.round(positiveNumber(raw.backgroundWaitMs, 60000, 10000, 300000)),
    fastProbeIntervalMs: Math.round(positiveNumber(raw.fastProbeIntervalMs, 500, 200, 10000)),
    retryIntervalMs: Math.round(positiveNumber(raw.retryIntervalMs, 1000, 500, 30000)),
    statusIntervalMs: Math.round(positiveNumber(raw.statusIntervalMs, 1000, 500, 30000)),
    probeAnalyzeDuration: Math.round(positiveNumber(raw.probeAnalyzeDuration, 1000000, 0, 30000000)),
    probeSize: Math.round(positiveNumber(raw.probeSize, 1000000, 32, 30000000))
  };
}

function boolSetting(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Boolean(value);
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on", "enable", "enabled"].includes(v)) return true;
  if (["0", "false", "no", "n", "off", "disable", "disabled"].includes(v)) return false;
  return fallback;
}


async function readHlsLoggingSettings() {
  await ensureAll();
  let cfg = {};
  try { cfg = await readJson(PATH_GIS_DASHBOARD); } catch {}
  const raw = cfg?.hlsLogging && typeof cfg.hlsLogging === "object" ? cfg.hlsLogging : {};
  const positiveInt = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
  };
  const fileValue = String(raw.apiLogFile || raw.file || "").trim();
  let file = API_LOG_FILE;
  if (fileValue) {
    file = path.isAbsolute(fileValue) ? fileValue : path.join(ROOT, fileValue);
  }
  return {
    enabled: boolSetting(raw.enabled, true),
    mode: normalizeLogMode(raw.mode || process.env.HLS_LOG_MODE || process.env.DEBUG_MODE || "normal", "normal"),
    file,
    maxBytes: positiveInt(raw.maxBytes, 2 * 1024 * 1024, 64 * 1024, 50 * 1024 * 1024),
    backups: positiveInt(raw.backups, 3, 1, 10),
    console: boolSetting(raw.console, true)
  };
}

async function refreshHlsLoggingSettings(reason = "refresh") {
  try {
    hlsApiLogSettings = await readHlsLoggingSettings();
    rtLog(`[LOGGING] mode=${hlsApiLogSettings.mode} file=${hlsApiLogSettings.file} reason=${reason}`);
  } catch (err) {
    rtWarn(`[LOGGING] failed to load logging settings reason=${reason}:`, err?.message || err);
  }
}


async function readHlsWatchdogSettings() {
  await ensureAll();
  let cfg = {};
  try { cfg = await readJson(PATH_GIS_DASHBOARD); } catch {}
  const raw = cfg?.hlsWatchdog && typeof cfg.hlsWatchdog === "object" ? cfg.hlsWatchdog : {};
  const positiveNumber = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  const stale = positiveNumber(raw.staleM3u8Sec ?? raw.stale_m3u8_sec, 25, 5, 180);
  const hard = Math.max(stale, positiveNumber(raw.hardStaleSec ?? raw.hard_stale_sec, 45, 10, 300));
  return {
    enabled: boolSetting(raw.enabled, true),
    startupGraceSec: positiveNumber(raw.startupGraceSec ?? raw.startup_grace_sec, 45, 10, 180),
    softStaleSec: positiveNumber(raw.softStaleSec ?? raw.soft_stale_sec, 10, 3, 120),
    staleM3u8Sec: stale,
    hardStaleSec: hard,
    restartDelaySec: positiveNumber(raw.restartDelaySec ?? raw.restart_delay_sec, 5, 1, 60),
    minRestartIntervalSec: positiveNumber(raw.minRestartIntervalSec ?? raw.min_restart_interval_sec, 20, 5, 300),
    maxRestartsPerHour: Math.round(positiveNumber(raw.maxRestartsPerHour ?? raw.max_restarts_per_hour, 6, 1, 60))
  };
}

async function readHlsRestartBackoffSettings() {
  await ensureAll();
  let cfg = {};
  try { cfg = await readJson(PATH_GIS_DASHBOARD); } catch {}
  const raw = cfg?.hlsRestartBackoff && typeof cfg.hlsRestartBackoff === "object" ? cfg.hlsRestartBackoff : {};
  const positiveNumber = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    enabled: boolSetting(raw.enabled, true),
    normalInitialSec: positiveNumber(raw.normalInitialSec ?? raw.initialSec, 10, 2, 600),
    normalMaxSec: positiveNumber(raw.normalMaxSec ?? raw.maxSec, 30, 5, 1800),
    alwaysOnInitialSec: positiveNumber(raw.alwaysOnInitialSec, 3, 1, 1800),
    alwaysOnMaxSec: positiveNumber(raw.alwaysOnMaxSec, 15, 3, 3600),
    successResetFreshSegmentSec: positiveNumber(raw.successResetFreshSegmentSec, 6, 1, 60),
    maxClientRestartsPerHour: Math.round(positiveNumber(raw.maxClientRestartsPerHour, 12, 1, 120))
  };
}

function computeRestartBackoffMs(activeItem, backoffSettings) {
  const attempts = Math.max(0, Number(activeItem?.restartAttemptCount || 0));
  const alwaysOn = Boolean(activeItem?.alwaysOn) || String(activeItem?.sourceType || "").toLowerCase() === "rtsp+";
  const initial = (alwaysOn ? backoffSettings.alwaysOnInitialSec : backoffSettings.normalInitialSec) * 1000;
  const max = (alwaysOn ? backoffSettings.alwaysOnMaxSec : backoffSettings.normalMaxSec) * 1000;
  return Math.min(max, initial * Math.pow(2, Math.max(0, attempts - 1)));
}

function restartHistoryWithinHour(activeItem) {
  const now = Date.now();
  const list = Array.isArray(activeItem?.restartHistory) ? activeItem.restartHistory : [];
  return list
    .map((x) => Date.parse(String(x || "")))
    .filter((t) => Number.isFinite(t) && now - t < 3600_000)
    .map((t) => new Date(t).toISOString());
}

async function readHlsAudioSettings() {
  await ensureAll();
  let cfg = {};
  try {
    cfg = await readJson(PATH_GIS_DASHBOARD);
  } catch {}
  const aud = cfg?.hlsAudio && typeof cfg.hlsAudio === "object" ? cfg.hlsAudio : {};
  const positiveNumber = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  const codec = String(aud.codec || "aac").trim().toLowerCase() === "aac" ? "aac" : "aac";
  const bitrate = String(aud.bitrate || aud.audioBitrate || "128k").trim() || "128k";
  const sampleRate = Math.round(positiveNumber(aud.sampleRate ?? aud.sample_rate, 44100, 8000, 96000));
  const channels = Math.round(positiveNumber(aud.channels ?? aud.ac, 2, 1, 8));
  return {
    enabled: boolSetting(aud.enabled, true),
    rtspPlusAudio: boolSetting(aud.rtspPlusAudio ?? aud.rtsp_plus_audio, true),
    rtspAudio: boolSetting(aud.rtspAudio ?? aud.rtsp_audio, false),
    codec,
    bitrate,
    sampleRate,
    channels
  };
}

function shouldIncludeAudioForSource(sourceType, audioSettings) {
  if (!audioSettings?.enabled) return false;
  const type = String(sourceType || "").trim().toLowerCase();
  if (type === "rtsp+") return Boolean(audioSettings.rtspPlusAudio);
  if (type === "rtsp") return Boolean(audioSettings.rtspAudio);
  return false;
}


function stringList(value) {
  if (Array.isArray(value)) return value.map((x) => String(x || "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function normalizeToolPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const expanded = raw.replace(/%([^%]+)%/g, (_m, name) => process.env[name] || _m);
  if (path.isAbsolute(expanded) || /^[A-Za-z]:[\\/]/.test(expanded)) return expanded;
  return path.resolve(ROOT, expanded);
}

async function readHlsToolSettings() {
  try {
    const cfg = await readJson(PATH_GIS_DASHBOARD);
    const tools = cfg?.hlsTools && typeof cfg.hlsTools === "object" ? cfg.hlsTools : {};
    const ffmpegPath = normalizeToolPath(tools.ffmpegPath || tools.ffmpeg || tools.path || "");
    const ffprobePath = normalizeToolPath(tools.ffprobePath || tools.ffprobe || "");
    const ffmpegCandidates = stringList(tools.ffmpegCandidates || tools.ffmpegPaths).map(normalizeToolPath);
    const ffprobeCandidates = stringList(tools.ffprobeCandidates || tools.ffprobePaths).map(normalizeToolPath);
    return {
      ffmpegPath,
      ffprobePath,
      ffmpegCandidates,
      ffprobeCandidates,
      allowPathAutoDetectFallback: boolSetting(tools.allowPathAutoDetectFallback, boolSetting(tools.allowAutoDetectFallback, true))
    };
  } catch {
    return { ffmpegPath: "", ffprobePath: "", ffmpegCandidates: [], ffprobeCandidates: [], allowPathAutoDetectFallback: true };
  }
}

async function findFfprobeCandidates() {
  const tools = await readHlsToolSettings();
  const env = String(process.env.FFPROBE || process.env.FFPROBE_PATH || "").trim();
  const candidates = [];
  if (env) candidates.push(env);
  if (tools.ffprobePath) candidates.push(tools.ffprobePath);
  candidates.push(...tools.ffprobeCandidates);

  // If only ffmpegPath was configured, infer ffprobe.exe from the same folder.
  const ffmpegLike = [tools.ffmpegPath, ...tools.ffmpegCandidates].filter(Boolean);
  for (const ffmpegPath of ffmpegLike) {
    const dir = path.dirname(ffmpegPath);
    if (dir && dir !== ".") candidates.push(path.join(dir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe"));
  }

  candidates.push("C:\\ffmpeg\\bin\\ffprobe.exe");
  candidates.push("C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe");
  if (tools.allowPathAutoDetectFallback) candidates.push("ffprobe");
  return Array.from(new Set(candidates.filter(Boolean)));
}

async function resolveFfprobePath() {
  const candidates = await findFfprobeCandidates();
  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(candidate, ["-version"], { timeout: 1500, windowsHide: true });
      if (String(stdout || "").toLowerCase().includes("ffprobe")) return candidate;
    } catch {}
  }
  return candidates[0] || "ffprobe";
}

function parseRtspEndpoint(rtspUrl) {
  try {
    const u = new URL(String(rtspUrl || ""));
    if (u.protocol !== "rtsp:") return null;
    return { host: u.hostname, port: Number(u.port || 554) || 554 };
  } catch {
    return null;
  }
}

function tcpProbe(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    if (!host || !port) return resolve({ ok: false, reason: "invalid_rtsp_endpoint" });
    const socket = new net.Socket();
    let done = false;
    const finish = (ok, reason) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve({ ok, reason });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, "tcp_connected"));
    socket.once("timeout", () => finish(false, "tcp_timeout"));
    socket.once("error", (err) => finish(false, err?.code || err?.message || "tcp_error"));
    socket.connect(port, host);
  });
}

async function readHlsPrecheckSettings() {
  await ensureAll();
  let cfg = {};
  try { cfg = await readJson(PATH_GIS_DASHBOARD); } catch {}
  const raw = cfg?.hlsPrecheck && typeof cfg.hlsPrecheck === "object" ? cfg.hlsPrecheck : {};
  const positiveNumber = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    enabled: boolSetting(raw.enabled, true),
    tcpTimeoutMs: Math.round(positiveNumber(raw.tcpTimeoutMs, 1200, 300, 10000)),
    ffprobeTimeoutMs: Math.round(positiveNumber(raw.ffprobeTimeoutMs, 4500, 1000, 20000)),
    cacheTtlMs: Math.round(positiveNumber(raw.cacheTtlMs, 10000, 0, 300000)),
    rtspAnalyzeDuration: Math.round(positiveNumber(raw.rtspAnalyzeDuration, 1000000, 0, 30000000)),
    rtspProbeSize: Math.round(positiveNumber(raw.rtspProbeSize, 1000000, 32, 30000000)),
    rtspPlusAnalyzeDuration: Math.round(positiveNumber(raw.rtspPlusAnalyzeDuration, 3000000, 0, 30000000)),
    rtspPlusProbeSize: Math.round(positiveNumber(raw.rtspPlusProbeSize, 3000000, 32, 30000000))
  };
}

async function loadPrecheckCache() {
  try {
    const data = await readJson(PATH_PRECHECK);
    return data && typeof data === "object" ? data : { version: 1, cameras: {} };
  } catch {
    return { version: 1, cameras: {} };
  }
}

async function savePrecheckResult(camId, result) {
  if (!isSafeCameraId(camId)) return;
  const cache = await loadPrecheckCache();
  cache.version = 1;
  cache.cameras = cache.cameras && typeof cache.cameras === "object" ? cache.cameras : {};
  cache.cameras[camId] = result;
  cache.savedAt = nowIso();
  await atomicWriteJson(PATH_PRECHECK, cache).catch(() => {});
}

async function getPrecheckResult(camId) {
  const cache = await loadPrecheckCache();
  return cache?.cameras?.[camId] || null;
}

function precheckFail(reason, extra = {}) {
  return { ok: false, tcpReachable: false, rtspProbeOk: false, reason, ...extra };
}

function classifyFfprobeError(stderr, stdout) {
  const t = `${stderr || ""}\n${stdout || ""}`.toLowerCase();
  if (t.includes("401") || t.includes("unauthorized")) return "RTSP 인증 실패";
  if (t.includes("404") || t.includes("not found")) return "RTSP 경로 오류 또는 스트림 없음";
  if (t.includes("connection refused")) return "RTSP 포트 연결 거부";
  if (t.includes("timed out") || t.includes("timeout")) return "RTSP probe 시간 초과";
  if (t.includes("invalid data") || t.includes("could not find codec parameters")) return "RTSP 영상 스트림 분석 실패";
  if (t.includes("no route") || t.includes("network is unreachable")) return "카메라 네트워크 접근 불가";
  return "RTSP 영상 스트림 확인 실패";
}

async function runRtspPrecheck(cam, source, options = {}) {
  const settings = await readHlsPrecheckSettings();
  const now = nowIso();
  const camId = cam?.id;
  const sourceType = source?.type;
  const rtspUrl = source?.url;
  const cached = await getPrecheckResult(camId);
  if (!options.force && settings.cacheTtlMs > 0 && cached?.lastCheckedAt && cached?.sourceUrl === rtspUrl) {
    const age = Date.now() - Date.parse(cached.lastCheckedAt);
    if (Number.isFinite(age) && age >= 0 && age < settings.cacheTtlMs) return cached;
  }

  if (!settings.enabled) {
    const result = { ok: true, skipped: true, reason: "precheck_disabled", tcpReachable: null, rtspProbeOk: null, lastCheckedAt: now, sourceType, sourceUrl: rtspUrl };
    await savePrecheckResult(camId, result);
    return result;
  }

  const endpoint = parseRtspEndpoint(rtspUrl);
  if (!endpoint) {
    const result = { ...precheckFail("RTSP URL 형식 오류", { sourceType, sourceUrl: rtspUrl, lastCheckedAt: now }) };
    await savePrecheckResult(camId, result);
    return result;
  }

  const tcp = await tcpProbe(endpoint.host, endpoint.port, settings.tcpTimeoutMs);
  if (!tcp.ok) {
    const result = { ok: false, tcpReachable: false, rtspProbeOk: false, reason: `RTSP 포트 접속 불가: ${tcp.reason}`, host: endpoint.host, port: endpoint.port, sourceType, sourceUrl: rtspUrl, lastCheckedAt: now };
    await savePrecheckResult(camId, result);
    return result;
  }

  const ffprobe = await resolveFfprobePath();
  const isPlus = String(sourceType || "").toLowerCase() === "rtsp+";
  const analyze = isPlus ? settings.rtspPlusAnalyzeDuration : settings.rtspAnalyzeDuration;
  const probeSize = isPlus ? settings.rtspPlusProbeSize : settings.rtspProbeSize;
  const args = [
    "-hide_banner",
    "-v", "error",
    "-rtsp_transport", "tcp",
    "-analyzeduration", String(analyze),
    "-probesize", String(probeSize),
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate",
    "-of", "json",
    rtspUrl
  ];
  try {
    const { stdout } = await execFileAsync(ffprobe, args, { timeout: settings.ffprobeTimeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 });
    let parsed = {};
    try { parsed = JSON.parse(stdout || "{}"); } catch {}
    const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
    const video = streams.find((s) => String(s?.codec_type || "").toLowerCase() === "video" && s?.codec_name);
    if (!video) {
      const result = { ok: false, tcpReachable: true, rtspProbeOk: false, reason: "RTSP 포트는 열려 있으나 영상 스트림 없음", host: endpoint.host, port: endpoint.port, sourceType, sourceUrl: rtspUrl, lastCheckedAt: now };
      await savePrecheckResult(camId, result);
      return result;
    }
    const result = {
      ok: true,
      tcpReachable: true,
      rtspProbeOk: true,
      reason: "RTSP video stream 확인 완료",
      host: endpoint.host,
      port: endpoint.port,
      sourceType,
      sourceUrl: rtspUrl,
      video: {
        codec: video.codec_name || null,
        width: Number(video.width) || null,
        height: Number(video.height) || null,
        avgFrameRate: video.avg_frame_rate || video.r_frame_rate || null
      },
      lastCheckedAt: now
    };
    await savePrecheckResult(camId, result);
    return result;
  } catch (err) {
    const result = {
      ok: false,
      tcpReachable: true,
      rtspProbeOk: false,
      reason: classifyFfprobeError(err?.stderr, err?.stdout),
      host: endpoint.host,
      port: endpoint.port,
      sourceType,
      sourceUrl: rtspUrl,
      lastCheckedAt: now
    };
    await savePrecheckResult(camId, result);
    return result;
  }
}

async function removeCameraMedia(camId) {
  if (!isSafeCameraId(camId)) return;
  const camMediaDir = path.join(MEDIA_DIR, camId);
  await fs.rm(camMediaDir, { recursive: true, force: true }).catch(() => {});
}

async function removeCameraMediaIfNotReopened(camId, reason = "cleanup") {
  if (!isSafeCameraId(camId)) return { removed: false, skipped: true, reason: "invalid-cam-id" };
  try {
    const st = await readJson(PATH_ACTIVE).catch(() => ({}));
    const active = Array.isArray(st?.active) ? st.active : [];
    const current = active.find((x) => x?.id === camId);
    if (current) {
      rtWarn(`[MEDIA_CLEANUP] ${camId} skipped reason=${reason} activeSession=${current.sessionId || current.restartToken || "none"}`);
      return { removed: false, skipped: true, reason: "reopened-or-active", sessionId: current.sessionId || null };
    }
  } catch {}
  await removeCameraMedia(camId);
  rtDebug(`[MEDIA_CLEANUP] ${camId} removed reason=${reason}`);
  return { removed: true, skipped: false, reason };
}

function validateSites(body) {
  if (!body || typeof body !== "object") return "Body must be object.";
  if (body.version !== 1) return "Unsupported version.";
  if (!Array.isArray(body.sites)) return "`sites` must be array.";
  if (body.sites.length > 100) return "Max sites is 100.";
  for (const s of body.sites) {
    if (!s.id || typeof s.id !== "string") return "site.id required.";
    if (!s.name || typeof s.name !== "string") return "site.name required.";
    if (!Array.isArray(s.polygon) || s.polygon.length < 3) return "polygon >= 3 required.";
  }
  return null;
}

function isSafeCameraId(camId) {
  return typeof camId === "string" && /^[A-Za-z0-9_.-]{1,96}$/.test(camId);
}

function normalizeCameraSource(cam) {
  const sourceType = typeof cam?.sourceType === "string" ? cam.sourceType.trim().toLowerCase() : "";
  const sourceUrl = typeof cam?.sourceUrl === "string" ? cam.sourceUrl.trim() : "";

  if (sourceType && sourceUrl) {
    if (sourceType === "rtsp" || sourceType === "rtsp+" || sourceType === "hls") {
      return { type: sourceType, url: sourceUrl, normalized: true };
    }
    return { type: "invalid", url: sourceUrl, normalized: false, reason: `unsupported sourceType: ${sourceType}` };
  }

  if (typeof cam?.rtsp === "string" && cam.rtsp.trim()) {
    return { type: "rtsp", url: cam.rtsp.trim(), normalized: false };
  }

  if (typeof cam?.hls === "string" && cam.hls.trim()) {
    return { type: "hls", url: cam.hls.trim(), normalized: false };
  }

  return { type: "invalid", url: "", normalized: false, reason: "camera source missing" };
}

function sanitizeCameraForClient(cam) {
  const resolved = normalizeCameraSource(cam);
  const sourceType = resolved.type === "invalid" ? null : resolved.type;
  const sourceUrl = resolved.type === "invalid" ? null : resolved.url;

  return {
    ...cam,
    sourceType,
    sourceUrl,
    hasSource: Boolean(sourceType && sourceUrl),
    streamMode: (sourceType === "rtsp" || sourceType === "rtsp+") ? "converted" : sourceType === "hls" ? "direct" : null,
    alwaysOn: sourceType === "rtsp+"
  };
}

async function ensureAll() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await ensureCanonicalCameras();
  await ensureFile(PATH_SITES, { version: 1, sites: [] });
  await ensureFile(PATH_CAMERAS, { version: 1, cameras: [] });
  await ensureFile(PATH_ACTIVE, { version: 1, maxStreams: 20, active: [] });
  await ensureFile(PATH_PRECHECK, { version: 1, cameras: {} });
  await ensureFile(PATH_GIS_DASHBOARD, {
    version: 1,
    map: {
      centerLat: 37.5662952,
      centerLng: 126.9779451,
      level: 4
    },
    hlsTools: {
      ffmpegPath: "C:\\ffmpeg\\bin\\ffmpeg.exe",
      ffprobePath: "C:\\ffmpeg\\bin\\ffprobe.exe",
      ffmpegCandidates: [
        "C:\\ffmpeg\\bin\\ffmpeg.exe",
        "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe"
      ],
      ffprobeCandidates: [
        "C:\\ffmpeg\\bin\\ffprobe.exe",
        "C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe"
      ],
      allowPathAutoDetectFallback: false
    },
    hlsConversion: {
      rtspEngine: "cpu",
      rtspPlusEngine: "gpu",
      gpuIndex: 0,
      fallbackToCpu: true
    },
    hlsOutput: {
      hlsTime: 0.25,
      hlsListSize: 48,
      hlsDeleteThreshold: 24
    },
    hlsStartup: {
      fastStart: true,
      minSegmentsToPlay: 1,
      maxM3u8AgeSec: 6,
      initialWaitMs: 3000,
      backgroundWaitMs: 60000,
      fastProbeIntervalMs: 500,
      retryIntervalMs: 1000,
      statusIntervalMs: 1000,
      probeAnalyzeDuration: 1000000,
      probeSize: 1000000
    },
    hlsPrecheck: {
      enabled: true,
      tcpTimeoutMs: 1200,
      ffprobeTimeoutMs: 4500,
      cacheTtlMs: 10000,
      rtspAnalyzeDuration: 1000000,
      rtspProbeSize: 1000000,
      rtspPlusAnalyzeDuration: 3000000,
      rtspPlusProbeSize: 3000000
    },
    hlsAudio: {
      enabled: true,
      rtspPlusAudio: true,
      rtspAudio: false,
      codec: "aac",
      bitrate: "128k",
      sampleRate: 44100,
      channels: 2
    },
    hlsWatchdog: {
      enabled: true,
      startupGraceSec: 45,
      softStaleSec: 10,
      staleM3u8Sec: 25,
      hardStaleSec: 45,
      restartDelaySec: 5,
      minRestartIntervalSec: 20,
      maxRestartsPerHour: 6
    },
    hlsResourceGuard: {
      enabled: true,
      maxViewers: 4,
      closePolicy: "oldest",
      excludeSourceTypes: ["rtsp+"],
      excludeAlwaysOn: true,
      beforeOpenCheck: true,
      autoCloseOldest: true,
      gpu: { enabled: true, maxUtilPercent: 85, maxMemoryPercent: 85 },
      cpu: { enabled: true, maxUtilPercent: 85, maxMemoryPercent: 85 }
    },
    hlsLogging: {
      enabled: true,
      mode: "normal",
      apiLogFile: "shared/logs/hls_api.log",
      maxBytes: 2097152,
      backups: 3,
      console: true
    }
  });
}

app.get("/api/sites", async (req, res) => {
  try {
    await ensureAll();
    return res.json(await readJson(PATH_SITES));
  } catch (e) {
    rtError(e);
    return res.status(500).json({ ok: false, error: "Failed to load sites" });
  }
});

app.put("/api/sites", async (req, res) => {
  try {
    await ensureAll();
    const err = validateSites(req.body);
    if (err) return res.status(400).json({ ok: false, error: err });

    const payload = { ...req.body, savedAt: nowIso() };
    await atomicWriteJson(PATH_SITES, payload);
    return res.json({ ok: true, savedAt: payload.savedAt });
  } catch (e) {
    rtError(e);
    return res.status(500).json({ ok: false, error: "Failed to save sites" });
  }
});



app.get("/api/dashboard-config", async (req, res) => {
  try {
    await ensureAll();
    return res.json(await readJson(PATH_GIS_DASHBOARD));
  } catch (e) {
    rtError(e);
    return res.status(500).json({ ok: false, error: "Failed to load dashboard config" });
  }
});

app.get("/api/cameras", async (req, res) => {
  try {
    await ensureAll();
    const payload = await readJson(PATH_CAMERAS);
    const cameraList = Array.isArray(payload?.cameras) ? payload.cameras : [];
    return res.json({
      ...payload,
      cameras: cameraList.map(sanitizeCameraForClient)
    });
  } catch (e) {
    rtError(e);
    return res.status(500).json({ ok: false, error: "Failed to load cameras" });
  }
});

async function buildAlwaysOnEntries() {
  const payload = await readJson(PATH_CAMERAS);
  const cams = Array.isArray(payload?.cameras) ? payload.cameras : [];
  return cams
    .filter((cam) => isSafeCameraId(cam?.id))
    .map((cam) => ({ cam, source: normalizeCameraSource(cam) }))
    .filter(({ source }) => source.type === "rtsp+")
    .map(({ cam, source }) => ({
      id: cam.id,
      name: cam.name || cam.id,
      rtsp: source.url,
      lastRequestedAt: nowIso(),
      alwaysOn: true,
      sourceType: "rtsp+"
    }));
}

async function syncAlwaysOnStreams() {
  const st = await readJson(PATH_ACTIVE);
  st.version = st.version ?? 1;
  st.maxStreams = st.maxStreams ?? 20;
  st.active = Array.isArray(st.active) ? st.active : [];

  const beforeActive = JSON.stringify(st.active);
  const alwaysEntries = await buildAlwaysOnEntries();
  const alwaysMap = new Map(alwaysEntries.map((x) => [x.id, x]));
  const nextActive = [];
  const removedAlways = [];

  for (const item of st.active) {
    if (item?.alwaysOn || String(item?.sourceType || "").toLowerCase() === "rtsp+") {
      const replacement = alwaysMap.get(item.id);
      if (replacement) {
        nextActive.push({
          ...replacement,
          lastRequestedAt: item.lastRequestedAt || replacement.lastRequestedAt
        });
        alwaysMap.delete(item.id);
      } else {
        removedAlways.push(item);
      }
    } else {
      // Runtime-created normal RTSP entries are preserved while the server is running.
      // They are cleared only by resetRuntimeCameraState() on startup/shutdown.
      nextActive.push(item);
    }
  }

  for (const item of alwaysMap.values()) nextActive.push(item);
  const afterActive = JSON.stringify(nextActive);
  st.active = nextActive;

  // Avoid rewriting camera_list.json on every status/keep-alive read.  This file is
  // shared state, and unnecessary writes caused Windows rename collisions under
  // concurrent keep-alive traffic.
  if (beforeActive !== afterActive || removedAlways.length > 0 || alwaysMap.size > 0) {
    st.savedAt = nowIso();
    await atomicWriteJson(PATH_ACTIVE, st);
    rtDebug(`[CAMERA_LIST] synced alwaysOn entries active=${st.active.length}`);
  }

  for (const item of removedAlways) {
    if (item?.id) await removeCameraMedia(item.id);
  }

  return st;
}

async function resetRuntimeCameraState({ clearRtspMedia = true, reason = "runtime_reset" } = {}) {
  await ensureAll();
  const alwaysEntries = await buildAlwaysOnEntries();
  const payload = {
    version: 1,
    maxStreams: 20,
    active: alwaysEntries,
    resetReason: reason,
    savedAt: nowIso()
  };
  try {
    const old = await readJson(PATH_ACTIVE).catch(() => ({}));
    if (Number.isFinite(Number(old?.maxStreams))) payload.maxStreams = Number(old.maxStreams);
  } catch {}
  await atomicWriteJson(PATH_ACTIVE, payload);

  if (clearRtspMedia) {
    const keep = new Set(alwaysEntries.map((x) => x.id));
    const entries = await fs.readdir(MEDIA_DIR, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (!isSafeCameraId(ent.name)) continue;
      if (keep.has(ent.name)) continue;
      await fs.rm(path.join(MEDIA_DIR, ent.name), { recursive: true, force: true }).catch(() => {});
    }
  }
  return payload;
}

async function shutdownRuntimeCameraState(reason = "api_shutdown") {
  try {
    await resetRuntimeCameraState({ clearRtspMedia: true, reason });
    rtLog(`[RUNTIME] camera_list.json reset (${reason})`);
  } catch (err) {
    rtWarn(`[RUNTIME] failed to reset camera_list.json (${reason}):`, err?.message || err);
  }
}

async function loadActiveState() {
  await ensureAll();
  const st = await syncAlwaysOnStreams();
  st.version = st.version ?? 1;
  st.maxStreams = st.maxStreams ?? 20;
  st.active = st.active ?? [];
  return st;
}

async function removeNormalRtspActiveById(camId, reason = "release") {
  const state = await loadActiveState();
  const before = Array.isArray(state.active) ? state.active.length : 0;
  state.active = Array.isArray(state.active) ? state.active.filter((x) => {
    if (x?.id !== camId) return true;
    if (x?.alwaysOn || String(x?.sourceType || "").toLowerCase() === "rtsp+") return true;
    return false;
  }) : [];
  const removed = before !== state.active.length;
  await atomicWriteJson(PATH_ACTIVE, { ...state, savedAt: nowIso(), lastReleaseReason: reason });
  rtLog(`[RELEASE] ${camId} removed=${removed} reason=${reason}`);
  return { state, removed };
}

async function releaseAllNormalRtsp(reason = "release-all") {
  const state = await loadActiveState();
  const removed = [];
  const kept = [];
  for (const item of Array.isArray(state.active) ? state.active : []) {
    if (item?.alwaysOn || String(item?.sourceType || "").toLowerCase() === "rtsp+") kept.push(item);
    else if (item?.id) removed.push(item);
  }
  state.active = kept;
  await atomicWriteJson(PATH_ACTIVE, { ...state, savedAt: nowIso(), lastReleaseReason: reason });
  for (const item of removed) {
    if (item?.id && isSafeCameraId(item.id)) await removeCameraMediaIfNotReopened(item.id, `release-all:${reason}`);
  }
  rtLog(`[RELEASE_ALL] removed=${removed.map((x) => x.id).join(",") || "none"} reason=${reason}`);
  return { state, removed };
}

function lruTouch(activeList, camId) {
  const idx = activeList.findIndex((x) => x.id === camId);
  if (idx >= 0) {
    activeList[idx].lastRequestedAt = nowIso();
    return { existed: true, evicted: null };
  }
  return { existed: false, evicted: null };
}

function toBoolSetting(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "enabled"].includes(v)) return true;
    if (["0", "false", "no", "off", "disabled"].includes(v)) return false;
  }
  return fallback;
}
function toNumberSetting(value, fallback, min = 0, max = 100000) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}
async function readHlsResourceGuardSettings() {
  await ensureAll();
  let cfg = {};
  try { cfg = await readJson(PATH_GIS_DASHBOARD); } catch {}
  const raw = cfg?.hlsResourceGuard && typeof cfg.hlsResourceGuard === "object" ? cfg.hlsResourceGuard : {};
  const gpu = raw.gpu && typeof raw.gpu === "object" ? raw.gpu : {};
  const cpu = raw.cpu && typeof raw.cpu === "object" ? raw.cpu : {};
  return {
    enabled: toBoolSetting(raw.enabled, true),
    maxViewers: Math.max(1, Math.round(toNumberSetting(raw.maxViewers, 20, 1, 64))),
    // V77.07: GPU stream count and CPU viewer count are separated.
    // YTN/video1(rtsp+) is excluded from normal RTSP eviction and uses the single GPU slot.
    maxGpuStreams: Math.max(1, Math.round(toNumberSetting(raw.maxGpuStreams, 1, 1, 16))),
    maxCpuStreams: Math.max(2, Math.round(toNumberSetting(raw.maxCpuStreams, 4, 2, 64))),
    minCpuViewersBeforeEvict: Math.max(2, Math.round(toNumberSetting(raw.minCpuViewersBeforeEvict, 2, 2, 64))),
    closePolicy: String(raw.closePolicy || "oldest"),
    excludeSourceTypes: Array.isArray(raw.excludeSourceTypes) ? raw.excludeSourceTypes.map((x) => String(x).toLowerCase()) : ["rtsp+"],
    excludeAlwaysOn: toBoolSetting(raw.excludeAlwaysOn, true),
    beforeOpenCheck: toBoolSetting(raw.beforeOpenCheck, true),
    autoCloseOldest: toBoolSetting(raw.autoCloseOldest, true),
    gpu: {
      enabled: toBoolSetting(gpu.enabled, true),
      maxUtilPercent: toNumberSetting(gpu.maxUtilPercent, 85, 1, 100),
      maxMemoryPercent: toNumberSetting(gpu.maxMemoryPercent, 85, 1, 100)
    },
    cpu: {
      enabled: toBoolSetting(cpu.enabled, true),
      maxUtilPercent: toNumberSetting(cpu.maxUtilPercent, 95, 1, 100),
      maxMemoryPercent: toNumberSetting(cpu.maxMemoryPercent, 95, 1, 100)
    }
  };
}

function memorySnapshot() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  return {
    totalBytes: total,
    freeBytes: free,
    usedBytes: used,
    memoryPercent: total > 0 ? Math.round((used / total) * 1000) / 10 : null
  };
}
function cpuSnapshot() {
  const cpus = os.cpus() || [];
  let idle = 0, total = 0;
  for (const c of cpus) {
    const t = c.times || {};
    idle += t.idle || 0;
    total += (t.user || 0) + (t.nice || 0) + (t.sys || 0) + (t.irq || 0) + (t.idle || 0);
  }
  return { idle, total };
}
let lastCpuSnapshot = cpuSnapshot();
function getCpuUtilPercent() {
  const cur = cpuSnapshot();
  const idleDelta = cur.idle - lastCpuSnapshot.idle;
  const totalDelta = cur.total - lastCpuSnapshot.total;
  lastCpuSnapshot = cur;
  if (totalDelta <= 0) return null;
  return Math.round((1 - idleDelta / totalDelta) * 1000) / 10;
}
async function getGpuSnapshot() {
  const result = { available: false, utilPercent: null, memoryPercent: null, memoryUsedMiB: null, memoryTotalMiB: null, error: null };
  try {
    const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"], { timeout: 1500 });
    const line = String(stdout || "").trim().split(/\r?\n/)[0] || "";
    const parts = line.split(",").map((x) => Number(String(x).trim()));
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      const [util, used, total] = parts;
      result.available = true;
      result.utilPercent = util;
      result.memoryUsedMiB = used;
      result.memoryTotalMiB = total;
      result.memoryPercent = total > 0 ? Math.round((used / total) * 1000) / 10 : null;
    }
  } catch (err) {
    result.error = err?.message || String(err);
  }
  return result;
}
async function getSystemResources() {
  const [gpu, cpuUtil] = await Promise.all([getGpuSnapshot(), Promise.resolve(getCpuUtilPercent())]);
  return { ok: true, checkedAt: nowIso(), cpu: { utilPercent: cpuUtil, ...memorySnapshot() }, gpu };
}
function isEvictableActive(item, guard) {
  if (!item) return false;
  if (guard.excludeAlwaysOn && item.alwaysOn) return false;
  const sourceType = String(item.sourceType || "rtsp").toLowerCase();
  if (guard.excludeSourceTypes.includes(sourceType)) return false;
  return true;
}
function evictOldestForResourceGuard(state, guard, newCamId) {
  let oldestIdx = -1;
  let oldestTime = Number.POSITIVE_INFINITY;
  for (let i = 0; i < state.active.length; i += 1) {
    const item = state.active[i];
    if (item?.id === newCamId) continue;
    if (!isEvictableActive(item, guard)) continue;
    const t = Date.parse(item?.lastRequestedAt || item?.openedAt || "1970-01-01T00:00:00Z");
    if (t < oldestTime) { oldestTime = t; oldestIdx = i; }
  }
  if (oldestIdx < 0) return null;
  const [evicted] = state.active.splice(oldestIdx, 1);
  return evicted || null;
}
async function applyResourceGuardBeforeOpen(state, source, conversionEngine, camId) {
  const guard = await readHlsResourceGuardSettings();
  const resources = await getSystemResources();
  const result = { guard, resources, evicted: null, reason: "ok", shouldEvict: false };
  if (!guard.enabled || !guard.beforeOpenCheck || source.type === "hls" || source.type === "rtsp+") return result;
  const normalViewers = state.active.filter((x) => isEvictableActive(x, guard));
  const gpuViewers = state.active.filter((x) => String(x?.conversionEngine || "").toLowerCase() === "gpu" && !x?.alwaysOn);
  const overViewerLimit = normalViewers.length >= guard.maxViewers;
  const gpuMode = conversionEngine === "gpu";
  const overGpuStreamLimit = gpuMode && gpuViewers.length >= guard.maxGpuStreams;
  const overCpuStreamLimit = !gpuMode && normalViewers.length >= guard.maxCpuStreams;
  const gpuOver = gpuMode && guard.gpu.enabled && resources.gpu.available && (
    Number(resources.gpu.utilPercent || 0) >= guard.gpu.maxUtilPercent || Number(resources.gpu.memoryPercent || 0) >= guard.gpu.maxMemoryPercent
  );
  const cpuOverRaw = !gpuMode && guard.cpu.enabled && (
    Number(resources.cpu.utilPercent || 0) >= guard.cpu.maxUtilPercent || Number(resources.cpu.memoryPercent || 0) >= guard.cpu.maxMemoryPercent
  );
  // V77.07: cam002+cam003 must be allowed together. CPU load alone may not evict before at least two normal RTSP viewers are open.
  const cpuOver = cpuOverRaw && normalViewers.length >= guard.minCpuViewersBeforeEvict;
  result.shouldEvict = Boolean(overViewerLimit || overGpuStreamLimit || overCpuStreamLimit || gpuOver || cpuOver);
  if (overViewerLimit) result.reason = `viewer limit ${normalViewers.length}/${guard.maxViewers}`;
  else if (overGpuStreamLimit) result.reason = `GPU stream limit ${gpuViewers.length}/${guard.maxGpuStreams}`;
  else if (overCpuStreamLimit) result.reason = `CPU stream limit ${normalViewers.length}/${guard.maxCpuStreams}`;
  else if (gpuOver) result.reason = `GPU load high util=${resources.gpu.utilPercent}% mem=${resources.gpu.memoryPercent}%`;
  else if (cpuOver) result.reason = `CPU/memory load high util=${resources.cpu.utilPercent}% mem=${resources.cpu.memoryPercent}% viewers=${normalViewers.length}`;
  else if (cpuOverRaw) result.reason = `CPU/memory load high but keep CPU viewer minimum ${normalViewers.length}/${guard.minCpuViewersBeforeEvict}`;
  if (result.shouldEvict && guard.autoCloseOldest) {
    result.evicted = evictOldestForResourceGuard(state, guard, camId);
  }
  return result;
}

function lruEvictIfNeeded(state) {
  const max = state.maxStreams ?? 20;
  if (state.active.length < max) return null;

  let oldestIdx = -1;
  let oldestTime = Number.POSITIVE_INFINITY;
  for (let i = 0; i < state.active.length; i += 1) {
    if (state.active[i]?.alwaysOn) continue;
    const t = Date.parse(state.active[i]?.lastRequestedAt || "1970-01-01T00:00:00Z");
    if (t < oldestTime) {
      oldestTime = t;
      oldestIdx = i;
    }
  }
  if (oldestIdx < 0) return null;
  const [evicted] = state.active.splice(oldestIdx, 1);
  return evicted || null;
}

function isKeepAliveRequestSource(value) {
  return String(value || "").toLowerCase().startsWith("keep-alive");
}

function isReconnectRequestSource(value) {
  return String(value || "").toLowerCase() === "reconnect";
}

function parseSegmentNumber(name = "") {
  const m = String(name || "").match(/segment_(\d+)\.(m4s|ts)$/i);
  return m ? Number(m[1]) : -1;
}

async function getStreamHealth(camId, activeItem = null) {
  const mediaDir = path.join(MEDIA_DIR, camId);
  const m3u8Path = path.join(mediaDir, "stream.m3u8");
  const now = Date.now();
  let m3u8Exists = false;
  let m3u8AgeMs = null;
  let latestSegmentName = null;
  let latestSegmentNo = -1;
  let latestSegmentMtimeMs = null;
  let latestSegmentAgeMs = null;
  let segmentCount = 0;
  try {
    const st = await fs.stat(m3u8Path);
    m3u8Exists = true;
    m3u8AgeMs = Math.max(0, now - st.mtimeMs);
  } catch {}
  try {
    const files = await fs.readdir(mediaDir).catch(() => []);
    for (const name of files) {
      if (!/\.(m4s|ts)$/i.test(name)) continue;
      segmentCount += 1;
      const full = path.join(mediaDir, name);
      let mtimeMs = 0;
      try { mtimeMs = (await fs.stat(full)).mtimeMs; } catch {}
      const no = parseSegmentNumber(name);
      if (no > latestSegmentNo || (no === latestSegmentNo && mtimeMs > (latestSegmentMtimeMs || 0))) {
        latestSegmentNo = no;
        latestSegmentName = name;
        latestSegmentMtimeMs = mtimeMs || null;
      }
    }
  } catch {}
  if (latestSegmentMtimeMs !== null) latestSegmentAgeMs = Math.max(0, now - latestSegmentMtimeMs);
  const activeSinceMs = activeItem?.lastRequestedAt ? Math.max(0, now - Date.parse(activeItem.lastRequestedAt)) : null;
  return {
    camId,
    m3u8Exists,
    m3u8AgeMs,
    m3u8AgeSec: m3u8AgeMs === null ? null : Math.round(m3u8AgeMs / 1000),
    segmentCount,
    latestSegmentName,
    latestSegmentNo,
    latestSegmentMtimeMs,
    latestSegmentAgeMs,
    latestSegmentAgeSec: latestSegmentAgeMs === null ? null : Math.round(latestSegmentAgeMs / 1000),
    activeSinceMs,
    activeSinceSec: activeSinceMs === null ? null : Math.round(activeSinceMs / 1000)
  };
}

function decideReconnectRecovery(health, watchdogSettings, activeItem, options = {}) {
  const hardMs = Math.max(10000, Number(watchdogSettings?.hardStaleSec || 45) * 1000);
  const softMs = Math.max(3000, Number(watchdogSettings?.softStaleSec || 10) * 1000);
  const startupMs = Math.max(10000, Number(watchdogSettings?.startupGraceSec || 45) * 1000);
  const cooldownMs = Math.max(5000, Number(watchdogSettings?.minRestartIntervalSec || 20) * 1000);
  // v77.01: client force-restart is now only a request.  A newly opened stream often
  // reports transient HLS.js errors before the first stable GOP/segment.  Restarting
  // during that window causes the repeating black/play/black loop seen on close->open.
  const clientForce = options?.clientForce === true;
  const clientForceGraceMs = Math.max(12000, Math.min(startupMs, Number(options?.clientForceGraceSec || 15) * 1000));
  const now = Date.now();
  const lastRestartAt = activeItem?.lastRestartRequestedAt ? Date.parse(activeItem.lastRestartRequestedAt) : 0;
  const activeSinceMs = health.activeSinceMs ?? 0;
  const latestAgeMs = health.latestSegmentAgeMs;
  const m3u8AgeMs = health.m3u8AgeMs;

  if (latestAgeMs !== null && latestAgeMs <= softMs) {
    return { action: "reuse", reason: `fresh-segment ${health.latestSegmentAgeSec}s` };
  }
  if (lastRestartAt && now - lastRestartAt < cooldownMs) {
    return { action: "reuse", reason: `restart-cooldown ${Math.round((now - lastRestartAt) / 1000)}s/${Math.round(cooldownMs / 1000)}s` };
  }
  if (clientForce && activeSinceMs < clientForceGraceMs) {
    return { action: "reuse", reason: `startup-grace ${health.activeSinceSec}s/${Math.round(clientForceGraceMs / 1000)}s` };
  }
  if (clientForce) {
    if (!health.m3u8Exists) return { action: "restart", reason: `client-force-m3u8-missing ${health.activeSinceSec}s` };
    if (health.segmentCount <= 0) return { action: "restart", reason: `client-force-segment-missing ${health.activeSinceSec}s` };
    if (latestAgeMs !== null && latestAgeMs > softMs) return { action: "restart", reason: `client-force-segment-stale ${health.latestSegmentAgeSec}s` };
    if (m3u8AgeMs !== null && m3u8AgeMs > softMs) return { action: "restart", reason: `client-force-m3u8-stale ${health.m3u8AgeSec}s` };
    return { action: "reuse", reason: "client-force-suppressed-healthy" };
  }
  if (!health.m3u8Exists && activeSinceMs > startupMs) {
    return { action: "restart", reason: `m3u8-missing ${health.activeSinceSec}s` };
  }
  if (health.segmentCount <= 0 && activeSinceMs > startupMs) {
    return { action: "restart", reason: `segment-missing ${health.activeSinceSec}s` };
  }
  if (latestAgeMs !== null && latestAgeMs > hardMs) {
    return { action: "restart", reason: `segment-stale ${health.latestSegmentAgeSec}s` };
  }
  if (m3u8AgeMs !== null && m3u8AgeMs > hardMs && health.segmentCount > 0) {
    return { action: "restart", reason: `m3u8-stale ${health.m3u8AgeSec}s` };
  }
  return { action: "reuse", reason: "healthy-or-within-grace" };
}

app.post("/api/streams/request", async (req, res) => {
  try {
    await ensureAll();
    const camId = req.body?.camId;
    if (!camId) return res.status(400).json({ ok: false, error: "camId required" });
    if (!isSafeCameraId(camId)) return res.status(400).json({ ok: false, error: "invalid camId" });

    const cams = await readJson(PATH_CAMERAS);
    const cam = (cams.cameras || []).find((c) => c.id === camId);
    if (!cam) return res.status(404).json({ ok: false, error: "camera not found" });

    const source = normalizeCameraSource(cam);
    if (source.type === "invalid") {
      return res.status(400).json({ ok: false, error: source.reason || "camera source missing" });
    }
    const requestSource = String(req.body?.source || req.query?.source || "viewer-click");
    const keepAliveRequest = isKeepAliveRequestSource(requestSource);
    const logRequest = keepAliveRequest ? rtDebug : rtLog;
    logRequest(`[REQUEST] ${camId} source=${requestSource} sourceType=${source.type}`);

    if (source.type === "hls") {
      return res.json({
        ok: true,
        camId,
        existed: false,
        evicted: null,
        sourceType: "hls",
        streamMode: "direct",
        waitForReady: false,
        hls: source.url
      });
    }

    if (keepAliveRequest && source.type === "rtsp") {
      const state = await loadActiveState();
      const activeItem = Array.isArray(state.active) ? state.active.find((x) => x?.id === camId) : null;
      if (!activeItem) {
        rtDebug(`[REQUEST] ${camId} ignored keep-alive source=${requestSource} reason=not-active`);
        return res.json({
          ok: true,
          camId,
          ignored: true,
          active: false,
          sourceType: source.type,
          streamMode: "converted",
          reason: "not-active"
        });
      }
      activeItem.lastSeenAt = nowIso();
      rtDebug(`[REQUEST] ${camId} keep-alive memory touch only source=${requestSource}`);
      return res.json({
        ok: true,
        camId,
        existed: true,
        active: true,
        sourceType: source.type,
        streamMode: "converted",
        waitForReady: true,
        hls: streamHlsPath(camId, activeItem?.sessionId || activeItem?.restartToken)
      });
    }

    if (isReconnectRequestSource(requestSource) && source.type === "rtsp") {
      const state = await loadActiveState();
      const activeItem = Array.isArray(state.active) ? state.active.find((x) => x?.id === camId) : null;
      if (!activeItem) {
        rtLog(`[RECONNECT] ${camId} decision=skip reason=not-active`);
        return res.json({
          ok: true,
          camId,
          ignored: true,
          active: false,
          sourceType: source.type,
          streamMode: "converted",
          reason: "not-active"
        });
      }
      const [health, watchdogSettings, backoffSettings] = await Promise.all([
        getStreamHealth(camId, activeItem),
        readHlsWatchdogSettings().catch(() => ({})),
        readHlsRestartBackoffSettings().catch(() => ({ enabled: true, normalInitialSec: 30, normalMaxSec: 120, alwaysOnInitialSec: 60, alwaysOnMaxSec: 300, successResetFreshSegmentSec: 6, maxClientRestartsPerHour: 6 }))
      ]);
      const clientForceRestart = req.body?.forceRestart === true;

      // V77.03: isolate failed cameras.  Once a stream has requested a restart,
      // the API must not keep issuing new restartToken values every few seconds.
      // Repeated token churn makes ffmpeg restart before stream.m3u8 can be created
      // and can affect always-on streams such as YTN.
      const nowMs = Date.now();
      const backoffUntil = activeItem?.restartBackoffUntil ? Date.parse(activeItem.restartBackoffUntil) : 0;
      const freshResetMs = Math.max(1000, Number(backoffSettings.successResetFreshSegmentSec || 6) * 1000);
      if (health.latestSegmentAgeMs !== null && health.latestSegmentAgeMs <= freshResetMs) {
        if (activeItem.restartAttemptCount || activeItem.restartBackoffUntil || activeItem.restartHistory) {
          activeItem.restartAttemptCount = 0;
          activeItem.restartBackoffUntil = null;
          activeItem.restartHistory = [];
          await atomicWriteJson(PATH_ACTIVE, { ...state, savedAt: nowIso(), lastRequestSource: requestSource });
        }
      } else if (backoffSettings.enabled && Number.isFinite(backoffUntil) && backoffUntil > nowMs) {
        const remainSec = Math.ceil((backoffUntil - nowMs) / 1000);
        rtWarn(`[RECONNECT] ${camId} decision=reuse reason=restart-backoff ${remainSec}s latest=${health.latestSegmentName || "none"} segAge=${health.latestSegmentAgeSec ?? "none"}s m3u8Age=${health.m3u8AgeSec ?? "none"}s`);
        return res.json({
          ok: true,
          camId,
          existed: true,
          restartRequested: false,
          decision: "reuse",
          reason: `restart-backoff ${remainSec}s`,
          backoffUntil: activeItem.restartBackoffUntil,
          health,
          sourceType: source.type,
          streamMode: "converted",
          waitForReady: true,
          sessionId: activeItem?.sessionId || activeItem?.restartToken || null,
          hls: streamHlsPath(camId, activeItem?.sessionId || activeItem?.restartToken)
        });
      }

      const decision = decideReconnectRecovery(health, watchdogSettings, activeItem, { clientForce: clientForceRestart });
      if (decision.action === "restart") {
        const history = restartHistoryWithinHour(activeItem);
        if (backoffSettings.enabled && history.length >= Number(backoffSettings.maxClientRestartsPerHour || 6)) {
          const backoffMs = computeRestartBackoffMs(activeItem, backoffSettings);
          activeItem.restartBackoffUntil = new Date(nowMs + backoffMs).toISOString();
          activeItem.restartHistory = history;
          await atomicWriteJson(PATH_ACTIVE, { ...state, savedAt: nowIso(), lastRequestSource: requestSource });
          rtWarn(`[RECONNECT] ${camId} decision=reuse reason=restart-hourly-limit backoff=${Math.round(backoffMs / 1000)}s latest=${health.latestSegmentName || "none"}`);
          return res.json({
            ok: true,
            camId,
            existed: true,
            restartRequested: false,
            decision: "reuse",
            reason: "restart-hourly-limit",
            backoffUntil: activeItem.restartBackoffUntil,
            health,
            sourceType: source.type,
            streamMode: "converted",
            waitForReady: true,
            sessionId: activeItem?.sessionId || activeItem?.restartToken || null,
            hls: streamHlsPath(camId, activeItem?.sessionId || activeItem?.restartToken)
          });
        }
        const sessionId = makeStreamSessionId(camId);
        const restartReason = decision.reason;
        const attemptCount = Math.max(0, Number(activeItem.restartAttemptCount || 0)) + 1;
        activeItem.restartAttemptCount = attemptCount;
        activeItem.restartHistory = [...history, nowIso()];
        const backoffMs = backoffSettings.enabled ? computeRestartBackoffMs(activeItem, backoffSettings) : 0;
        activeItem.restartBackoffUntil = backoffMs ? new Date(nowMs + backoffMs).toISOString() : null;
        activeItem.sessionId = sessionId;
        activeItem.restartToken = sessionId;
        activeItem.lastRestartRequestedAt = nowIso();
        activeItem.lastRestartReason = `reconnect:${restartReason}`;
        activeItem.lastRequestedAt = nowIso();
        await atomicWriteJson(PATH_ACTIVE, { ...state, savedAt: nowIso(), lastRequestSource: requestSource });
        rtWarn(`[RECONNECT] ${camId} decision=restart reason=${restartReason} attempt=${attemptCount} backoff=${Math.round(backoffMs / 1000)}s latest=${health.latestSegmentName || "none"} segAge=${health.latestSegmentAgeSec ?? "none"}s m3u8Age=${health.m3u8AgeSec ?? "none"}s session=${sessionId}`);
        return res.json({
          ok: true,
          camId,
          existed: true,
          restartRequested: true,
          decision: "restart",
          reason: restartReason,
          attemptCount,
          backoffUntil: activeItem.restartBackoffUntil,
          sessionId,
          health,
          sourceType: source.type,
          streamMode: "converted",
          waitForReady: true,
          hls: streamHlsPath(camId, sessionId)
        });
      }
      activeItem.lastSeenAt = nowIso();
      const reuseLogger = clientForceRestart ? rtWarn : rtLog;
      reuseLogger(`[RECONNECT] ${camId} decision=reuse reason=${decision.reason} clientForce=${clientForceRestart} latest=${health.latestSegmentName || "none"} segAge=${health.latestSegmentAgeSec ?? "none"}s m3u8Age=${health.m3u8AgeSec ?? "none"}s`);
      return res.json({
        ok: true,
        camId,
        existed: true,
        restartRequested: false,
        decision: "reuse",
        reason: decision.reason,
        health,
        sourceType: source.type,
        streamMode: "converted",
        waitForReady: true,
        hls: streamHlsPath(camId, activeItem?.sessionId || activeItem?.restartToken)
      });
    }

    const precheck = await runRtspPrecheck(cam, source, { force: Boolean(req.body?.forcePrecheck) });
    rtDebug(`[PRECHECK] ${camId} source=${requestSource} ok=${precheck.ok} reason=${precheck.reason || "ok"}`);
    if (!precheck.ok) {
      return res.status(503).json({
        ok: false,
        camId,
        error: precheck.reason || "RTSP 사전 점검 실패",
        precheck,
        sourceType: source.type,
        streamMode: "converted"
      });
    }

    const state = await loadActiveState();
    const touched = lruTouch(state.active, camId);
    const activeItem = Array.isArray(state.active) ? state.active.find((x) => x?.id === camId) : null;
    if (touched.existed) {
      if (keepAliveRequest) {
        rtDebug(`[REQUEST] ${camId} existed=true memory touch only source=${requestSource}`);
      } else {
        await atomicWriteJson(PATH_ACTIVE, { ...state, savedAt: nowIso(), lastRequestSource: requestSource });
        rtLog(`[REQUEST] ${camId} existed=true touched active list source=${requestSource}`);
      }
      return res.json({
        ok: true,
        camId,
        existed: true,
        evicted: null,
        resourceGuard: null,
        sourceType: source.type,
        streamMode: "converted",
        alwaysOn: source.type === "rtsp+",
        waitForReady: true,
        precheck,
        sessionId: activeItem?.sessionId || activeItem?.restartToken || null,
        hls: streamHlsPath(camId, activeItem?.sessionId || activeItem?.restartToken)
      });
    }

    const conversionSettings = await readHlsConversionSettings();
    const conversionEngine = selectConversionEngineForSource(source.type, conversionSettings);
    const resourceGuard = await applyResourceGuardBeforeOpen(state, source, conversionEngine, camId);
    if (resourceGuard.evicted?.id) {
      await removeCameraMedia(resourceGuard.evicted.id);
    }
    const evicted = resourceGuard.evicted || lruEvictIfNeeded(state);
    if (!evicted && state.active.length >= (state.maxStreams ?? 20)) {
      return res.status(429).json({
        ok: false,
        error: "stream capacity reached",
        detail: "All active slots are occupied by alwaysOn streams. Increase maxStreams or disable an alwaysOn camera."
      });
    }
    if (evicted?.id) {
      await removeCameraMedia(evicted.id);
    }

    const sessionId = makeStreamSessionId(camId);
    const requestedAt = nowIso();
    state.active.push({
      id: camId,
      name: cam.name || camId,
      rtsp: source.url,
      lastRequestedAt: requestedAt,
      lastSeenAt: requestedAt,
      sessionId,
      restartToken: sessionId,
      restartAttemptCount: 0,
      restartBackoffUntil: null,
      restartHistory: [],
      alwaysOn: source.type === "rtsp+",
      sourceType: source.type,
      conversionEngine
    });

    await atomicWriteJson(PATH_ACTIVE, { ...state, savedAt: nowIso(), lastRequestSource: requestSource });
    rtLog(`[REQUEST] ${camId} existed=false added active source=${requestSource} session=${sessionId}`);

    return res.json({
      ok: true,
      camId,
      existed: false,
      evicted: evicted ? { id: evicted.id, name: evicted.name, reason: resourceGuard.reason } : null,
      resourceGuard,
      sourceType: source.type,
      streamMode: "converted",
      alwaysOn: source.type === "rtsp+",
      waitForReady: true,
      precheck,
      sessionId,
      hls: streamHlsPath(camId, sessionId)
    });
  } catch (e) {
    rtError(e);
    return res.status(500).json({ ok: false, error: "request stream failed" });
  }
});



async function buildStreamStatus(camId) {
  await ensureAll();
  if (!isSafeCameraId(camId)) {
    const err = new Error("invalid camId");
    err.statusCode = 400;
    throw err;
  }

  const [state, camsPayload, conversionSettings, hlsOutput, hlsStartup, hlsAudio] = await Promise.all([readJson(PATH_ACTIVE), readJson(PATH_CAMERAS), readHlsConversionSettings(), readHlsOutputSettings(), readHlsStartupSettings(), readHlsAudioSettings()]);
  const active = Array.isArray(state?.active) ? state.active : [];
  const activeItem = active.find((x) => x?.id === camId) || null;
  const cam = (Array.isArray(camsPayload?.cameras) ? camsPayload.cameras : []).find((x) => x?.id === camId) || null;
  const source = cam ? normalizeCameraSource(cam) : { type: null, url: "" };
  const health = await getStreamHealth(camId, activeItem);
  const m3u8Exists = health.m3u8Exists;
  const m3u8AgeSec = health.m3u8AgeSec;
  const segmentCount = health.segmentCount;

  const logPath = path.join(LOGS_DIR, `${camId}.log`);
  const logTailRaw = await readTextTail(logPath);
  const logTail = maskRtspUrl(logTailRaw);
  const precheck = await getPrecheckResult(camId);
  return {
    ok: true,
    apiVersion: API_VERSION,
    camId,
    cameraName: cam?.name || activeItem?.name || camId,
    sourceType: source?.type || activeItem?.sourceType || null,
    conversionEngine: source?.type ? selectConversionEngineForSource(source.type, conversionSettings) : null,
    hlsConversion: conversionSettings,
    hlsOutput,
    hlsStartup,
    hlsPrecheck: await readHlsPrecheckSettings().catch(() => null),
    hlsWatchdog: await readHlsWatchdogSettings().catch(() => null),
    hlsAudio,
    audioIncluded: source?.type ? shouldIncludeAudioForSource(source.type, hlsAudio) : false,
    precheck,
    active: Boolean(activeItem),
    alwaysOn: Boolean(activeItem?.alwaysOn),
    sessionId: activeItem?.sessionId || activeItem?.restartToken || null,
    m3u8Exists,
    m3u8AgeSec,
    segmentCount,
    health,
    mediaPath: streamHlsPath(camId, activeItem?.sessionId || activeItem?.restartToken),
    logClass: classifyConverterLog(logTailRaw),
    logTail
  };
}

async function handleStreamStatus(req, res) {
  try {
    const camId = req.params?.camId || req.query?.camId;
    if (!camId) return res.status(400).json({ ok: false, error: "camId required" });
    return res.json(await buildStreamStatus(camId));
  } catch (e) {
    rtError(e);
    return res.status(e.statusCode || 500).json({ ok: false, error: e.message || "stream status failed" });
  }
}

app.get("/api/system/resources", async (req, res) => {
  try {
    const [resources, guard] = await Promise.all([getSystemResources(), readHlsResourceGuardSettings()]);
    const state = await loadActiveState();
    return res.json({ ...resources, hlsResourceGuard: guard, activeStreams: Array.isArray(state.active) ? state.active.map((x) => ({ id: x.id, sourceType: x.sourceType, alwaysOn: Boolean(x.alwaysOn), lastRequestedAt: x.lastRequestedAt })) : [] });
  } catch (e) {
    rtError(e);
    return res.status(500).json({ ok: false, error: e.message || "resource status failed" });
  }
});

app.get("/api/health", async (req, res) => {
  const hlsTools = await readHlsToolSettings().catch(() => null);
  const hlsConversion = await readHlsConversionSettings().catch(() => null);
  const hlsOutput = await readHlsOutputSettings().catch(() => null);
  const hlsStartup = await readHlsStartupSettings().catch(() => null);
  const hlsPrecheck = await readHlsPrecheckSettings().catch(() => null);
  const hlsWatchdog = await readHlsWatchdogSettings().catch(() => null);
  const hlsAudio = await readHlsAudioSettings().catch(() => null);
  const hlsResourceGuard = await readHlsResourceGuardSettings().catch(() => null);
  const hlsLogging = await readHlsLoggingSettings().catch(() => hlsApiLogSettings);
  res.json({ ok: true, service: "hls_converter_api", apiVersion: API_VERSION, diagnostics: "ffmpeg_path_config", port: Number(PORT) || PORT, hlsTools, hlsConversion, hlsOutput, hlsStartup, hlsPrecheck, hlsWatchdog, hlsAudio, hlsResourceGuard, hlsLogging });
});

app.get("/api/logging", async (req, res) => {
  try {
    const hlsLogging = await readHlsLoggingSettings();
    return res.json({ ok: true, apiVersion: API_VERSION, hlsLogging });
  } catch (e) {
    rtError(e);
    return res.status(500).json({ ok: false, error: e.message || "logging settings failed" });
  }
});

app.post("/api/logging/reload", async (req, res) => {
  try {
    await refreshHlsLoggingSettings("api_reload");
    return res.json({ ok: true, apiVersion: API_VERSION, hlsLogging: hlsApiLogSettings });
  } catch (e) {
    rtError(e);
    return res.status(500).json({ ok: false, error: e.message || "logging reload failed" });
  }
});

app.get("/api/cameras/check/:camId", async (req, res) => {
  try {
    await ensureAll();
    const camId = req.params?.camId;
    if (!camId || !isSafeCameraId(camId)) return res.status(400).json({ ok: false, error: "invalid camId" });
    const cams = await readJson(PATH_CAMERAS);
    const cam = (cams.cameras || []).find((c) => c.id === camId);
    if (!cam) return res.status(404).json({ ok: false, error: "camera not found" });
    const source = normalizeCameraSource(cam);
    if (source.type === "invalid") return res.status(400).json({ ok: false, error: source.reason || "camera source missing" });
    if (source.type === "hls") return res.json({ ok: true, camId, skipped: true, reason: "direct_hls", sourceType: "hls" });
    const precheck = await runRtspPrecheck(cam, source, { force: req.query.force === "1" || req.query.force === "true" });
    return res.status(precheck.ok ? 200 : 503).json({ ok: precheck.ok, camId, precheck });
  } catch (e) {
    rtError(e);
    return res.status(500).json({ ok: false, error: e.message || "camera precheck failed" });
  }
});

app.get("/api/streams/status/:camId", handleStreamStatus);
app.get("/api/stream/status/:camId", handleStreamStatus);
app.get("/api/streams/status", handleStreamStatus);
app.get("/api/stream/status", handleStreamStatus);

app.post("/api/streams/release", async (req, res) => {
  try {
    await ensureAll();
    const camId = req.body?.camId;
    const reason = String(req.body?.source || req.body?.reason || "viewer-close");
    if (!camId) return res.status(400).json({ ok: false, error: "camId required" });
    if (!isSafeCameraId(camId)) return res.status(400).json({ ok: false, error: "invalid camId" });

    const cams = await readJson(PATH_CAMERAS);
    const cam = (cams.cameras || []).find((c) => c.id === camId);
    const source = cam ? normalizeCameraSource(cam) : { type: "rtsp" };

    if (source.type === "hls" || source.type === "rtsp+") {
      rtLog(`[RELEASE] ${camId} skipped sourceType=${source.type} reason=${reason}`);
      return res.json({ ok: true, removed: false, skipped: true, sourceType: source.type });
    }

    // Important order: remove from runtime active/watchdog target list first.
    // The Python converter watches camera_list.json; once removed, watchdog must not restart this camId.
    const { state, removed } = await removeNormalRtspActiveById(camId, reason);
    const cleanup = await removeCameraMediaIfNotReopened(camId, `release:${reason}`);
    const latestState = await readJson(PATH_ACTIVE).catch(() => state);
    const stillActive = Array.isArray(latestState.active) && latestState.active.some((x) => x?.id === camId);
    rtLog(`[RELEASE] ${camId} removed=${removed} verifyActive=${stillActive} cleanupSkipped=${Boolean(cleanup.skipped)} reason=${reason}`);

    return res.json({ ok: true, removed, active: !stillActive ? false : true, sourceType: "rtsp", cleanup });
  } catch (e) {
    rtError(e);
    return res.status(500).json({ ok: false, error: "release failed" });
  }
});

app.post("/api/streams/release-viewers", async (req, res) => {
  try {
    await ensureAll();
    const reason = String(req.body?.source || req.body?.reason || "release-viewers");
    const { state, removed } = await releaseAllNormalRtsp(reason);
    return res.json({
      ok: true,
      removed: removed.map((x) => ({ id: x.id, name: x.name, sourceType: x.sourceType || "rtsp" })),
      active: Array.isArray(state.active) ? state.active.map((x) => ({ id: x.id, sourceType: x.sourceType, alwaysOn: Boolean(x.alwaysOn) })) : []
    });
  } catch (e) {
    rtError(e);
    return res.status(500).json({ ok: false, error: "release viewers failed" });
  }
});

app.use("/media", express.static(MEDIA_DIR, {
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
}));

app.use(express.static(WEB_DIR, {
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-store");
  }
}));

app.get("/", (req, res) => {
  res.sendFile(path.join(WEB_DIR, "index.html"));
});

const PORT = Number(String(process.env.PORT || '8080').trim()) || 8080;
const HOST = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';

(async () => {
  await ensureAll();
  await refreshHlsLoggingSettings("api_startup");
  await resetRuntimeCameraState({ clearRtspMedia: true, reason: "api_startup" });
  const server = app.listen(PORT, HOST, () => {
    rtLog(`API+WEB server listening on http://${HOST}:${PORT}`);
    rtLog(`[REMOTE] HLS API available from LAN as http://<server-ip>:${PORT}`);
    rtLog("[RUNTIME] camera_list.json reset on API startup; only rtsp+/alwaysOn streams remain active.");
  });

  let shuttingDown = false;
  const gracefulShutdown = async (signalName) => {
    if (shuttingDown) return;
    shuttingDown = true;
    rtLog(`[RUNTIME] ${signalName} received. Resetting runtime camera state...`);
    await shutdownRuntimeCameraState(signalName || "api_shutdown");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
})();
