/**
 * ============================================================================
 * Axxon ONE VMS 지능형 이벤트 수신 및 이미지 프록시 서버 (최종 마스터본)
 * ============================================================================
 */

const express = require('express');
const http = require('http');
const https = require('https');
const tls = require('tls');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const protobuf = require('protobufjs'); 

require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- [Event Dashboard JSON 설정] ---
// 기본 파일: apps/event_dashboard/config/event_dashboard.json
// LOGIN/PASSWD(VMS 계정 정보)는 비밀 값이므로 JSON에 두지 않고 apps/event_dashboard/.env에서만 읽습니다.
// 환경변수(PORT, AXXON_SERVER_IP 등)가 있으면 JSON보다 우선합니다.
const CONFIG_PATH = path.join(__dirname, 'config', 'event_dashboard.json');
const DEFAULT_CONFIG = {
    PORT: 3100,
    AXXON_SERVER_IP: '192.168.0.62',
    GRPC_PORT: '20109',
    LOGIN: 'CHANGE_ME',
    PASSWD: 'CHANGE_ME',
    MAX_SIZE: 1000,
    IMAGE_RETRY_COUNT: 5,
    IMAGE_RETRY_DELAY_MS: 500,
    CERT_OVERRIDE_HOST: '127.0.0.1'
};

function readJsonConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
            console.log(`[CONFIG] 기본 설정 파일 생성: ${CONFIG_PATH}`);
            return { ...DEFAULT_CONFIG };
        }
        return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    } catch (error) {
        console.error(`[CONFIG] 설정 파일 읽기 실패, 기본값 사용: ${error.message}`);
        return { ...DEFAULT_CONFIG };
    }
}

function positiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return Math.min(parsed, max);
}

const rawConfig = readJsonConfig();
const CONFIG = {
    PORT: positiveInt(process.env.PORT ?? rawConfig.PORT, DEFAULT_CONFIG.PORT, 1, 65535),
    AXXON_SERVER_IP: String(process.env.AXXON_SERVER_IP ?? rawConfig.AXXON_SERVER_IP),
    GRPC_PORT: String(process.env.GRPC_PORT ?? rawConfig.GRPC_PORT),
    LOGIN: String(process.env.LOGIN ?? rawConfig.LOGIN),
    PASSWD: String(process.env.PASSWD ?? rawConfig.PASSWD),
    MAX_SIZE: positiveInt(process.env.MAX_SIZE ?? rawConfig.MAX_SIZE, DEFAULT_CONFIG.MAX_SIZE, 1, 100000),
    IMAGE_RETRY_COUNT: positiveInt(process.env.IMAGE_RETRY_COUNT ?? rawConfig.IMAGE_RETRY_COUNT, DEFAULT_CONFIG.IMAGE_RETRY_COUNT, 1, 100),
    IMAGE_RETRY_DELAY_MS: positiveInt(process.env.IMAGE_RETRY_DELAY_MS ?? rawConfig.IMAGE_RETRY_DELAY_MS, DEFAULT_CONFIG.IMAGE_RETRY_DELAY_MS, 0, 60000),
    CERT_OVERRIDE_HOST: String(process.env.CERT_OVERRIDE_HOST ?? rawConfig.CERT_OVERRIDE_HOST)
};

const PORT = CONFIG.PORT;
const HOST = String(process.env.HOST || rawConfig.HOST || '0.0.0.0').trim() || '0.0.0.0';
const VMS_IP = CONFIG.AXXON_SERVER_IP;
const GRPC_PORT = CONFIG.GRPC_PORT;
const VMS_ID = CONFIG.LOGIN;
const VMS_PW = CONFIG.PASSWD;
const MAX_SIZE = CONFIG.MAX_SIZE;

console.log(`[CONFIG] PORT=${PORT}, AXXON_SERVER_IP=${VMS_IP}, GRPC_PORT=${GRPC_PORT}, LOGIN=${VMS_ID}, MAX_SIZE=${MAX_SIZE}`);
if (VMS_ID === 'CHANGE_ME' || VMS_PW === 'CHANGE_ME') {
    console.warn('[CONFIG] Axxon LOGIN/PASSWD must be set in config/event_dashboard.json or environment variables before connecting to VMS.');
}

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
    res.status(404).send('index.html not found');
});

// 브라우저에 공개해도 되는 설정만 내려줍니다. LOGIN/PASSWD는 내려주지 않습니다.
app.get('/api/settings', (req, res) => {
    res.json({ maxSize: MAX_SIZE, port: PORT, axxonServerIp: VMS_IP });
});

