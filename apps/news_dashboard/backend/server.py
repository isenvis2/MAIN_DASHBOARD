from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / 'NewsDashBoard.json'
SAFETY_URL = 'https://www.safetydata.go.kr/V2/api/DSSP-IF-00051'

# Backend-only secret loading. API keys must not be placed in the Vite frontend env.
load_dotenv(BACKEND_DIR / '.env')

DEFAULT_CONFIG: dict[str, Any] = {
    'AIAnal': False,
    'ReportDate': 30,
    'RowsPerPage': 100,
    'StartDayPage': 458,
    'EndPage': 470,
    'LastPage': 470,
    'BackwardScanLimit': 3,
    'ForwardScanLimit': 3,
    'LOAD_TIME': 15,
    'LOAD_TRY_TIME': 5,
    'ScrollSpeed': 40,
    'ScrollPauseSeconds': 5,
    'StopPosi': 0,
}

SECRET_CONFIG_KEYS = {'ServiceKey', 'serviceKey', 'GEMINI_API_KEY', 'VITE_GEMINI_API_KEY', 'SAFETY_SERVICE_KEY'}
UPSTREAM_TIMEOUT_SEC = 20
UPSTREAM_RETRIES = 2
UPSTREAM_RETRY_DELAY_SEC = 0.4
GEMINI_TIMEOUT_SEC = 30
VALID_AREAS = ['서울','인천','경기','강원','충북','충남','대전','전북','전남','광주','경북','경남','대구','부산','울산','제주','전국']
VALID_IMPORTANCE = {'Urgent', 'Alert', 'Info'}

app = Flask(__name__)
CORS(app, resources={r'/api/*': {'origins': os.environ.get('NEWS_CORS_ORIGINS', '*')}})


def strip_secret_keys(raw: dict[str, Any] | None) -> dict[str, Any]:
    raw = raw or {}
    return {k: v for k, v in raw.items() if k not in SECRET_CONFIG_KEYS}


def sanitize_config(raw: dict[str, Any] | None) -> dict[str, Any]:
    raw_public = strip_secret_keys(raw)
    cfg = DEFAULT_CONFIG | raw_public
    for key in ['ReportDate', 'RowsPerPage', 'StartDayPage', 'EndPage', 'LastPage', 'BackwardScanLimit', 'ForwardScanLimit', 'LOAD_TIME', 'LOAD_TRY_TIME', 'ScrollSpeed', 'ScrollPauseSeconds']:
        try:
            value = int(cfg[key])
        except Exception:
            value = int(DEFAULT_CONFIG[key])
        cfg[key] = max(1, value)
    cfg['AIAnal'] = bool(cfg.get('AIAnal', False))
    try:
        cfg['StopPosi'] = max(-1, min(1, int(cfg.get('StopPosi', DEFAULT_CONFIG['StopPosi']))))
    except Exception:
        cfg['StopPosi'] = DEFAULT_CONFIG['StopPosi']
    if cfg['EndPage'] < cfg['StartDayPage']:
        cfg['EndPage'] = cfg['StartDayPage']
    if cfg['LastPage'] < cfg['EndPage']:
        cfg['LastPage'] = cfg['EndPage']
    return cfg


def load_config() -> dict[str, Any]:
    try:
        if not CONFIG_PATH.exists():
            return save_config(DEFAULT_CONFIG)
        with CONFIG_PATH.open('r', encoding='utf-8') as f:
            return sanitize_config(json.load(f))
    except Exception:
        return save_config(DEFAULT_CONFIG)


