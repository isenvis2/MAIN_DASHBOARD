# RIC Dashboard

Current package: **RIC_V78_05_root_gitignore_and_credential_hardening** 사용 설명서

- V78.05: 저장소 루트 `.gitignore`/`.gitattributes`를 추가하고, Event Dashboard의 AxxonONE 계정 정보를 `.env`로 분리했으며, Report Dashboard의 승인/반려/무효처리 API에 백엔드 암호 검증을 추가했습니다.
- V78.03: 뉴스/SMS/날씨 외부 API 키를 백엔드에서만 사용하도록 정리하고, 서버 백엔드 + 클라이언트 프론트엔드 분리 실행을 지원합니다.
- V78.02: HLS 변환용 FFmpeg/FFprobe 실행 파일 경로를 `shared/config/GISDashBoard.json`의 `hlsTools`에서 직접 지정할 수 있게 했습니다.
- V78.01: Report Dashboard를 메인 화면 모달로 연결하고, 닫은 뒤 메인 보고서 버튼으로 포커스를 복귀합니다. 첨부 cameras(4).json을 새 카메라 기준 파일로 반영했습니다.
- V78.00: Main Dashboard에 Report Dashboard를 통합하고, 3200 포트·JSON 환경 설정·통합 실행/상태 확인을 제공합니다.
- V77.12: YTN 라이브 패널의 live edge 반복 seek 문제를 수정했습니다.
- V77.11: video1/YTN stale segment pruning 및 epoch start_number 정책을 적용했습니다.

현재 기준 버전: **RIC_V78_05_root_gitignore_and_credential_hardening**  
HLS API 버전: **v78.02** (FFmpeg JSON 경로 설정 유지)


## Event Dashboard / Report Dashboard 자격증명 분리 및 백엔드 암호 검증 (V78.05)

### Event Dashboard

AxxonONE VMS 계정(`LOGIN`, `PASSWD`)은 더 이상 `apps/event_dashboard/config/event_dashboard.json`에 평문으로 두지 않습니다. 아래 파일에서만 관리합니다.

```text
apps/event_dashboard/.env
```

```text
LOGIN=실제_VMS_계정
PASSWD=실제_VMS_비밀번호
```

`config/event_dashboard.json`에는 `PORT`, `AXXON_SERVER_IP`, `GRPC_PORT` 등 비밀이 아닌 값만 남습니다.

### Report Dashboard

승인(`/approve`)/반려(`/reject`)/무효처리(`/void`) API가 프런트엔드 UI뿐 아니라 **서버에서도** 암호를 검사합니다. 기준 암호는 `apps/report_dashboard/.env`에서 관리합니다.

```text
apps/report_dashboard/.env
```

```text
REPORT_ADMIN_PASSWORD=관리자_암호
REPORT_INSPECTOR_PASSWORD=안전감독관_결재_암호
REPORT_DIRECTOR_PASSWORD=감리단장_결재_암호
```

`.env`가 없거나 값이 비어 있으면 서버는 기존 기본값(`raon1234`/`1111`/`2222`)으로 동작하며 콘솔에 경고를 출력합니다. 운영 환경에서는 반드시 실제 값으로 교체하십시오. 화면의 "결재 암호 변경" 메뉴로 안전감독관/감리단장 암호를 바꾸면 서버가 재시작되기 전까지 메모리에서 유지되며, 영구 반영하려면 `.env` 값을 직접 수정하고 서버를 재시작해야 합니다.

## API 키 백엔드 전용 운영 및 클라이언트 프론트엔드 분리 실행 (V78.03)

V78.03부터 뉴스/SMS/날씨의 외부 데이터 API 키는 브라우저 프론트엔드에 넣지 않고 서버 백엔드에서만 읽습니다.

### 서버 PC에서 실행하는 백엔드

뉴스 백엔드 키 파일:

```text
apps/news_dashboard/backend/.env
```

주요 항목:

```text
SAFETY_SERVICE_KEY=...
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3-flash-preview
```

SMS 백엔드 키 파일:

```text
apps/sms_dashboard/.env
```

```text
SAFETYDATA_SERVICE_KEY=...
```

날씨 백엔드 키 파일:

```text
apps/weather_dashboard/.env
```

```text
KMA_AUTHKEY=...
```

### 클라이언트 PC에서 뉴스/SMS 프론트엔드 실행

