# kma_client.py
import json
import datetime
import requests
from urllib.parse import quote
from pathlib import Path

BASE_URL = "https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0"

def get_base_datetime_vilage(now=None):
    """단기예보(getVilageFcst) 발표시각: 02,05,08,11,14,17,20,23 (통상)"""
    if now is None:
        now = datetime.datetime.now()
    now = now - datetime.timedelta(minutes=15)
    times = [2, 5, 8, 11, 14, 17, 20, 23]
    base_time = 23
    base_date = now.date()
    for t in reversed(times):
        if now.hour >= t:
            base_time = t
            break
    else:
        base_time = 23
        base_date = (now.date() - datetime.timedelta(days=1))
    return base_date.strftime("%Y%m%d"), f"{base_time:02d}00"

def get_base_datetime_ultra_now(now=None):
    """초단기실황(getUltraSrtNcst): 안전하게 현재-40분 기준 HH00"""
    if now is None:
        now = datetime.datetime.now()
    now = now - datetime.timedelta(minutes=40)
    return now.strftime("%Y%m%d"), now.strftime("%H00")

def get_base_datetime_ultra_fcst(now=None):
    """초단기예보(getUltraSrtFcst): 안전하게 현재-70분 기준 HH30"""
    if now is None:
        now = datetime.datetime.now()
    now = now - datetime.timedelta(minutes=70)
    return now.strftime("%Y%m%d"), now.strftime("%H30")

def get_weather_icon(sky, pty):
    # PTY: 0(없음),1(비),2(비/눈),3(눈),4(소나기)
    # SKY: 1(맑음),3(구름많음),4(흐림)
    if pty in ["1", "4"]:
        return "☔"
    if pty == "2":
        return "🌧️❄️"
    if pty == "3":
        return "❄️"
    if sky == "1":
        return "☀️"
    if sky == "3":
        return "⛅"
    if sky == "4":
        return "☁️"
    return "🌈"

def get_wind_direction(vec):
    try:
        vec = float(vec)
        dirs = ["북", "북북동", "북동", "동북동", "동", "동남동", "남동", "남남동",
                "남", "남남서", "남서", "서남서", "서", "서북서", "북서", "북북서", "북"]
        return dirs[int((vec + 11.25) / 22.5) % 16]
    except Exception:
        return "-"

def format_precip(val):
    if val is None:
        return "-"
    if isinstance(val, str) and val.strip() in ["강수없음", "적설없음"]:
        return "0"
    return str(val)


def format_snow(val):
    """Return snowfall (SNO) as-is, preserving ranges like '1~4cm'.
    KMA sometimes returns strings such as '적설없음'."""
    if val is None:
        return "-"
    if isinstance(val, str) and val.strip() in ["강수없음", "적설없음", "없음", "-"]:
        return "0"
    return str(val)

def dt_from_key(dt_key: str) -> datetime.datetime:
    return datetime.datetime.strptime(dt_key, "%Y%m%d%H%M")

def call_kma(auth_key: str, endpoint: str, params: dict):
    url = f"{BASE_URL}/{endpoint.lstrip('/')}"
    params = dict(params)
    params["authKey"] = quote(auth_key, safe="")
    res = requests.get(url, params=params, timeout=15)
    return res.status_code, res

def _check_ok(res_json: dict):
    header = res_json.get("response", {}).get("header", {})
    if header.get("resultCode") != "00":
        raise RuntimeError(f"API 에러: {header.get('resultMsg')}")
    return res_json

def fetch_current_ultra(auth_key, nx, ny):
    base_date, base_time = get_base_datetime_ultra_now()
    params = dict(pageNo=1, numOfRows=100, dataType="JSON",
                  base_date=base_date, base_time=base_time, nx=nx, ny=ny)
    status, res = call_kma(auth_key, "getUltraSrtNcst", params)
    if status != 200:
        raise RuntimeError(f"HTTP {status}: {res.text}")
    data = _check_ok(res.json())
    items = data["response"]["body"]["items"]["item"]
    now_map = {it["category"]: it["obsrValue"] for it in items}
    return {"_base_date": base_date, "_base_time": base_time, **now_map}