def save_config(config: dict[str, Any]) -> dict[str, Any]:
    cfg = sanitize_config(config)
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CONFIG_PATH.open('w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    return cfg


def get_safety_service_key() -> str:
    # Accept both names for easier server migration; never return this through /api/config.
    return (os.environ.get('SAFETY_SERVICE_KEY') or os.environ.get('SAFETYDATA_SERVICE_KEY') or '').strip().strip('"')


def get_gemini_api_key() -> str:
    return (os.environ.get('GEMINI_API_KEY') or '').strip().strip('"')


def synthetic_news_response(page_no: str, num_of_rows: str, error_message: str, status: int = 200) -> Response:
    payload = {
        'header': {
            'resultMsg': 'UPSTREAM ERROR',
            'resultCode': '99',
            'errorMsg': error_message,
        },
        'numOfRows': int(num_of_rows),
        'pageNo': int(page_no),
        'totalCount': None,
        'body': None,
    }
    return jsonify(payload), status


def normalize_importance(value: Any) -> str:
    v = str(value or '').strip()
    if v in VALID_IMPORTANCE:
        return v
    lower = v.lower()
    if any(x in lower for x in ['urgent', '긴급', 'rose', 'red']):
        return 'Urgent'
    if any(x in lower for x in ['alert', '주의', 'amber', 'yellow', 'orange']):
        return 'Alert'
    return 'Info'


def normalize_area(value: Any) -> str:
    v = str(value or '').strip()
    if not v:
        return '전국'
    aliases = {
        '경기도': '경기', '충청북도': '충북', '충청남도': '충남', '전라북도': '전북', '전라남도': '전남',
        '경상북도': '경북', '경상남도': '경남', '서울특별시': '서울', '부산광역시': '부산', '대구광역시': '대구',
        '인천광역시': '인천', '광주광역시': '광주', '대전광역시': '대전', '울산광역시': '울산', '제주특별자치도': '제주',
    }
    if v in aliases:
        return aliases[v]
    if v in VALID_AREAS:
        return v
    if v.endswith('특별시') or v.endswith('광역시') or v.endswith('특별자치도') or v.endswith('도'):
        short = v[:2]
        return aliases.get(v, short if short in VALID_AREAS else v)
    lower = v.lower()
    if 'seoul' in lower:
        return '서울'
    if 'incheon' in lower:
        return '인천'
    if 'busan' in lower:
        return '부산'
    return v if v in VALID_AREAS else '전국'


def fallback_ai_payload(summary: str = '요약을 생성할 수 없습니다.', error: str | None = None) -> dict[str, Any]:
    payload = {'area': '전국', 'importance': 'Info', 'summary': summary}
    if error:
        payload['warning'] = error[:300]
    return payload


def parse_json_from_gemini(text: str) -> dict[str, Any]:
    text = (text or '').strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception:
        # Recover JSON embedded in markdown or surrounding text.
        m = re.search(r'\{[\s\S]*\}', text)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return {}
    return {}


@app.get('/api/health')
def health() -> Response:
    return jsonify({
        'ok': True,
        'service': 'news_dashboard_backend',
        'safetyKeyConfigured': bool(get_safety_service_key()),
        'geminiKeyConfigured': bool(get_gemini_api_key()),
        'configPath': str(CONFIG_PATH),
    })


@app.get('/api/config')
def get_config() -> Response:
    # Public runtime config only. Secret keys are read from backend/.env and never returned to clients.
    return jsonify(load_config())


@app.post('/api/config')
def post_config() -> Response:
    payload = request.get_json(silent=True) or {}
    config = save_config(payload)
    return jsonify({'ok': True, 'config': config})


@app.get('/api/news')
def get_news() -> Response:
    cfg = load_config()
    service_key = get_safety_service_key()
    page_no = request.args.get('pageNo', str(cfg['StartDayPage']))
    num_of_rows = request.args.get('numOfRows', str(cfg['RowsPerPage']))

    if not service_key:
        return synthetic_news_response(page_no, num_of_rows, 'SAFETY_SERVICE_KEY가 backend/.env에 설정되지 않았습니다.')

    params = {
        'serviceKey': service_key,
        'pageNo': page_no,
        'numOfRows': num_of_rows,
    }

    last_error = ''
    for attempt in range(1, UPSTREAM_RETRIES + 2):
        try:
            upstream = requests.get(SAFETY_URL, params=params, timeout=UPSTREAM_TIMEOUT_SEC)
            if upstream.ok:
                return Response(
                    upstream.content,
                    status=200,
                    content_type=upstream.headers.get('Content-Type', 'application/json'),
                )

            last_error = f'HTTP {upstream.status_code}: {upstream.text[:300]}'
            print('[UPSTREAM HTTP ERROR]', attempt, page_no, last_error.replace(service_key, '***'))
        except requests.RequestException as exc:
            last_error = str(exc)
            print('[UPSTREAM EXCEPTION]', attempt, page_no, last_error)

        if attempt <= UPSTREAM_RETRIES:
            time.sleep(UPSTREAM_RETRY_DELAY_SEC)

    return synthetic_news_response(page_no, num_of_rows, last_error.replace(service_key, '***') if service_key else last_error or 'Unknown upstream error')


@app.post('/api/ai/analyze')
def analyze_news_with_ai() -> Response:
    cfg = load_config()
    if not cfg.get('AIAnal', False):
        return jsonify(fallback_ai_payload('AI 분석 비활성화'))

    api_key = get_gemini_api_key()
    if not api_key:
        return jsonify(fallback_ai_payload('Gemini API 키가 backend/.env에 설정되지 않았습니다.'))

    payload = request.get_json(silent=True) or {}
    title = str(payload.get('title') or '').strip()
    content = str(payload.get('content') or '').strip()
    if not title and not content:
        return jsonify(fallback_ai_payload('분석할 뉴스 내용이 없습니다.'))

    model = (os.environ.get('GEMINI_MODEL') or 'gemini-3-flash-preview').strip()
    endpoint = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
    prompt = (
        '다음은 재난 관련 뉴스입니다. 이 뉴스를 분석하여 중요도(Urgent, Alert, Info 중 하나), '
        '한 문장 요약, 그리고 발생/관련 지역(대한민국 광역 단위)을 판정해 주세요.\n'
        f'지역(area)은 반드시 다음 목록 중 하나로만 답하세요: {", ".join(VALID_AREAS)}.\n\n'
        f'제목: {title}\n내용: {content[:500]}'
    )

    body = {
        'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
        'generationConfig': {
            'responseMimeType': 'application/json',
            'responseSchema': {
                'type': 'OBJECT',
                'properties': {
                    'area': {'type': 'STRING'},
                    'importance': {'type': 'STRING'},
                    'summary': {'type': 'STRING'},
                },
                'required': ['area', 'importance', 'summary'],
            },
        },
    }

    try:
        upstream = requests.post(endpoint, params={'key': api_key}, json=body, timeout=GEMINI_TIMEOUT_SEC)
        if not upstream.ok:
            msg = f'Gemini HTTP {upstream.status_code}: {upstream.text[:300]}'
            print('[GEMINI ERROR]', msg.replace(api_key, '***'))
            return jsonify(fallback_ai_payload('요약을 생성할 수 없습니다.', msg))
        data = upstream.json()
        text = ''
        candidates = data.get('candidates') or []
        if candidates:
            parts = ((candidates[0].get('content') or {}).get('parts') or [])
            text = ''.join(str(p.get('text') or '') for p in parts)
        result = parse_json_from_gemini(text)
        return jsonify({
            'area': normalize_area(result.get('area')),
            'importance': normalize_importance(result.get('importance')),
            'summary': str(result.get('summary') or '요약을 생성할 수 없습니다.').strip()[:500],
        })
    except Exception as exc:
        print('[GEMINI EXCEPTION]', exc)
        return jsonify(fallback_ai_payload('요약을 생성할 수 없습니다.', str(exc)))


if __name__ == '__main__':
    port = int(os.environ.get('NEWS_BACKEND_PORT', os.environ.get('PORT', '8000')))
    host = os.environ.get('NEWS_BACKEND_HOST', os.environ.get('HOST', '0.0.0.0'))
    app.run(host=host, port=port, debug=False)