클라이언트 PC에는 API 키를 설치하지 않습니다. 프론트엔드는 Vite proxy를 통해 서버 백엔드로만 요청합니다.

뉴스 프론트엔드:

```bat
apps\news_dashboard\run_frontend_client.bat http://서버IP:8000
```

SMS 프론트엔드:

```bat
apps\sms_dashboard\run_frontend_client.bat http://서버IP:3005
```

### 메인 대시보드 분리 호스트 설정

`shared/config/modules.json`에서 백엔드 서버와 프론트엔드 클라이언트 주소를 분리할 수 있습니다.

```json
{
  "backend_host": "192.168.0.199",
  "frontend_host": "auto",
  "hls_url": "http://{BACKEND_HOST}:8080/index.html?embed=1",
  "weather_url": "http://{BACKEND_HOST}:8100/?embed=1",
  "sms_url": "http://{FRONTEND_HOST}:3000/?embed=1",
  "news_url": "http://{FRONTEND_HOST}:5173/?embed=1",
  "report_url": "http://{BACKEND_HOST}:3200/"
}
```

- `backend_host`: HLS, Weather, Event, Report, News Backend, SMS Backend가 실행되는 서버 PC IP
- `frontend_host`: 메인 대시보드와 뉴스/SMS Vite 프론트엔드가 실행되는 클라이언트 PC IP. `auto`이면 현재 브라우저 접속 host를 사용합니다.
- Kakao Map JavaScript SDK의 앱 키는 브라우저 SDK 특성상 클라이언트에서 로드됩니다. 대신 Kakao 개발자 콘솔에 실제 접속 도메인/IP:포트를 등록해야 합니다.

## FFmpeg 경로 지정 방법 (V78.02)

새 컴퓨터에서 Windows `Path` 순서 때문에 AxxonSoft DriverPack의 제한된 `ffmpeg.EXE`가 먼저 잡히면 `Unrecognized option 'gpu'`, `Unrecognized option 'preset'` 오류가 발생할 수 있습니다. V78.02부터는 아래 JSON에서 사용할 FFmpeg를 직접 지정합니다.

설정 파일:

```text
shared/config/GISDashBoard.json
```

기본 설정 예시:

```json
"hlsTools": {
  "ffmpegPath": "C:\\ffmpeg\\bin\\ffmpeg.exe",
  "ffprobePath": "C:\\ffmpeg\\bin\\ffprobe.exe",
  "ffmpegCandidates": [
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe"
  ],
  "ffprobeCandidates": [
    "C:\\ffmpeg\\bin\\ffprobe.exe",
    "C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe"
  ],
  "allowPathAutoDetectFallback": false
}
```

운영 PC에 FFmpeg가 다른 위치에 있으면 `ffmpegPath`와 `ffprobePath`만 실제 경로로 바꾸면 됩니다. `allowPathAutoDetectFallback`이 `false`이면 지정 경로/후보 경로가 없을 때 변환기가 중단되므로, 잘못된 FFmpeg가 자동 선택되는 것을 방지할 수 있습니다.

확인 명령:

```powershell
C:\ffmpeg\bin\ffmpeg.exe -version
C:\ffmpeg\bin\ffmpeg.exe -encoders | findstr /i "nvenc libx264"
C:\ffmpeg\bin\ffprobe.exe -version
```


이 문서는 현재 버전의 설치, 실행, 설정, 포트 구성, 점검 방법만 정리합니다.  


## V77.03 restart backoff isolation 보강

- 업로드된 최신 `cameras.json`을 기준 카메라 목록으로 반영했습니다.
- `cam002/cam003`처럼 m3u8 생성이 실패한 일반 RTSP 카메라는 즉시 재시작을 반복하지 않고 카메라별 backoff 상태로 격리합니다.
- API 로그에서 다음 형태를 확인할 수 있습니다.

```text
[RECONNECT] cam002 decision=restart reason=client-force-m3u8-missing ... attempt=1 backoff=30s
[RECONNECT] cam002 decision=reuse reason=restart-backoff 24s ...
```

- converter 로그에서 다음 형태를 확인할 수 있습니다.

```text
[FFMPEG_START] pid=... cam=cam002 ...
[HLS_WAIT_FAIL] cam002 stream.m3u8 not created within ...
[RESTART_BACKOFF] cam002 hlsStartFailures=1 wait=30.0s ...
```

