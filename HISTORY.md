# 2026-08-05 / RIC_V78_07_event_dashboard_archive_https

## 수정 내용

- `apps/event_dashboard/server.js`의 `/api/image` 스냅샷 프록시가 AxxonONE archive 미디어 서버에 `http://`로 접속하며 VMS 계정 정보(Basic Auth)를 평문으로 전송하던 것을 `https://`로 변경했습니다.
- Node 전역 `fetch()`는 undici 기반이라 커스텀 CA(Node `https.Agent`)를 인식하지 못하므로, 이 요청만 Node 내장 `https` 모듈로 직접 처리하도록 `fetchArchiveImage()` 헬퍼를 추가했습니다.
- archive HTTPS 연결은 gRPC와 동일한 `api.ngp.root-ca.crt` 루트 CA를 신뢰 목록에 추가해서 검증합니다(`tls.rootCertificates`에 추가하는 방식이라 공개 CA로 서버 인증서가 바뀌어도 계속 동작합니다). 재시도(404 시 재시도)·오류 처리 동작은 기존과 동일하게 유지했습니다.
- gRPC의 `ssl_target_name_override`/`CERT_OVERRIDE_HOST` 설정은 AxxonONE gRPC 인증서가 고정 호스트명으로 발급되는 표준 방식에 맞춘 의도된 설정(루트 CA pinning)으로 확인되어 변경하지 않았습니다.

## 검증 내용

- `node --check server.js` 통과
- 서버를 임시 기동해 `/api/settings` 정상 응답, `/api/image`가 (샌드박스에서 VMS 접근 불가로 인한) 네트워크 오류를 코드 크래시 없이 500으로 정상 처리함을 확인
- 테스트 후 프로세스 종료 및 포트 해제 확인

---

# 2026-08-05 / RIC_V78_06_gisdashboard_config_data_sync

## 수정 내용

- `shared/config/GISDashBoard.json`과 `shared/data/GISDashBoard.json`의 `hlsWatchdog` 임계값이 서로 달라(startupGraceSec 45↔30, softStaleSec 10↔6, staleM3u8Sec 25↔12, hardStaleSec 45↔18) 두 파일이 실제로 어긋나 있던 문제를 정리했습니다.
- `apps/hls_converter/api/server.js`와 `apps/hls_converter/converter/ffmpeg_manager.py`가 실제로 읽는 파일은 `shared/data/GISDashBoard.json`이므로(코드 경로로 확인), 배포·검토용 미러인 `shared/config/GISDashBoard.json`을 `shared/data` 값 기준으로 동기화했습니다. 실제 운영 중인 watchdog 동작값은 변경하지 않았습니다.

## 검증 내용

- `diff`로 `shared/config/GISDashBoard.json`과 `shared/data/GISDashBoard.json`이 완전히 동일해졌음을 확인
- 두 파일 모두 JSON 문법 검사 통과

---

# 2026-08-05 / RIC_V78_05_root_gitignore_and_credential_hardening

## 수정 내용

- 저장소 루트에 `.gitignore`/`.gitattributes`가 없어 `apps/`, `shared/` 등 전체가 커밋 시 `.env` 실키, HLS 미디어 산출물, 로그/캐시까지 그대로 올라갈 수 있었던 문제를 막기 위해 루트 `.gitignore`(node_modules, .env, 로그, 캐시, shared/media 산출물 등)와 `.gitattributes`(eol 정책, 바이너리 처리)를 추가했습니다.
- `apps/event_dashboard/config/event_dashboard.json`에 평문으로 들어있던 AxxonONE VMS 계정(`LOGIN`, `PASSWD`)을 JSON에서 제거하고, `apps/event_dashboard/.env`(백엔드 전용)에서만 읽도록 `dotenv`를 연동했습니다. `.env.example`과 앱 전용 `.gitignore`를 추가했습니다.
- `apps/report_dashboard/server.ts`의 결재 API(`/approve`, `/reject`, `/void`)가 관리자/안전감독관/감리단장 암호를 전혀 검사하지 않고 `role`/`reason` 값만으로 동작하던 문제(프런트엔드 비밀번호 입력창은 UI 표시일 뿐 서버로 전달되지 않았음)를 수정했습니다. 서버가 `apps/report_dashboard/.env`의 `REPORT_ADMIN_PASSWORD`/`REPORT_INSPECTOR_PASSWORD`/`REPORT_DIRECTOR_PASSWORD`를 기준으로 각 요청의 `password` 값을 검사하며, 값이 없거나 틀리면 401로 거부합니다. CLAUDE.md 7.2가 요구하는 "백엔드에서도 상태/권한을 검사"를 충족합니다.
- 프런트엔드(`src/App.tsx`)는 비밀번호 확인 단계에서 로컬 상수(`raon1234`, `1111`, `2222`) 비교 대신 신규 `/api/auth/verify-password`를 호출해 서버 값과 대조하도록 변경하고, 확인된 비밀번호를 승인/반려/무효처리 API 요청 본문에 함께 실어 보내도록 수정했습니다.
- 안전감독관/감리단장 결재 암호 변경 UI가 브라우저 상태에만 저장되어 새로고침 시 항상 `1111`/`2222`로 초기화되던 문제를 함께 정리했습니다. 신규 `/api/auth/change-password`(관리자 암호 확인 필요)를 통해 서버 메모리 값을 변경하도록 했습니다. 서버 재시작 시에는 `.env` 값으로 되돌아가므로, 영구히 바꾸려면 `.env`를 직접 수정해야 합니다.
- `apps/report_dashboard/.env.example`을 추가하고 앱 `.gitignore`에 `.env` 제외 규칙을 추가했습니다.

## 검증 내용

- 루트 `.gitignore` 적용 후 `git status --ignored`로 `apps/news_dashboard/.env`, `apps/news_dashboard/backend/.env`, `apps/sms_dashboard/.env`, `apps/weather_dashboard/.env`가 무시 처리됨을 확인
- `apps/event_dashboard`: `node --check server.js`, JSON 문법 검사, 실제 기동 후 `/api/settings` 응답에 `LOGIN`/`PASSWD` 미노출 및 `.env` 값 정상 로드(`LOGIN=root`) 확인
- `apps/report_dashboard`: `npm run lint`(`tsc --noEmit`) 통과, `npm run build`(vite build + esbuild server 번들) 통과
- `apps/report_dashboard`: 프로덕션 서버를 임시 기동해 다음을 curl로 확인
  - `POST /api/auth/verify-password` 잘못된 관리자 암호 → 401, 올바른 암호 → 200
  - `POST /api/reports/:id/void` 잘못된 관리자 암호 → 401(존재하지 않는 문서 ID에서도 비밀번호 검사가 조회보다 먼저 수행됨을 확인), 올바른 암호 → 404 Report not found(비밀번호 검사 통과 후 다음 단계로 정상 진행)
  - `POST /api/reports/:id/approve` 잘못된 감리단장 암호 → 401
  - `POST /api/auth/change-password` 잘못된 관리자 암호 → 401, 올바른 관리자 암호로 안전감독관 암호 변경 → 이후 새 암호로 `verify-password` 200, 기존 암호로는 401 확인
  - 테스트 후 임시 서버 프로세스 종료, 포트 재확인으로 잔류 프로세스 없음 확인

---

# 2026-07-08 / RIC_V78_03_backend_api_keys_split_frontend

## 수정 내용

- 뉴스 대시보드의 Gemini API 호출을 브라우저 직접 호출 방식에서 `apps/news_dashboard/backend/server.py`의 `/api/ai/analyze` 백엔드 프록시 방식으로 변경했습니다.
- 뉴스 대시보드의 `VITE_GEMINI_API_KEY`와 프론트엔드 `.env.local`을 제거하고, Gemini/SafetyData 키를 `apps/news_dashboard/backend/.env`에서만 읽도록 분리했습니다.
- 뉴스 `/api/config` 응답과 저장 로직에서 `ServiceKey`, `GEMINI_API_KEY`, `VITE_GEMINI_API_KEY` 같은 비밀 키 항목이 클라이언트로 내려가지 않도록 차단했습니다.
- SMS 대시보드는 SafetyData 키를 기존처럼 Express 백엔드 `.env`에서만 사용하도록 정리하고, 프론트엔드 Vite 설정에서 `process.env.GEMINI_API_KEY` 주입 코드를 제거했습니다.
- 뉴스/SMS 프론트엔드를 클라이언트 PC에서 실행하고 백엔드는 서버 PC에서 실행할 수 있도록 `NEWS_BACKEND_URL`, `SMS_BACKEND_URL` 기반 Vite proxy 설정과 `run_frontend_client.bat`를 추가했습니다.
- 메인 대시보드 `modules.json`에 `backend_host`/`frontend_host` 분리 설정과 `{BACKEND_HOST}`/`{FRONTEND_HOST}` placeholder를 추가해, 클라이언트 프론트엔드와 서버 백엔드를 분리해도 iframe/API 주소를 명시할 수 있게 했습니다.
- 날씨 대시보드는 KMA 키를 backend `.env`에서만 사용하도록 유지하고, 원격 프론트/백엔드 분리 운영을 위해 CORS 응답 헤더를 보강했습니다.

## 검증 내용

- 프론트엔드 소스에서 `VITE_GEMINI_API_KEY`, `import.meta.env.VITE_GEMINI_API_KEY`, SafetyData `ServiceKey` 직접 사용 제거 확인
- 뉴스 백엔드 `/api/config`가 공개 설정만 반환하고 API 키를 반환하지 않는 로직 검사
- 뉴스 백엔드 `/api/news` SafetyData 호출과 `/api/ai/analyze` Gemini 호출이 모두 backend `.env` 값을 사용하도록 알고리즘 점검
- 뉴스/SMS Vite proxy가 클라이언트 PC 실행 시 `NEWS_BACKEND_URL`/`SMS_BACKEND_URL`을 서버 백엔드 주소로 사용할 수 있는지 정적 검증
- Python/TypeScript/JavaScript 문법 검사 및 JSON 문법 검사
- ZIP 무결성 검사

---

# 2026-07-08 / RIC_V78_02_ffmpeg_path_config

## 수정 내용

- HLS Converter가 사용할 FFmpeg/FFprobe 실행 파일 경로를 `shared/data/GISDashBoard.json`의 `hlsTools`에서 지정할 수 있도록 추가했습니다.
- `shared/config/GISDashBoard.json`에도 동일한 `hlsTools` 설정을 반영해 배포/설정 기준 파일을 일치시켰습니다.
- 우선순위는 `--ffmpeg` 명령행 인자 → `hlsTools.ffmpegPath` → `hlsTools.ffmpegCandidates` → `allowPathAutoDetectFallback=true`일 때만 PATH 자동 탐색 순서입니다.
- 기본 후보는 `C:\ffmpeg\bin\ffmpeg.exe`, `C:\Program Files\ffmpeg\bin\ffmpeg.exe`이며, `allowPathAutoDetectFallback` 기본값을 `false`로 두어 AxxonSoft DriverPack의 제한된 `ffmpeg.exe`가 우선 선택되는 문제를 막았습니다.
- HLS API의 RTSP 사전 점검용 `ffprobe`도 같은 `hlsTools` 설정에서 `ffprobePath`/`ffprobeCandidates`를 우선 사용하도록 수정했습니다.
- `/api/health` 응답에 `hlsTools` 설정을 포함하여 현재 HLS 도구 경로 설정을 확인할 수 있게 했습니다.

## 검증 내용

- Python 문법 검사 통과
- Node.js HLS API 문법 검사 통과
- JSON 문법 검사 및 `shared/data/GISDashBoard.json`/`shared/config/GISDashBoard.json`의 `hlsTools` 일치 확인
- FFmpeg 경로 선택 알고리즘 검증: CLI 지정값 최우선, JSON 후보 우선, JSON 후보가 없거나 허용된 경우에만 PATH fallback
- ZIP 무결성 검사

---

# 2026-07-06 / RIC_V78_01_report_dashboard_modal_camera_source

## 수정 내용

- 메인 대시보드 상단의 **보고서 대시보드** 버튼을 별도 브라우저 창 실행 방식에서 메인 화면 내 모달 방식으로 변경했습니다.
- 모달 내부에는 `shared/config/modules.json`의 `report_url`(기본 3200 포트)을 iframe으로 연결합니다. 새 창/탭을 열지 않습니다.
- 모달은 닫기 버튼, 배경 클릭, `Esc` 키로 닫을 수 있으며, 닫은 뒤 키보드 포커스는 메인의 **보고서 대시보드** 버튼으로 되돌아갑니다.
- 첨부 `cameras(4).json`을 새 카메라 기준 파일로 적용했습니다. HLS API가 실제로 읽는 `shared/data/cameras.json`과 배포 설정 미러인 `shared/config/cameras.json`을 동일한 내용으로 교체했습니다.
- `video1` RTSP+ 상시 변환, `cam001`~`cam004` RTSP, 나머지 HLS 카메라 목록은 첨부 파일 정의를 그대로 사용합니다.

