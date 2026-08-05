VMS Event Dashboard 수정본
=========================

1) 실행 포트
- 기본 포트: 3100
- 실행: npm start
- 접속: http://localhost:3100
- 필요 시 PORT 환경변수로 변경 가능
  Windows CMD: set PORT=3101 && npm start
  PowerShell:  $env:PORT=3101; npm start
  Linux/Mac:   PORT=3101 npm start

2) 메인 대시보드 하부 Event Snapshots 패널 연동 예시
- 기존 하부 패널의 snapshotContainer 대신 iframe을 넣어 사용합니다.

<footer class="bottom-panel panel-card">
  <iframe id="eventFrame" title="Event Snapshots" src="http://localhost:3100"></iframe>
</footer>

- style.css에 이미 iframe { width:100%; height:100%; border:none; background:#000; } 규칙이 있으면 추가 CSS는 필요 없습니다.

3) 주요 수정 내용
- server.js의 listen 포트를 3000에서 3100 기본값으로 변경했습니다.
- 메인 대시보드 마지막 버전의 어두운 패널 스타일에 맞춰 index.html을 수정했습니다.
- 하부 패널 높이에 맞게 이벤트 카드를 가로 스냅샷 스트립으로 표시합니다.
- 최근 이벤트 강조, 최대 40개 유지, 연결 상태 표시, 전체화면 확대 팝업을 유지했습니다.
- 이벤트 텍스트는 HTML 이스케이프 처리하여 표시 안정성을 높였습니다.

[JSON 설정]
이벤트 대시보드 설정 파일:
  apps\event_dashboard\config\event_dashboard.json

주요 항목:
  PORT                 : 이벤트 대시보드 웹 포트, 기본 3100
  AXXON_SERVER_IP      : Axxon ONE 서버 IP
  GRPC_PORT            : Axxon gRPC 포트, 기본 20109
  LOGIN                : Axxon 로그인 ID
  PASSWD               : Axxon 로그인 비밀번호
  MAX_SIZE             : 화면에 보관할 이벤트 카드 최대 개수, 현재 기본 1000
  IMAGE_RETRY_COUNT    : 스냅샷 이미지 재시도 횟수
  IMAGE_RETRY_DELAY_MS : 스냅샷 이미지 재시도 간격(ms)
  CERT_OVERRIDE_HOST   : gRPC 인증서 우회 호스트, 기본 127.0.0.1

동작:
  MAX_SIZE를 초과하면 가장 오래된 이벤트 카드부터 자동 삭제됩니다.
  LOGIN/PASSWD는 브라우저로 전달하지 않고 서버에서만 사용합니다.