- 정상 segment가 다시 갱신되면 restart attempt/backoff 상태는 자동 초기화됩니다.
- 초기 표시 속도 유지를 위해 `hlsStartup.minSegmentsToPlay`는 계속 1개 조건을 유지합니다.


## V77.01 restart storm guard 보강

- `cam002`를 닫은 직후 다시 열었을 때, HLS.js 오류가 서버 `client-force-restart`를 반복 발생시켜 black/play/black이 반복되는 현상을 보강했습니다.
- 클라이언트가 `forceRestart=true`를 보내도 서버가 무조건 재시작하지 않고, 최신 segment freshness, startup grace, restart cooldown을 먼저 판단합니다.
- 최신 segment가 신선하면 `decision=reuse reason=fresh-segment`로 기존 세션을 유지합니다.
- 새로 연 지 약 15초 이내에는 `decision=reuse reason=startup-grace`로 서버 재시작을 억제합니다.
- 최근 재시작 이후 cooldown 중이면 `decision=reuse reason=restart-cooldown`으로 반복 재시작을 차단합니다.
- 브라우저 HLS.js 오류는 기본 4회까지 로컬 recover/reload를 먼저 수행하고, 최소 15초 이후에만 서버 재시작 요청으로 넘어갑니다.
- 같은 카메라를 여는 중에는 중복 viewer-click 요청을 무시하도록 `openingCameraIds` 보호를 추가했습니다.
- 초기 표시 속도 유지를 위해 `hlsStartup.minSegmentsToPlay`는 계속 기존 1개 조건을 유지합니다.

로그에서 다음 형태를 확인할 수 있습니다.

```text
[RECONNECT] cam002 decision=reuse reason=startup-grace ... clientForce=true
[RECONNECT] cam002 decision=reuse reason=fresh-segment ... clientForce=true
[RECONNECT] cam002 decision=reuse reason=restart-cooldown ... clientForce=true
```

## V77.00 close/open session race 보강

- 일반 RTSP Viewer를 닫은 직후 바로 다시 열 때, 이전 종료 작업이 새 Viewer의 HLS 파일을 삭제하지 않도록 세션 보호를 추가했습니다.
- 새 Viewer 요청마다 `sessionId`/`restartToken`을 발행하고 HLS URL에 `?sid=...`를 붙입니다.
- 브라우저가 이전 `stream.m3u8`/segment 상태를 재사용해 블랙 화면에서 멈추는 현상을 줄이기 위한 cache/session 분리입니다.
- HLS.js 오류가 반복되면 기존 HLS.js 객체를 폐기하고 서버에 `forceRestart` reconnect를 요청합니다.
- Python converter는 종료 중인 오래된 worker가 현재 active 된 새 세션의 media 폴더를 지우지 않도록 `session_token`을 비교합니다.
- 초기 표시 속도 유지를 위해 `hlsStartup.minSegmentsToPlay`는 기존 1개 조건을 유지합니다.

확인 주소:

```text
http://서버IP:8080/api/streams/status/cam002
```

상태 응답에서 다음 항목을 확인할 수 있습니다.

```text
apiVersion: v77.01
sessionId: cam002-...
mediaPath: /media/cam002/stream.m3u8?sid=cam002-...
```

로그에서 다음 형태를 확인할 수 있습니다.

```text
[REQUEST] cam002 existed=false added active source=viewer-click session=...
[RECONNECT] cam002 decision=restart reason=client-force-restart ... session=...
[SKIP_CLEANUP] cam002 reopened currentSession=... oldSession=...
```

## V76.15 reconnect stale restart 보강

- 브라우저가 `source=reconnect`로 재접속을 요청할 때, 서버는 active 여부만 갱신하지 않고 HLS health를 확인합니다.
- 최신 segment가 `hlsWatchdog.hardStaleSec` 이상 갱신되지 않으면 `camera_list.json`의 해당 항목에 `restartToken`을 기록합니다.
- Python converter는 `restartToken` 변경을 감지하면 기존 ffmpeg를 종료하고 media 폴더를 정리한 뒤 새 ffmpeg를 시작합니다.
- 닫힌 카메라나 active 목록에 없는 일반 RTSP는 reconnect로 다시 살아나지 않습니다.
- 상태 API에서 `health.latestSegmentName`, `health.latestSegmentAgeSec`, `health.segmentCount`, `health.m3u8AgeSec`를 확인할 수 있습니다.