// [이미지 프록시 라우터]
app.get('/api/image', async (req, res) => {
    const { camBase64, timestamp } = req.query;
    if (!camBase64 || !timestamp) return res.status(400).send("파라미터 누락");

    let rawCamId = Buffer.from(camBase64, 'base64').toString('utf8');
    if (rawCamId.startsWith('hosts/')) rawCamId = rawCamId.substring(6); 
    
    // 💡 [핵심 수정] 콜론(:)이 %3A로 인코딩되어 404가 나던 현상 해결! (일반 encodeURI 사용)
    const safeCamId = encodeURI(rawCamId);
    
    const safeTime = timestamp.replace(/(\.\d{3})\d+/, '$1');
    
    const imageUrl = `https://${VMS_IP}/archive/media/${safeCamId}/${safeTime}`;
    const authHeader = "Basic " + Buffer.from(`${VMS_ID}:${VMS_PW}`).toString('base64');

    console.log(`📸 [이미지 요청] 원본ID: ${rawCamId} | 변환된ID: ${safeCamId}`);

    try {
        let lastResult;
        let success = false;

        // 💡 [안정화] 녹화 딜레이를 고려하여 재시도 횟수를 3번 -> 5번(총 2.5초 대기)으로 증가
        for (let i = 0; i < CONFIG.IMAGE_RETRY_COUNT; i++) {
            lastResult = await fetchArchiveImage(imageUrl, authHeader);
            if (lastResult.statusCode >= 200 && lastResult.statusCode < 300) { success = true; break; }
            if (lastResult.statusCode !== 404) break;
            await new Promise(resolve => setTimeout(resolve, CONFIG.IMAGE_RETRY_DELAY_MS));
        }

        if (!success) throw new Error(`VMS 응답 실패: ${lastResult.statusCode}`);

        res.set('Content-Type', 'image/jpeg');
        res.send(lastResult.body);
    } catch (error) {
        console.error(`❌ [이미지 로드 실패] ${safeTime} - ${error.message}`);
        res.status(500).send("이미지 로드 실패");
    }
});

// --- [gRPC 프로토콜 설정] ---
const PROTO_DIR = path.join(__dirname, 'protos');
const protoOptions = { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true, includeDirs: [PROTO_DIR] };

const authPackageDef = protoLoader.loadSync('axxonsoft/bl/auth/Authentication.proto', protoOptions);
const authProto = grpc.loadPackageDefinition(authPackageDef).axxonsoft.bl.auth;
const notifyPackageDef = protoLoader.loadSync('axxonsoft/bl/events/Notification.proto', protoOptions);
const notifyProto = grpc.loadPackageDefinition(notifyPackageDef).axxonsoft.bl.events;

const root = new protobuf.Root();
root.resolvePath = (origin, target) => path.isAbsolute(target) ? target : path.join(PROTO_DIR, target);
root.loadSync(path.join(PROTO_DIR, 'axxonsoft/bl/events/Events.proto'));
const DetectorEventMessage = root.lookupType("axxonsoft.bl.events.DetectorEvent");

const rootCert = fs.readFileSync(path.join(__dirname, 'api.ngp.root-ca.crt'));
const sslCreds = grpc.credentials.createSsl(rootCert);

// AxxonONE archive 이미지 요청(HTTPS)도 gRPC와 같은 자체 서명 루트 CA를 신뢰하도록 구성합니다.
// 기본 공개 CA 목록에 이 루트 CA를 추가하는 방식이라, 서버가 공개 CA 인증서로 바뀌어도 계속 동작합니다.
const archiveHttpsAgent = new https.Agent({ ca: [...tls.rootCertificates, rootCert] });

// fetch()는 undici 기반이라 Node의 https.Agent(커스텀 CA)를 인식하지 못하므로,
// 이 요청만 https 모듈로 직접 처리해 archiveHttpsAgent를 실제로 적용합니다.
function fetchArchiveImage(url, authHeader) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            agent: archiveHttpsAgent,
            headers: { 'Authorization': authHeader, 'Accept': 'image/jpeg' }
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({ statusCode: response.statusCode, body: Buffer.concat(chunks) }));
            response.on('error', reject);
        });
        req.on('error', reject);
    });
}