## 검증 내용

- `cameras.json` JSON 문법, 카메라 ID 중복 여부, `video1` RTSP+ 상시 소스 정의 확인
- `shared/data/cameras.json`과 `shared/config/cameras.json`의 해시 일치 확인
- 메인 Dashboard HTML/JavaScript/CSS 모달 구조·문법 검사
- Report Dashboard 3200 포트 응답 및 iframe 허용 헤더 확인
- 모달 열기 → 닫기 → 메인 보고서 버튼 포커스 복귀 알고리즘 점검
- ZIP 무결성 검사

---

# 2026-07-06 / RIC_V78_00_report_dashboard_integration

## 수정 내용

- `apps/report_dashboard`에 Report Dashboard 소스와 운영 빌드를 통합했습니다.
- 메인 대시보드 상단에 **보고서 대시보드** 버튼을 추가했습니다. 버튼은 `shared/config/modules.json`의 `report_url`을 사용하여 별도 창으로 Report Dashboard를 엽니다.
- SMS Frontend가 이미 사용하는 3000 포트와 충돌하지 않도록 Report Dashboard 전용 포트를 **3200**으로 지정했습니다.
  - `shared/config/ports.json`: `report_dashboard: 3200`
  - `shared/config/modules.json`: `report_url: http://{HOST}:3200/`
  - `apps/report_dashboard/config/report_dashboard.json`: `service.port: 3200`
- Report Dashboard의 포트, 서버 바인딩 주소, DB 파일 경로, 요청 본문 크기를 `.env` 대신 `apps/report_dashboard/config/report_dashboard.json`에 통합했습니다.
- 보고서 DB를 `shared/data/report_dashboard/db.json`에 두어 애플리케이션 코드 업데이트와 운영 데이터를 분리했습니다.
- `infra/scripts/run_report_dashboard.bat`, `open_report_dashboard.bat`를 추가하고, `run_all.bat`이 Report Dashboard를 자동 시작한 뒤 `/api/health`를 확인하도록 확장했습니다.
- `check_remote_ports.bat`에 Report Dashboard 포트 점검을 추가했습니다.
- `docs/README.md`와 `apps/report_dashboard/README.md`에 실행 방법, 포트, JSON 설정, DB 보존 정책을 반영했습니다.

## 검증 내용

- JSON 문법 검사
- Report Dashboard TypeScript 문법 검사 및 production server CJS 변환 검사
- 3200 포트 기동 후 `/api/health` 확인
- 메인 대시보드의 `report_url` 원격 hostname 정규화 및 버튼 popup 경로 검사
- `run_all.bat` Report 시작 → health 확인 → Main 시작 순서 검사
- 결재 흐름(작성 → 결재 요청 → 안전감독관 승인 → 감리단장 최종 승인, 반려, 무효 처리, 정정본) API 회귀 검사
- ZIP 무결성 검사

---

## 2026-06-16 / RIC_V77_12_ytn_panel_seek_loop_fix

### 수정 내용
- YTN 라이브 패널에서 정상 재생 중에도 `live edge - 3초` 보정이 반복 실행되어 약 3초 구간을 계속 되감아 재생하는 문제를 수정했습니다.
- `ytn.html`의 `timeupdate`, `LEVEL_LOADED`, `FRAG_CHANGED`, 주기 timer에서 live edge에 너무 가깝다는 이유만으로 seek하지 않도록 변경했습니다.
- background 복귀 후 0~5초로 리셋되었거나 live edge보다 30초 이상 뒤처진 경우에만 live 위치 보정을 수행합니다.
- player stall 상태는 기존처럼 player-only recovery에서 처리하고, 정상 재생 중에는 currentTime을 강제로 되감지 않습니다.
- GIS/HLS viewer 및 `camera_player.html`의 공통 live resume 보정에서도 live edge 근접만으로 되감는 조건을 제거해 동일한 반복 seek 부작용을 예방했습니다.
- YTN iframe cache busting 값을 `v=7712`로 갱신해 이전 player 코드가 브라우저 캐시에 남지 않도록 했습니다.
- V77.11의 epoch start_number, stale segment pruning, video1 GPU / cam002·cam003 CPU 정책은 유지했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- HTML inline JavaScript 문법 검사 통과
- 알고리즘 검증 통과: 정상 재생 중 live edge 근접만으로는 seek하지 않음
- 알고리즘 검증 통과: background 복귀 후 0~5초 리셋/30초 이상 지연일 때만 live 위치 보정
- zip 무결성 검사 통과

## RIC_V77_11_hls_prune_loop_fix

- video1/YTN에서 오래된 HLS segment 파일이 누적되어 짧은 구간을 반복 재생하는 문제를 방지했습니다.
- FFmpeg HLS segment 시작 번호를 epoch 기반으로 지정해 재시작 후 segment_000 재사용을 피합니다.
- stream.m3u8에서 참조 중인 segment와 최근 segment만 보존하고 오래된 segment를 주기적으로 prune합니다.
- rtsp+/video1 재시작 시에는 오래된 HLS 산출물을 정리하고, 브라우저는 마지막 frame overlay로 black 화면을 줄이는 기존 정책을 유지합니다.

## RIC_V77_10_background_live_resume_fix
- YTN 대시보드 iframe을 YouTube/외부 플레이어가 아니라 HLS Converter의 `/ytn.html?camId=video1` 공통 player로 명시 고정했습니다.
- YTN HLS player에 live edge 3초 buffer margin을 추가해 `재생시간=영상길이` 상태에서 멈춤/재생을 반복하는 현상을 줄였습니다.
- GIS/HLS viewer와 YTN 대시보드 모두 video1에 대해 `duration - 3초` 안정 지점으로 보정하는 player-only recovery를 적용했습니다.
- 기존 GPU 1개(YTN) + CPU 2개 이상(cam002/cam003) 정책은 유지했습니다.

## RIC_V77_10_background_live_resume_fix

- YTN/video1 로그에서 FFmpeg와 HLS segment 생성은 정상인데 화면만 멈추는 현상에 대응했습니다.
- HLS.js player currentTime stall 감시를 강화하고, segment가 fresh이면 FFmpeg/API 재시작 대신 player-only 복구를 우선 수행합니다.
- HLS.js liveSyncPosition 기반 live edge 강제 이동, FRAG_LOADED/FRAG_CHANGED/LEVEL_LOADED 기반 overlay 해제 조건을 추가했습니다.
- GPU 1개(YTN) + CPU 2개 이상(cam002/cam003) 동시 유지 정책은 유지합니다.
- 검증 txt 파일은 패키지에 포함하지 않습니다.

## RIC_V77_07_gpu1_cpu2plus_viewer_fix

- 기본 변환 정책을 `rtspEngine=cpu`, `rtspPlusEngine=gpu`로 변경했습니다. YTN/video1 같은 rtsp+ alwaysOn 스트림만 NVIDIA GPU를 사용하고, cam002/cam003 같은 일반 RTSP는 CPU/libx264를 사용합니다.
- NVIDIA GPU 0번을 명시적으로 선택할 수 있도록 `gpuIndex`, `rtspGpuIndex`, `rtspPlusGpuIndex` 설정을 유지/확장하고, GPU 모드 FFmpeg 명령에 `-hwaccel_device`와 `-gpu`를 추가했습니다.
- blackout 시간을 줄이기 위해 restart backoff를 rtsp+ 최대 15초, 일반 rtsp 최대 30초로 축소했습니다.
- controlled restart 시 기존 HLS 파일을 즉시 삭제하지 않고 보존하도록 하여 브라우저가 검은 화면으로 바뀌는 시간을 줄였습니다. 초기 기동 시 전체 ffmpeg 종료와 media cleanup 정책은 유지합니다.
- HLS.js 재동기화/재시작 중 마지막 정상 프레임을 캡처한 freeze-frame overlay를 표시하고, 새 영상이 재생되면 자동으로 제거하도록 했습니다.
- HLS segment 기본값을 0.25초에서 0.5초로 완화하여 GTX 1650 Ti 환경에서 파일 I/O와 playlist 갱신 부담을 줄였습니다.


## RIC_V77_04_player_ffmpeg_boot_diagnostics
- 최신 cameras.json 반영: video1/cam002/cam003 URL 수정본 기준 적용.
- segment가 계속 생성되는데 브라우저 화면만 멈추는 경우를 위해 player-only live-edge recovery 추가.
- HLS.js 준비중 상태 메시지 중복 갱신을 억제하여 메인 대시보드 메시지 깜빡임 완화.
- PLAYER_STATE / PLAYER_STALL / PLAYER_RECOVER 로그 추가.
- FFmpeg diagnostics 로그 추가: version, hwaccels, h264_nvenc/cuda 지원 여부.
- FFmpeg progress 파일 파싱으로 frame/out_time/speed 및 stall 로그 기록.
- run_all.bat에 wait_health.bat 기반 health check 대기 추가. 고정 대기보다 준비 즉시 다음 단계 진행.

# RIC Dashboard HISTORY

이 문서는 RIC 대시보드 프로젝트의 버전 이력을 관리합니다.

앞으로 새 버전의 변경 이력은 아래 형식을 따릅니다.

```text
## YYYY-MM-DD / RIC_V<MAIN>_<SUB>_<comment>
```

루트에는 이 `HISTORY.md`만 두고, 현재 버전의 설치/실행/포트 정보는 `docs/README.md`에서 관리합니다.

---

---

## 2026-06-10 / RIC_V77_03_restart_backoff_isolation

### 수정 내용
- 최신 `cameras.json` 기준 파일을 반영했습니다. 특히 `video1`, `cam001`, `cam002`, `cam003` RTSP URL을 업로드된 파일 기준으로 교체했습니다.
- `cam002/cam003`가 `stream.m3u8`을 만들지 못하는 상태에서 API가 restartToken을 반복 발행해 ffmpeg 재시작 루프가 발생하는 문제를 보강했습니다.
- 카메라별 `restartAttemptCount`, `restartBackoffUntil`, `restartHistory`를 추가해 실패 카메라를 backoff 상태로 격리합니다.
- 최신 segment가 정상적으로 갱신되면 restart attempt/backoff 상태를 자동 초기화합니다.
- 시간당 restart 요청 한도를 추가해 일반 RTSP 실패가 YTN 같은 `rtsp+ / alwaysOn` 스트림까지 흔들지 않도록 했습니다.
- Python converter에서 `stream.m3u8` 생성 실패 시 `[HLS_WAIT_FAIL]`, `[RESTART_BACKOFF]`, `[FFMPEG_START]` 로그를 남기고 카메라별 exponential backoff 후 재시도하도록 했습니다.
- 초기 화면 표시 속도를 위해 `hlsStartup.minSegmentsToPlay = 1` 조건은 유지했습니다.
- HLS API 버전을 `v77.03`으로 갱신했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- API restart backoff / hourly limit / fresh segment reset 알고리즘 검증 통과
- converter HLS 생성 실패 backoff / 카메라별 격리 알고리즘 검증 통과
- zip 무결성 검사 통과


## 2026-06-10 / RIC_V77_02_converter_watchdog_recovery

### 수정 내용
- 장시간 실행 중 PC 부하나 RTSP 입력 정체로 HLS `stream.m3u8` 또는 segment 갱신이 멈춘 뒤 Viewer가 깜박이다 먹통이 되는 현상을 보강했습니다.
- Python converter에 worker 생존 감시 함수를 추가하여 active 카메라가 남아 있는데 worker thread/proc 상태가 비정상인 경우 자동으로 worker를 재시작합니다.
- converter 로그에 `session`, `restartToken`, `stream.m3u8 created`, `first segment detected` 기록을 추가해 API restartToken 이후 실제 ffmpeg/HLS 생성 여부를 추적하기 쉽게 했습니다.
- HLS watchdog 기본값을 운영 화면 기준으로 더 빠르게 조정했습니다: startupGrace 30초, softStale 6초, staleM3u8 12초, hardStale 18초, restartDelay 3초, minRestartInterval 15초, maxRestartsPerHour 12회.
- 브라우저 Viewer 재시작이 한도에 도달해도 영구 먹통으로 멈추지 않고, 15초 backoff 후 상태 확인/재시도를 계속하도록 수정했습니다.
- 초기 화면 표시 속도를 위해 `hlsStartup.minSegmentsToPlay = 1` 조건은 유지했습니다.
- HLS API 버전을 `v77.02`로 갱신했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- converter worker 생존 감시 및 재시작 알고리즘 검증 통과
- HLS stale 감지 기본값 검증 통과
- Viewer 재시작 backoff 후 지속 재시도 알고리즘 검증 통과
- zip 무결성 검사 통과


## 2026-06-09 / RIC_V77_01_restart_storm_guard