확인 주소:

```text
http://서버IP:8080/api/streams/status/cam002
http://서버IP:8080/api/streams/status/cam003
```

로그에서 다음 형태를 확인할 수 있습니다.

```text
[RECONNECT] cam002 decision=reuse reason=healthy-or-within-grace
[RECONNECT] cam002 decision=restart reason=segment-stale 52s
[RESTART_TOKEN] cam002 requested restart token=...
```


## V76.14 camera_list.json 저장 충돌 방지

- `camera_list.json` 저장은 전용 큐를 통해 순서대로 처리합니다.
- 동시에 여러 Viewer 요청이나 keep-alive가 들어와도 같은 `camera_list.json.tmp` 파일을 공유하지 않습니다.
- `keep-alive-touch`는 active 여부 확인용으로만 사용하며, 정상 active 상태에서는 `camera_list.json`을 매번 저장하지 않습니다.
- active 목록에 없는 일반 RTSP에 대한 keep-alive는 새 스트림으로 재등록하지 않고 무시합니다.
- 이 변경은 Windows에서 발생하던 `EPERM` / `ENOENT` rename 오류를 줄이기 위한 것입니다.


## V76.13 HLS API DEBUG/NORMAL 로그 모드

- `shared/config/GISDashBoard.json`의 `hlsLogging.mode`로 로그 상세도를 선택합니다.
- `normal` 모드는 운영용 기본값입니다. 시작/종료, request/release, release-all, Watchdog 재시작, 오류/경고 같은 중요 로그만 기록합니다.
- `debug` 모드는 문제 추적용입니다. HTTP 요청, precheck 결과, 상태 확인 같은 세부 로그까지 `shared/logs/hls_api.log`에 기록합니다.
- 로그 파일은 `shared/logs/hls_api.log`에 저장되며, 크기가 커지면 `hls_api.log.1`, `hls_api.log.2` 형태로 rotation됩니다.
- 현재 설정은 `http://서버IP:8080/api/logging` 또는 `/api/health`에서 확인할 수 있습니다.
- 설정 파일을 수정한 뒤 HLS API를 재시작하거나 `POST /api/logging/reload`를 호출하면 새 설정을 반영할 수 있습니다.

예시:

```json
"hlsLogging": {
  "enabled": true,
  "mode": "debug",
  "apiLogFile": "shared/logs/hls_api.log",
  "maxBytes": 2097152,
  "backups": 3,
  "console": true
}
```


## V76.12 release 상태 동기화 및 timestamp 로그

- 개별 Viewer를 닫으면 서버 `camera_list.json`에서 해당 일반 RTSP camId를 먼저 제거합니다.
- Python converter Watchdog은 재시작 직전에 `camera_list.json` active 목록을 다시 확인합니다. 닫힌 카메라는 ffmpeg를 다시 시작하지 않습니다.
- `모두 닫기`는 화면 Viewer뿐 아니라 서버의 일반 RTSP active 항목도 `/api/streams/release-viewers`로 정리합니다.
- 프론트엔드 keep-alive/reconnect timer는 닫힌 camId를 다시 request하지 않도록 `releasedCameraIds`로 차단합니다.
- HLS API/Python converter 주요 로그에 `[HH:MM:SS.mmm]` 시간이 붙어 동작 순서를 추적하기 쉽습니다.
- `/api/streams/request` 요청에는 `source=viewer-click|keep-alive|reconnect` 등이 기록되어 ffmpeg 재시작 원인을 추적할 수 있습니다.

## V76.11 시작/종료 런타임 상태 초기화

- `camera_list.json`은 영구 설정이 아니라 현재 실행 중인 HLS 변환 상태 파일로 취급합니다.
- HLS API 시작 시 이전 실행에서 남아 있던 일반 `rtsp` active 항목을 제거하고, `rtsp+`/alwaysOn 스트림만 다시 등록합니다.
- 시작 시 일반 RTSP 카메라의 이전 media 폴더를 정리하여 오래된 segment가 새 실행 상태로 오인되지 않도록 했습니다.
- HLS API가 `SIGINT`/`SIGTERM`으로 종료될 때도 일반 RTSP active 상태와 media 폴더를 정리합니다.
- 실행 중에는 사용자가 선택한 일반 RTSP active 상태를 유지하므로, 같은 camId에 대해 중복 ffmpeg가 실행되는 상황을 줄입니다.