def fetch_ultra_forecast(auth_key, nx, ny):
    base_date, base_time = get_base_datetime_ultra_fcst()
    params = dict(pageNo=1, numOfRows=1000, dataType="JSON",
                  base_date=base_date, base_time=base_time, nx=nx, ny=ny)
    status, res = call_kma(auth_key, "getUltraSrtFcst", params)
    if status != 200:
        raise RuntimeError(f"HTTP {status}: {res.text}")
    data = _check_ok(res.json())
    items = data["response"]["body"]["items"]["item"]
    forecasts = {}
    for it in items:
        dt_key = f"{it['fcstDate']}{it['fcstTime']}"
        forecasts.setdefault(dt_key, {})
        forecasts[dt_key][it["category"]] = it["fcstValue"]
    return {"_base_date": base_date, "_base_time": base_time, "_items": forecasts}

def fetch_forecast_vilage(auth_key, nx, ny):
    base_date, base_time = get_base_datetime_vilage()
    params = dict(pageNo=1, numOfRows=3000, dataType="JSON",
                  base_date=base_date, base_time=base_time, nx=nx, ny=ny)
    status, res = call_kma(auth_key, "getVilageFcst", params)
    if status != 200:
        raise RuntimeError(f"HTTP {status}: {res.text}")
    data = _check_ok(res.json())
    items = data["response"]["body"]["items"]["item"]
    forecasts = {}
    for it in items:
        dt_key = f"{it['fcstDate']}{it['fcstTime']}"
        forecasts.setdefault(dt_key, {})
        forecasts[dt_key][it["category"]] = it["fcstValue"]
    return {"_base_date": base_date, "_base_time": base_time, "_items": forecasts}

def pick_3days_forecast(items_by_time, now=None):
    if now is None:
        now = datetime.datetime.now()
    end = now + datetime.timedelta(hours=72)
    keys = []
    for k in items_by_time.keys():
        try:
            dt = dt_from_key(k)
        except Exception:
            continue
        if now <= dt <= end:
            keys.append(k)
    keys.sort()
    return {k: items_by_time[k] for k in keys}

def find_nearest_sky(fcst_3days):
    for k in sorted(fcst_3days.keys()):
        sky = fcst_3days[k].get("SKY")
        if sky:
            return sky
    return "1"

def pick_nearest_point(items_by_time, now=None, max_ahead_minutes=120):
    if now is None:
        now = datetime.datetime.now()
    cand = []
    for k in items_by_time.keys():
        try:
            dt = dt_from_key(k)
        except Exception:
            continue
        diff = (dt - now).total_seconds()
        if diff > max_ahead_minutes * 60:
            continue
        cand.append((abs(diff), diff, k))
    if not cand:
        return None, {}
    cand.sort(key=lambda x: (x[0], -1 if x[1] > 0 else 0))
    best = cand[0][2]
    return best, items_by_time.get(best, {})

def select_forecast_keys(fcst_dict, now_dt, start_offset_hours=6, step_hours=12, horizon_hours=72):
    if not fcst_dict:
        return []
    dts = []
    for k in sorted(fcst_dict.keys()):
        try:
            dtv = datetime.datetime.strptime(k, "%Y%m%d%H%M")
        except Exception:
            continue
        dts.append((k, dtv))
    if not dts:
        return []

    start_dt = now_dt + datetime.timedelta(hours=start_offset_hours)
    end_dt = start_dt + datetime.timedelta(hours=horizon_hours)

    targets = []
    t = start_dt
    while t <= end_dt:
        targets.append(t)
        t += datetime.timedelta(hours=step_hours)

    selected, used = [], set()
    ptr, n = 0, len(dts)

    for target in targets:
        while ptr < n and dts[ptr][1] < target:
            ptr += 1
        cand = dts[ptr] if ptr < n else min(dts, key=lambda x: abs((x[1] - target).total_seconds()))
        k, dtv = cand
        if not (start_dt <= dtv <= end_dt):
            continue
        if k in used:
            continue
        used.add(k)
        selected.append(k)

    return selected