### 수정 내용
- cam002를 닫고 1초 안에 다시 열었을 때, 화면이 잠깐 재생된 뒤 black으로 돌아가고 다시 몇 초 재생되는 반복 현상을 보강했습니다.
- 원인은 클라이언트 HLS.js 오류가 `forceRestart=true` reconnect를 반복 요청하고, 서버가 이를 무조건 restart로 받아들이면서 새로 시작 중인 ffmpeg/HLS를 계속 끊는 구조였습니다.
- 서버의 reconnect 판단에서 `client-force-restart`를 절대 명령이 아니라 요청으로 취급하도록 변경했습니다.
- 최신 segment가 `softStaleSec` 이내로 신선하면 `decision=reuse reason=fresh-segment`로 재시작하지 않습니다.
- 새로 연 직후 약 15초 startup grace 동안에는 `decision=reuse reason=startup-grace`로 client force restart를 억제합니다.
- 최근 restart 이후 `minRestartIntervalSec` 이내면 `decision=reuse reason=restart-cooldown`으로 restart storm을 차단합니다.
- 브라우저 HLS.js 오류 복구 기준을 강화하여 기본 4회까지 로컬 recover/reload를 먼저 수행하고, 최소 15초 이후에만 서버 restart 요청을 허용하도록 했습니다.
- 같은 카메라를 여는 중에는 `openingCameraIds`로 중복 viewer-click 요청을 무시하여 `existed=false added`가 중복 발생할 가능성을 줄였습니다.
- 초기 화면 표시 속도 때문에 `hlsStartup.minSegmentsToPlay`는 기존 1개 조건을 유지했습니다.
- HLS API 버전을 `v77.01`로 갱신했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- client-force-restart 억제 알고리즘 검증 통과
- startup grace / fresh segment / restart cooldown 우선순위 검증 통과
- 중복 viewer-click 차단 로직 검증 통과
- HLS URL session 유지 및 cache-busting 경로 검증 통과
- zip 무결성 검사 통과

---

## 2026-06-09 / RIC_V77_00_Comment

### 수정 내용
- cam002 같은 일반 RTSP Viewer를 닫은 직후 다시 열 때 발생하는 close/open race condition을 보강했습니다.
- 일반 RTSP를 새로 열 때마다 `sessionId`와 `restartToken`을 함께 발행하고, HLS URL에 `?sid=...`를 붙여 브라우저가 이전 playlist/segment 상태를 재사용하지 않도록 했습니다.
- 브라우저 HLS.js 오류가 반복되면 단순 recover/reload에 머물지 않고, 기존 HLS.js 인스턴스를 폐기한 뒤 서버에 강제 재시작을 요청하도록 했습니다.
- `/api/streams/release`에서 media 폴더 삭제 직전 현재 active 상태를 다시 확인하여, 이미 새 세션으로 다시 열린 카메라의 HLS 파일을 삭제하지 않도록 했습니다.
- Python converter의 `Camera` 상태에 `session_token`을 추가하고, `stop_worker()`가 오래된 세션의 종료 작업으로 새 세션의 media 폴더를 지우지 않도록 `clear_camera_media_if_safe()` 보호 로직을 추가했습니다.
- `keep-alive` 중 active가 끊긴 Viewer는 `viewer-resume`으로 재등록되며, 새 `sessionId`와 HLS URL을 Viewer 상태에 반영하도록 했습니다.
- 초기 화면 표시 속도를 위해 `hlsStartup.minSegmentsToPlay` 조건은 기존값 1을 유지했습니다. segmentCount 2~3개 대기 조건은 이번 버전에 넣지 않았습니다.
- 배포 기본 `camera_list.json`은 `rtsp+ / alwaysOn` 항목만 남기고 일반 RTSP 디버깅 active 항목을 제거했습니다.
- HLS API 버전을 `v77.00`으로 갱신했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- close → release → 즉시 open 순서에서 오래된 release/stop 작업이 새 session media를 삭제하지 않는 알고리즘 검증 통과
- HLS URL session query 적용 및 브라우저 cache-busting 경로 검증 통과
- HLS.js 반복 오류 시 강제 restartToken/sessionId 재발행 흐름 검증 통과
- `camera_list.json` 배포 기본값 검증 통과
- zip 무결성 검사 통과

---

## 2026-06-09 / RIC_V76_15_reconnect_stale_restart_fix

### 수정 내용
- 브라우저 HLS.js가 `source=reconnect`로 다시 요청할 때 단순히 active timestamp만 갱신하지 않고, 실제 HLS health 상태를 검사하도록 수정했습니다.
- reconnect 요청 시 `stream.m3u8` 존재 여부, segment 개수, 최신 segment 번호, 최신 segment 수정 시간, 최신 segment age를 확인합니다.
- active 상태이지만 최신 segment가 `hlsWatchdog.hardStaleSec` 이상 갱신되지 않으면 `restartToken`을 `camera_list.json`에 기록하여 Python converter가 해당 카메라를 controlled restart 하도록 했습니다.
- reconnect가 active 목록에 없는 일반 RTSP를 다시 살리지 않도록 `decision=skip reason=not-active` 처리를 추가했습니다.
- reconnect 판단 결과를 로그에 `decision=reuse`, `decision=restart`, `decision=skip` 형태로 남기도록 했습니다.
- `/api/streams/status/:camId` 응답에 `health` 객체를 추가하여 `latestSegmentName`, `latestSegmentAgeSec`, `segmentCount`, `m3u8AgeSec` 등을 확인할 수 있게 했습니다.
- Python converter의 `Camera` 상태에 `restartToken`을 포함하고, 토큰 변경 시 기존 ffmpeg를 종료한 뒤 새 ffmpeg를 시작하도록 watcher 재시작 조건을 보강했습니다.
- HLS API 버전을 `v76.15`로 갱신했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- HTML 내부 JavaScript 기본 검사 통과
- reconnect 요청의 HLS health 검사 알고리즘 검증 통과
- segment stale 상태에서 `restartToken` 발행 알고리즘 검증 통과
- active 목록에 없는 reconnect 재등록 차단 알고리즘 검증 통과
- Python converter의 restartToken 감지 및 worker 재시작 조건 검증 통과
- `/api/streams/status/:camId` health 응답 구조 검증 통과
- zip 무결성 검사 통과

---

## 2026-06-09 / RIC_V76_14_camera_list_write_queue_fix

### 수정 내용
- `camera_list.json` 저장 전용 직렬화 큐를 추가하여 동시에 여러 request/keep-alive가 들어와도 JSON 저장이 한 번씩 순서대로 실행되도록 했습니다.
- `camera_list.json.tmp` 단일 임시 파일명을 사용하지 않고, process id/시간/random 값을 포함한 고유 tmp 파일명으로 저장하도록 변경했습니다.
- Windows 환경에서 `rename` 시 `EPERM`, `EBUSY`, `EACCES`가 발생하면 짧은 간격으로 재시도하도록 보강했습니다.
- `syncAlwaysOnStreams()`가 상태 변화가 없을 때는 `camera_list.json`을 다시 저장하지 않도록 수정했습니다.
- `keep-alive-touch` 요청은 디스크의 `camera_list.json`을 저장하지 않고 메모리 확인/응답만 하도록 변경했습니다.
- `keep-alive-touch`가 active 목록에 없는 일반 RTSP camId를 다시 active로 등록하지 않도록 차단했습니다.
- normal 로그 모드에서는 반복 keep-alive 로그를 줄이고, debug 모드에서만 자세히 추적하도록 조정했습니다.
- HLS API 버전을 `v76.14`로 갱신했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- HTML 내부 JavaScript 기본 검사 통과
- `camera_list.json` 직렬 저장 큐 알고리즘 검사 통과
- 고유 tmp 파일명 기반 atomic write 알고리즘 검사 통과
- keep-alive 요청의 디스크 저장 생략 알고리즘 검사 통과
- active 목록에 없는 keep-alive 재등록 차단 알고리즘 검사 통과
- zip 무결성 검사 통과

---

## 2026-06-09 / RIC_V76_13_hls_api_debug_logging_mode

### 수정 내용
- `shared/data/GISDashBoard.json`와 `shared/config/GISDashBoard.json`에 `hlsLogging` 옵션을 추가했습니다.
- `hlsLogging.mode`를 `normal` 또는 `debug`로 설정할 수 있게 했습니다.
- HLS API 전용 로그 파일 `shared/logs/hls_api.log`를 생성하도록 했습니다.
- `normal` 모드에서는 시작/종료, request/release, release-all, Watchdog/오류/경고 같은 중요 로그 중심으로 기록합니다.
- `debug` 모드에서는 HTTP 요청, precheck 결과, 상태 확인 등 세부 추적 로그까지 기록합니다.
- 로그 파일 크기가 커질 경우 `hls_api.log.1`, `hls_api.log.2` 형식으로 rotation되도록 했습니다.
- `/api/health`와 `/api/logging`에서 현재 logging 설정을 확인할 수 있게 했고, `/api/logging/reload`로 설정을 다시 읽을 수 있게 했습니다.
- HLS API 버전을 `v76.13`으로 갱신했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- HTML 내부 JavaScript 기본 검사 통과
- `hlsLogging.mode=normal` 중요 로그 필터링 알고리즘 검사 통과
- `hlsLogging.mode=debug` 상세 로그 출력 알고리즘 검사 통과
- `shared/logs/hls_api.log` 생성 및 rotation 경로 알고리즘 검사 통과
- `/api/health`, `/api/logging`, `/api/logging/reload` 응답 구조 검사 통과
- zip 무결성 검사 통과

---

## 2026-06-09 / RIC_V76_12_release_state_timestamp_log_fix

### 수정 내용
- 개별 Viewer 닫기 시 서버의 `camera_list.json` active 목록에서 해당 일반 RTSP camId를 먼저 제거하도록 release 순서를 보강했습니다.
- Watchdog이 감시하는 대상은 `camera_list.json` active 목록을 기준으로 판단하며, 닫혀서 active에서 제거된 일반 RTSP 카메라는 재시작하지 않도록 Python converter에 active 재확인 방어를 추가했습니다.
- `모두 닫기` 시 화면 Viewer 정리뿐 아니라 `/api/streams/release-viewers`를 호출하여 일반 RTSP active 항목 전체를 서버에서도 제거하도록 했습니다. `rtsp+`/alwaysOn 스트림은 유지합니다.
- 프론트엔드에서 Viewer를 닫는 즉시 `releasedCameraIds`에 등록하여 keep-alive/reconnect/status timer가 닫힌 카메라를 다시 `/api/streams/request`하지 못하도록 차단했습니다.
- `/api/streams/request` 호출에 `source` 값을 기록하여 `viewer-click`, `keep-alive`, `reconnect` 등 어떤 경로로 ffmpeg가 다시 요청되었는지 추적할 수 있게 했습니다.
- HLS API와 Python converter의 주요 로그에 `[HH:MM:SS.mmm]` timestamp를 추가했습니다.
- cam002처럼 한 번이라도 RTSP 입력과 segment 생성이 확인된 로그는 단순히 `401` 문자열만으로 `RTSP 인증 실패 가능성`으로 오판하지 않도록 로그 분류를 보강했습니다.
- HLS API 버전을 `v76.12`로 갱신했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- HTML 내부 JavaScript 기본 검사 통과
- 개별 닫기 시 Watchdog 감시 대상 제거 우선 알고리즘 검사 통과
- 모두 닫기 시 일반 RTSP active 전체 release 알고리즘 검사 통과
- 닫힌 camId의 keep-alive/reconnect 재요청 차단 알고리즘 검사 통과
- Watchdog restart 직전 active 목록 재확인 알고리즘 검사 통과
- timestamp 로그 형식 검사 통과
- zip 무결성 검사 통과

---

## 2026-06-08 / RIC_V76_11_startup_state_reset_process_guard

### 수정 내용
- HLS API 시작 시 `camera_list.json`을 런타임 상태 파일로 초기화하도록 수정했습니다.
- 이전 실행에서 남아 있던 일반 `rtsp` 카메라 active 항목은 시작 시 제거하고, `rtsp+`/alwaysOn 스트림만 다시 등록하도록 했습니다.
- 시작 시 일반 RTSP 카메라의 이전 `shared/media/<camId>` 폴더를 정리하여 오래된 `stream.m3u8`/segment가 새 실행 상태로 오인되지 않도록 했습니다.
- HLS API 종료 시 `SIGINT`/`SIGTERM`을 받으면 `camera_list.json`을 다시 초기화하고 일반 RTSP media 폴더를 정리하는 graceful shutdown 로직을 추가했습니다.
- 실행 중에는 일반 RTSP active 상태를 유지하되, 시작/종료 시에만 초기화되도록 `syncAlwaysOnStreams()`와 `resetRuntimeCameraState()` 역할을 분리했습니다.
- 패키지 안의 기본 `shared/data/camera_list.json`도 일반 RTSP 항목 없이 `video1` 같은 `rtsp+`/alwaysOn만 포함하도록 정리했습니다.
- HLS API 버전을 `v76.11`로 갱신했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- HTML 내부 JavaScript 기본 검사 통과
- 시작 시 `camera_list.json` 일반 RTSP active 제거 알고리즘 검사 통과
- 실행 중 일반 RTSP active 유지 및 종료 시 초기화 알고리즘 검사 통과
- `rtsp+`/alwaysOn 자동 변환 유지 조건 검사 통과
- 일반 RTSP media 폴더 시작/종료 정리 알고리즘 검사 통과
- zip 무결성 검사 통과

