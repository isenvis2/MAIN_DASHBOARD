# Report Dashboard (RIC 통합 모듈)

현장 순찰보고서와 사건보고서를 작성·조회·출력하는 React + Express 모듈입니다. 메인 대시보드 우측 상단의 **보고서 대시보드** 버튼을 누르면 메인 화면 내 모달로 열립니다. 모달을 닫으면 키보드 포커스가 해당 버튼으로 복귀합니다.

## 운영 설정

배포 환경값은 `.env`가 아니라 아래 JSON 한 곳에서 관리합니다.

```text
apps/report_dashboard/config/report_dashboard.json
```

| 항목 | 설명 | 기본값 |
|---|---|---|
| `service.host` | 서버 바인딩 주소 | `0.0.0.0` |
| `service.port` | Report Dashboard 포트 | `3200` |
| `storage.databaseFile` | 보고서 DB 파일 경로. JSON 파일 위치를 기준으로 해석 | `../../../shared/data/report_dashboard/db.json` |
| `http.requestBodyLimit` | JSON/사진 포함 요청 허용 크기 | `15mb` |

`shared/config/ports.json` 및 `shared/config/modules.json`의 `report_dashboard` / `report_url`도 같은 3200 포트로 맞춰 두었습니다. 포트를 바꿀 때에는 세 파일을 함께 같은 값으로 수정하십시오.

## 실행

전체 RIC 서비스 시작 시 Report Dashboard도 자동으로 실행됩니다.

```bat
infra\scripts\run_all.bat
```

Report Dashboard만 실행하려면 아래 스크립트를 사용합니다.

```bat
infra\scripts\run_report_dashboard.bat
```

메인 화면에서 열거나 아래 주소로 직접 접속할 수 있습니다.

```text
http://<서버IP>:3200/
```

## 데이터 보존

운영 데이터는 `shared/data/report_dashboard/db.json`에 저장됩니다. 버전 교체 전에 이 파일을 별도로 백업하고, 새 패키지에 덮어쓸 때에는 기존 DB 파일을 보존하십시오.

## 결재·문서 보존 정책

- 작성 중/반려 상태 문서만 수정 및 결재 요청이 가능합니다.
- 결재 요청 이후 문서는 삭제할 수 없습니다.
- 최종 결재 문서는 수정·삭제·결재 취소할 수 없고, 관리자 무효 처리 후 정정본을 작성합니다.
- 무효 처리된 원본과 결재 이력은 보존됩니다.