## V76.10 HLS segment 0.25초 튜닝

- HLS segment 길이를 `0.5초`에서 `0.25초`로 줄였습니다.
- playlist 유지 개수는 `24`에서 `48`로 늘려 이론상 live window를 약 12초 수준으로 유지합니다.
- 삭제 여유 segment는 `12`에서 `24`로 늘렸습니다.
- segment 생성 빈도는 늘어나지만, 초기 segment 생성과 live edge 접근성이 개선될 수 있습니다.


## V76.08 Viewer 중복 방지 및 전체 닫기 보강

- 같은 카메라를 다시 선택해도 GIS HLS Viewer를 새로 만들지 않고 기존 Viewer를 앞으로 가져옵니다.
- HLS 재연결/재시도 중에도 동일 `camId`에 대한 Viewer는 하나만 유지합니다.
- `모두 닫기`는 내부 상태에 등록된 Viewer와 화면에 남은 고아 Viewer DOM을 모두 정리합니다.
- 닫기 후 HLS.js, video source, timer, 연결선, stream release 정리 흐름을 유지합니다.


## HLS Viewer 상태 관리 개선

- GIS HLS Viewer는 HLS.js 재생 성공 이벤트를 기준으로 `준비중` 상태를 해제합니다.
- 재생이 성공하면 상단 상태바의 `HLS.js 준비중...` 문구를 자동으로 숨깁니다.
- 여러 Viewer 중 아직 준비 중인 항목이 있을 때만 상태 문구를 유지합니다.
- Viewer가 열려 있는 동안 일반 RTSP 스트림은 주기적으로 keep-alive 재요청을 수행합니다.
- 일시적으로 `active=false`가 감지되면 자동으로 `/api/streams/request`를 재요청합니다.
- 닫기 버튼은 준비중/재시작 상태와 무관하게 항상 동작하도록 보강되었습니다.



## V76.07 주요 운용 개선

- HLS Watchdog을 보수적으로 변경했습니다. `stream.m3u8` 갱신 시간만 보지 않고 segment 증가 여부도 함께 확인합니다.
- 정체가 감지되면 기존 Viewer를 닫지 않고 마지막 화면을 유지한 채 `영상 재연결 중...` 상태로 전환합니다.
- 기존 ffmpeg가 완전히 종료된 것을 확인한 뒤 HLS 출력 파일을 정리하고 새 ffmpeg를 시작합니다.
- 짧은 간격의 반복 재시작을 막기 위해 `minRestartIntervalSec`와 낮은 `maxRestartsPerHour`를 적용합니다.
- 새 일반 RTSP 카메라를 열기 전에 리소스 상태와 현재 Viewer 수를 확인합니다. 필요하면 가장 오래된 일반 RTSP Viewer를 자동으로 닫고 새 카메라를 엽니다.
- YTN 같은 `rtsp+`/alwaysOn 스트림은 자동 종료 대상에서 제외합니다.
- `/api/system/resources`에서 CPU/메모리/GPU 상태와 active stream 목록을 확인할 수 있습니다.

버전별 수정 이력은 `../HISTORY.md`를 확인하세요.

---

## 1. 프로젝트 구조

```text
ric_v8/
  apps/
    main_dashboard/      메인 통합 대시보드
    hls_converter/       GIS 지도, HLS API, RTSP→HLS 변환, HLS Viewer
    weather_dashboard/   날씨 대시보드
    sms_dashboard/       긴급문자 대시보드
    news_dashboard/      뉴스 대시보드
    event_dashboard/     이벤트 스냅샷 대시보드
    report_dashboard/    보고서 작성·결재 대시보드
  shared/
    data/                cameras.json, camera_list.json
    config/              modules.json, ports.json, GISDashBoard.json 등 공통 설정
    media/               ffmpeg가 생성하는 HLS 출력 위치
  infra/scripts/         Windows 실행/점검 스크립트
  docs/README.md         현재 버전 사용 설명서
  HISTORY.md             버전 이력
```

---

## 2. 설치 전 준비

### 필수 프로그램