---

## 2026-06-04 / RIC_V76_05_hls_status_message_hide

### 수정 내용
- GIS HLS Viewer에서 영상 재생이 성공했는데도 상단 상태바에 `HLS.js 준비중...` 문구가 계속 남는 문제를 수정했습니다.
- HLS.js `MANIFEST_PARSED`, `FRAG_LOADED`, video `playing/loadeddata` 등 재생 성공 이벤트가 발생하면 Viewer ready 상태를 유지하면서 상단 상태 문구를 자동으로 숨기도록 했습니다.
- 여러 HLS Viewer가 동시에 열려 있을 때는 아직 준비 중인 Viewer가 남아 있는 경우에만 상태 메시지를 유지하고, 모든 Viewer가 ready 상태가 되면 상태 문구를 비우도록 했습니다.
- HLS 재시작 성공 시에도 `재시작 완료` 문구를 계속 남기지 않고, 재생 성공 후 운영 화면을 가리지 않도록 상태 문구를 숨깁니다.
- HLS API 버전을 `v76.05`로 갱신했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- HTML 내부 JavaScript 기본 검사 통과
- HLS 재생 성공 시 상단 상태 문구 숨김 알고리즘 검사 통과
- 여러 Viewer 중 준비 중인 항목이 남아 있을 때 상태 메시지 유지 조건 검사 통과
- 문서 구조 검사 통과
- zip 무결성 검사 통과

---

## 2026-06-04 / RIC_V76_04_hls_viewer_state_release_fix

### 수정 내용
- GIS HLS Viewer에서 영상이 실제로 보이는데도 `준비중` 상태가 계속 남는 문제를 줄이기 위해 HLS.js 재생 성공 이벤트(`MANIFEST_PARSED`, `FRAG_LOADED`, `playing`, `loadeddata`)에서 Viewer 상태를 `ready`로 전환하도록 수정했습니다.
- Viewer가 열려 있는 동안 일반 RTSP 스트림이 해제되거나 LRU idle 상태로 판단되지 않도록 주기적 keep-alive 재요청을 추가했습니다.
- Viewer별 HLS.js 인스턴스, retry 상태, restart 상태를 camId 단위로 분리 관리하도록 보강했습니다.
- `active=false` 상태가 감지되더라도 Viewer가 열려 있으면 `/api/streams/request`를 자동 재요청하여 일시적 release/cleanup 상태에서 복구하도록 했습니다.
- 닫기 버튼은 준비중/재시작 상태와 무관하게 항상 동작하도록 버튼 z-index, 이벤트 전파 차단, cleanup 순서를 보강했습니다.
- 재생 URL이 `/media/<camId>/stream.m3u8` 형식과 맞지 않으면 오류로 처리하도록 camId/URL 불일치 방어 로직을 추가했습니다.
- `Immediate exit requested`, `received signal 2` 로그를 GPU/CUDA 실패가 아니라 `변환 프로세스 외부 종료`로 분류하도록 HLS API 로그 분류를 개선했습니다.
- HLS API 버전을 `v76.04`로 갱신했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- HTML 내부 JavaScript 기본 검사 통과
- HLS Viewer ready 상태 전환 알고리즘 검사 통과
- Viewer keep-alive / active=false 자동 재요청 알고리즘 검사 통과
- 닫기 버튼 우선 동작 및 cleanup 로직 검사 통과
- camId별 HLS 인스턴스 분리 관리 로직 검사 통과
- 변환 프로세스 외부 종료 로그 분류 검사 통과
- zip 무결성 검사 통과

---

## 2026-06-04 / RIC_V76_03_hlsjs_player_fix

### 수정 내용
- GIS HLS Viewer, CAM Player, YTN Player에서 Chrome/Edge가 `Native HLS` 경로로 잘못 진입하는 문제를 수정했습니다.
- HLS 재생 로직을 `HLS.js 우선`으로 변경하고, Native HLS는 Safari 계열에서만 fallback으로 사용하도록 정리했습니다.
- HLS.js CDN을 안정 버전으로 고정하고, jsDelivr 실패 시 cdnjs/unpkg를 순차 시도하는 fallback 로더를 추가했습니다.
- HLS.js가 로드되지 않았을 때는 `HLS.js 로드 실패` 메시지를 명확히 표시하도록 했습니다.
- cam002처럼 `stream.m3u8`, `init.mp4`, `segment_*.m4s`가 생성되는데도 브라우저가 검은 화면에 머무는 문제를 줄였습니다.
- HLS API 버전을 `v76.03`으로 갱신했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js 문법 검사 통과
- HTML 내부 JavaScript 기본 검사 통과
- HLS.js 우선 재생 알고리즘 검사 통과
- Safari 전용 Native HLS fallback 조건 검사 통과
- 기존 RTSP fast-start 설정 유지 확인
- zip 무결성 검사 통과

---

## 2026-06-04 / RIC_V76_02_rtsp_fast_start

### 수정 내용
- 일반 `rtsp` 카메라 선택 시 화면 표출 시간을 줄이기 위해 prewarm 없이 빠른 시작 정책을 적용했습니다.
- GIS HLS Viewer는 새 RTSP 선택 시 뷰어를 먼저 표시하고, `segmentCount >= 1` 조건에서 재생을 시작하도록 완화했습니다.
- HLS 준비 대기값을 `initialWaitMs=3000`, `retryIntervalMs=1000`, `statusIntervalMs=1000` 중심으로 조정했습니다.
- HLS segment 길이를 `hlsTime=0.5`로 줄이고, 보관 개수는 `24/12`로 유지하여 초기 segment 생성 시간을 줄였습니다.
- 일반 RTSP의 ffmpeg 분석 옵션을 `analyzeduration/probesize=1000000`으로 완화하여 초기 접속 시간을 줄였습니다.
- `shared/data/GISDashBoard.json`과 `shared/config/GISDashBoard.json`에 `hlsStartup` 설정을 추가했습니다.
- HLS API 버전을 `v76.02`로 갱신했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js 문법 검사 통과
- HTML 내부 JavaScript 기본 검사 통과
- HLS fast-start 준비 조건 알고리즘 검사 통과
- 일반 RTSP 분석 옵션 완화 적용 확인
- prewarm 미적용 확인
- zip 무결성 검사 통과

---

## 2026-06-04 / RIC_V76_01_event_message_normal_font

### 수정 내용
- 이벤트 대시보드에서 사진을 선택했을 때 메인 중앙 화면에 표시되는 이벤트 로그의 글자 굵기를 낮췄습니다.
- 이벤트 로그 값 영역은 일반 폰트 굵기(`font-weight: 400`)로 표시하도록 수정했습니다.
- 이벤트 로그 라벨은 기존보다 약한 강조(`font-weight: 600`)로 조정하여 시인성을 개선했습니다.
- HLS API 버전을 `v76.01`로 갱신했습니다.

### 검증 내용
- CSS 이벤트 로그 폰트 굵기 적용 확인
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js 문법 검사 통과
- HTML 내부 JavaScript 기본 검사 통과
- zip 무결성 검사 통과

---

## 2026-06-02 / RIC_V76_00_ytn_audio_baseline

### 기준 소스
- 사용자 업로드 기준: `RIC_V75_41_ytn_rtsp_plus_audio(1).zip`
- 새 기준 버전: `RIC_V76_00_ytn_audio_baseline`
- HLS API 버전: `v76.00`

### 정리 내용
- 문서 구조를 `ric_v8/HISTORY.md`와 `ric_v8/docs/README.md` 중심으로 정리했습니다.
- 기존 루트 `README.md`의 주요 버전 이력과 설명을 `HISTORY.md` 및 `docs/README.md`로 분리했습니다.
- 루트의 README 계열 보조 문서를 정리하고, 앞으로 루트에는 `HISTORY.md`만 두는 규칙을 적용했습니다.
- `docs/README.md`에는 현재 버전의 설치 방법, 실행 방법, 포트 구성, 주요 설정 파일, 외부 접속 점검 방법을 정리했습니다.
- HLS API 버전을 `v76.00`으로 갱신했습니다.
- 실행 중 생성될 수 있는 HLS media segment 파일은 패키징 대상에서 제외했습니다.

### 현재 기능 기준
- 메인 대시보드 원격 접속 URL 자동 변환 구조 유지
- HLS API / GIS / CAM Viewer 연동 유지
- GIS HLS Viewer 자동 배치, 드래그 이동, 카메라-뷰어 빨간 연결선 기능 유지
- `shared/data/cameras.json` 단일 카메라 원본 구조 유지
- `rtsp+` YTN 스트림 오디오 포함 정책 유지
- 일반 `rtsp` 카메라는 영상만 유지
- Weather 실행 전 Python requirements 자동 설치 구조 유지
- 8090 포트는 Main Dashboard 전용으로 유지

### 검증 내용
- JSON 문법 검사
- Python 문법 검사
- Node.js 문법 검사
- HTML 내부 JavaScript 기본 검사
- 카메라 단일 원본 구조 검사
- HLS 변환 설정 검사
- YTN `rtsp+` 오디오 정책 검사
- 원격 접속 URL 변환 로직 검사
- GIS HLS Viewer 자동 배치/연결선 로직 검사
- zip 무결성 검사

---

## 이전 V75 계열 이력 요약

아래 내용은 이전 루트 `README.md`와 README 계열 문서에서 통합한 요약입니다.

## 5. 버전 이력

### RIC_V75_24_baseline_readme_cleanup

- 최상위 디렉토리/zip 이름을 `RIC_V<MAIN>_<SUB>_<comment>` 형식으로 정리했습니다.
- 기존 여러 `.md` 파일의 내용을 이 `README.md`로 통합 정리했습니다.
- 앞으로 수정 이력은 이 README에 누적하도록 규칙을 정했습니다.
- `README.md`를 제외한 `.md` 파일은 삭제했습니다.
- HLS API health의 `apiVersion`을 `v75.24`로 갱신했습니다.

### v75.23 HLS 준비 대기/재시도 개선

- GIS HLS Viewer의 초기 대기를 5초로 조정했습니다.
- 이후 2초 간격으로 상태 표시와 재시도를 수행합니다.
- 60초 이후에도 뷰어를 닫지 않고 계속 재시도합니다.
- 준비되는 순간 자동으로 재생을 시작합니다.

### v75.22 HLS 변환 엔진 선택

- `GISDashBoard.json`에 `hlsConversion` 설정을 추가했습니다.
- 일반 `rtsp`와 `rtsp+`를 각각 CPU/GPU로 선택할 수 있습니다.
- GPU 변환 실패 시 CPU fallback을 지원합니다.
- 노트북 테스트 기본값은 일반 RTSP CPU, YTN `rtsp+` GPU입니다.

### v75.21 GIS HLS Viewer / CAM 모드 초기화 동기화

- GIS HLS Viewer가 CAM 모드처럼 `/api/streams/request`를 호출하도록 수정했습니다.
- stream.m3u8 준비 대기, 상태 조회, HLS 오류 복구를 GIS Viewer에도 추가했습니다.
- CAM 모드에서 한 번 본 뒤에야 GIS에서 보이던 문제를 줄였습니다.

### v75.20 HLS 상태 API / 8080 포트 정리

- HLS API에 health/status 확인 경로를 추가했습니다.
- 8080 포트에 이전 프로세스가 남아 있을 때 새 서버가 뜨지 못하는 문제를 줄이도록 실행 스크립트를 보강했습니다.

### v75.19 RTSP→HLS 변환 상태 확인

- `/api/streams/status/<camId>` 상태 API를 추가했습니다.
- active 여부, m3u8 존재 여부, segment 수, ffmpeg 로그 요약을 확인할 수 있습니다.
- 일반 RTSP 입력 분석 옵션을 안정성 우선으로 조정했습니다.

### v75.18 HLS Player Recovery

- 업로드된 cameras.json을 data/config 양쪽에 반영했습니다.
- HLS segment 404로 멈추는 문제를 줄이기 위해 HLS.js 오류 복구 로직을 추가했습니다.
- YTN, CAM Player, GIS/HLS Viewer에 cache-buster와 복구 절차를 추가했습니다.

### v75.17 CAM 모드 YTN HLS URL 보정

- CAM 모드에서 상대 HLS 경로가 8090 기준으로 잘못 요청되던 문제를 수정했습니다.
- `/media/video1/stream.m3u8`를 HLS API 서버인 8080 기준 절대 URL로 보정합니다.

### v75.16 단독 대시보드 TITLE 문구 수정

- 단독 새창 타이틀을 대시보드별로 구분했습니다.
- 긴급문자 대시보드, 뉴스 대시보드, 날씨 대시보드, 이벤트 대시보드 문구를 적용했습니다.

