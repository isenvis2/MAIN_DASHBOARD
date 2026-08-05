import os
import json
import threading
import time
from pathlib import Path
from flask import Flask, jsonify, render_template, send_from_directory
from dotenv import load_dotenv
from kma_client import fetch_all

load_dotenv()

APP_DIR = Path(__file__).resolve().parent
CACHE_DIR = APP_DIR / "cache"
CACHE_DIR.mkdir(exist_ok=True)

CACHE_FILE = CACHE_DIR / "weather_cache.json"
META_FILE  = CACHE_DIR / "weather_cache.meta.json"

KMA_AUTHKEY = os.getenv("KMA_AUTHKEY", "").strip()
AREA_PATH = str(APP_DIR / "AreaData.json")
CONFIG_PATH = APP_DIR / "Weather_DashBoard.json"

# 통합 패키지 기본 포트: 8082
PORT = int(os.getenv("WEATHER_PORT", os.getenv("PORT", "8100")))

UPDATE_SECONDS = 10 * 60  # 10분

app = Flask(__name__, static_folder="static", template_folder="templates")

@app.after_request
def add_no_cache_headers(resp):
    try:
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        resp.headers["Access-Control-Allow-Origin"] = os.getenv("WEATHER_CORS_ORIGINS", "*")
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
        resp.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    except Exception:
        pass
    return resp

_cache_lock = threading.Lock()

def save_cache(data: dict):
    with _cache_lock:
        CACHE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        META_FILE.write_text(json.dumps({
            "updated_at": data.get("generated_at"),
            "regions": len(data.get("regions", []))
        }, ensure_ascii=False, indent=2), encoding="utf-8")

def load_cache():
    if not CACHE_FILE.exists():
        return None
    with _cache_lock:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))



def load_display_config():
    default = {
        "forecast": {
            "start_offset_hours": 24,
            "interval_hours": 24,
            "horizon_hours": 24,
        },
        "scroll_pause_seconds": 5,
        "stop_posi": 0,
    }
    if not CONFIG_PATH.exists():
        return default
    try:
        loaded = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        forecast = loaded.get("forecast", {}) if isinstance(loaded, dict) else {}
        merged = dict(default["forecast"])
        if isinstance(forecast, dict):
            merged.update({k: v for k, v in forecast.items() if v is not None})
        scroll_pause_seconds = loaded.get("scroll_pause_seconds", default["scroll_pause_seconds"]) if isinstance(loaded, dict) else default["scroll_pause_seconds"]
        stop_posi = loaded.get("stop_posi", default["stop_posi"]) if isinstance(loaded, dict) else default["stop_posi"]
        try:
            scroll_pause_seconds = max(0, float(scroll_pause_seconds))
        except Exception:
            scroll_pause_seconds = default["scroll_pause_seconds"]
        try:
            stop_posi = int(stop_posi)
        except Exception:
            stop_posi = default["stop_posi"]
        if stop_posi < -1:
            stop_posi = -1
        if stop_posi > 1:
            stop_posi = 1
        return {"forecast": merged, "scroll_pause_seconds": scroll_pause_seconds, "stop_posi": stop_posi}
    except Exception as e:
        print("[CONFIG] load failed:", e)
        return default

def build_error_payload(message: str):
    return {
        "error": message,
        "generated_at": None,
        "regions": []
    }

def update_once():
    if not KMA_AUTHKEY:
        data = build_error_payload("KMA_AUTHKEY가 설정되지 않았습니다.")
    else:
        data = fetch_all(KMA_AUTHKEY, AREA_PATH, load_display_config())
        if not isinstance(data, dict):
            data = build_error_payload("날씨 데이터를 가져오지 못했습니다.")
    save_cache(data)
    return data

def updater_loop():
    while True:
        try:
            data = update_once()
            print("[CACHE] updated:", data.get("generated_at"))
        except Exception as e:
            print("[CACHE] update failed:", e)
        time.sleep(UPDATE_SECONDS)

@app.route("/")
def index():
    return render_template("weather.html")

@app.route("/api/weather")
def api_weather():
    data = load_cache()
    if data is None:
        # 캐시가 없으면 즉시 1회 시도
        try:
            data = update_once()
        except Exception as e:
            return jsonify({"error": f"초기 캐시 생성 실패: {e}", "regions": []}), 503
    return jsonify(data)

@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(app.static_folder, filename)

def start_background_updater():
    th = threading.Thread(target=updater_loop, daemon=True)
    th.start()

if __name__ == "__main__":
    # 서버 시작 전 1회 캐시 생성 시도
    try:
        first = update_once()
        print("[STARTUP] initial cache ready:", first.get("generated_at"))
    except Exception as e:
        print("[STARTUP] initial cache failed:", e)

    start_background_updater()
    print(f"[WEATHER] listening on http://0.0.0.0:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False, use_reloader=False)