- Python 3.x
- Node.js
- npm
- FFmpeg
- Chrome 또는 Edge 브라우저

FFmpeg는 일반적으로 아래 경로를 권장합니다.

```text
C:\Program Files\ffmpeg\bin\ffmpeg.exe
```

### Python 패키지

Weather Dashboard는 실행 전에 `requirements.txt`를 자동 설치하도록 구성되어 있습니다.

```text
apps/weather_dashboard/requirements.txt
```

주요 패키지:

```text
flask
requests
python-dotenv
```

---

## 3. 실행 방법

전체 실행:

```bat
ric_v8\infra\scripts\run_all.bat
```

개별 실행:

```bat
ric_v8\infra\scripts\run_hls_converter.bat
ric_v8\infra\scripts\run_weather_dashboard.bat
ric_v8\infra\scripts\run_sms_dashboard.bat
ric_v8\infra\scripts\run_news_dashboard.bat
ric_v8\infra\scripts\run_event_dashboard.bat
ric_v8\infra\scripts\run_report_dashboard.bat
ric_v8\infra\scripts\run_main_dashboard.bat
```

전체 정지:

```bat
ric_v8\infra\scripts\stop_all.bat
```

---

## 4. 접속 주소

서버 PC에서 직접 접속:

```text
http://localhost:8090/apps/main_dashboard/web/index.html
```

외부 PC에서 접속:

```text
http://<서버IP>:8090/apps/main_dashboard/web/index.html
```

예:

```text
http://192.168.0.199:8090/apps/main_dashboard/web/index.html
```

하위 대시보드와 HLS API는 메인 대시보드에 접속한 hostname을 기준으로 자동 변환됩니다.  
예를 들어 `192.168.0.199:8090`으로 접속하면 내부 프레임은 `192.168.0.199:8080`, `192.168.0.199:8100` 등으로 연결됩니다.

---

## Report Dashboard 통합 (V78.01)

- 메인 대시보드 우측 상단의 **보고서 대시보드** 버튼을 누르면 Report Dashboard가 새 브라우저 창이 아닌 메인 화면의 모달로 열립니다.
- 모달은 닫기 버튼, 모달 바깥 배경 클릭, `Esc` 키로 닫을 수 있습니다. 닫은 뒤에는 키보드 포커스가 메인의 **보고서 대시보드** 버튼으로 복귀합니다.
- Report Dashboard는 3200 포트에서 동작하며, 모달 iframe은 `shared/config/modules.json`의 `report_url`을 사용합니다.
- Report Dashboard는 SMS Frontend가 사용 중인 3000 포트를 사용하지 않고 **3200 포트**를 사용합니다.
- 전체 시작(`infra\scripts\run_all.bat`) 시 Report Dashboard도 자동 시작하고 상태 API(`/api/health`) 응답까지 확인합니다.
- 서버 환경값은 `.env`가 아니라 `apps/report_dashboard/config/report_dashboard.json`에서 관리합니다.
- 보고서 DB는 코드 폴더가 아닌 `shared/data/report_dashboard/db.json`에 저장됩니다. 버전 교체 시 기존 DB를 보존하십시오.

Report Dashboard 단독 실행:

```bat
infra\scripts\run_report_dashboard.bat
```

직접 접속 주소:

```text
http://<서버IP>:3200/
```


## 카메라 기준 파일 (V78.01)

- `shared/data/cameras.json`은 HLS API와 Converter가 실제로 읽는 유일한 카메라 목록입니다(v75.28부터 단일 원본).
- `shared/config/cameras.json`은 존재하지 않습니다. 카메라 추가/주소 변경/좌표 변경은 `shared/data/cameras.json`만 수정합니다.

---

## 5. 포트 구성

| 서비스 | 포트 | 용도 |
|---|---:|---|
| Main Dashboard | 8090 | 통합 대시보드 웹 |
| HLS / GIS API / Media | 8080 | 카메라 API, GIS Viewer, HLS media |
| Weather Dashboard | 8100 | 날씨 대시보드 |
| SMS Frontend | 3000 | 긴급문자 화면 |
| SMS Backend | 3005 | 긴급문자 API 프록시 |
| News Frontend | 5173 | 뉴스 화면 |
| News Backend | 8000 | 뉴스 API 프록시 |
| Event Dashboard | 3100 | 이벤트 스냅샷 대시보드 |
| Report Dashboard | 3200 | 보고서 작성·결재 대시보드 |