### v75.15 이벤트 로그 스크롤바 제거

- 이벤트 로그 영역 높이를 조정하고 오른쪽 스크롤바가 나오지 않도록 개선했습니다.
- 라벨 폭과 행 높이를 조정했습니다.

### v75.14 이벤트 로그 파싱 재수정

- Axxon 이벤트 문자열의 카메라명/이벤트명 구분자를 확대 지원했습니다.
- 지원 구분자: `·`, `ㆍ`, `•`, `.`, `-`, `:`, `：`
- 서버와 메인 대시보드 양쪽 파서를 모두 보강했습니다.

### v75.13 이벤트 로그 내용 분리

- 이벤트 소스, 카메라 이름, 이벤트명, 이벤트 메시지, 발생시각을 분리 표시했습니다.
- `hosts/` 접두어를 제거하고 사용자에게 의미 있는 소스 경로로 표시했습니다.

### v75.12 이벤트 뷰어 로그 레이아웃

- 메인 중앙 이벤트 뷰어를 이미지 상단, 로그 하단 구조로 변경했습니다.
- 오른쪽 상단 메시지는 숨기고 하단 로그에 상세 정보를 표시했습니다.

### v75.11 이벤트 빨간 박스 위치/크기 보정

- `object-fit: contain`으로 표시된 실제 이미지 영역을 계산했습니다.
- offsetX/offsetY를 반영해 빨간 박스 위치를 보정했습니다.
- 박스가 이미지 밖으로 나가지 않도록 clamp 처리했습니다.

### v75.10 단독 대시보드 TITLE 고정

- 날씨, 뉴스, 이벤트 단독 실행 모드에서 SMS처럼 TITLE이 상단 고정되도록 수정했습니다.
- iframe `?embed=1` 모드에서는 TITLE이 숨겨집니다.

### v75.9 새창 버튼 팝업 방식

- 새창 버튼이 새 탭이 아닌 독립 창으로 열리도록 `window.open` 옵션을 조정했습니다.

### v75.8 단독 대시보드 타이틀 헤더

- 날씨, 뉴스, 이벤트 대시보드에 SMS와 같은 단독 실행용 상단 타이틀 헤더를 추가했습니다.

### v75.7 이벤트 스냅샷 헤더/버튼 간격

- Event Snapshots 이름을 `이벤트 스냅샷`으로 변경했습니다.
- 상태 로그와 새창/Sync 버튼이 겹치지 않도록 여백과 위치를 조정했습니다.

### v75.6 새창 버튼 표시 확실화

- 날씨/SMS/뉴스 패널 제목줄에서 새창 버튼이 보이지 않을 수 있는 문제를 수정했습니다.
- 실행 시 버튼 존재 여부를 점검하고 없으면 자동 생성합니다.

### v75.5 새창 버튼 가시성 보강

- 새창 버튼을 panel title 내부 toolbar로 이동했습니다.
- sync 버튼 왼쪽에 고정했습니다.

### v75.4 단일 대시보드 새창 버튼 추가

- 날씨, SMS, 뉴스, 이벤트 패널에 새창 열기 버튼을 추가했습니다.
- 단독 대시보드 URL은 `?embed=1` 없이 열립니다.

### v75.2 RTSP+ 표시 수정

- `rtsp+` 카메라가 Unknown으로 표시되는 문제를 수정했습니다.
- YTN은 `RTSP+ 상시 HLS`로 표시됩니다.

### v75.1 뉴스 대시보드 실행 수정

- 뉴스 백엔드 Python 의존성 자동 설치를 추가했습니다.
- 백엔드 health 응답 대기 후 프론트엔드를 시작하도록 수정했습니다.

### v75 보안/안정화 정리

- HLS API CORS 기본 허용 범위를 localhost 계열로 제한했습니다.
- camera id 검증을 추가했습니다.
- alwaysOn 스트림과 LRU 제한 문제를 보강했습니다.
- 민감정보 포함 여부를 구분해 로컬 실행용/공유용 패키지 주의사항을 정리했습니다.

## 6. 기존 문서 통합 출처 요약

아래 문서들의 내용을 이 README로 통합했습니다. 원본 `.md` 파일은 정리 대상이므로 삭제했습니다.

