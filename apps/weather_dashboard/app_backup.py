# app.py
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

UPDATE_SECONDS = 10 * 60  # 10분

app = Flask(__name__, static_folder="static", template_folder="templates")
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

def updater_loop():
    while True:
        try:
            if not KMA_AUTHKEY:
                data = {"error": "KMA_AUTHKEY가 설정되지 않았습니다. .env 또는 환경변수를 설정하세요.", "generated_at": None, "regions": []}
            else:
                data = fetch_all(KMA_AUTHKEY, AREA_PATH)
            save_cache(data)
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
        return jsonify({"error": "캐시가 아직 생성되지 않았습니다. 잠시 후 새로고침하세요.", "regions": []}), 503
    return jsonify(data)

@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(app.static_folder, filename)

def start_background_updater():
    th = threading.Thread(target=updater_loop, daemon=True)
    th.start()

if __name__ == "__main__":
    start_background_updater()
    app.run(host="0.0.0.0", port=8080, debug=True)