function compactText(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function deriveCameraNameFromSource(source) {
    const raw = compactText(source, 'Unknown');
    const parts = raw.split('/').filter(Boolean);
    const device = parts.find((part) => /device/i.test(part));
    if (device) return device;
    const endpoint = parts.find((part) => /sourceendpoint|video/i.test(part));
    if (endpoint) return endpoint;
    return raw;
}

function parseAxxonLocalizedEventText(text) {
    const raw = compactText(text, '');
    if (!raw) return { cameraName: '', eventName: '', eventMessage: '' };

    // Axxon Korean event text examples:
    // 카메라 "54.카메라" · "3.영역 내 움직임 감지" 검출 동작 시작 ...
    // 카메라 "54.카메라". "3.영역 내 움직임 감지" 검출 동작 종료 ...
    // Separator can be middle dot, period, dash, colon, or bullet depending on VMS/localization.
    const match = raw.match(/^카메라\s+(\"[^\"]+\"|[^\"·ㆍ•\.\-:：]+?)\s*[·ㆍ•\.\-:：]\s*(\"[^\"]+\"|[^\s]+)(?:\s+([\s\S]+))?$/);
    if (!match) {
      return { cameraName: '', eventName: raw, eventMessage: raw };
    }

    return {
      cameraName: `카메라 ${compactText(match[1], '')}`,
      eventName: compactText(match[2], raw),
      eventMessage: compactText(match[3], '')
    };
}

function buildEventMessage(event, eventType) {
    const parsed = parseAxxonLocalizedEventText(eventType);
    if (parsed.eventMessage) return parsed.eventMessage;

    const candidates = [
        event && event.message,
        event && event.description,
        event && event.comment,
        event && event.text,
        event && eventType
    ];
    return compactText(candidates.find((item) => compactText(item, '')), eventType || '이벤트');
}

// 외부 IP 통신 시 인증서 우회
const grpcOptions = {
    'grpc.ssl_target_name_override': CONFIG.CERT_OVERRIDE_HOST,
    'grpc.default_authority': CONFIG.CERT_OVERRIDE_HOST
};

const authClient = new authProto.AuthenticationService(`${VMS_IP}:${GRPC_PORT}`, sslCreds, grpcOptions);
const notifyClient = new notifyProto.DomainNotifier(`${VMS_IP}:${GRPC_PORT}`, sslCreds, grpcOptions);

// --- [실시간 통신 핸들러] ---
io.on('connection', (socket) => {
    console.log(`🖥️ [연결됨] 브라우저 화면 갱신 완료!`);
    socket.emit('dashboard_settings', { maxSize: MAX_SIZE });

    authClient.AuthenticateEx2({ user_name: VMS_ID, password: VMS_PW }, (error, response) => {
        if (error) {
            console.error(`🚨 [VMS 접속 에러] 통신 실패: ${error.message}`);
            socket.emit('vms_status', { ok: false, message: `VMS 접속 에러: ${error.message}` });
            return;
        }
        if (response.error_code !== 'AUTHENTICATE_CODE_OK') {
            console.error(`🚨 [VMS 로그인 실패] 응답코드: ${response.error_code}`);
            socket.emit('vms_status', { ok: false, message: `VMS 로그인 실패: ${response.error_code}` });
            return;
        }

        console.log(`✅ [VMS 인증 성공] AxxonONE(${VMS_IP})과 정상 연결됨. 이벤트 수신 대기 중...`);
        socket.emit('vms_status', { ok: true, message: `VMS 연결됨: ${VMS_IP}` });

        const metadata = new grpc.Metadata();
        metadata.add(response.token_name, response.token_value); 

        const requestArgs = {
            subscription_id: "dashboard_" + Date.now(),
            filters: { include: [{ event_type: 1, domain_wide: true }] } 
        };

        const call = notifyClient.PullDetailedEvents(requestArgs, metadata);

        socket.on('disconnect', () => {
            try { call.cancel(); } catch (e) {}
        });

        call.on('data', (eventsResponse) => {
            const items = eventsResponse.items || [];
            
            items.forEach((event) => {
                let actualCameraId = event.subjects ? event.subjects[0] : "Unknown";
                let actualEventType = (event.localization && event.localization.text) ? event.localization.text : "이벤트";
                let realCrop = { x: 0, y: 0, w: 0, h: 0 };
                let eventTimestamp = new Date().toISOString();

                if (event.body && event.body.value) {
                    try {
                        const decodedBody = DetectorEventMessage.decode(event.body.value);
                        if (decodedBody.timestamp) eventTimestamp = decodedBody.timestamp;
                        if (decodedBody.details && decodedBody.details.length > 0) {
                            const rect = decodedBody.details[0].rectangle;
                            if (rect) realCrop = { x: rect.x || 0, y: rect.y || 0, w: rect.w || 0, h: rect.h || 0 };
                        }
                    } catch (e) {}
                }

                const parsedLocalizedEvent = parseAxxonLocalizedEventText(actualEventType);
                socket.emit('vms_event', {
                    timestamp: eventTimestamp,
                    cameraId: actualCameraId,
                    eventSource: actualCameraId,
                    cameraName: parsedLocalizedEvent.cameraName || deriveCameraNameFromSource(actualCameraId),
                    eventType: parsedLocalizedEvent.eventName || actualEventType,
                    eventName: parsedLocalizedEvent.eventName || actualEventType,
                    eventMessage: buildEventMessage(event, actualEventType),
                    rawEventText: actualEventType,
                    crop: realCrop
                }); 
            });
        });
        
        call.on('error', (err) => {
            console.error(`🚨 [이벤트 수신 끊김] VMS와의 gRPC 통신이 끊어졌습니다: ${err.message}`);
            socket.emit('vms_status', { ok: false, message: `이벤트 수신 끊김: ${err.message}` });
        });
    });
});

server.listen(PORT, HOST, () => {
    console.log(`🚀 [안정화 모드] 이벤트 대시보드 서버 가동: http://${HOST}:${PORT}`);
    console.log(`[REMOTE] Event Dashboard available from LAN as http://<server-ip>:${PORT}`);
});