외부 PC에서 접속하려면 Windows 방화벽에서 위 포트를 허용해야 합니다.

포트 점검:

```bat
ric_v8\infra\scripts\check_remote_ports.bat <서버IP>
```

예:

```bat
ric_v8\infra\scripts\check_remote_ports.bat 192.168.0.199
```

---

## 6. 주요 설정 파일

| 파일 | 설명 |
|---|---|
| `shared/data/cameras.json` | 유일한 카메라 원본 |
| `shared/data/camera_list.json` | ffmpeg 변환 런타임 상태 |
| `shared/config/GISDashBoard.json` | GIS/HLS 설정, 변환 엔진, HLS 출력, 오디오 설정 |
| `shared/config/modules.json` | 메인 대시보드 iframe 주소 템플릿 |
| `shared/config/ports.json` | 포트 정의 |
| `apps/report_dashboard/config/report_dashboard.json` | Report Dashboard 서버 바인딩·포트·DB 경로·요청 크기 설정 |
| `shared/data/report_dashboard/db.json` | Report Dashboard 운영 데이터 및 결재 이력 |

현재 카메라 수: **19개**

카메라 추가/수정은 반드시 아래 파일에서만 합니다.

```text
shared/data/cameras.json
```

---

## 7. HLS 변환 설정

`shared/config/GISDashBoard.json`의 `hlsConversion`에서 RTSP 변환 엔진을 선택합니다.

```json
{
  "rtspEngine": "cpu",
  "rtspPlusEngine": "gpu",
  "gpuIndex": 0,
  "fallbackToCpu": true,
  "note": "rtspEngine/rtspPlusEngine 값은 cpu 또는 gpu입니다. PC/서버 GPU 테스트 기본값은 rtsp와 rtsp+ 모두 gpu이며, 실패 시 fallbackToCpu로 CPU 재시도합니다."
}
```

HLS segment 정책:

```json
{
  "hlsTime": 0.25,
  "hlsListSize": 48,
  "hlsDeleteThreshold": 24,
  "note": "초기 표출과 live edge 접근성을 개선하기 위해 segment 길이를 0.25초로 줄이고, playlist window는 약 12초로 유지하도록 보관 개수는 48/24로 조정합니다."
}
```

RTSP 빠른 시작 정책:

```json
{
  "fastStart": true,
  "minSegmentsToPlay": 1,
  "maxM3u8AgeSec": 6,
  "initialWaitMs": 3000,
  "backgroundWaitMs": 60000,
  "fastProbeIntervalMs": 500,
  "retryIntervalMs": 1000,
  "statusIntervalMs": 1000,
  "probeAnalyzeDuration": 1000000,
  "probeSize": 1000000
}
```

이 설정은 prewarm 없이 새 RTSP 카메라를 선택했을 때 첫 화면 표출 시간을 줄이기 위한 설정입니다. `minSegmentsToPlay`는 1로 완화되어 있으며, 초기 재생 중 문제가 생기면 기존 HLS 재시작/재로드 로직으로 복구합니다.

---

## 8. YTN 오디오 정책

현재 버전은 YTN 같은 `rtsp+` 스트림에만 오디오를 포함하도록 구성되어 있습니다.

```json
{
  "enabled": true,
  "rtspPlusAudio": true,
  "rtspAudio": false,
  "codec": "aac",
  "bitrate": "128k",
  "sampleRate": 44100,
  "channels": 2,
  "note": "YTN 같은 rtsp+ 스트림만 오디오를 포함합니다. 일반 rtsp 카메라는 영상만 유지합니다."
}
```

정책:

- `rtsp+` / YTN: 영상 + 음성
- 일반 `rtsp`: 영상만
- 브라우저 자동재생 정책 때문에 기본은 음소거 자동재생
- YTN 화면 또는 CAM 모드에서 `음성 켜기` 버튼을 눌러야 소리가 켜짐

오디오 진단:

```text
http://<서버IP>:8080/api/streams/status/video1
```

---

## 9. 원격 접속 점검 순서

1. 서버 PC에서 전체 실행
2. 서버 PC에서 HLS API 확인

```text
http://localhost:8080/api/health
```

3. 외부 PC에서 HLS API 확인

```text
http://<서버IP>:8080/api/health
```