def load_regions(area_path="AreaData.json"):
    p = Path(area_path)
    if not p.exists():
        return [{"name": "서울", "nx": 60, "ny": 127}]
    return json.loads(p.read_text(encoding="utf-8"))

def fetch_all(auth_key, area_path="AreaData.json", display_config=None):
    now_dt = datetime.datetime.now()
    regions = load_regions(area_path)
    forecast_cfg = {
        "label": "3일 예보",
        "start_offset_hours": 6,
        "interval_hours": 12,
        "horizon_hours": 72,
    }
    if isinstance(display_config, dict):
        cfg_forecast = display_config.get("forecast", {})
        if isinstance(cfg_forecast, dict):
            forecast_cfg.update({k: v for k, v in cfg_forecast.items() if v is not None})
    out = {
        "generated_at": now_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "regions": [],
        "forecast_config": forecast_cfg,
    }

    for r in regions:
        name, nx, ny = r.get("name", "지역"), r.get("nx"), r.get("ny")
        region_obj = {"name": name, "nx": nx, "ny": ny, "now": {}, "forecast": []}

        try:
            now_data = fetch_current_ultra(auth_key, nx, ny)
        except Exception as e:
            region_obj["now_error"] = str(e)
            now_data = {}

        try:
            ultra = fetch_ultra_forecast(auth_key, nx, ny).get("_items", {})
        except Exception as e:
            region_obj["ultra_error"] = str(e)
            ultra = {}

        try:
            vilage_raw = fetch_forecast_vilage(auth_key, nx, ny)["_items"]
            fcst_3days = pick_3days_forecast(vilage_raw, now_dt)
        except Exception as e:
            region_obj["forecast_error"] = str(e)
            fcst_3days = {}

        _, nearest_ultra = pick_nearest_point(ultra) if ultra else (None, {})
        sky_for_now = nearest_ultra.get("SKY") or (find_nearest_sky(fcst_3days) if fcst_3days else "1")
        pty_for_now = nearest_ultra.get("PTY")
        if pty_for_now is None:
            pty_for_now = now_data.get("PTY", "0") if now_data else "0"

        icon_now = get_weather_icon(sky_for_now, pty_for_now)

        region_obj["now"] = {
            "captured_at": now_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "icon": icon_now,
            "T1H": now_data.get("T1H", "-"),
            "REH": now_data.get("REH", "-"),
            "RN1": format_precip(now_data.get("RN1", "-")),
            "SNO": format_snow(now_data.get("SNO", "-")),
            "VEC": get_wind_direction(now_data.get("VEC", "0")),
            "WSD": now_data.get("WSD", "-"),
            "SKY": sky_for_now,
            "PTY": pty_for_now,
            "PTY_obs": now_data.get("PTY", "0"),
        }

        if fcst_3days:
            keys = select_forecast_keys(
                fcst_3days,
                now_dt,
                start_offset_hours=int(forecast_cfg.get("start_offset_hours", 6)),
                step_hours=int(forecast_cfg.get("interval_hours", 12)),
                horizon_hours=int(forecast_cfg.get("horizon_hours", 72)),
            )
            for k in keys:
                d = fcst_3days[k]
                sky = d.get("SKY", "1")
                pty = d.get("PTY", "0")
                region_obj["forecast"].append({
                    "key": k,
                    "time": f"{k[4:6]}/{k[6:8]} {k[8:10]}:{k[10:12]}",
                    "icon": get_weather_icon(sky, pty),
                    "PTY": pty,
                    "SNO": format_snow(d.get("SNO", "-")),
                    "TMP": d.get("TMP", "-"),
                    "POP": d.get("POP", "-"),
                    "PCP": format_precip(d.get("PCP", "-")),
                    "REH": d.get("REH", "-"),
                    "VEC": get_wind_direction(d.get("VEC", "0")),
                    "WSD": d.get("WSD", "-"),
                })

        out["regions"].append(region_obj)

    return out