| 기존 문서 | 통합 내용 요약 |
|---|---|
| `CAM_MODE_YTN_FIX_V75_17.md` | v75.17 CAM 모드 YTN HLS URL 보정 수정 — 메인 대시보드의 CAM 모드는 `camera_player.html`을 `localhost:8090`에서 로드합니다. 하지만 HLS API(`/api/streams/request`)는 `hls` 값을 `/media/video1/stream.m3u8`처럼 상대 경로로 반환합니다. 기존 `camera_player.html`은  |
| `CHANGELOG.md` | CHANGELOG — - Initial integrated test package generated on 2026-03-30 - Sanitized plaintext secrets from shareable files. - Restricted HLS API CORS defaults to local dashboard origins. - Added |
| `EVENT_BOX_CLAMP_FIX_V75_11.md` | V75.11 이벤트 이미지 빨간 박스 보정 수정 — - 메인 대시보드 중앙 이벤트 이미지의 빨간 감지 박스를 실제 표시 이미지 영역 기준으로 재계산합니다. - `object-fit: contain`으로 생기는 좌우/상하 여백을 계산하여 offset을 반영합니다. - crop 좌표는 0~1 범위로 보정하고, 박스가 이미지 영역 밖으로 나가지 않도록 clamp 처리했습니다.  |
| `EVENT_DASHBOARD_HEADER_FIX_V75_7.md` | v75.7 이벤트 스냅샷 헤더/버튼 간격 수정 — - Event Dashboard 표시명을 `Event Snapshots`에서 `이벤트 스냅샷`으로 변경했습니다. - 메인 대시보드의 이벤트 패널 iframe title도 `이벤트 스냅샷`으로 변경했습니다. - 이벤트 상태 로그가 새창 버튼/Sync 버튼 아래로 겹치지 않도록 iframe 내부 헤더에 embedded 모드  |
| `EVENT_LOG_PARSE_FIX_V75_14.md` | v75.14 이벤트 로그 파싱 재점검 수정 — Axxon 이벤트 문자열에서 카메라명과 이벤트명 사이의 구분자가 중간점(·)만 온다고 가정했지만, 실제 로그에는 마침표(.) 형태도 들어왔습니다. 그래서 파서가 실패하고 전체 문장이 이벤트명/이벤트 메시지에 그대로 표시되었습니다. - 구분자 지원 확장: `·`, `ㆍ`, `•`, `.`, `-`, `:`, `：` - 서버 |
| `GIS_CAM_SYNC_FIX_V75_21.md` | v75.21 GIS HLS Viewer / CAM 모드 초기화 동기화 — v75.18~v75.20에서 일반 RTSP 카메라를 GIS 모드의 HLS Viewer에서 먼저 열면 화면이 나오지 않고, CAM 모드에서 한 번 재생한 뒤 GIS 모드로 돌아오면 보이는 현상이 있었다. CAM 모드는 카메라 선택 시 HLS 변환 요청과 m3u8 준비 대기를 충분히 수행한다. 반면 GIS HLS Viewer |
| `HLS_CAM001_404_FIX_V75_19.md` | v75.19 HLS stream.m3u8 404 개선 — 브라우저 콘솔에 다음 오류가 반복되는 경우: GET http://localhost:8080/media/cam001/stream.m3u8?... 404 Not Found HLS 준비 시간 초과 이는 HLS 플레이어 문제가 아니라, RTSP → HLS 변환기가 `shared/media/cam001/stream.m3u8` 파일 |
| `HLS_PLAYER_RECOVERY_V75_18.md` | v75.18 HLS Player Recovery Fix — - 업로드된 `cameras(2).json`을 `shared/data/cameras.json`과 `shared/data/cameras.json` 양쪽에 반영했습니다. - `rtsp+` YTN 상시 변환 항목을 `shared/data/camera_list.json`에 유지했습니다. - HLS segment 404로 화면 |
| `LOCAL_SECRETS_NOTICE_V75.md` | LOCAL SECRETS NOTICE - V75 — 이 빌드는 사용자가 요청한 실제 실행용 민감정보가 포함된 로컬 실행용 패키지입니다. 포함 항목: - RTSP 계정 정보가 포함된 `shared/data/cameras.json`, `shared/data/cameras.json`, `shared/data/camera_list.json` - Axxon 접속 계정이 포함된  |
| `NEWS_DASHBOARD_FIX_V75_1.md` | News Dashboard Fix V75.1 — 이번 수정은 다운로드 후 바로 실행했을 때 뉴스 대시보드가 뜨지 않을 수 있는 실행 스크립트 문제를 보완합니다. - `infra/scripts/run_news_dashboard.bat`에서 백엔드 Python 의존성(`flask`, `flask-cors`, `requests`)을 자동 설치하도록 수정했습니다. - 백엔드  |
| `OPEN_BUTTON_FIX_V75_6.md` | v75.6 새창 버튼 표시 확실화 수정 — v75.5에서는 HTML에 새창 버튼이 들어가 있었지만, 기존 floating 버튼 스타일과 panel title 스타일이 섞여 실제 실행 화면에서 버튼이 보이지 않을 수 있었습니다. 특히 기존 캐시 또는 이전 CSS가 남아 있으면 sync 버튼만 보이고 새창 버튼은 누락된 것처럼 보일 수 있었습니다. - 날씨/SMS/뉴 |
| `OPEN_PANEL_BUTTON_FIX_V75_4.md` | v75.4 단일 대시보드 새창 열기 버튼 추가 — 날씨, SMS, 뉴스, 이벤트 대시보드의 sync 버튼 옆에 사각형 두 개가 겹쳐 보이는 작은 버튼을 추가하고, 버튼을 누르면 해당 단일 대시보드만 새창에서 열리도록 수정. - 메인 대시보드 `index.html`에 새창 열기 버튼 4개 추가 - `btnOpenWeather` - `btnOpenSms` - `btnOpen |
| `RTSP_PLUS_LABEL_FIX_V75_2.md` | v75.2 RTSP+ 표시 수정 — 카메라 목록에서 `video1 / YTN 라이브`가 `Unknown`으로 표시되는 문제가 있었습니다. 메인 대시보드의 표시는 일부 상황에서 `sourceType`만 엄격하게 비교했고, GIS/HLS 화면의 `normalizeCameraSource()`는 `rtsp+`를 유효한 타입으로 인정하지 않았습니다. 또한 브라우저  |
| `SECURITY_FIXES_V75.md` | v75 취약/위험 항목 정리 및 수정 내역 — 1. **민감정보 평문 포함** - SMTP 비밀번호, Gemini API Key, SafetyData 서비스키, KMA 인증키, Axxon 계정/비밀번호가 코드/설정 파일에 평문으로 들어 있었습니다. - 공유용 zip에서는 실제 키를 제거하고 `CHANGE_ME` 또는 빈 값으로 치환했습니다. 2. **CORS 허용 범 |
| `STANDALONE_FIXED_HEADER_V75_10.md` | v75.10 Standalone Header Fixed — SMS 대시보드와 동일하게 단독 실행 모드에서 타이틀 헤더가 상단 고정되도록 수정했습니다. - Weather Dashboard: `.platform-title-header` fixed, body top padding 적용 - News Dashboard: `PlatformTitleHeader` fixed, main top  |
| `TITLE_HEADER_FIX_V75_16.md` | v75.16 단독 대시보드 TITLE 문구 수정 — 단독 새창으로 열리는 대시보드의 상단 TITLE 우측 문구를 대시보드 종류별로 구분되게 수정했습니다. - 긴급문자 대시보드: `재난안전공유플랫폼 긴급문자 대시보드` - 뉴스 대시보드: `재난안전공유플랫폼 뉴스 대시보드` - 날씨 대시보드: `재난안전공유플랫폼 날씨 대시보드` - 이벤트 대시보드: `재난안전공유플랫폼 이벤트 |
| `V75_22_HLS_CONVERSION_ENGINE_CONFIG.md` | v75.22 HLS 변환 엔진 선택 기능 — 노트북 테스트 환경과 서버 GPU 환경을 분리하기 위해 `rtsp+`와 일반 `rtsp`의 변환 엔진을 `GISDashBoard.json`에서 선택할 수 있도록 수정했습니다. 아래 두 파일에 동일한 설정이 들어 있습니다. - `shared/data/GISDashBoard.json` - `shared/config/GISDa |
| `V75_23_HLS_WAIT_RETRY.md` | v75.23 HLS 준비 대기/재시도 개선 — GIS HLS Viewer에서 RTSP→HLS 변환 준비를 기다리는 방식을 개선했습니다. - 초기 조용한 대기: 5초 - 이후 상태 표시/재시도 간격: 2초 - 1차 백그라운드 확인: 60초 - 60초 후에도 준비되지 않으면 뷰어를 닫지 않고 계속 재시도 |
| `V75_5_OPEN_BUTTON_VISIBILITY_FIX.md` | V75.5 open button visibility fix — 메인 대시보드의 날씨/SMS/뉴스 패널에서 새창 열기 버튼이 iframe 위에 보이지 않을 수 있는 문제를 수정했습니다. - 버튼을 panel-title 내부 toolbar로 이동했습니다. - sync 버튼 왼쪽에 새창 버튼을 고정 배치했습니다. - CSS/JS cache busting query를 v755로 갱신했습니다 |
| `V75_8_STANDALONE_TITLE_HEADER_FIX.md` | V75.8 Standalone Dashboard Title Header Fix — SMS 대시보드의 상단 타이틀 형식을 기준으로 다음 단일 대시보드에 동일한 타이틀 헤더를 추가했습니다. - 날씨 대시보드 - 뉴스 대시보드 - 이벤트 스냅샷 대시보드 메인 대시보드 iframe에서 호출되는 `?embed=1` 모드에서는 타이틀 헤더가 표시되지 않도록 처리했습니다. |
| `V75_9_POPUP_WINDOW_FIX.md` | V75.9 새창 버튼 동작 수정 — 메인 대시보드의 날씨, SMS, 뉴스, 이벤트 스냅샷 새창 버튼이 새 탭으로 열리지 않도록 `window.open()` 옵션을 수정했습니다. 기존 방식: window.open(url, name, 'popup=no,noopener,noreferrer,width=1280,height=800') 수정 방식: window.ope |
| `VALIDATION_REPORT_V75.md` | v75 검증 보고서 — 통과 항목: - `node --check apps/hls_converter/api/server.js` - `node --check apps/event_dashboard/server.js` - `node --check apps/sms_dashboard/server/server.js` - `python -m py_compil |
| `VALIDATION_REPORT_V75_12.md` | v75.12 이벤트 뷰어 레이아웃 및 로그 표시 수정 검증 보고서 — - 메인 대시보드 중앙 이벤트 이미지 화면을 `이벤트 뷰어` 모드로 정리했습니다. - 이벤트 사진은 상단 이미지 영역을 최대한 채우고, 상세 로그는 하단 전용 영역에 표시합니다. - 중앙 화면 상단 오른쪽의 기존 이벤트 요약 문구는 이벤트 모드에서 숨깁니다. - 하단 로그는 `이벤트 소스`, `카메라 이름`, `이벤트명` |
| `apps/event_dashboard/protos/README.md` | apps/event_dashboard/protos/README.md — Public gRPC API --------------- The APIs defined here used both internally and by third party integrators, so it is crucially important to maintain the high standard of quality, co |
| `apps/news_dashboard/README.md` | 재난안전 뉴스 대시보드 (Python 설정 저장 포함) — - 프런트엔드: React + Vite - 백엔드: Python Flask - 설정 저장: `NewsDashBoard.json`을 Python이 직접 읽고 저장 - 뉴스 API 프록시: Python이 safetydata.go.kr API를 프록시 - 뉴스 카드 1열 표시 |
| `apps/sms_dashboard/README.md` | 재난안전 긴급대시보드 (Disaster Safety Dashboard) — 행정안전부 긴급재난문자 데이터를 기반으로 한 실시간 재난 안전 정보 대시보드입니다. 세련된 다크 블루 테마와 자동 무한 스크롤 기능을 제공합니다. - **실시간 데이터 시뮬레이션**: 지역, 단계, 재난 유형별 필터링된 재난문자 표시 - **자동 무한 스크롤**: 끊김 없는 수직 스크롤로 정보 가독성 극대화 - **동적  |
| `apps/sms_dashboard/README2.md` | SMS_DASHBOARD (Real Data) 실행 가이드 — 이 프로젝트는 SafetyData(안전데이터공유플랫폼) OpenAPI `DSSP-IF-00247`를 **브라우저에서 직접 호출하지 않고**, 로컬 Express 서버(프록시)를 통해 호출합니다. - 프론트(대시보드): Vite/React (`http://localhost:3000`) - 프록시 서버: Express (`h |
| `apps/weather_dashboard/README.md` | Weather Web Dashboard — - Python 3.10+ 권장 - 기상청 API 허브(authKey) 필요 pip install -r requirements.txt - `.env.example` 를 `.env` 로 복사 후 `KMA_AUTHKEY`에 키 입력 또는 환경변수로 설정 |
| `docs/V75_13_EVENT_LOG_PARSE_FIX.md` | V75.13 이벤트 로그 파싱 수정 — 이벤트 대시보드에서 선택한 이벤트 이미지를 메인 대시보드 중앙 화면에 표시할 때, Axxon localization 문자열을 다음 항목으로 분리해서 표시하도록 수정했습니다. - 이벤트 소스: `hosts/` 접두어를 제거하고 `RAON-AXXON / DeviceIpint.54 / SourceEndpoint.video:0: |
| `docs/architecture/directory_structure.md` | 디렉토리 구조 설명 — Raon_Integrated_Control/ ├─ apps/ │  ├─ main_dashboard/ │  ├─ hls_converter/ │  ├─ sms_dashboard/ |
| `docs/architecture/module_relationship.md` | 모듈 관계 설명 — [shared/config/*.json] │ ├──────────────┐ │              │ ▼              ▼ |
| `docs/configuration/cameras_json.md` | cameras.json 설명 — `shared/data/cameras.json` { "cameras": [ { "id": "CAM-001", |
| `docs/configuration/config_index.md` | 설정 파일 인덱스 — / 파일명 / 실제 위치 / 설명 / 사용 모듈 / 실행 예시 포함 / /---/---/---/---/---/ / cameras.json / `shared/data/cameras.json` / 카메라 목록, 좌표, 상태, 영상 소스 정보 / `apps/main_dashboard`, `apps/hls_converter` |
| `docs/configuration/gis_dashboard_json.md` | GISDashBoard.json 설명 — `shared/config/GISDashBoard.json` { "centerLat": 36.9923, "centerLng": 127.1126, "level": 4, |
| `docs/configuration/json_parameter_convention.md` | JSON 파라미터 작성 규칙 — - 키 이름은 기본적으로 `camelCase` 사용 - 좌표는 숫자형 사용 - ID는 문자열 사용 - 날짜는 가능하면 ISO-8601 형식 사용 - 실행 예시는 가능한 한 기존 프로젝트에서 사용하던 형식 유지 |
| `docs/configuration/modules_json.md` | modules.json 설명 — `shared/config/modules.json` { "weather_url": "http://localhost:8100/?embed=1", "sms_url": "http://localhost:5174", "news_url": "http://localhost:5173", |
| `docs/configuration/ports_json.md` | ports.json 설명 — `shared/config/ports.json` { "main_dashboard": 8090, "weather_dashboard": 8100, "sms_preview": 5174, |
| `docs/deployment/port_policy.md` | 포트 정책 — - Main Dashboard: 8090 - HLS API: 8081 - Weather: 8080 - SMS Preview: 5174 - News Frontend: 5173 |
| `docs/deployment/windows_run_guide.md` | Windows 실행 가이드 — 1. `infra/scripts/run_hls_converter.bat` 실행 2. `infra/scripts/run_weather_dashboard.bat` 실행 3. `infra/scripts/run_sms_dashboard.bat` 실행 4. `infra/scripts/run_news_dashboard.bat` 실행 |
| `docs/screen_design/layout_spec.md` | 화면 배치 명세 — - 좌측 20%: 상단 GIS/Camera List, 하단 Weather - 중앙 55%: GIS / Camera View - 우측 25%: YTN / SMS / News - 하단 168px: Event Snapshots |
| `docs/screen_design/panel_behavior.md` | 패널 동작 명세 — - 앱 시작 시 중앙은 GIS 모드 - 좌측 카메라 선택 시 Camera View 전환 - GIS 복귀 버튼 클릭 시 GIS 모드 복귀 - Weather/SMS/News는 iframe URL 기준으로 로드 |


## 7. 검증 메모

이 패키지에서 수행한 문서 정리 검증:

- JSON 파일 문법 검사
- 주요 Python 파일 문법 검사
- 주요 Node.js 파일 문법 검사
- `README.md`를 제외한 `.md` 파일 삭제 확인
- zip 무결성 검사



## RIC_V75_25_pc_gpu_hls_stability

- PC/서버 테스트 환경을 고려해 `GISDashBoard.json` 기본 설정을 `rtspEngine: "gpu"`, `rtspPlusEngine: "gpu"`로 변경했습니다.
- GPU 변환 실패 시 기존처럼 `fallbackToCpu: true`에 따라 CPU/libx264로 자동 재시도합니다.
- 다중 GIS/HLS Viewer 표출 시 segment 404를 줄이기 위해 HLS segment 정책을 완화했습니다.
  - `hlsTime: 1.0`
  - `hlsListSize: 24`
  - `hlsDeleteThreshold: 12`
- `GISDashBoard.json`에 `hlsOutput` 설정을 추가해 segment 정책을 설정 파일에서 조정할 수 있게 했습니다.
- HLS.js 플레이어에서 segment/playlist 404가 감지되면 최신 `stream.m3u8`를 cache-buster와 함께 즉시 다시 로드하도록 보강했습니다.
- HLS API `/api/health`와 `/api/streams/status/<camId>` 응답에 `hlsOutput` 값을 포함하도록 했습니다.
- HLS API 버전을 `v75.25`로 갱신했습니다.


## RIC_V75_26_gis_hls_ready_start_sync

- GIS 모드 HLS Viewer의 재생 시작 조건을 CAM 모드와 더 가깝게 보강했습니다.
- 기존에는 `stream.m3u8`가 HTTP 200이면 바로 재생을 시작했지만, 이제 변환 카메라는 상태 API 기준으로 `m3u8Exists=true`, `segmentCount >= 3`, `m3u8AgeSec <= 6` 조건을 만족해야 재생을 시작합니다.
- GIS HLS Viewer에서도 HLS URL을 항상 절대 URL로 정규화해 상대 경로/캐시 문제를 줄였습니다.
- segment/playlist 404가 반복되면 단순 `hls.loadSource()` 재시도에서 끝내지 않고, HLS 인스턴스를 정리한 뒤 `/api/streams/request` 재호출, 준비 상태 재확인, 새 HLS 인스턴스 생성 순서로 전체 재시작하도록 보강했습니다.
- GIS 모드에서 먼저 카메라를 열면 화면이 안 나오고 CAM 모드 전환 후 GIS로 돌아오면 보이던 초기화 절차 차이를 줄였습니다.
- HLS API 버전을 `v75.26`으로 갱신했습니다.


## RIC_V75_27_user_rtsp_weather_baseline

- 사용자가 새 PC 설치 환경에서 수정한 코드를 새 기준선으로 반영했습니다.
- 카메라 목록 기준 파일을 `shared/data/cameras.json`으로 잡고, `shared/data/cameras.json`을 동일 내용으로 동기화했습니다.
- 추가된 일반 RTSP 카메라 `cam003 / 사무실 RTSP`를 기준 카메라 목록에 포함했습니다.
- `cam003`의 설명 문구가 `/media/cam002/stream.m3u8`를 가리키던 부분을 `/media/cam003/stream.m3u8`로 정정했습니다.
- 런타임 잔여 상태가 다음 실행에 영향을 주지 않도록 `shared/data/camera_list.json`은 `rtsp+` 상시 변환 항목만 남기고 일반 RTSP active 항목은 초기화했습니다.
- Weather Dashboard의 `requirements.txt` 변경 내용을 유지했습니다.
  - `flask==3.0.2`
  - `requests==2.31.0`
  - `python-dotenv==1.2.2`
- HLS 변환 설정은 PC/GPU 테스트 기준으로 유지했습니다.
  - 일반 `rtsp`: GPU
  - `rtsp+`: GPU
  - GPU 실패 시 CPU fallback
- HLS API 버전을 `v75.27`로 갱신했습니다.


## RIC_V75_28_single_camera_source

- 카메라 목록 원본을 `shared/data/cameras.json` 하나로 단일화했습니다.
- `shared/config/cameras.json`은 삭제했습니다. 앞으로 카메라 추가/주소 변경/좌표 변경은 `shared/data/cameras.json`만 수정합니다.
- HLS API 서버의 `shared/config/cameras.json` 복사/동기화 경고 로직을 제거하고, `shared/data/cameras.json`이 없을 경우 빈 기본 파일만 생성하도록 정리했습니다.
- `run_all.bat`의 사전 점검 경로를 `shared/data/cameras.json` 기준으로 변경했습니다.
- `shared/data/camera_list.json`은 변환기 런타임 상태 파일로 분리합니다. 일반 RTSP 카메라가 active로 남아 있으면 테스트 중 생성된 상태이므로 필요 시 초기화합니다.
- README 외의 기존 `.md` 파일은 남기지 않는 기존 관리 규칙을 유지했습니다.

### 카메라 파일 관리 규칙

```text
shared/data/cameras.json      # 유일한 카메라 원본
shared/data/camera_list.json  # 런타임 HLS 변환 상태
shared/data/GISDashBoard.json # GIS/HLS 설정
shared/config/modules.json    # 메인 대시보드 iframe URL 설정
```

## RIC_V75_29_weather_dependency_autoinstall

- Weather Dashboard 실행 전에 Python 의존 패키지를 자동 설치하도록 수정했습니다.
- `infra/scripts/run_weather_dashboard.bat`에서 `apps/weather_dashboard/requirements.txt`를 확인한 뒤 `python -m pip install -r requirements.txt`를 실행합니다.
- 설치 후 `from dotenv import load_dotenv`, `flask`, `requests` import 검사를 수행해 `python-dotenv` 누락 문제를 실행 전에 잡도록 했습니다.
- 단독 실행용 `apps/weather_dashboard/run_Weather_DashBoard.bat`에도 동일한 Python 패키지 자동 설치 및 import 검사를 추가했습니다.
- `python-dotenv`는 설치 패키지명이고, 코드에서 import할 때는 `dotenv` 모듈명으로 사용한다는 점을 실행 검증에 반영했습니다.
- HLS API 버전을 `v75.29`로 갱신했습니다.



## RIC_V75_30_gis_hls_viewer_drag_link

- GIS 모드의 HLS Viewer를 마우스로 드래그해서 이동할 수 있도록 수정했습니다.
- HLS Viewer의 버튼, 영상 컨트롤, 입력 요소를 제외한 영역을 마우스로 누른 상태에서 이동하면, 마우스를 놓은 위치에 Viewer가 고정됩니다.
- 카메라 위치와 해당 HLS Viewer 사이를 빨간색 선으로 연결해 어떤 카메라 영상이 어느 Viewer에 표시되는지 구분할 수 있도록 했습니다.
- HLS Viewer를 처음 열 때 카메라 아이콘 위에 겹치지 않도록 지도 화면 기준으로 오른쪽 위에 자동 배치하고, 화면 밖으로 나가지 않도록 위치를 clamp 처리합니다.
- HLS Viewer를 이동할 때 빨간 연결선도 실시간으로 따라 움직입니다.
- HLS Viewer를 닫거나 전체 닫기를 실행하면 연결선도 함께 제거됩니다.
- HLS API 버전을 `v75.30`으로 갱신했습니다.


## RIC_V75_31_gis_hls_auto_layout

- GIS 모드 HLS Viewer를 새로 열 때 화면의 여유 공간을 점수화해서 자동 배치하도록 수정했습니다.
- 카메라 주변 8방향 후보를 먼저 검사하고, 모두 겹치면 지도 전체를 격자로 탐색해 가장 겹침이 적은 위치를 선택합니다.
- 점수 기준은 기존 Viewer와의 겹침 면적, 카메라와의 거리, 화면 가장자리 접근, 카메라 아이콘 가림 여부입니다.
- Viewer가 지도 영역 밖으로 나가지 않도록 초기 배치와 드래그 이동 모두 clamp 처리했습니다.
- 기존 빨간 연결선은 자동 배치 위치와 드래그 이동 위치를 계속 따라가도록 유지했습니다.
- HLS API 버전을 v75.31로 갱신했습니다.

## RIC_V75_32_gis_hls_auto_layout_marker_avoid

- GIS 모드 HLS Viewer 자동 배치 알고리즘에서 카메라 아이콘 가림 방지 기준을 강화했습니다.
- 기존 v75.31은 선택한 카메라 좌표 중심만 강하게 회피했기 때문에, 주변에 있는 다른 카메라 마커가 Viewer에 가려질 수 있었습니다.
- 이번 버전에서는 `cameraMarkers`에 표시된 모든 카메라 마커를 보호 영역으로 계산합니다.
- 카메라 마커는 40x40 이미지와 bottom-center anchor 구조를 기준으로 하되, 여유 padding을 추가해 Viewer가 아이콘 위에 올라가지 않도록 했습니다.
- 후보 위치 점수 계산 시 카메라 마커 보호 영역과 겹치면 일반 거리/가장자리 점수보다 훨씬 큰 penalty를 부여합니다.
- 선택한 카메라에도 별도의 더 큰 보호 영역을 추가해 Viewer가 연결선 시작점과 카메라 아이콘을 덮지 않도록 했습니다.
- 기존 기능인 HLS Viewer 드래그 이동, 빨간 연결선, 기존 Viewer 겹침 최소화, 지도 밖 clamp 처리는 유지했습니다.
- HLS API 버전을 `v75.33`로 갱신했습니다.


## RIC_V75_33_fix_8090_port_conflict

- 8090 포트 충돌을 수정했습니다.
- Main Dashboard만 8090 포트를 사용하도록 정리했습니다.
- HLS Converter의 `ffmpeg_manager.py` 내장 shared-folder HTTP 서버 기본값을 비활성화했습니다. (`--http-port 0`)
- HLS 미디어 파일은 Node HLS API의 8080 포트에서 `/media/...` 경로로 서비스하도록 유지했습니다.
- `run_hls_converter.bat`와 converter 실행 스크립트가 `--http-port 0`을 명시하도록 수정했습니다.
- `run_main_dashboard.bat`는 실행 전 기존 8090 LISTENING 프로세스를 종료하고, `ric_v8` 루트에서 `python -m http.server 8090 --bind 0.0.0.0`으로 실행하도록 수정했습니다.
- 외부 PC 접속 주소는 `http://서버IP:8090/apps/main_dashboard/web/index.html`입니다.

### 포트 역할

| 포트 | 역할 | 비고 |
|---:|---|---|
| 8080 | HLS API / GIS / media | `/media/camId/stream.m3u8` 제공 |
| 8090 | Main Dashboard | `ric_v8` 루트 기준 정적 서버 |
| 8100 | Weather Dashboard | Flask |
| 3000 / 3005 | SMS Dashboard | Frontend / Backend |
| 5173 / 8000 | News Dashboard | Frontend / Backend |
| 3100 | Event Dashboard | Node / Socket.IO |


## RIC_V75_34_remote_client_host_url_fix

- 외부 클라이언트 PC에서 메인 대시보드 접속 시 내부 iframe과 HLS API가 `localhost`를 클라이언트 자신으로 해석하는 문제를 수정했습니다.
- `apps/main_dashboard/web/js/app.js`에서 `modules.json`의 localhost/127.0.0.1 URL을 현재 접속한 서버 hostname 기준으로 자동 변환합니다.
- CAM 모드 `camera_player.html`과 YTN `ytn.html`도 `location.hostname:8080` 기준으로 HLS API 주소를 계산하도록 수정했습니다.
- HLS API CORS 정책은 localhost뿐 아니라 사설망 대역(10.x, 172.16~31.x, 192.168.x)에서 사용하는 대시보드 포트를 허용하도록 보강했습니다.
- News backend는 외부 접근/프록시 안정성을 위해 `0.0.0.0:8000`으로 바인딩합니다.
- 검증: JSON, Python, Node.js, HTML 내부 JS 문법 및 URL 변환 알고리즘 검증을 수행했습니다.


## RIC_V75_35_remote_service_bind_fix

- 외부 PC에서 192.168.0.199:8090 메인 대시보드는 열리지만 내부 대시보드가 `localhost` 또는 로컬 바인딩 때문에 접속 거부되는 문제를 보강했다.
- HLS API, SMS backend, Event dashboard를 `0.0.0.0`에 명시적으로 바인딩하도록 수정했다.
- News frontend의 Vite 실행 기본값을 `--host 0.0.0.0 --port 5173`으로 변경했다.
- run scripts에서도 HOST=0.0.0.0을 명시하도록 보강했다.
- 원격 PC에서 포트 상태를 확인할 수 있는 `infra/scripts/check_remote_ports.bat`를 추가했다.
- 외부 접속 시 메인 대시보드가 modules.json의 localhost URL을 현재 접속 host로 바꾸는 기존 로직은 유지한다.

원격 접속 점검 순서:

```bat
infra\scripts\check_remote_ports.bat 192.168.0.199
```

모든 대시보드를 외부 PC에서 사용하려면 Windows 방화벽에서 다음 포트를 허용해야 한다: 8080, 8090, 8100, 3000, 3005, 5173, 8000, 3100.


## RIC_V75_36_remote_bind_host_trim_fix

- HLS API 실행 시 `set HOST=0.0.0.0 && node server.js` 구문 때문에 Windows CMD에서 `HOST` 값 끝에 공백이 들어가 `0.0.0.0 `로 전달되던 문제를 수정했다.
- `run_hls_converter.bat`, SMS backend, Event dashboard 실행 스크립트의 `set HOST=...` 구문을 `set "HOST=0.0.0.0"` 형식으로 변경했다.
- HLS API, SMS backend, Event dashboard 서버 코드에서 `process.env.HOST` 값을 `trim()` 처리하도록 보강했다.
- 8090은 Main Dashboard 전용, 8080은 HLS/GIS API 전용이라는 포트 역할은 유지한다.


## RIC_V75_37_remote_iframe_src_hard_fix

- 외부 클라이언트에서 메인 대시보드를 열 때 하위 iframe의 `localhost` URL이 그대로 남는 문제를 추가 보강했습니다.
- `shared/config/modules.json`의 하위 서비스 URL을 `{HOST}` 플레이스홀더 형식으로 바꾸고, 메인 대시보드가 현재 접속한 hostname으로 강제 정규화하도록 수정했습니다.
- `apps/main_dashboard/web/index.html`의 `app.js` cache-busting 버전을 갱신해 이전 브라우저 캐시가 남아 원격 URL 변환 로직이 적용되지 않는 문제를 줄였습니다.
- `embed_loader.html`에서도 target/probe URL을 다시 한 번 현재 서버 IP 기준으로 정규화하도록 방어 로직을 추가했습니다.
- 외부 접속 예: `http://192.168.0.199:8090/apps/main_dashboard/web/index.html`로 열면 하위 프레임은 `192.168.0.199:8080`, `:8100`, `:3000`, `:5173`, `:3100`으로 열립니다.


## RIC_V75_38_remote_cors_api_url_fix

- HLS API CORS 응답이 특정 Origin으로 고정되어 `localhost:8090 -> localhost:8080` 요청에서 차단되던 문제를 수정했습니다.
- HLS API는 허용된 사설망/localhost Origin에 대해 요청 Origin을 그대로 `Access-Control-Allow-Origin`으로 반환합니다.
- GIS/HLS 웹 앱의 API 기준을 상대 경로가 아니라 현재 접속 서버 hostname의 `:8080` 절대 URL로 고정했습니다.
- `hls_converter/web/index.html`과 메인 대시보드 `index.html`의 JS 캐시 버전을 `v75.38`로 갱신했습니다.
- HLS API 버전을 `v75.38`로 갱신했습니다.


## RIC_V75_39_cors_origin_hard_fix

- HLS API CORS 응답이 요청 Origin과 다르게 나가던 문제를 보강했습니다.
- `/api/cameras` 요청에서 `Access-Control-Allow-Origin`이 `localhost:8080`으로 덮어써지는 상황을 막기 위해, 응답 헤더 설정을 요청 Origin 기준으로 강제 보호합니다.
- `localhost:8090 -> localhost:8080`, `192.168.x.x:8090 -> 192.168.x.x:8080` 요청 모두 허용합니다.
- HLS API 버전을 `v75.39`로 갱신했습니다.

## RIC_V75_40_api_url_join_fix

- 메인 대시보드의 HLS API 기준 URL이 `http://host:8080/`처럼 끝에 `/`를 가진 상태에서 `/api/cameras`를 붙여 `//api/cameras`가 되는 문제를 수정했습니다.
- `serviceOrigin()`과 `joinUrl()`을 추가하여 API URL 조합 시 중복 슬래시가 생기지 않도록 정규화했습니다.
- `camera_player.html`, YTN 플레이어에도 동일한 URL 조합 함수를 적용했습니다.
- 메인 대시보드 카메라 로딩 시 실제 호출 URL을 콘솔에 출력하도록 하여 원격 접속 문제 진단이 쉬워졌습니다.
- HLS API 버전을 `v75.40`으로 갱신했습니다.

## RIC_V75_41_ytn_rtsp_plus_audio

- YTN처럼 `sourceType: "rtsp+"`인 상시 변환 스트림에만 HLS 오디오를 포함하도록 `hlsAudio` 설정을 추가했습니다.
- 일반 `rtsp` 카메라는 기존처럼 영상만 변환하도록 유지했습니다. 불필요한 오디오 트랙으로 인한 네트워크/브라우저/ffmpeg 부하를 줄이기 위한 정책입니다.
- `shared/data/GISDashBoard.json` 및 `shared/config/GISDashBoard.json`에 아래 설정을 추가했습니다.

```json
"hlsAudio": {
  "enabled": true,
  "rtspPlusAudio": true,
  "rtspAudio": false,
  "codec": "aac",
  "bitrate": "128k",
  "sampleRate": 44100,
  "channels": 2
}
```

- `ffmpeg_manager.py`에서 `rtsp+` 스트림에는 `-map 0:a:0?`, `-c:a aac`, `-b:a 128k`, `-ac 2`, `-ar 44100`을 적용합니다.
- 일반 `rtsp` 스트림에는 `-an`을 명시해서 오디오를 제외합니다.
- YTN 플레이어(`ytn.html`)에 `음성 켜기/끄기` 버튼을 추가했습니다. 브라우저 자동재생 정책을 고려해 기본은 음소거 자동재생이고, 사용자가 버튼을 눌러 음성을 켭니다.
- CAM 모드에서 YTN을 볼 때도 음성 버튼을 표시하도록 `camera_player.html`을 보강했습니다.
- HLS API health/status 응답에 `hlsAudio`와 `audioIncluded` 상태를 포함했습니다.
- HLS API 버전을 `v75.41`로 갱신했습니다.

## 이전 루트 보조 문서 통합 요약

### README_DASHBOARD_OPEN_SCRIPTS.txt
- Dashboard open/run scripts
- ==========================
- This package includes separate scripts for News, Event, SMS, and Weather dashboards.
- They follow the same kiosk option style used by the main dashboard script.
- 1) Start dashboard + open web page
- ----------------------------------
- Normal mode:
- infra\scripts\run_news_dashboard_open.bat
- infra\scripts\run_event_dashboard_open.bat
- infra\scripts\run_sms_dashboard_open.bat
- infra\scripts\run_weather_dashboard_open.bat
- Kiosk/fullscreen mode:
- infra\scripts\run_news_dashboard_open.bat --kiosk
- infra\scripts\run_event_dashboard_open.bat --kiosk
- infra\scripts\run_sms_dashboard_open.bat --kiosk
- infra\scripts\run_weather_dashboard_open.bat --kiosk
- The following aliases are also accepted:
- --fullscreen
- --kiost   (typo-compatible with an earlier script)
- 2) Open web page only

### README_EVENT_INTEGRATION.txt
- Event Dashboard Integration Notes
- =================================
- 기준 버전: v69_ytn_rtsp_plus_always_on(1).zip
- 적용 내용
- - apps/event_dashboard 추가
- - shared/config/modules.json 에 event_url 추가: http://localhost:3100/?embed=1
- - shared/config/ports.json 에 event_dashboard: 3100 추가
- - apps/main_dashboard/web/index.html 의 하부 Event Snapshots 영역만 eventFrame iframe으로 교체
- - apps/main_dashboard/web/js/app.js 에 eventFrame 로드/수동 새로고침 연결 추가
- - infra/scripts/run_event_dashboard.bat 추가
- - infra/scripts/run_event_dashboard.bat 추가
- - infra/scripts/run_all.bat 추가
- 충돌 방지
- - 기존 SMS 3000/3005, News 5173/8000, Weather 8100, HLS 8080, Main 8090 값은 변경하지 않았습니다.
- - Event Dashboard는 3100 포트만 사용합니다.
- - 기존 infra/scripts/run_all.bat 파일은 변경하지 않았습니다. 기존 실행 방식에 영향을 주지 않기 위해 event 포함 실행은 run_all.bat로 분리했습니다.
- 처음 실행
- 1) infra\scripts\run_event_dashboard.bat
- 2) infra\scripts\run_all.bat
- 이벤트 대시보드만 실행


## 2026-06-04 / RIC_V76_06_rtsp_precheck_watchdog

### 수정 내용
- 카메라 선택 전 RTSP 사전 점검을 추가했습니다.
  - RTSP URL에서 host/port를 추출해 TCP 연결을 먼저 확인합니다.
  - ffprobe로 video stream 존재 여부를 확인합니다.
  - cam001처럼 RTSP 영상 스트림이 없거나 포트 접속이 불가한 경우 HLS 변환과 Viewer 실행을 시작하지 않습니다.
- `/api/cameras/check/:camId` API를 추가했습니다.
- `/api/streams/status/:camId` 응답에 `precheck` 결과와 `hlsPrecheck` 설정을 포함했습니다.
- HLS 변환 watchdog을 추가했습니다.
  - 시작 후 지정 시간 내 `stream.m3u8`이 생성되지 않거나, 생성된 `stream.m3u8`이 일정 시간 갱신되지 않으면 ffmpeg 프로세스를 재시작합니다.
  - RTSP 연결 reset, 프레임 정체, segment 갱신 정체 상태의 자동 복구 가능성을 높였습니다.
- YTN 같은 `rtsp+`는 너무 낮은 probe/analyze 값을 쓰지 않도록 보강했습니다.
  - `analyzeduration/probesize`를 3000000 기준으로 유지해 초기 스트림 분석과 오디오 감지 안정성을 높였습니다.
- 로그 분류에서 `Error number -10054`를 RTSP 연결 중단/원격 종료로 분류하도록 보강했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- RTSP precheck 알고리즘 검사 통과
- ffprobe video stream 확인 알고리즘 검사 통과
- HLS watchdog stale m3u8 재시작 알고리즘 검사 통과
- HISTORY.md 및 docs/README.md 문서 구조 유지 확인

## 2026-06-04 / RIC_V76_07_hls_reconnect_resource_guard

### 수정 내용
- HLS Watchdog을 보수적으로 재설계했습니다.
  - `stream.m3u8` 갱신 시간만으로 즉시 재시작하지 않고, 최신 segment 번호/mtime 증가 여부를 함께 확인합니다.
  - soft stale 상태에서는 경고 로그만 남기고, hard stale 조건에서만 재시작합니다.
  - 기존 ffmpeg가 완전히 종료된 후 HLS 출력 파일을 정리하고 새 ffmpeg를 시작합니다.
  - `minRestartIntervalSec`와 `maxRestartsPerHour`로 반복 재시작을 제한해 `0xc0000142` 같은 Windows ffmpeg 초기화 오류 가능성을 줄였습니다.
  - Watchdog 정체는 GPU/CUDA 실패로 오분류하지 않고, 실제 CUDA/NVENC 오류 로그가 있을 때만 CPU fallback을 수행합니다.
- GIS HLS Viewer 재연결 방식을 개선했습니다.
  - HLS 오류/정체 시 Viewer를 닫지 않고 마지막 화면을 유지합니다.
  - 백그라운드에서 변환을 안전하게 재시작하고 새 `stream.m3u8` 준비 후 기존 video element에 HLS.js를 다시 연결합니다.
  - 재연결 중에도 닫기 버튼과 Viewer 위치는 유지됩니다.
- 리소스 기반 Viewer 제한 기능을 추가했습니다.
  - 새 일반 RTSP 카메라를 열기 전에 GPU 모드이면 GPU 사용률/메모리, CPU 모드이면 CPU/메모리 상태를 확인합니다.
  - Viewer 수 또는 리소스 임계값을 초과하면 가장 오래된 일반 RTSP Viewer를 자동으로 닫고 새 카메라를 엽니다.
  - YTN 같은 `rtsp+`/alwaysOn 스트림은 자동 종료 대상에서 제외합니다.
  - `/api/system/resources` API를 추가해 CPU/메모리/GPU 상태와 active stream 목록을 확인할 수 있습니다.
- `GISDashBoard.json`에 `hlsResourceGuard` 설정과 보수적인 `hlsWatchdog` 설정을 추가했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- HTML 내부 JavaScript 기본 검사 통과
- Watchdog soft/hard stale 및 재시작 간격 알고리즘 검사 통과
- ffmpeg 완전 종료 후 재시작 및 HLS 출력 정리 알고리즘 검사 통과
- Viewer 마지막 화면 유지 재연결 알고리즘 검사 통과
- 리소스 기반 오래된 일반 RTSP Viewer 자동 종료 알고리즘 검사 통과
- HISTORY.md 및 docs/README.md 문서 구조 유지 확인

## 2026-06-05 / RIC_V76_08_single_viewer_close_all_fix

### 수정 내용
- GIS HLS Viewer가 같은 `camId`로 중복 생성되지 않도록 단일 Viewer 보장 로직을 추가했습니다.
  - 이미 열린 카메라를 다시 선택하면 새 Viewer를 만들지 않고 기존 Viewer를 앞으로 가져옵니다.
  - 재연결/재시도 흐름에서도 기존 Viewer 내부에서만 HLS.js를 재연결하도록 중복 생성 경로를 차단했습니다.
- `모두 닫기` 동작을 보강했습니다.
  - `camOverlays` 상태에 등록된 Viewer뿐 아니라 실제 DOM에 남은 고아 Viewer도 함께 제거합니다.
  - 중복 Viewer로 인해 내부 상태와 화면 DOM이 어긋난 경우에도 모든 HLS Viewer가 닫히도록 처리했습니다.
- 개별 닫기 동작을 보강했습니다.
  - 같은 `camId`의 중복/고아 DOM Viewer를 함께 제거합니다.
  - HLS.js 인스턴스, video source, timer, 연결선, stream release 정리를 기존 흐름과 함께 유지합니다.
- Viewer 생성 시 `data-hls-viewer-cam-id`를 부여해 DOM 기준 중복 검사와 강제 정리가 가능하도록 했습니다.
- 기존 Viewer를 앞으로 가져올 때 z-index를 높이고 짧은 강조 표시를 적용했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- HTML 내부 JavaScript 기본 검사 통과
- 같은 camId Viewer 중복 생성 방지 알고리즘 검사 통과
- `모두 닫기`가 상태 등록 Viewer와 고아 DOM Viewer를 모두 제거하는 로직 검사 통과
- 개별 닫기 시 같은 camId 잔여 Viewer 정리 로직 검사 통과
- HISTORY.md 및 docs/README.md 문서 구조 유지 확인

## 2026-06-05 / RIC_V76_09_connector_cleanup_fix

### 수정 내용
- GIS HLS Viewer를 닫았을 때 카메라 아이콘과 Viewer 사이의 빨간 연결선이 남는 문제를 수정했습니다.
- Kakao Polyline은 DOM 요소가 아니므로 `cameraConnectorRegistry`를 추가하여 camId별 연결선을 별도로 추적하도록 했습니다.
- 개별 닫기 시 해당 camId의 연결선을 상태 객체와 별도 registry 양쪽에서 모두 제거하도록 보강했습니다.
- 모두 닫기 시 화면에 남은 고아 Viewer뿐 아니라 registry에 남은 모든 연결선도 강제로 제거하도록 수정했습니다.
- 같은 camId Viewer 중복 정리 과정에서 유지해야 할 정상 Viewer의 연결선을 잘못 제거하지 않도록 중복 DOM 제거와 연결선 제거를 분리했습니다.
- HLS API 버전을 `v76.09`로 갱신했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- HTML 내부 JavaScript 기본 검사 통과
- 개별 Viewer 닫기 시 camId별 연결선 제거 알고리즘 검사 통과
- 모두 닫기 시 고아 Viewer와 잔여 연결선 제거 알고리즘 검사 통과
- 중복 Viewer 정리 시 유지 Viewer 연결선 보존 알고리즘 검사 통과

## 2026-06-08 / RIC_V76_10_hls_segment_025_tuning

### 수정 내용
- HLS 출력 segment 정책을 조정했습니다.
  - `hlsTime`: `0.5`초 → `0.25`초
  - `hlsListSize`: `24` → `48`
  - `hlsDeleteThreshold`: `12` → `24`
- segment 단위는 더 짧게 하되, `0.25초 × 48개 = 약 12초`로 기존과 유사한 playlist live window를 유지하도록 했습니다.
- HLS API 기본값과 Python ffmpeg manager 기본값도 같은 값으로 맞췄습니다.
- `shared/data/GISDashBoard.json`과 `shared/config/GISDashBoard.json`의 HLS 출력 정책을 동일하게 반영했습니다.
- HLS API 버전을 `v76.10`으로 갱신했습니다.

### 검증 내용
- JSON 문법 검사 통과
- Python 문법 검사 통과
- Node.js JavaScript 문법 검사 통과
- HTML 내부 JavaScript 기본 검사 통과
- HLS segment window 계산 검증: `0.25초 × 48개 = 약 12초`
- 삭제 여유 segment 검증: `hlsDeleteThreshold = 24`
- shared/data와 shared/config 설정 일치 검사 통과
- zip 무결성 검사 통과


## RIC_V77_05_startup_ffmpeg_cleanup_fast_recovery
- 전용 서버 운영 정책에 맞춰 HLS Converter/API 시작 전에 모든 `ffmpeg.exe`를 강제 종료하도록 변경했습니다.
- Python converter 시작 시에도 `taskkill /F /IM ffmpeg.exe /T` 기반 startup cleanup을 수행하고 `shared/logs/startup_cleanup.log`에 기록합니다.
- `startupCleanup.forceKillAllFfmpegOnStartup=true` 설정을 추가했습니다.
- media 산출물 정리 후 camera_list.json을 초기화하여 이전 FFmpeg/HLS 산출물과 새 세션이 섞이지 않도록 했습니다.