4. 외부 PC에서 카메라 API 확인

```text
http://<서버IP>:8080/api/cameras
```

5. 외부 PC에서 메인 대시보드 접속

```text
http://<서버IP>:8090/apps/main_dashboard/web/index.html
```

6. 브라우저 캐시 문제 발생 시 `Ctrl + F5`로 강제 새로고침

---

## 10. Kakao Map 주의사항

외부 IP로 접속할 경우 Kakao Developers 콘솔에 아래와 같은 도메인 등록이 필요할 수 있습니다.

```text
http://<서버IP>:8080
http://<서버IP>:8090
```

등록하지 않으면 GIS 지도 영역이 검게 보일 수 있습니다.

---

## 11. 문제 발생 시 빠른 확인

### 카메라 리스트가 안 보일 때

```text
http://<서버IP>:8080/api/cameras
```

브라우저 개발자 도구 Console에서 `api/cameras` 요청 URL이 `localhost`가 아니라 서버 IP인지 확인합니다.

### HLS 영상이 안 나올 때

```text
http://<서버IP>:8080/api/streams/status/<camId>
```

예:

```text
http://<서버IP>:8080/api/streams/status/video1
```

### Weather에서 dotenv 오류가 날 때

```bat
cd apps\weather_dashboard
python -m pip install -r requirements.txt
```

현재 실행 스크립트는 실행 전에 자동 설치하도록 되어 있습니다.

---

## 12. 패키징 / 공유 전 정리

공유용으로 정리할 때는 `shrink_for_share.py` 또는 별도 정리 스크립트로 아래를 제거합니다.

- `node_modules`
- `__pycache__`
- HLS segment/media 임시 파일
- 로그/캐시 파일
- 빌드 산출물

민감정보가 들어 있을 수 있으므로 외부 공유 전 반드시 계정, 비밀번호, API Key, RTSP URL을 점검하세요.

### HLS.js 재생 정책

Chrome/Edge/Firefox에서는 HLS.js를 우선 사용합니다. 일부 브라우저에서 Native HLS 지원값이 반환되더라도 실제 재생이 멈출 수 있으므로, Native HLS는 Safari 계열에서만 fallback으로 사용합니다.

```text
Chrome / Edge / Firefox → HLS.js 우선
Safari / iOS            → Native HLS fallback 허용
```

HLS.js가 로드되지 않으면 화면에 로드 실패 메시지를 표시합니다. 네트워크가 CDN을 차단하는 환경에서는 HLS.js CDN 접근 여부를 확인해야 합니다.



## RTSP 사전 점검 및 자동 재시작

현재 버전은 일반 RTSP 카메라를 선택할 때 HLS 변환을 바로 시작하지 않고 사전 점검을 수행합니다.

1. RTSP URL의 host와 port를 추출합니다.
2. TCP 연결 가능 여부를 확인합니다.
3. ffprobe로 video stream 존재 여부를 확인합니다.
4. 점검 실패 시 Viewer와 HLS 변환을 시작하지 않고 접속 불가 메시지를 표시합니다.

상태 확인 API:

```text
http://서버IP:8080/api/cameras/check/cam001
http://서버IP:8080/api/streams/status/cam001
```

`GISDashBoard.json`의 `hlsPrecheck`와 `hlsWatchdog`에서 timeout과 watchdog 기준을 조정할 수 있습니다.

```json
"hlsPrecheck": {
  "enabled": true,
  "tcpTimeoutMs": 1200,
  "ffprobeTimeoutMs": 4500,
  "cacheTtlMs": 10000
},
"hlsWatchdog": {
  "enabled": true,
  "startupGraceSec": 25,
  "staleM3u8Sec": 12,
  "restartDelaySec": 1,
  "maxRestartsPerHour": 30
}
```


### V77.07 기본 운영 권장

GTX 1650 Ti + Intel 내장 GPU 서버에서는 `h264_nvenc/cuda` 경로가 NVIDIA GPU만 사용합니다. 안정 운전을 위해 기본값은 `video1/YTN(rtsp+)`만 NVIDIA GPU를 사용하고, `cam002/cam003` 같은 일반 RTSP는 CPU/libx264로 변환합니다. 재시작 중에는 검은 화면 대신 마지막 프레임을 유지하는 freeze-frame overlay가 표시됩니다.
