import React, { useState, useEffect, useRef } from "react";
import { 
  FileText, 
  AlertTriangle, 
  Trash2, 
  Save, 
  Download, 
  Plus, 
  ChevronLeft, 
  Image as ImageIcon,
  Printer,
  ChevronDown,
  Eye,
  X,
  Settings,
  Upload,
  Lock,
  KeyRound,
  CheckSquare,
  ShieldCheck,
  RefreshCw,
  WifiOff,
  ArrowLeftRight,
  ArrowUpDown,
  Send,
  RotateCcw,
  Ban,
  FilePlus2,
  LockKeyhole
} from "lucide-react";
import { ApprovalRole, ApprovalStatus, Report, ReportType } from "./types";

export default function App() {
  const [reports, setReports] = useState<Report[]>([]);
  const [activeTab, setActiveTab] = useState<ReportType>('patrol');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  // Form State - Patrol
  const [pTitle, setPTitle] = useState("");
  const [pDate, setPDate] = useState("");
  const [pInspector, setPInspector] = useState("");
  const [pArea, setPArea] = useState("");
  const [pStatus, setPStatus] = useState<'순찰 진행중' | '순찰 완료'>('순찰 진행중');
  const [pCheck, setPCheck] = useState("");
  const [pVoice, setPVoice] = useState("");

  // Form State - Incident
  const [iTitle, setITitle] = useState("");
  const [iReportId, setIReportId] = useState("");
  const [iDate, setIDate] = useState("");
  const [iLocation, setILocation] = useState("");
  const [iStatus, setIStatus] = useState<'작업 중지' | '시정 조치'>('시정 조치');
  const [iDesc, setIDesc] = useState("");
  const [iAction, setIAction] = useState("");
  const [iImage, setIImage] = useState<string | null>(null);

  // Layout State
  const [isMobile, setIsMobile] = useState(false);
  const [mobileShowForm, setMobileShowForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [apiError, setApiError] = useState('');
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  type PreviewFitMode = 'auto' | 'horizontal' | 'vertical' | 'manual';
  const [previewFitMode, setPreviewFitMode] = useState<PreviewFitMode>('auto');
  const [previewScale, setPreviewScale] = useState(0.55);
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const [previewPaperSize, setPreviewPaperSize] = useState({ width: 794, height: 1123 });
  const [previewDragging, setPreviewDragging] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [logoImage, setLogoImage] = useState<string>(`data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 350 80"><path d="M10 50 Q25 20, 50 20 T90 50" fill="none" stroke="%230054A6" stroke-width="8" stroke-linecap="round"/><path d="M25 50 Q40 25, 60 25 T95 50" fill="none" stroke="%23009B4E" stroke-width="6" stroke-linecap="round"/><text x="15" y="48" font-family="sans-serif" font-size="28" font-weight="900" fill="%230054A6" font-style="italic">e</text><text x="32" y="48" font-family="sans-serif" font-size="28" font-weight="900" fill="%23009B4E" font-style="italic">x</text><text x="110" y="38" font-family="sans-serif" font-size="18" font-weight="800" fill="%230c1a30">한국도로공사</text><text x="110" y="54" font-family="sans-serif" font-size="10" font-weight="700" fill="%23666" letter-spacing="1.5">KOREA EXPRESSWAY CORP.</text></svg>`);
  const [logoFileName, setLogoFileName] = useState<string>("korea_expressway_logo_example.svg");

  // Custom Alert / Confirm Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'alert' | 'confirm'>('alert');
  const [modalTitle, setModalTitle] = useState("");
  const [modalMessage, setModalMessage] = useState("");
  const [modalConfirmCallback, setModalConfirmCallback] = useState<(() => void) | null>(null);

  const triggerAlert = (message: string, title = "알림") => {
    setModalType('alert');
    setModalTitle(title);
    setModalMessage(message);
    setModalConfirmCallback(null);
    setModalOpen(true);
  };

  const triggerConfirm = (message: string, onConfirm: () => void, title = "확인") => {
    setModalType('confirm');
    setModalTitle(title);
    setModalMessage(message);
    // Wrap callback in a function to store it correctly in state
    setModalConfirmCallback(() => onConfirm);
    setModalOpen(true);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const printTemplateRef = useRef<HTMLDivElement>(null);
  // The preview paper is visible in the browser and therefore is the most reliable PDF capture target.
  const printPreviewRef = useRef<HTMLDivElement>(null);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const previewFitModeRef = useRef<PreviewFitMode>('auto');
  const previewDragRef = useRef({ active: false, pointerId: -1, startX: 0, startY: 0, originX: 0, originY: 0 });

  // --- Signature & Stamp States ---
  const DEFAULT_INSPECTOR_STAMP = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="44" fill="none" stroke="%23e53e3e" stroke-width="4"/><circle cx="50" cy="50" r="39" fill="none" stroke="%23e53e3e" stroke-width="1.2" stroke-dasharray="3 3"/><text x="50" y="42" font-family="sans-serif" font-size="13" font-weight="900" fill="%23e53e3e" text-anchor="middle">안 전</text><text x="50" y="60" font-family="sans-serif" font-size="13" font-weight="900" fill="%23e53e3e" text-anchor="middle">김점검</text><text x="50" y="74" font-family="sans-serif" font-size="11" font-weight="900" fill="%23e53e3e" text-anchor="middle">(인)</text></svg>`;

  const DEFAULT_DIRECTOR_STAMP = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="44" fill="none" stroke="%23e53e3e" stroke-width="4"/><circle cx="50" cy="50" r="39" fill="none" stroke="%23e53e3e" stroke-width="1.2" stroke-dasharray="3 3"/><text x="50" y="42" font-family="sans-serif" font-size="13" font-weight="900" fill="%23e53e3e" text-anchor="middle">감 리</text><text x="50" y="60" font-family="sans-serif" font-size="13" font-weight="900" fill="%23e53e3e" text-anchor="middle">박단장</text><text x="50" y="74" font-family="sans-serif" font-size="11" font-weight="900" fill="%23e53e3e" text-anchor="middle">(인)</text></svg>`;

  const [inspectorStamp, setInspectorStamp] = useState<string>(DEFAULT_INSPECTOR_STAMP);
  const [directorStamp, setDirectorStamp] = useState<string>(DEFAULT_DIRECTOR_STAMP);
  const [inspectorStampFileName, setInspectorStampFileName] = useState<string>("기본_안전관리자_도장.svg");
  const [directorStampFileName, setDirectorStampFileName] = useState<string>("기본_감리단장_도장.svg");

  // Custom password prompt modal state
  const [passModalOpen, setPassModalOpen] = useState(false);
  const [passModalTitle, setPassModalTitle] = useState("");
  const [passModalMessage, setPassModalMessage] = useState("");
  const [passModalType, setPassModalType] = useState<'admin' | 'inspector_sign' | 'director_sign' | 'new_password_set'>('admin');
  const [passInputValue, setPassInputValue] = useState("");
  const [passInputPlaceholder, setPassInputPlaceholder] = useState("");
  const [passModalError, setPassModalError] = useState("");
  const [passModalOnSuccess, setPassModalOnSuccess] = useState<{ fn: (val: string) => void } | null>(null);

  // Stamp File Input Refs
  const inspectorStampInputRef = useRef<HTMLInputElement>(null);
  const directorStampInputRef = useRef<HTMLInputElement>(null);

  // Approval Management Modal State
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [apprInspectorPass, setApprInspectorPass] = useState("");
  const [apprDirectorPass, setApprDirectorPass] = useState("");

  // Workflow action reason modal: used for 반려 and administrator-only 무효 처리.
  const [reasonModalOpen, setReasonModalOpen] = useState(false);
  const [reasonModalMode, setReasonModalMode] = useState<'reject' | 'void'>('reject');
  const [reasonModalRole, setReasonModalRole] = useState<ApprovalRole>('inspector');
  const [reasonModalPassword, setReasonModalPassword] = useState('');
  const [reasonValue, setReasonValue] = useState('');
  const [reasonModalError, setReasonModalError] = useState('');

  // Check screen size
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getApprovalStatus = (report?: Report): ApprovalStatus => {
    if (!report) return 'draft';
    if (report.approvalStatus) return report.approvalStatus;
    if (report.directorApproved) return 'final_approved';
    if (report.inspectorApproved) return 'inspector_approved';
    return 'draft';
  };

  const approvalStatusLabel = (status: ApprovalStatus): string => {
    switch (status) {
      case 'draft': return '작성 중';
      case 'requested': return '결재 요청';
      case 'inspector_approved': return '안전감독관 결재';
      case 'rejected': return '반려';
      case 'final_approved': return '최종 결재 완료';
      case 'voided': return '무효 처리';
    }
  };

  const approvalStatusClass = (status: ApprovalStatus): string => {
    switch (status) {
      case 'draft': return 'bg-white/5 text-white/55 border border-white/10';
      case 'requested': return 'bg-sky-500/10 text-sky-300 border border-sky-500/25';
      case 'inspector_approved': return 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/25';
      case 'rejected': return 'bg-rose-500/10 text-rose-300 border border-rose-500/25';
      case 'final_approved': return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25';
      case 'voided': return 'bg-orange-500/10 text-orange-300 border border-orange-500/25';
    }
  };

  const isEditableApprovalStatus = (status: ApprovalStatus): boolean => status === 'draft' || status === 'rejected';

  const getApiErrorMessage = async (response: Response, fallback: string) => {
    try {
      const body = await response.json();
      return body?.error || body?.detail || fallback;
    } catch {
      return fallback;
    }
  };

  const checkServerHealth = async () => {
    setApiStatus('checking');
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (!response.ok) {
        const message = await getApiErrorMessage(response, '서버 상태를 확인할 수 없습니다.');
        setApiStatus('offline');
        setApiError(message);
        return false;
      }
      setApiStatus('online');
      setApiError('');
      return true;
    } catch (error) {
      console.error('Health check failed:', error);
      setApiStatus('offline');
      setApiError('서버와 연결할 수 없습니다. 서버 실행 및 네트워크 상태를 확인하세요.');
      return false;
    }
  };

  // Fetch reports on mount, then periodically re-check only the server connection.
  useEffect(() => {
    const initialize = async () => {
      await checkServerHealth();
      await fetchReports();
    };
    void initialize();
    const timer = window.setInterval(() => { void checkServerHealth(); }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const fetchReports = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/reports', { cache: 'no-store' });
      if (!res.ok) {
        const message = await getApiErrorMessage(res, '보고서 목록을 불러오지 못했습니다.');
        setApiStatus('offline');
        setApiError(message);
        return false;
      }
      const data: Report[] = await res.json();
      setReports(data);
      setApiStatus('online');
      setApiError('');
      return true;
    } catch (err) {
      console.error("Failed to fetch reports:", err);
      setApiStatus('offline');
      setApiError('서버와 연결할 수 없습니다. 서버 실행 및 네트워크 상태를 확인하세요.');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const retryServerConnection = async () => {
    const healthy = await checkServerHealth();
    if (healthy) {
      await fetchReports();
    }
  };

  // Set form when report selected
  const handleSelectReport = (id: string) => {
    setSelectedId(id);
    const item = reports.find(r => r.id === id);
    if (!item) return;

    if (item.type === 'patrol') {
      setActiveTab('patrol');
      setPTitle(item.title);
      setPDate(item.date);
      setPInspector(item.inspector);
      setPArea(item.area);
      setPStatus(item.status);
      setPCheck(item.check);
      setPVoice(item.voice);
    } else {
      setActiveTab('incident');
      setITitle(item.title);
      setIReportId(item.reportId);
      setIDate(item.date);
      setILocation(item.location);
      setIStatus(item.status);
      setIDesc(item.desc);
      setIAction(item.action);
      setIImage(item.image);
    }
    
    if (isMobile) {
      setMobileShowForm(true);
    }
  };

  const handleCreateNew = () => {
    const newId = 'new_' + Date.now();
    const nowStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(' ', 'T').slice(0, 16);

    if (activeTab === 'patrol') {
      setSelectedId(newId);
      setPTitle('새 순찰보고서');
      setPDate(nowStr);
      setPInspector('');
      setPArea('');
      setPStatus('순찰 진행중');
      setPCheck('');
      setPVoice('');
    } else {
      const formattedDate = nowStr.replace(/[-T:]/g, '').slice(0, 8);
      const generatedReportNum = 'INC-' + formattedDate + '-' + Math.floor(100 + Math.random() * 900);
      setSelectedId(newId);
      setITitle('새 사건 보고서');
      setIReportId(generatedReportNum);
      setIDate(nowStr);
      setILocation('');
      setIStatus('시정 조치');
      setIDesc('');
      setIAction('');
      setIImage(null);
    }

    if (isMobile) {
      setMobileShowForm(true);
    }
  };

  const handleSave = async () => {
    if (!selectedId) return;

    let payload: Partial<Report> = {};
    const existing = reports.find(r => r.id === selectedId);

    if (existing && !isEditableApprovalStatus(getApprovalStatus(existing))) {
      triggerAlert('결재 요청 이후의 문서는 수정할 수 없습니다. 반려된 문서만 수정 후 재결재할 수 있습니다.', '문서 잠금');
      return;
    }

    if (activeTab === 'patrol') {
      payload = {
        id: selectedId,
        type: 'patrol',
        title: pTitle || '제목 없음',
        date: pDate,
        inspector: pInspector,
        area: pArea,
        status: pStatus,
        check: pCheck,
        voice: pVoice,
      };
    } else {
      payload = {
        id: selectedId,
        type: 'incident',
        title: iTitle || '제목 없음',
        reportId: iReportId,
        date: iDate,
        location: iLocation,
        status: iStatus,
        desc: iDesc,
        action: iAction,
        image: iImage,
      };
    }

    try {
      const isNew = selectedId.startsWith('new_');
      const url = isNew ? '/api/reports' : `/api/reports/${selectedId}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const savedReport: Report = await res.json();
        triggerAlert(existing && getApprovalStatus(existing) === 'rejected' ? "반려 문서가 수정되었습니다. 내용을 확인한 뒤 다시 결재 요청해주십시오." : "성공적으로 저장되었습니다.", "저장 완료");
        
        // Refresh & Select saved
        await fetchReports();
        setSelectedId(savedReport.id);
        
        if (isMobile) {
          setMobileShowForm(false);
        }
      } else {
        const message = await getApiErrorMessage(res, "저장에 실패했습니다.");
        setApiStatus('offline');
        setApiError(message);
        triggerAlert(message, "저장 오류");
      }
    } catch (err) {
      console.error(err);
      setApiStatus('offline');
      setApiError('서버와 연결할 수 없습니다.');
      triggerAlert("서버 통신 실패", "오류");
    }
  };

  const resetFormState = () => {
    // Patrol
    setPTitle("");
    setPDate("");
    setPInspector("");
    setPArea("");
    setPStatus('순찰 진행중');
    setPCheck("");
    setPVoice("");

    // Incident
    setITitle("");
    setIReportId("");
    setIDate("");
    setILocation("");
    setIStatus('시정 조치');
    setIDesc("");
    setIAction("");
    setIImage(null);
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    
    if (selectedId.startsWith('new_')) {
      triggerConfirm("작성 중인 보고서를 취소하고 삭제하시겠습니까?", () => {
        resetFormState();
        setSelectedId(null);
        setMobileShowForm(false);
      }, "작성 취소");
      return;
    }

    const current = reports.find((report) => report.id === selectedId);
    if (current && getApprovalStatus(current) !== 'draft') {
      triggerAlert('결재 요청 이후의 문서는 삭제할 수 없습니다. 최종 결재 문서는 관리자 무효 처리 후 정정본을 작성하세요.', '삭제 제한');
      return;
    }

    triggerConfirm("작성 중인 보고서를 삭제하시겠습니까?", async () => {
      try {
        const res = await fetch(`/api/reports/${selectedId}`, {
          method: 'DELETE'
        });

        if (res.ok) {
          triggerAlert("삭제되었습니다.", "삭제 완료");
          resetFormState();
          setSelectedId(null);
          setMobileShowForm(false);
          fetchReports();
        } else {
          const message = await getApiErrorMessage(res, "삭제에 실패했습니다.");
          setApiStatus('offline');
          setApiError(message);
          triggerAlert(message, "삭제 오류");
        }
      } catch (err) {
        console.error(err);
        setApiStatus('offline');
        setApiError('서버와 연결할 수 없습니다.');
        triggerAlert("서버 통신 실패", "오류");
      }
    }, "보고서 삭제");
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setIImage(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  // --- Custom Password Modal Handler ---
  // 관리자/안전감독관/감리단장 암호는 서버(apps/report_dashboard/.env)가 기준값을 가지고 있으므로,
  // 로컬 상수 비교 대신 서버에 검증을 위임합니다. 이렇게 해야 .env에서 암호를 바꿔도 화면이 어긋나지 않습니다.
  const verifyPasswordWithServer = async (role: 'admin' | 'inspector' | 'director', password: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, password }),
      });
      return response.ok;
    } catch (error) {
      console.error('Password verification failed:', error);
      return false;
    }
  };

  const handlePassModalSubmit = async () => {
    if (passModalType === 'admin') {
      const verified = passInputValue;
      const ok = await verifyPasswordWithServer('admin', verified);
      if (ok) {
        setPassModalOpen(false);
        setPassInputValue("");
        setPassModalError("");
        if (passModalOnSuccess && passModalOnSuccess.fn) {
          passModalOnSuccess.fn(verified);
        }
      } else {
        setPassModalError("관리자 암호가 일치하지 않습니다.");
      }
    } else if (passModalType === 'new_password_set') {
      if (!passInputValue.trim()) {
        setPassModalError("암호를 입력해주십시오.");
        return;
      }
      const val = passInputValue;
      setPassModalOpen(false);
      setPassInputValue("");
      setPassModalError("");
      if (passModalOnSuccess && passModalOnSuccess.fn) {
        passModalOnSuccess.fn(val);
      }
    } else {
      // inspector_sign or director_sign
      const verified = passInputValue;
      const role = passModalType === 'inspector_sign' ? 'inspector' : 'director';
      const ok = await verifyPasswordWithServer(role, verified);
      if (ok) {
        setPassModalOpen(false);
        setPassInputValue("");
        setPassModalError("");
        if (passModalOnSuccess && passModalOnSuccess.fn) {
          passModalOnSuccess.fn(verified);
        }
      } else {
        setPassModalError("결재 암호가 일치하지 않습니다.");
      }
    }
  };

  const handleTriggerInspectorStampUpload = () => {
    setPassModalType('admin');
    setPassModalTitle("관리자 권한 확인");
    setPassModalMessage("안전관리자 도장 파일을 지정하려면 관리자 암호를 입력해주십시오.");
    setPassInputPlaceholder("관리자 암호 입력");
    setPassInputValue("");
    setPassModalError("");
    setPassModalOnSuccess({
      fn: () => {
        inspectorStampInputRef.current?.click();
      }
    });
    setPassModalOpen(true);
  };

  const handleTriggerInspectorPasswordChange = () => {
    setPassModalType('admin');
    setPassModalTitle("관리자 권한 확인");
    setPassModalMessage("안전감독관 결재 암호를 변경하려면 관리자 암호를 입력해주십시오.");
    setPassInputPlaceholder("관리자 암호 입력");
    setPassInputValue("");
    setPassModalError("");
    setPassModalOnSuccess({
      fn: (adminPassword: string) => {
        setTimeout(() => {
          setPassModalType('new_password_set');
          setPassModalTitle("안전감독관 새 결재 암호 설정");
          setPassModalMessage("새로 지정할 안전감독관 결재 암호를 입력해주십시오.");
          setPassInputPlaceholder("새 결재 암호 입력");
          setPassInputValue("");
          setPassModalError("");
          setPassModalOnSuccess({
            fn: async (newVal: string) => {
              try {
                const response = await fetch('/api/auth/change-password', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ adminPassword, role: 'inspector', newPassword: newVal }),
                });
                if (!response.ok) {
                  throw new Error(await getApiErrorMessage(response, '결재 암호 변경에 실패했습니다.'));
                }
                triggerAlert("안전감독관 결재 암호가 성공적으로 변경되었습니다.", "암호 변경 완료");
              } catch (error) {
                const message = error instanceof Error ? error.message : '결재 암호 변경에 실패했습니다.';
                triggerAlert(message, "암호 변경 실패");
              }
            }
          });
          setPassModalOpen(true);
        }, 200);
      }
    });
    setPassModalOpen(true);
  };

  const handleTriggerDirectorStampUpload = () => {
    setPassModalType('admin');
    setPassModalTitle("관리자 권한 확인");
    setPassModalMessage("감리단장 도장 파일을 지정하려면 관리자 암호를 입력해주십시오.");
    setPassInputPlaceholder("관리자 암호 입력");
    setPassInputValue("");
    setPassModalError("");
    setPassModalOnSuccess({
      fn: () => {
        directorStampInputRef.current?.click();
      }
    });
    setPassModalOpen(true);
  };

  const handleTriggerDirectorPasswordChange = () => {
    setPassModalType('admin');
    setPassModalTitle("관리자 권한 확인");
    setPassModalMessage("감리단장 결재 암호를 변경하려면 관리자 암호를 입력해주십시오.");
    setPassInputPlaceholder("관리자 암호 입력");
    setPassInputValue("");
    setPassModalError("");
    setPassModalOnSuccess({
      fn: (adminPassword: string) => {
        setTimeout(() => {
          setPassModalType('new_password_set');
          setPassModalTitle("감리단장 새 결재 암호 설정");
          setPassModalMessage("새로 지정할 감리단장 결재 암호를 입력해주십시오.");
          setPassInputPlaceholder("새 결재 암호 입력");
          setPassInputValue("");
          setPassModalError("");
          setPassModalOnSuccess({
            fn: async (newVal: string) => {
              try {
                const response = await fetch('/api/auth/change-password', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ adminPassword, role: 'director', newPassword: newVal }),
                });
                if (!response.ok) {
                  throw new Error(await getApiErrorMessage(response, '결재 암호 변경에 실패했습니다.'));
                }
                triggerAlert("감리단장 결재 암호가 성공적으로 변경되었습니다.", "암호 변경 완료");
              } catch (error) {
                const message = error instanceof Error ? error.message : '결재 암호 변경에 실패했습니다.';
                triggerAlert(message, "암호 변경 실패");
              }
            }
          });
          setPassModalOpen(true);
        }, 200);
      }
    });
    setPassModalOpen(true);
  };

  const handleInspectorStampUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setInspectorStampFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setInspectorStamp(event.target.result as string);
          triggerAlert("안전관리자 도장 이미지가 등록되었습니다.", "등록 완료");
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleDirectorStampUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setDirectorStampFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setDirectorStamp(event.target.result as string);
          triggerAlert("감리단장 도장 이미지가 등록되었습니다.", "등록 완료");
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const callWorkflowApi = async (path: string, body?: Record<string, unknown>) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, '결재 처리에 실패했습니다.'));
    }
    return response.json() as Promise<Report>;
  };

  const handleRequestApproval = () => {
    if (!selectedId || selectedId.startsWith('new_')) {
      triggerAlert("결재 요청 전에는 먼저 '저장 및 반영'을 눌러 보고서를 저장해주십시오.", '결재 요청');
      return;
    }

    const current = reports.find((report) => report.id === selectedId);
    if (!current) return;
    const status = getApprovalStatus(current);
    if (!isEditableApprovalStatus(status)) {
      triggerAlert('현재 상태에서는 결재 요청을 할 수 없습니다.', '결재 요청');
      return;
    }

    triggerConfirm(`[ ${current.title} ] 보고서를 결재 요청하시겠습니까?\n결재 요청 후에는 반려될 때까지 내용을 수정하거나 삭제할 수 없습니다.`, async () => {
      try {
        await callWorkflowApi(`/api/reports/${current.id}/request`);
        triggerAlert('결재 요청이 등록되었습니다. 안전감독관 결재를 기다립니다.', '결재 요청 완료');
        await fetchReports();
      } catch (error) {
        const message = error instanceof Error ? error.message : '결재 요청에 실패했습니다.';
        setApiStatus('offline');
        setApiError(message);
        triggerAlert(message, '결재 요청 오류');
      }
    }, '결재 요청 확인');
  };

  const handleApproveClick = () => {
    if (!selectedId) return;
    if (selectedId.startsWith('new_')) {
      triggerAlert("새로 작성 중인 보고서입니다. 결재하기 전에 먼저 상단의 '저장 및 반영' 버튼을 눌러 저장해주십시오.", '알림');
      return;
    }
    setApproveModalOpen(true);
  };

  const handleSetApprovalStatus = (role: ApprovalRole) => {
    const current = reports.find((report) => report.id === selectedId);
    if (!current) return;

    const status = getApprovalStatus(current);
    if (role === 'inspector' && status !== 'requested') {
      triggerAlert('안전감독관 결재는 결재 요청 상태의 문서에서만 할 수 있습니다.', '결재 순서 확인');
      return;
    }
    if (role === 'director' && status !== 'inspector_approved') {
      triggerAlert('감리단장 결재는 안전감독관 결재가 완료된 후에만 할 수 있습니다.', '결재 순서 확인');
      return;
    }

    const roleType = role === 'inspector' ? 'inspector_sign' : 'director_sign';
    const title = role === 'inspector' ? '안전감독관 결재 서명' : '감리단장 최종 결재 서명';
    setPassModalType(roleType);
    setPassModalTitle(title);
    setPassModalMessage(`[ ${current.title} ] 보고서를 ${role === 'inspector' ? '안전감독관 결재' : '최종 결재'}하시겠습니까?\n이 역할의 결재 암호를 입력해주십시오.`);
    setPassInputPlaceholder('결재 암호 입력');
    setPassInputValue('');
    setPassModalError('');
    setPassModalOnSuccess({
      fn: async (password: string) => {
        try {
          await callWorkflowApi(`/api/reports/${current.id}/approve`, { role, password });
          triggerAlert(role === 'inspector' ? '안전감독관 결재가 완료되었습니다. 감리단장 최종 결재를 기다립니다.' : '감리단장 최종 결재가 완료되었습니다. 문서는 잠금 상태가 됩니다.', '결재 완료');
          await fetchReports();
        } catch (error) {
          const message = error instanceof Error ? error.message : '결재 처리에 실패했습니다.';
          setApiStatus('offline');
          setApiError(message);
          triggerAlert(message, '결재 오류');
        }
      }
    });
    setPassModalOpen(true);
  };

  const openReasonModal = (mode: 'reject' | 'void', role: ApprovalRole = 'inspector', password: string = '') => {
    setReasonModalMode(mode);
    setReasonModalRole(role);
    setReasonModalPassword(password);
    setReasonValue('');
    setReasonModalError('');
    setReasonModalOpen(true);
  };

  const handleRejectClick = (role: ApprovalRole) => {
    const current = reports.find((report) => report.id === selectedId);
    if (!current) return;

    const status = getApprovalStatus(current);
    const allowed = (role === 'inspector' && status === 'requested') || (role === 'director' && status === 'inspector_approved');
    if (!allowed) {
      triggerAlert('현재 결재 단계에서는 반려할 수 없습니다.', '반려 처리');
      return;
    }

    const roleType = role === 'inspector' ? 'inspector_sign' : 'director_sign';
    setPassModalType(roleType);
    setPassModalTitle(role === 'inspector' ? '안전감독관 반려 확인' : '감리단장 반려 확인');
    setPassModalMessage(`[ ${current.title} ] 보고서를 반려하시겠습니까?\n결재 암호 확인 후 반려 사유를 입력합니다.`);
    setPassInputPlaceholder('결재 암호 입력');
    setPassInputValue('');
    setPassModalError('');
    setPassModalOnSuccess({ fn: (password: string) => openReasonModal('reject', role, password) });
    setPassModalOpen(true);
  };

  const handleVoidClick = () => {
    const current = reports.find((report) => report.id === selectedId);
    if (!current) return;
    if (getApprovalStatus(current) !== 'final_approved') {
      triggerAlert('최종 결재가 완료된 문서만 관리자 무효 처리할 수 있습니다.', '문서 무효 처리');
      return;
    }

    setPassModalType('admin');
    setPassModalTitle('관리자 권한 확인');
    setPassModalMessage(`[ ${current.title} ] 최종 결재 문서를 무효 처리합니다.\n관리자 암호를 확인한 뒤 무효 처리 사유를 입력해주십시오.`);
    setPassInputPlaceholder('관리자 암호 입력');
    setPassInputValue('');
    setPassModalError('');
    setPassModalOnSuccess({ fn: (password: string) => openReasonModal('void', 'inspector', password) });
    setPassModalOpen(true);
  };

  const handleReasonModalSubmit = async () => {
    const current = reports.find((report) => report.id === selectedId);
    const reason = reasonValue.trim();
    if (!current) return;
    if (!reason) {
      setReasonModalError('사유를 입력해주십시오.');
      return;
    }

    try {
      const path = reasonModalMode === 'reject'
        ? `/api/reports/${current.id}/reject`
        : `/api/reports/${current.id}/void`;
      const body = reasonModalMode === 'reject'
        ? { role: reasonModalRole, reason, password: reasonModalPassword }
        : { reason, password: reasonModalPassword };

      await callWorkflowApi(path, body);
      setReasonModalOpen(false);
      setReasonModalPassword('');
      if (reasonModalMode === 'reject') {
        triggerAlert('보고서가 반려되었습니다. 작성자는 반려 사유를 확인한 뒤 수정하여 다시 결재 요청할 수 있습니다.', '반려 완료');
      } else {
        triggerAlert('최종 결재 문서가 무효 처리되었습니다. 기존 문서는 보존되며, 필요 시 정정본을 새로 작성할 수 있습니다.', '문서 무효 처리 완료');
      }
      await fetchReports();
    } catch (error) {
      const message = error instanceof Error ? error.message : '처리에 실패했습니다.';
      setReasonModalError(message);
    }
  };

  const handleCreateCorrectedCopy = () => {
    const current = reports.find((report) => report.id === selectedId);
    if (!current) return;
    if (getApprovalStatus(current) !== 'voided') {
      triggerAlert('무효 처리된 문서에서만 정정본을 작성할 수 있습니다.', '정정본 작성');
      return;
    }

    triggerConfirm(`[ ${current.title} ] 문서를 기준으로 정정본 초안을 작성하시겠습니까?\n기존 무효 문서는 그대로 보존되고, 새 문서는 작성 중 상태로 생성됩니다.`, async () => {
      try {
        const copied = await callWorkflowApi(`/api/reports/${current.id}/corrected-copy`);
        await fetchReports();
        setActiveTab(copied.type);
        setSelectedId(copied.id);
        if (copied.type === 'patrol') {
          setPTitle(copied.title);
          setPDate(copied.date);
          setPInspector(copied.inspector);
          setPArea(copied.area);
          setPStatus(copied.status);
          setPCheck(copied.check);
          setPVoice(copied.voice);
        } else {
          setITitle(copied.title);
          setIReportId(copied.reportId);
          setIDate(copied.date);
          setILocation(copied.location);
          setIStatus(copied.status);
          setIDesc(copied.desc);
          setIAction(copied.action);
          setIImage(copied.image);
        }
        triggerAlert('정정본 초안이 생성되었습니다. 내용을 수정한 후 결재 요청해주십시오.', '정정본 생성 완료');
      } catch (error) {
        const message = error instanceof Error ? error.message : '정정본 생성에 실패했습니다.';
        triggerAlert(message, '정정본 생성 오류');
      }
    }, '정정본 작성 확인');
  };


  const readPreviewMetrics = () => {
    const viewport = previewViewportRef.current;
    const paper = printPreviewRef.current;
    if (!viewport || !paper) return null;

    const viewportBounds = viewport.getBoundingClientRect();
    const paperWidth = Math.max(1, paper.offsetWidth || paper.scrollWidth || 794);
    const paperHeight = Math.max(1, paper.offsetHeight || paper.scrollHeight || 1123);
    return {
      viewportWidth: viewportBounds.width,
      viewportHeight: viewportBounds.height,
      paperWidth,
      paperHeight,
    };
  };

  const fitPreviewPaper = (mode: Exclude<PreviewFitMode, 'manual'>) => {
    const metrics = readPreviewMetrics();
    if (!metrics || metrics.viewportWidth <= 0 || metrics.viewportHeight <= 0) return;

    const safeMargin = 32;
    const horizontalScale = Math.max(0.08, (metrics.viewportWidth - safeMargin * 2) / metrics.paperWidth);
    const verticalScale = Math.max(0.08, (metrics.viewportHeight - safeMargin * 2) / metrics.paperHeight);
    const nextScale = Math.min(
      2.5,
      mode === 'horizontal' ? horizontalScale : mode === 'vertical' ? verticalScale : Math.min(horizontalScale, verticalScale),
    );

    previewFitModeRef.current = mode;
    setPreviewFitMode(mode);
    setPreviewPaperSize({ width: metrics.paperWidth, height: metrics.paperHeight });
    setPreviewScale(nextScale);
    setPreviewOffset({
      x: Math.round((metrics.viewportWidth - metrics.paperWidth * nextScale) / 2),
      y: Math.round((metrics.viewportHeight - metrics.paperHeight * nextScale) / 2),
    });
  };

  const handlePreviewWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const viewport = previewViewportRef.current;
    if (!viewport) return;

    const bounds = viewport.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    const nextScale = Math.min(2.5, Math.max(0.08, previewScale * factor));
    if (Math.abs(nextScale - previewScale) < 0.001) return;

    const ratio = nextScale / previewScale;
    setPreviewOffset({
      x: pointerX - (pointerX - previewOffset.x) * ratio,
      y: pointerY - (pointerY - previewOffset.y) * ratio,
    });
    previewFitModeRef.current = 'manual';
    setPreviewFitMode('manual');
    setPreviewScale(nextScale);
  };

  const handlePreviewPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    previewDragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: previewOffset.x,
      originY: previewOffset.y,
    };
    setPreviewDragging(true);
  };

  const handlePreviewPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = previewDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    setPreviewOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
    previewFitModeRef.current = 'manual';
    setPreviewFitMode('manual');
  };

  const stopPreviewDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = previewDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    previewDragRef.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPreviewDragging(false);
  };

  useEffect(() => {
    if (!showPdfPreview) return;

    let resizeObserver: ResizeObserver | null = null;
    let animationFrame = 0;
    const refit = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        fitPreviewPaper(previewFitModeRef.current === 'manual' ? 'auto' : previewFitModeRef.current);
      });
    };

    // The paper's full height is known only after the preview has been laid out.
    refit();
    if (previewViewportRef.current && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (previewFitModeRef.current !== 'manual') {
          fitPreviewPaper(previewFitModeRef.current);
        }
      });
      resizeObserver.observe(previewViewportRef.current);
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      previewDragRef.current.active = false;
      setPreviewDragging(false);
    };
  }, [showPdfPreview]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        setLogoImage(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleRemoveImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIImage(null);
  };

  const handleExportPDF = async (mode: 'download' | 'preview' = 'download') => {
    if (!selectedId) return;

    if (mode === 'preview') {
      previewFitModeRef.current = 'auto';
      setPreviewFitMode('auto');
      setShowPdfPreview(true);
      return;
    }

    // Capture the visible A4 paper first. Some browsers return a blank canvas when
    // html2canvas is asked to render an element placed far outside the viewport.
    const element = printPreviewRef.current ?? printTemplateRef.current;
    if (!element) {
      triggerAlert("PDF로 저장할 보고서 서식을 찾지 못했습니다. 미리보기를 다시 연 후 재시도해주세요.", "PDF 오류");
      return;
    }

    const reportTitle = activeTab === 'patrol' ? pTitle : iTitle;
    
    // Convert oklch/oklab string to rgb/rgba
    const cleanColorString = (str: string): string => {
      if (!str || typeof str !== 'string') return str;
      return str.replace(/(oklch|oklab)\(([^)]+)\)/gi, (match, type, content) => {
        try {
          const parts = content.trim().split(/[\s,+/]+/).filter(Boolean);
          if (parts.length < 3) return match;
          
          let p1 = parseFloat(parts[0]);
          if (parts[0].includes('%')) p1 /= 100;
          
          let p2 = parseFloat(parts[1]);
          if (parts[1].includes('%')) p2 /= 100;
          
          let p3 = parseFloat(parts[2]);
          if (parts[2].includes('%')) p3 /= 100;
          
          let alpha = 1;
          if (parts.length >= 4) {
            alpha = parseFloat(parts[3]);
            if (parts[3].includes('%')) alpha /= 100;
          }
          
          if (isNaN(p1) || isNaN(p2) || isNaN(p3)) return match;
          
          let r = 0, g = 0, b = 0;
          if (type.toLowerCase() === 'oklch') {
            // oklch to rgb
            const hRad = (p3 * Math.PI) / 180;
            const oklabA = p2 * Math.cos(hRad);
            const oklabB = p2 * Math.sin(hRad);
            
            // oklab to lms
            const l_ = p1 + 0.3963377774 * oklabA + 0.2158037573 * oklabB;
            const m_ = p1 - 0.1055613458 * oklabA - 0.0638541728 * oklabB;
            const s_ = p1 - 0.0894841775 * oklabA - 1.2914855480 * oklabB;
            
            const l = l_ * l_ * l_;
            const m = m_ * m_ * m_;
            const s = s_ * s_ * s_;
            
            const r_lin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
            const g_lin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
            const b_lin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
            
            const gamma = (c: number) => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
            r = Math.min(255, Math.max(0, Math.round(gamma(r_lin) * 255)));
            g = Math.min(255, Math.max(0, Math.round(gamma(g_lin) * 255)));
            b = Math.min(255, Math.max(0, Math.round(gamma(b_lin) * 255)));
          } else {
            // oklab to lms
            const l_ = p1 + 0.3963377774 * p2 + 0.2158037573 * p3;
            const m_ = p1 - 0.1055613458 * p2 - 0.0638541728 * p3;
            const s_ = p1 - 0.0894841775 * p2 - 1.2914855480 * p3;
            
            const l = l_ * l_ * l_;
            const m = m_ * m_ * m_;
            const s = s_ * s_ * s_;
            
            const r_lin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
            const g_lin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
            const b_lin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
            
            const gamma = (c: number) => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
            r = Math.min(255, Math.max(0, Math.round(gamma(r_lin) * 255)));
            g = Math.min(255, Math.max(0, Math.round(gamma(g_lin) * 255)));
            b = Math.min(255, Math.max(0, Math.round(gamma(b_lin) * 255)));
          }
          
          return alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
        } catch (e) {
          return match;
        }
      });
    };

    // Helper to wrap getComputedStyle with a Proxy
    const wrapGetComputedStyle = (originalFn: typeof window.getComputedStyle) => {
      return function(this: any, el: Element, pseudo?: string) {
        const style = originalFn.call(this, el, pseudo);
        return new Proxy(style, {
          get(target, prop) {
            const val = target[prop as keyof CSSStyleDeclaration];
            if (typeof val === 'string' && (val.includes('oklch') || val.includes('oklab'))) {
              return cleanColorString(val);
            }
            if (typeof val === 'function') {
              return val.bind(target);
            }
            return val;
          }
        }) as any;
      };
    };

    // Temporarily patch the main window's getComputedStyle
    const originalGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = wrapGetComputedStyle(originalGetComputedStyle);

    const restoreGetComputedStyle = () => {
      window.getComputedStyle = originalGetComputedStyle;
    };

    try {
      // html2pdf의 자동 페이지 분할은 A4 높이 반올림 오차 때문에 빈 2페이지가
      // 생성되는 경우가 있어, 보이는 미리보기 문서를 복제한 뒤 캔버스를 직접 PDF로 저장합니다.
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      const sourceElement = element;
      const pdfHost = document.createElement('div');
      pdfHost.setAttribute('data-pdf-export-host', 'true');
      pdfHost.style.position = 'fixed';
      pdfHost.style.left = '0';
      pdfHost.style.top = '0';
      pdfHost.style.width = '210mm';
      pdfHost.style.background = '#ffffff';
      pdfHost.style.pointerEvents = 'none';
      pdfHost.style.zIndex = '-1';
      pdfHost.style.overflow = 'hidden';

      const pdfElement = sourceElement.cloneNode(true) as HTMLElement;
      pdfElement.classList.remove('shadow-lg');
      pdfElement.style.boxShadow = 'none';
      pdfElement.style.margin = '0';
      pdfElement.style.width = '210mm';
      pdfElement.style.maxWidth = '210mm';
      pdfElement.style.minHeight = '297mm';

      // html2canvas는 기본 SVG 로고(data:image/svg+xml)를 일부 PC에서 누락시키는 경우가 있습니다.
      // 캡처 직전에 SVG만 PNG data URL로 변환해 미리보기와 PDF의 로고를 동일하게 유지합니다.
      const rasterizeSvgDataUrl = (source: string) => new Promise<string>((resolve, reject) => {
        const image = new Image();
        let objectUrl = '';
        const cleanup = () => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
        image.onload = () => {
          try {
            const scale = 3;
            const width = Math.max(1, image.naturalWidth || 350);
            const height = Math.max(1, image.naturalHeight || 80);
            const rasterCanvas = document.createElement('canvas');
            rasterCanvas.width = width * scale;
            rasterCanvas.height = height * scale;
            const rasterContext = rasterCanvas.getContext('2d');
            if (!rasterContext) throw new Error('Logo canvas context is unavailable.');
            rasterContext.imageSmoothingEnabled = true;
            rasterContext.imageSmoothingQuality = 'high';
            rasterContext.scale(scale, scale);
            rasterContext.drawImage(image, 0, 0, width, height);
            cleanup();
            resolve(rasterCanvas.toDataURL('image/png'));
          } catch (error) {
            cleanup();
            reject(error);
          }
        };
        image.onerror = () => {
          cleanup();
          reject(new Error('SVG logo could not be loaded.'));
        };

        try {
          // Raw UTF-8 SVG data URLs (and base64 SVG uploads) are normalised into a Blob.
          // This is more reliable than drawing a direct SVG data URL with html2canvas on Windows Chrome.
          const commaIndex = source.indexOf(',');
          if (commaIndex < 0) throw new Error('Invalid SVG data URL.');
          const meta = source.slice(0, commaIndex);
          const payload = source.slice(commaIndex + 1);
          const svgText = /;base64/i.test(meta)
            ? new TextDecoder('utf-8').decode(Uint8Array.from(atob(payload), (char) => char.charCodeAt(0)))
            : decodeURIComponent(payload);
          objectUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
          image.src = objectUrl;
        } catch (error) {
          cleanup();
          reject(error);
        }
      });

      const waitForImage = (image: HTMLImageElement) => new Promise<void>((resolve) => {
        if (image.complete && image.naturalWidth > 0) {
          resolve();
          return;
        }
        image.onload = () => resolve();
        image.onerror = () => resolve();
      });

      const pdfImages = Array.from(pdfElement.querySelectorAll('img'));
      await Promise.all(pdfImages.map(async (image) => {
        const source = image.getAttribute('src') || image.src;
        if (source.startsWith('data:image/svg+xml')) {
          try {
            image.src = await rasterizeSvgDataUrl(source);
          } catch (logoError) {
            // SVG 변환에 실패해도 원본 이미지를 유지해 PDF 저장 자체는 계속합니다.
            console.warn('Logo rasterization skipped:', logoError);
          }
        }
        await waitForImage(image);
      }));

      pdfHost.appendChild(pdfElement);
      document.body.appendChild(pdfHost);

      const bounds = pdfElement.getBoundingClientRect();
      const canvas = await html2canvas(pdfElement, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        width: Math.ceil(bounds.width),
        height: Math.ceil(bounds.height),
        scrollX: 0,
        scrollY: 0,
        logging: false,
        onclone: (clonedDoc: Document) => {
          const clonedWindow = clonedDoc.defaultView;
          if (clonedWindow) {
            clonedWindow.getComputedStyle = wrapGetComputedStyle(clonedWindow.getComputedStyle);
          }

          const styles = clonedDoc.getElementsByTagName('style');
          for (let i = 0; i < styles.length; i++) {
            const style = styles[i];
            if (style.innerHTML) style.innerHTML = cleanColorString(style.innerHTML);
          }

          const allElements = clonedDoc.getElementsByTagName('*');
          for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i] as HTMLElement;
            const styleAttr = el.getAttribute('style');
            if (styleAttr && (styleAttr.includes('oklch') || styleAttr.includes('oklab'))) {
              el.setAttribute('style', cleanColorString(styleAttr));
            }
          }
        },
      });

      pdfHost.remove();

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      const pageWidthMm = 210;
      const pageHeightMm = 297;
      const pageHeightPx = (canvas.width * pageHeightMm) / pageWidthMm;
      // 1~2mm의 브라우저 반올림 오차나 보이지 않는 하단 여백 때문에 빈 2페이지가
      // 만들어지지 않도록, A4보다 조금 큰 문서는 한 페이지에 비례 축소해 저장합니다.
      const singlePageFitThreshold = pageHeightPx * 1.12;

      if (canvas.height <= singlePageFitThreshold) {
        const renderedHeightMm = Math.min(pageHeightMm, (canvas.height * pageWidthMm) / canvas.width);
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.98), 'JPEG', 0, 0, pageWidthMm, renderedHeightMm);
      } else {
        const blankPageTolerancePx = Math.max(24, Math.round(canvas.width * 0.02));
        const pageCount = Math.max(1, Math.ceil((canvas.height - blankPageTolerancePx) / pageHeightPx));

        for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
          const sourceY = Math.round(pageIndex * pageHeightPx);
          const remainingHeight = canvas.height - sourceY;
          if (remainingHeight <= blankPageTolerancePx) break;

          const sourceHeight = Math.min(Math.ceil(pageHeightPx), remainingHeight);
          const pageCanvas = document.createElement('canvas');
          pageCanvas.width = canvas.width;
          pageCanvas.height = sourceHeight;
          const context = pageCanvas.getContext('2d');
          if (!context) throw new Error('PDF canvas context is unavailable.');

          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
          context.drawImage(canvas, 0, sourceY, canvas.width, sourceHeight, 0, 0, pageCanvas.width, pageCanvas.height);

          if (pageIndex > 0) pdf.addPage('a4', 'portrait');
          const imageHeightMm = (sourceHeight * pageWidthMm) / canvas.width;
          pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.98), 'JPEG', 0, 0, pageWidthMm, imageHeightMm);
        }
      }

      pdf.save(`[보고서]_${reportTitle || '안전관리보고서'}.pdf`);
    } catch (err) {
      console.error("PDF generation error:", err);
      const orphanHost = document.querySelector('[data-pdf-export-host="true"]');
      if (orphanHost) orphanHost.remove();
      triggerAlert("PDF 파일을 생성하지 못했습니다. 문서 내용을 확인한 후 다시 시도해주세요.", "PDF 오류");
    } finally {
      restoreGetComputedStyle();
    }
  };

  const handleClosePreview = () => {
    setShowPdfPreview(false);
  };

  const renderPrintTemplate = (documentRef?: React.Ref<HTMLDivElement>) => {
    const isPatrol = activeTab === 'patrol';
    const currentReport = reports.find(r => r.id === selectedId);
    
    const formatDate = (dateStr: string) => {
      if (!dateStr) return '';
      try {
        const date = new Date(dateStr);
        return `${date.getFullYear()}년 ${String(date.getMonth() + 1).padStart(2, '0')}월 ${String(date.getDate()).padStart(2, '0')}일 ${String(date.getHours()).padStart(2, '0')}시 ${String(date.getMinutes()).padStart(2, '0')}분`;
      } catch (e) {
        return dateStr;
      }
    };

  return (
      <div ref={documentRef} className="print-document w-full max-w-[210mm] mx-auto bg-white text-black p-[12mm_14mm] font-sans shadow-lg leading-normal text-left flex flex-col" style={{ width: '210mm', minHeight: '297mm', boxSizing: 'border-box' }}>
        <div className="print-content flex-1">
          {/* Document Header */}
          <div className="pb-2 border-b-2 border-black mb-3">
            {/* Top Row with Logo and Official Badge */}
            <div className="flex justify-between items-center mb-1.5">
              <div className="h-7 flex items-center">
                {logoImage ? (
                  <img src={logoImage} alt="Logo" className="h-6 w-auto object-contain max-w-[145px]" referrerPolicy="no-referrer" />
                ) : (
                  <div className="h-6" />
                )}
              </div>
              <span className="border border-black px-1.5 py-0.5 text-[7px] font-bold tracking-widest uppercase font-mono">도시공사 관리용 / OFFICIAL USE</span>
            </div>
            
            {/* Centered Title */}
            <div className="text-center mt-1">
              <h1 className="text-lg font-bold tracking-tight text-black font-serif">
                {isPatrol ? 'DAILY PATROL REPORT' : 'INCIDENT INVESTIGATION REPORT'}
              </h1>
              <p className="text-[9px] text-gray-600 font-bold tracking-widest mt-1">
                {isPatrol ? '일일 도보순찰 안전 점검 보고서' : '현장 안전 위반 및 사고조사 보고서'}
              </p>
            </div>
          </div>

          {/* Report Identification/Overview Table */}
          <div className="mb-3">
            <table className="w-full border-collapse border border-black text-[10px] text-black">
              <tbody>
                {isPatrol ? (
                  <>
                    <tr>
                      <td className="border border-black bg-gray-100 px-2 py-1.5 font-bold w-[20%] text-center">보고서 제목</td>
                      <td className="border border-black px-2 py-1.5 font-bold text-xs" colSpan={3}>{pTitle || '제목 없음'}</td>
                    </tr>
                    <tr>
                      <td className="border border-black bg-gray-100 px-2 py-1.5 font-bold w-[20%] text-center">점검 일시</td>
                      <td className="border border-black px-2 py-1.5 w-[30%]">{formatDate(pDate)}</td>
                      <td className="border border-black bg-gray-100 px-2 py-1.5 font-bold w-[20%] text-center">점검자</td>
                      <td className="border border-black px-2 py-1.5 w-[30%]">{pInspector || '미입력'}</td>
                    </tr>
                    <tr>
                      <td className="border border-black bg-gray-100 px-2 py-1.5 font-bold w-[20%] text-center">점검 구역</td>
                      <td className="border border-black px-2 py-1.5">{pArea || '미입력'}</td>
                      <td className="border border-black bg-gray-100 px-2 py-1.5 font-bold w-[20%] text-center">진행 상태</td>
                      <td className="border border-black px-2 py-1.5">
                        <span className="font-bold">
                          {pStatus}
                        </span>
                      </td>
                    </tr>
                  </>
                ) : (
                  <>
                    <tr>
                      <td className="border border-black bg-gray-100 px-2 py-1.5 font-bold w-[20%] text-center">보고서 제목</td>
                      <td className="border border-black px-2 py-1.5 font-bold text-xs" colSpan={3}>{iTitle || '제목 없음'}</td>
                    </tr>
                    <tr>
                      <td className="border border-black bg-gray-100 px-2 py-1.5 font-bold w-[20%] text-center">관리 번호</td>
                      <td className="border border-black px-2 py-1.5 font-mono w-[30%]">{iReportId}</td>
                      <td className="border border-black bg-gray-100 px-2 py-1.5 font-bold w-[20%] text-center">발생 일시</td>
                      <td className="border border-black px-2 py-1.5 w-[30%]">{formatDate(iDate)}</td>
                    </tr>
                    <tr>
                      <td className="border border-black bg-gray-100 px-2 py-1.5 font-bold w-[20%] text-center">발생 위치</td>
                      <td className="border border-black px-2 py-1.5">{iLocation || '미입력'}</td>
                      <td className="border border-black bg-gray-100 px-2 py-1.5 font-bold w-[20%] text-center">조치 수준</td>
                      <td className="border border-black px-2 py-1.5">
                        <span className="font-bold">
                          {iStatus}
                        </span>
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>

          {/* Detailed Sections */}
          <div className="space-y-1.5">
            {isPatrol ? (
              <>
                <div>
                  <h4 className="text-[10px] font-bold border-b border-black pb-0.5 mb-1.5 uppercase tracking-wide">1. 시설물 육안 점검 결과 / VISUAL AUDIT RESULTS</h4>
                  <div className="border border-gray-300 p-2.5 rounded bg-gray-50 text-[10px] text-gray-800 whitespace-pre-wrap leading-relaxed min-h-[390px]">
                    {pCheck || '기록된 점검 내용이 없습니다.'}
                  </div>
                </div>
                
                <div>
                  <h4 className="text-[10px] font-bold border-b border-black pb-0.5 mb-1.5 uppercase tracking-wide">2. 현장 근로자 건의 및 청취 사항 / WORKER VOICE</h4>
                  <div className="border border-gray-300 p-2.5 rounded bg-gray-50 text-[10px] text-gray-800 whitespace-pre-wrap leading-relaxed min-h-[245px]">
                    {pVoice || '기록된 건의 사항이 없습니다.'}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <h4 className="text-[10px] font-bold border-b border-black pb-0.5 mb-1.5 uppercase tracking-wide">1. 사건 상황 설명 및 위반 행위 / INCIDENT DESCRIPTION</h4>
                  <div className={`border border-gray-300 p-2.5 rounded bg-gray-50 text-[10px] text-gray-800 whitespace-pre-wrap leading-relaxed ${iImage ? 'min-h-[190px]' : 'min-h-[350px]'}`}>
                    {iDesc || '기록된 사건 상황 설명이 없습니다.'}
                  </div>
                </div>

                <div>
                  <h4 className="text-[10px] font-bold border-b border-black pb-0.5 mb-1.5 uppercase tracking-wide">2. 현장 통제 및 조치 결과 / ACTIONS & MEASURES</h4>
                  <div className={`border border-gray-300 p-2.5 rounded bg-gray-50 text-[10px] text-gray-800 whitespace-pre-wrap leading-relaxed ${iImage ? 'min-h-[120px]' : 'min-h-[240px]'}`}>
                    {iAction || '기록된 현장 조치 결과가 없습니다.'}
                  </div>
                </div>

                {iImage && (
                  <div>
                    <h4 className="text-[10px] font-bold border-b border-black pb-0.5 mb-1.5 uppercase tracking-wide">3. 현장 증적 사진 / PHOTOGRAPHIC EVIDENCE</h4>
                    <div className="border border-gray-300 p-2 rounded bg-gray-50 flex justify-center items-center h-[185px]">
                      <img src={iImage} alt="현장 증적 사진" className="max-h-full max-w-full object-contain" />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Official Stamp & Signatures */}
        <div className="print-signature-block mt-3 border-t border-gray-200 pt-2 flex justify-between items-end text-[9px] break-inside-avoid">
          <div className="space-y-0.5">
            <p className="text-gray-400 font-mono tracking-wider">DOC ID: {isPatrol ? `PAT-${selectedId?.slice(4,12)}` : iReportId}</p>
            <p className="text-gray-400 font-mono tracking-wider">SYSTEM GENERATED SAFEGUARD REPORT</p>
          </div>
          <div className="flex gap-5 text-center mr-1">
            {/* 결재 순서: 안전감독관 → 감리단장 */}
            <div className="space-y-1.5">
              <p className="font-bold text-gray-500">안전감독관 (인)</p>
              <div className="border-b border-black w-16 h-4 flex justify-center items-center relative">
                {currentReport?.inspectorApproved && inspectorStamp && (
                  <img src={inspectorStamp} alt="안전감독관 직인" className="absolute w-10 h-10 -bottom-1 select-none pointer-events-none" />
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="font-bold text-gray-500">감리단장 (인)</p>
              <div className="border-b border-black w-16 h-4 flex justify-center items-center relative">
                {currentReport?.directorApproved && directorStamp && (
                  <img src={directorStamp} alt="감리단장 직인" className="absolute w-10 h-10 -bottom-1 select-none pointer-events-none" />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const filteredReports = reports.filter(r => r.type === activeTab);
  const selectedReport = reports.find((report) => report.id === selectedId);
  const selectedApprovalStatus = getApprovalStatus(selectedReport);
  const isFormLocked = !!selectedReport && !isEditableApprovalStatus(selectedApprovalStatus);
  const canDeleteSelected = !!selectedId && (selectedId.startsWith('new_') || selectedApprovalStatus === 'draft');
  const canRequestSelected = !!selectedReport && isEditableApprovalStatus(selectedApprovalStatus);

  return (
    <>
      <div id="main-app-layout" className="flex flex-col h-screen bg-[#0a0b0d] text-[#e1e1e1] font-sans overflow-hidden select-none">
      
      {/* Top Header */}
      <header className="h-20 border-b border-white/5 flex items-center justify-between px-6 lg:px-8 bg-[#0f1115] shrink-0">
        <div>
          <h1 className="text-xl lg:text-2xl font-serif italic text-[#d4af37] tracking-tight">REPORT COMMAND CENTER</h1>
          <p className="text-[9px] lg:text-[10px] text-white/40 uppercase tracking-[0.2em] font-mono">도시공사 현장 밀착 안전 관리 대시보드</p>
        </div>
        <div className="flex items-center gap-4 lg:gap-6">
          <button
            type="button"
            onClick={() => { void retryServerConnection(); }}
            title={apiError || '서버 연결 상태를 다시 확인합니다.'}
            className="flex items-center gap-2 bg-white/5 px-3 py-1.5 lg:px-4 lg:py-2 rounded border border-white/10 hover:border-[#d4af37]/60 transition-colors cursor-pointer"
          >
            <div className={`w-2 h-2 rounded-full ${apiStatus === 'online' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : apiStatus === 'checking' ? 'bg-amber-400 animate-pulse' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`}></div>
            <span className="text-[10px] lg:text-xs font-medium tracking-wide">
              {apiStatus === 'online' ? 'SERVER SYNC ACTIVE' : apiStatus === 'checking' ? 'SERVER CHECKING' : 'SERVER OFFLINE'}
            </span>
            {apiStatus === 'offline' ? <WifiOff className="w-3.5 h-3.5 text-red-400" /> : <RefreshCw className={`w-3.5 h-3.5 text-white/45 ${apiStatus === 'checking' ? 'animate-spin' : ''}`} />}
          </button>
          <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-full border border-[#d4af37]/30 bg-gradient-to-br from-[#1a1c21] to-[#0a0b0d] flex items-center justify-center text-[#d4af37] text-xs lg:text-sm font-bold shadow-xl shrink-0">
            JD
          </div>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Sidebar: Lists reports */}
        <div className={`w-full lg:w-[400px] bg-[#0f1115] border-r border-white/5 flex flex-col shrink-0 ${isMobile && mobileShowForm ? 'hidden' : 'flex'}`}>
          
          {/* Navigation Tabs */}
          <div className="flex border-b border-white/5 bg-[#0a0b0d]/30">
            <button 
              onClick={() => { setActiveTab('patrol'); setSelectedId(null); }}
              className={`flex-1 py-4 text-center font-bold text-xs lg:text-sm transition-all duration-300 border-b-2 flex items-center justify-center gap-2 cursor-pointer ${
                activeTab === 'patrol' 
                  ? 'text-[#d4af37] border-[#d4af37] bg-[#d4af37]/5 font-serif italic' 
                  : 'text-white/40 border-transparent hover:text-white/80'
              }`}
            >
              <FileText className="w-4 h-4" />
              일일 도보순찰
            </button>
            <button 
              onClick={() => { setActiveTab('incident'); setSelectedId(null); }}
              className={`flex-1 py-4 text-center font-bold text-xs lg:text-sm transition-all duration-300 border-b-2 flex items-center justify-center gap-2 cursor-pointer ${
                activeTab === 'incident' 
                  ? 'text-[#d4af37] border-[#d4af37] bg-[#d4af37]/5 font-serif italic' 
                  : 'text-white/40 border-transparent hover:text-white/80'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
              사건 보고서
            </button>
          </div>

          {/* Sidebar Header */}
          <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
            <span className="text-xs text-white/40 font-medium font-mono uppercase tracking-widest">
              총 {filteredReports.length}건의 기록
            </span>
            <button 
              onClick={handleCreateNew}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-[#d4af37] text-[#d4af37] hover:bg-[#d4af37] hover:text-[#0a0b0d] text-xs font-bold transition-all duration-200 cursor-pointer uppercase tracking-wider font-mono"
            >
              <Plus className="w-3.5 h-3.5" />
              새 보고서 추가
            </button>
          </div>

          {/* Report List Items */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#0a0b0d]/30">
            {isLoading ? (
              <div className="flex justify-center items-center h-40">
                <span className="text-xs text-white/30 tracking-widest font-mono uppercase">Loading Records...</span>
              </div>
            ) : filteredReports.length === 0 ? (
              <div className="flex flex-col justify-center items-center h-40 text-center space-y-2 p-4 border border-dashed border-white/5 rounded">
                <p className="text-xs text-white/40 tracking-wider">기록된 보고서가 없습니다.</p>
                <p className="text-[11px] text-white/20 uppercase tracking-widest">Tap '+ 새 보고서 추가' above</p>
              </div>
            ) : (
              filteredReports.map(item => {
                const isActive = item.id === selectedId;
                let badgeStyle = "bg-[#d4af37]/10 text-[#d4af37] border border-[#d4af37]/20";
                if (item.status === '작업 중지') {
                  badgeStyle = "bg-red-500/10 text-red-400 border border-red-500/20";
                } else if (item.status === '시정 조치' || item.status === '순찰 진행중') {
                  badgeStyle = "bg-amber-500/10 text-amber-400 border border-amber-500/20";
                }

                return (
                  <div 
                    key={item.id}
                    onClick={() => handleSelectReport(item.id)}
                    className={`p-4 rounded border transition-all duration-300 cursor-pointer ${
                      isActive 
                        ? 'border-[#d4af37] bg-white/[0.04] shadow-xl' 
                        : 'border-white/5 bg-[#16181d] hover:border-white/10 hover:bg-[#1a1c22]'
                    }`}
                  >
                    <div className="font-serif text-[15px] mb-2.5 text-white flex items-center justify-between gap-2">
                      <span className="truncate">{item.title}</span>
                      {item.type === 'incident' && item.image && (
                        <span className="text-[10px] text-[#d4af37] shrink-0 font-mono border border-[#d4af37]/30 px-1.5 py-0.5 rounded bg-[#d4af37]/5">📎 첨부됨</span>
                      )}
                    </div>
                    <div className="flex justify-between items-center mt-2.5 border-t border-white/[0.03] pt-2">
                      <span className="text-[11px] text-white/40 font-mono">
                        {item.date ? item.date.replace('T', ' ') : '-'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[9.5px] font-bold font-sans px-2 py-0.5 rounded-sm ${approvalStatusClass(getApprovalStatus(item))}`}>
                          {getApprovalStatus(item) === 'final_approved' ? '● ' : ''}{approvalStatusLabel(getApprovalStatus(item))}
                        </span>
                        <span className={`text-[9px] font-mono uppercase tracking-widest px-2.5 py-0.5 rounded-full ${badgeStyle}`}>
                          {item.status}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Main Form details & PDF Preview */}
        <div className={`flex-1 flex flex-col bg-[#0a0b0d] overflow-hidden ${isMobile && !mobileShowForm ? 'hidden' : 'flex'}`}>
          
          {/* Empty View (No Selection) */}
          {!selectedId ? (
            <div className="flex-1 flex flex-col justify-center items-center text-white/30 space-y-4 p-8">
              <div className="w-16 h-16 rounded-full border border-white/10 flex items-center justify-center bg-[#0f1115] shadow-lg">
                <FileText className="w-8 h-8 text-[#d4af37]/60" />
              </div>
              <div className="text-center">
                <p className="text-sm font-serif italic text-white/80 mb-1">선택된 보고서가 없습니다</p>
                <p className="text-xs text-white/40 tracking-wider">좌측 리스트에서 보고서를 선택하거나 새 보고서를 생성해주세요.</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              
              {/* Header / Toolbar */}
              <div className="px-6 py-4 border-b border-white/5 bg-[#0f1115] flex justify-between items-center flex-wrap gap-3 shrink-0" data-html2canvas-ignore="true">
                <div className="flex items-center gap-3">
                  {isMobile && (
                    <button 
                      onClick={() => setMobileShowForm(false)}
                      className="p-1.5 rounded hover:bg-white/5 text-white transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xs font-mono tracking-widest uppercase text-white/60">
                      {selectedId.startsWith('new_') ? 'NEW RECORD CREATION' : 'REPORT DETAIL'}
                    </h2>
                    {!selectedId.startsWith('new_') && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-sm ${approvalStatusClass(selectedApprovalStatus)}`}>
                        {approvalStatusLabel(selectedApprovalStatus)}
                      </span>
                    )}
                    {isFormLocked && (
                      <span className="flex items-center gap-1 text-[10px] text-white/35">
                        <LockKeyhole className="w-3 h-3" /> 문서 잠금
                      </span>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <button 
                    onClick={() => handleExportPDF('preview')}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-[#d4af37] bg-[#0f1115] rounded-sm border border-[#d4af37]/40 hover:bg-[#d4af37]/10 transition-all cursor-pointer uppercase tracking-wider font-mono"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    보고서 미리보기
                  </button>

                  {canDeleteSelected && (
                    <button 
                      onClick={handleDelete}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-red-400 border border-red-500/20 bg-red-500/5 rounded-sm hover:bg-red-500/10 transition-all cursor-pointer uppercase tracking-wider font-mono"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      삭제
                    </button>
                  )}

                  {isEditableApprovalStatus(selectedApprovalStatus) && (
                    <button 
                      onClick={handleSave}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-[#0a0b0d] bg-[#d4af37] rounded-sm hover:brightness-110 transition-all cursor-pointer uppercase tracking-wider font-mono"
                    >
                      <Save className="w-3.5 h-3.5" />
                      저장 및 반영
                    </button>
                  )}

                  {canRequestSelected && !selectedId.startsWith('new_') && (
                    <button 
                      onClick={handleRequestApproval}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-sky-600 border border-sky-500 rounded-sm hover:bg-sky-500 transition-all cursor-pointer uppercase tracking-wider font-mono"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {selectedApprovalStatus === 'rejected' ? '수정 후 재결재 요청' : '결재 요청'}
                    </button>
                  )}

                  {!selectedId.startsWith('new_') && (
                    <button 
                      onClick={handleApproveClick}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 border border-indigo-500 rounded-sm hover:bg-indigo-500 transition-all cursor-pointer uppercase tracking-wider font-mono"
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                      결재 현황
                    </button>
                  )}

                  {/* Settings Button & Panel */}
                  <div className="relative">
                    <button 
                      onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                      className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-sm border transition-all cursor-pointer uppercase tracking-wider font-mono ${
                        isSettingsOpen 
                          ? 'text-[#0a0b0d] bg-[#d4af37] border-[#d4af37]' 
                          : 'text-[#e1e1e1] border-white/10 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <Settings className="w-3.5 h-3.5" />
                      설정
                    </button>
                    
                    {isSettingsOpen && (
                      <div className="absolute right-0 mt-2 w-96 bg-[#0f1115] border border-[#d4af37]/40 rounded shadow-2xl z-50 p-4 text-left">
                        <div className="flex justify-between items-center pb-2 mb-3 border-b border-white/5">
                          <h4 className="text-xs font-bold text-[#d4af37] flex items-center gap-1.5">
                            <Settings className="w-3.5 h-3.5" />
                            설정 메뉴
                          </h4>
                          <button onClick={() => setIsSettingsOpen(false)} className="text-white/40 hover:text-white">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        
                        <div className="space-y-4">
                          <div>
                            <label className="block text-[10px] font-bold text-white/50 uppercase tracking-wider mb-1">
                              로고 파일
                            </label>
                            
                            <div className="flex items-center gap-2">
                              <input 
                                type="text" 
                                value={logoFileName} 
                                readOnly
                                className="flex-1 bg-[#16181d] border border-white/10 rounded px-2 py-1.5 text-[11px] text-white/70 font-mono focus:outline-none"
                              />
                              <button
                                onClick={() => logoInputRef.current?.click()}
                                className="px-3 py-1.5 bg-[#d4af37]/10 border border-[#d4af37]/40 text-[#d4af37] rounded text-[11px] font-bold hover:bg-[#d4af37]/20 transition-all cursor-pointer flex items-center gap-1 shrink-0"
                              >
                                <Upload className="w-3 h-3" />
                                선택
                              </button>
                              <input 
                                type="file"
                                ref={logoInputRef}
                                onChange={handleLogoUpload}
                                accept="image/*"
                                className="hidden"
                              />
                            </div>
                          </div>
                          
                          {logoImage && (
                            <div>
                              <span className="block text-[9px] font-bold text-white/40 uppercase tracking-wider mb-1">
                                로고 미리보기
                              </span>
                              <div className="border border-white/5 rounded bg-white/5 p-3 flex items-center justify-center h-20 relative group">
                                <img 
                                  src={logoImage} 
                                  alt="Logo Preview" 
                                  className="max-h-full max-w-full object-contain"
                                  referrerPolicy="no-referrer"
                                />
                                <button
                                  onClick={() => {
                                    setLogoImage("");
                                    setLogoFileName("선택된 파일 없음");
                                  }}
                                  className="absolute top-1 right-1 p-1 bg-black/60 rounded text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
                                  title="로고 초기화"
                                >
                                  초기화
                                </button>
                              </div>
                            </div>
                          )}

                          {/* 1. 안전관리자 설정 */}
                          <div className="border-t border-white/5 pt-3">
                            <label className="block text-[10px] font-bold text-white/50 uppercase tracking-wider mb-1.5">
                              안전감독관 결재 및 서명 설정
                            </label>
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <input 
                                  type="text" 
                                  value={inspectorStampFileName} 
                                  readOnly
                                  className="flex-1 bg-[#16181d] border border-white/10 rounded px-2 py-1.5 text-[11px] text-white/50 font-mono focus:outline-none"
                                />
                                {inspectorStamp && (
                                  <div className="w-7 h-7 bg-white rounded border border-red-500/50 p-0.5 flex items-center justify-center shrink-0">
                                    <img src={inspectorStamp} alt="St" className="max-h-full max-w-full object-contain" />
                                  </div>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  onClick={handleTriggerInspectorStampUpload}
                                  className="px-2 py-1.5 bg-[#d4af37]/15 border border-[#d4af37]/40 text-[#d4af37] rounded text-[11px] font-bold hover:bg-[#d4af37]/35 transition-all cursor-pointer flex items-center justify-center gap-1"
                                >
                                  <Upload className="w-3 h-3" />
                                  도장 지정
                                </button>
                                <button
                                  onClick={handleTriggerInspectorPasswordChange}
                                  className="px-2 py-1.5 bg-white/5 border border-white/10 text-white/80 rounded text-[11px] font-bold hover:bg-white/10 transition-all cursor-pointer flex items-center justify-center gap-1"
                                >
                                  <Lock className="w-3 h-3" />
                                  암호 지정
                                </button>
                              </div>
                              <input 
                                type="file"
                                ref={inspectorStampInputRef}
                                onChange={handleInspectorStampUpload}
                                accept="image/*"
                                className="hidden"
                              />
                            </div>
                          </div>

                          {/* 2. 감리단장 설정 */}
                          <div className="border-t border-white/5 pt-3">
                            <label className="block text-[10px] font-bold text-white/50 uppercase tracking-wider mb-1.5">
                              감리단장 결재 및 서명 설정
                            </label>
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <input 
                                  type="text" 
                                  value={directorStampFileName} 
                                  readOnly
                                  className="flex-1 bg-[#16181d] border border-white/10 rounded px-2 py-1.5 text-[11px] text-white/50 font-mono focus:outline-none"
                                />
                                {directorStamp && (
                                  <div className="w-7 h-7 bg-white rounded border border-red-500/50 p-0.5 flex items-center justify-center shrink-0">
                                    <img src={directorStamp} alt="St" className="max-h-full max-w-full object-contain" />
                                  </div>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  onClick={handleTriggerDirectorStampUpload}
                                  className="px-2 py-1.5 bg-[#d4af37]/15 border border-[#d4af37]/40 text-[#d4af37] rounded text-[11px] font-bold hover:bg-[#d4af37]/35 transition-all cursor-pointer flex items-center justify-center gap-1"
                                >
                                  <Upload className="w-3 h-3" />
                                  도장 지정
                                </button>
                                <button
                                  onClick={handleTriggerDirectorPasswordChange}
                                  className="px-2 py-1.5 bg-white/5 border border-white/10 text-white/80 rounded text-[11px] font-bold hover:bg-white/10 transition-all cursor-pointer flex items-center justify-center gap-1"
                                >
                                  <Lock className="w-3 h-3" />
                                  암호 지정
                                </button>
                              </div>
                              <input 
                                type="file"
                                ref={directorStampInputRef}
                                onChange={handleDirectorStampUpload}
                                accept="image/*"
                                className="hidden"
                              />
                            </div>
                          </div>

                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Form Canvas (The printable PDF container) */}
              <div className="flex-1 overflow-y-auto p-4 lg:p-8 bg-[#0a0b0d]">
                <fieldset
                  disabled={isFormLocked}
                  className={`max-w-4xl mx-auto bg-[#16181d] border border-white/5 rounded p-6 lg:p-10 shadow-2xl space-y-8 text-[#e1e1e1] ${isFormLocked ? 'opacity-80' : ''}`}
                >
                  
                  {/* PDF Header (Hidden in app, shown only on PDF conversion) */}
                  <div className="pdf-title text-center pb-6 border-b border-[#d4af37]/30 hidden">
                    <h1 className="text-3xl font-serif italic text-[#d4af37] tracking-tight">
                      {activeTab === 'patrol' ? 'DAILY PATROL REPORT' : 'INCIDENT INVESTIGATION REPORT'}
                    </h1>
                    <p className="text-[10px] text-white/40 uppercase tracking-[0.2em] mt-2">도시공사 현장 밀착 안전 관리 시스템</p>
                  </div>

                  {activeTab === 'patrol' ? (
                    /* ------------------ PATROL FORM ------------------ */
                    <div className="space-y-3">
                      <div className="border-b border-white/5 pb-2 flex items-center gap-2">
                        <span className="w-1 h-4 bg-[#d4af37] rounded-sm"></span>
                        <h3 className="text-xs font-mono font-bold text-[#d4af37] uppercase tracking-widest">기본 순찰 정보 / BASIC INFO</h3>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-[11px] uppercase tracking-widest font-mono text-white/40 mb-1.5">보고서 제목 / TITLE</label>
                          <input 
                            type="text" 
                            value={pTitle}
                            onChange={(e) => setPTitle(e.target.value)}
                            placeholder="예: 1공구 오전 육안 점검"
                            className="w-full bg-[#0a0b0d] border border-white/5 text-white p-3 rounded-sm text-sm focus:outline-none focus:border-[#d4af37] transition-colors font-serif"
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[11px] uppercase tracking-widest font-mono text-white/40 mb-1.5">순찰 일시 / DATE</label>
                            <input 
                              type="datetime-local" 
                              value={pDate}
                              onChange={(e) => setPDate(e.target.value)}
                              className="w-full bg-[#0a0b0d] border border-white/5 text-white p-3 rounded-sm text-sm focus:outline-none focus:border-[#d4af37] transition-colors font-mono"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] uppercase tracking-widest font-mono text-white/40 mb-1.5">점검자 / INSPECTOR</label>
                            <input 
                              type="text" 
                              value={pInspector}
                              onChange={(e) => setPInspector(e.target.value)}
                              placeholder="예: 도시공사 안전감리단 / 김감독"
                              className="w-full bg-[#0a0b0d] border border-white/5 text-white p-3 rounded-sm text-sm focus:outline-none focus:border-[#d4af37] transition-colors"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] uppercase tracking-widest font-mono text-white/40 mb-1.5">대상 구역 / AREA</label>
                            <input 
                              type="text" 
                              value={pArea}
                              onChange={(e) => setPArea(e.target.value)}
                              placeholder="예: 1공구 (터파기/골조 구간)"
                              className="w-full bg-[#0a0b0d] border border-white/5 text-white p-3 rounded-sm text-sm focus:outline-none focus:border-[#d4af37] transition-colors"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] uppercase tracking-widest font-mono text-white/40 mb-1.5">진행 상태 / STATUS</label>
                            <select 
                              value={pStatus}
                              onChange={(e) => setPStatus(e.target.value as any)}
                              className="w-full bg-[#0a0b0d] border border-white/5 text-[#d4af37] p-3 rounded-sm text-sm focus:outline-none focus:border-[#d4af37] transition-colors font-mono"
                            >
                              <option value="순찰 진행중">순찰 진행중 (PENDING)</option>
                              <option value="순찰 완료">순찰 완료 (COMPLETED)</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="border-b border-white/5 pb-2 pt-4 flex items-center gap-2">
                        <span className="w-1 h-4 bg-[#d4af37] rounded-sm"></span>
                        <h3 className="text-xs font-mono font-bold text-[#d4af37] uppercase tracking-widest">점검 및 청취 내용 / INSPECTION CONTENT</h3>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-[11px] uppercase tracking-widest font-mono text-white/40 mb-1.5">시설물 육안 점검 결과 / VISUAL AUDIT</label>
                          <textarea 
                            value={pCheck}
                            onChange={(e) => setPCheck(e.target.value)}
                            placeholder="구간별 비계 구조물, 위험 방지망 설치 상태 등을 서술하세요."
                            className="w-full h-32 bg-[#0a0b0d] border border-white/5 text-white p-3 rounded-sm text-sm focus:outline-none focus:border-[#d4af37] transition-colors resize-y leading-relaxed"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] uppercase tracking-widest font-mono text-white/40 mb-1.5">현장 근로자 건의사항 / WORKER VOICE</label>
                          <textarea 
                            value={pVoice}
                            onChange={(e) => setPVoice(e.target.value)}
                            placeholder="현장 작업자의 의견 청취 및 조치 건의 내용을 기재하세요."
                            className="w-full h-24 bg-[#0a0b0d] border border-white/5 text-white p-3 rounded-sm text-sm focus:outline-none focus:border-[#d4af37] transition-colors resize-y leading-relaxed"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* ------------------ INCIDENT FORM ------------------ */
                    <div className="space-y-3">
                      <div className="border-b border-white/5 pb-2 flex items-center gap-2">
                        <span className="w-1 h-4 bg-[#d4af37] rounded-sm"></span>
                        <h3 className="text-xs font-mono font-bold text-[#d4af37] uppercase tracking-widest">사건 개요 / INCIDENT SUMMARY</h3>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-[11px] uppercase tracking-widest font-mono text-white/40 mb-1.5">보고서 제목 / TITLE</label>
                          <input 
                            type="text" 
                            value={iTitle}
                            onChange={(e) => setITitle(e.target.value)}
                            placeholder="예: 3공구 지게차 신호수 미배치 건"
                            className="w-full bg-[#0a0b0d] border border-white/5 text-white p-3 rounded-sm text-sm focus:outline-none focus:border-[#d4af37] transition-colors font-serif"
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[11px] uppercase tracking-widest font-mono text-white/40 mb-1.5">사건 관리 번호 / REPORT ID</label>
                            <input 
                              type="text" 
                              value={iReportId}
                              readOnly
                              className="w-full bg-[#0f1115] border border-white/5 text-white/40 p-3 rounded-sm text-sm cursor-not-allowed font-mono"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] uppercase tracking-widest font-mono text-white/40 mb-1.5">발생 일시 / INCIDENT DATE</label>
                            <input 
                              type="datetime-local" 
                              value={iDate}
                              onChange={(e) => setIDate(e.target.value)}
                              className="w-full bg-[#0a0b0d] border border-white/5 text-white p-3 rounded-sm text-sm focus:outline-none focus:border-[#d4af37] transition-colors font-mono"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] uppercase tracking-widest font-mono text-white/40 mb-1.5">발생 위치 / LOCATION</label>
                            <input 
                              type="text" 
                              value={iLocation}
                              onChange={(e) => setILocation(e.target.value)}
                              placeholder="예: 3공구 하역구역 야적장"
                              className="w-full bg-[#0a0b0d] border border-white/5 text-white p-3 rounded-sm text-sm focus:outline-none focus:border-[#d4af37] transition-colors"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] uppercase tracking-widest font-mono text-white/40 mb-1.5">조치 수준 / ACTION LEVEL</label>
                            <select 
                              value={iStatus}
                              onChange={(e) => setIStatus(e.target.value as any)}
                              className="w-full bg-[#0a0b0d] border border-white/5 text-[#d4af37] font-bold p-3 rounded-sm text-sm focus:outline-none focus:border-[#d4af37] transition-colors font-mono"
                            >
                              <option value="작업 중지">작업 중지 (STOP WORK - RED)</option>
                              <option value="시정 조치">즉각 시정 명령 (CORRECTION - YELLOW)</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="border-b border-white/5 pb-2 pt-4 flex items-center gap-2">
                        <span className="w-1 h-4 bg-[#d4af37] rounded-sm"></span>
                        <h3 className="text-xs font-mono font-bold text-[#d4af37] uppercase tracking-widest">사건 내용 및 조치 / INCIDENT & MEASURES</h3>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-[11px] uppercase tracking-widest font-mono text-white/40 mb-1.5">사건 상황 설명 / STATUS DESCRIPTION</label>
                          <textarea 
                            value={iDesc}
                            onChange={(e) => setIDesc(e.target.value)}
                            placeholder="발생 경위 및 안전 지침 위반 사항을 상세히 기술하세요."
                            className="w-full h-32 bg-[#0a0b0d] border border-white/5 text-white p-3 rounded-sm text-sm focus:outline-none focus:border-[#d4af37] transition-colors resize-y leading-relaxed"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] uppercase tracking-widest font-mono text-white/40 mb-1.5">현장 조치 결과 / FIELD ACTIONS TAKEN</label>
                          <textarea 
                            value={iAction}
                            onChange={(e) => setIAction(e.target.value)}
                            placeholder="적발 후 현장에서 취한 시정 지시 혹은 통제 사항을 서술하세요."
                            className="w-full h-24 bg-[#0a0b0d] border border-white/5 text-white p-3 rounded-sm text-sm focus:outline-none focus:border-[#d4af37] transition-colors resize-y leading-relaxed"
                          />
                        </div>
                      </div>

                      <div className="border-b border-white/5 pb-2 pt-4 flex items-center gap-2">
                        <span className="w-1 h-4 bg-[#d4af37] rounded-sm"></span>
                        <h3 className="text-xs font-mono font-bold text-[#d4af37] uppercase tracking-widest">현장 사건 사진 첨부 / PHOTO EVIDENCE</h3>
                      </div>

                      {/* Image Attachment (Interactive) */}
                      <div 
                        onClick={() => { if (!isFormLocked) fileInputRef.current?.click(); }}
                        className="group relative w-full h-[320px] bg-[#0a0b0d] border border-dashed border-white/10 hover:border-[#d4af37] text-white/40 hover:text-[#d4af37] rounded flex flex-col items-center justify-center cursor-pointer transition-all duration-300 overflow-hidden"
                      >
                        {iImage ? (
                          <>
                            <img 
                              src={iImage} 
                              alt="현장 안전 위반 사진" 
                              className="absolute inset-0 w-full h-full object-contain bg-[#0a0b0d] z-10"
                            />
                            <button 
                              type="button"
                              onClick={handleRemoveImage}
                              className="absolute top-4 right-4 bg-red-500 hover:bg-red-600 text-white font-bold text-[10px] tracking-wider uppercase py-1.5 px-3 rounded-sm shadow-md z-20 transition-transform hover:scale-105 cursor-pointer"
                              data-html2canvas-ignore="true"
                            >
                              사진 삭제 / REMOVE
                            </button>
                          </>
                        ) : (
                          <div className="flex flex-col items-center gap-3 text-center p-4">
                            <ImageIcon className="w-8 h-8 text-white/20 group-hover:text-[#d4af37] transition-colors" />
                            <p className="text-xs font-semibold tracking-wider">여기를 클릭하여 현장 사진을 첨부하세요 (PC / 모바일 지원)</p>
                            <p className="text-[10px] text-white/20 uppercase tracking-widest">TAP TO ATTACH IMAGE EVIDENCE</p>
                          </div>
                        )}
                      </div>
                      
                      <input 
                        type="file" 
                        ref={fileInputRef}
                        onChange={handleImageUpload}
                        accept="image/*"
                        className="hidden"
                      />
                    </div>
                  )}
                </fieldset>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* PDF Print Preview Modal */}
      {showPdfPreview && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4 modal-overlay-to-hide">
          <div className="bg-[#0f1115] border border-white/10 w-full max-w-4xl rounded shadow-2xl flex flex-col h-[90vh] min-h-[420px] overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-[#e1e1e1]">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-[#13151b] shrink-0">
              <div>
                <h3 className="text-sm font-bold text-[#d4af37] flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  안전 관리 보고서 출력 미리보기
                </h3>
                <p className="text-[10px] text-white/50 mt-1">가로·세로 자동 맞춤으로 시작합니다. 문서는 드래그로 이동하고 휠로 확대·축소할 수 있습니다.</p>
              </div>
              <div className="ml-auto mr-3 hidden sm:flex items-center gap-1 rounded border border-white/10 bg-black/15 p-1">
                <button
                  type="button"
                  onClick={() => fitPreviewPaper('horizontal')}
                  title="문서 폭을 화면 폭에 맞춥니다"
                  className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded transition-colors cursor-pointer ${previewFitMode === 'horizontal' ? 'bg-[#d4af37] text-[#0a0b0d] font-bold' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}
                >
                  <ArrowLeftRight className="w-3 h-3" />
                  수평 맞춤
                </button>
                <button
                  type="button"
                  onClick={() => fitPreviewPaper('vertical')}
                  title="문서 높이를 화면 높이에 맞춥니다"
                  className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded transition-colors cursor-pointer ${previewFitMode === 'vertical' ? 'bg-[#d4af37] text-[#0a0b0d] font-bold' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}
                >
                  <ArrowUpDown className="w-3 h-3" />
                  수직 맞춤
                </button>
              </div>
              <button 
                onClick={handleClosePreview}
                className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Preview workspace: the paper keeps its real A4 size, while the stage reserves
                the scaled size. This prevents the signature block from being clipped. */}
            <div
              ref={previewViewportRef}
              className={`flex-1 min-h-0 relative bg-[#0a0b0d] overflow-hidden touch-none ${previewDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
              onWheel={handlePreviewWheel}
              onPointerDown={handlePreviewPointerDown}
              onPointerMove={handlePreviewPointerMove}
              onPointerUp={stopPreviewDragging}
              onPointerCancel={stopPreviewDragging}
              aria-label="보고서 미리보기 작업 영역"
            >
              <div
                className="absolute"
                style={{
                  left: `${previewOffset.x}px`,
                  top: `${previewOffset.y}px`,
                  width: `${previewPaperSize.width * previewScale}px`,
                  height: `${previewPaperSize.height * previewScale}px`,
                }}
              >
                <div
                  className="bg-white rounded-sm shadow-2xl"
                  style={{
                    width: '210mm',
                    transform: `scale(${previewScale})`,
                    transformOrigin: 'top left',
                  }}
                >
                  {renderPrintTemplate(printPreviewRef)}
                </div>
              </div>
            </div>
            
            {/* Modal Footer: Printing & Close Actions */}
            <div className="px-6 py-4 border-t border-white/5 bg-[#13151b] flex justify-between items-center flex-wrap gap-3 shrink-0">
              <span className="text-[10px] text-[#d4af37]/60 font-mono tracking-wider">
                💡 실제 인쇄 장치로 출력하거나 PDF 로컬 파일로 즉시 다운로드할 수 있습니다.
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    window.print();
                  }}
                  className="flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold text-[#0a0b0d] bg-[#d4af37] rounded-sm hover:brightness-110 transition-all cursor-pointer font-sans"
                >
                  <Printer className="w-4 h-4" />
                  인쇄하기 (Print)
                </button>
                <button
                  onClick={() => {
                    handleExportPDF('download');
                  }}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold text-[#e1e1e1] bg-white/5 border border-white/10 rounded-sm hover:bg-white/10 transition-all cursor-pointer font-sans"
                >
                  <Download className="w-4 h-4 text-[#d4af37]" />
                  파일로 저장 (PDF)
                </button>
                <button
                  onClick={handleClosePreview}
                  className="px-4 py-2.5 text-xs font-bold text-white/60 bg-transparent border border-white/5 rounded-sm hover:bg-white/5 hover:text-white transition-all cursor-pointer font-sans"
                >
                  닫기
                </button>
              </div>
            </div>
            
          </div>
        </div>
      )}
      </div>

      {/* A4 export target: kept off-screen so PDF output matches the preview, while print CSS makes it visible. */}
      <div id="print-area-container" className="fixed top-0 left-[-100000px] w-[210mm] pointer-events-none" aria-hidden="true">
        {renderPrintTemplate(printTemplateRef)}
      </div>

      {/* Custom Alert/Confirm Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-[#13151b] border border-[#d4af37]/40 rounded shadow-2xl max-w-sm w-full overflow-hidden text-left animate-in fade-in zoom-in duration-150">
            <div className="px-5 py-4 border-b border-white/5 bg-[#1a1d24] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#d4af37]" />
              <h3 className="text-sm font-bold text-[#d4af37] font-mono tracking-wide">{modalTitle}</h3>
            </div>
            <div className="p-5">
              <p className="text-xs text-white/80 whitespace-pre-wrap leading-relaxed font-sans">{modalMessage}</p>
            </div>
            <div className="px-5 py-3 border-t border-white/5 bg-[#1a1d24] flex justify-end gap-2">
              {modalType === 'confirm' ? (
                <>
                  <button
                    onClick={() => {
                      setModalOpen(false);
                    }}
                    className="px-3.5 py-1.5 text-xs font-bold text-white/60 bg-transparent border border-white/10 rounded-sm hover:bg-white/5 hover:text-white transition-all cursor-pointer font-sans"
                  >
                    취소 (Cancel)
                  </button>
                  <button
                    onClick={() => {
                      setModalOpen(false);
                      if (modalConfirmCallback) modalConfirmCallback();
                    }}
                    className="px-3.5 py-1.5 text-xs font-bold text-[#0a0b0d] bg-[#d4af37] rounded-sm hover:brightness-110 transition-all cursor-pointer font-sans"
                  >
                    확인 (Confirm)
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setModalOpen(false);
                  }}
                  className="px-4 py-1.5 text-xs font-bold text-[#0a0b0d] bg-[#d4af37] rounded-sm hover:brightness-110 transition-all cursor-pointer font-sans"
                >
                  확인 (OK)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Password Verification Dialog Modal */}
      {passModalOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[120] p-4">
          <div className="bg-[#13151b] border border-[#d4af37]/40 rounded shadow-2xl max-w-sm w-full overflow-hidden text-left animate-in fade-in zoom-in duration-150">
            <div className="px-5 py-4 border-b border-white/5 bg-[#1a1d24] flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#d4af37]" />
              <h3 className="text-xs font-bold text-[#d4af37] font-mono tracking-wide uppercase">{passModalTitle}</h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-white/80 leading-relaxed font-sans whitespace-pre-line">{passModalMessage}</p>
              <div>
                <input
                  type="password"
                  placeholder={passInputPlaceholder || "암호 입력"}
                  value={passInputValue}
                  onChange={(e) => {
                    setPassInputValue(e.target.value);
                    setPassModalError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handlePassModalSubmit();
                    }
                  }}
                  className="w-full bg-[#0a0b0d] border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#d4af37] font-mono"
                  autoFocus
                />
                {passModalError && (
                  <p className="text-red-400 text-[10px] mt-1.5 font-mono">{passModalError}</p>
                )}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-white/5 bg-[#1a1d24] flex justify-end gap-2">
              <button
                onClick={() => {
                  setPassModalOpen(false);
                  setPassInputValue("");
                  setPassModalError("");
                }}
                className="px-3 py-1.5 text-xs font-bold text-white/60 bg-transparent border border-white/10 rounded-sm hover:bg-white/5 hover:text-white transition-all cursor-pointer font-sans"
              >
                취소 (Cancel)
              </button>
              <button
                onClick={handlePassModalSubmit}
                className="px-4 py-1.5 text-xs font-bold text-[#0a0b0d] bg-[#d4af37] rounded-sm hover:brightness-110 transition-all cursor-pointer font-sans"
              >
                확인 (Confirm)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approval Status & Management Modal */}
      {approveModalOpen && (() => {
        const currentReport = reports.find((report) => report.id === selectedId);
        if (!currentReport) return null;

        const status = getApprovalStatus(currentReport);
        const isFinal = status === 'final_approved';
        const isVoided = status === 'voided';
        const inspectorDone = status === 'inspector_approved' || isFinal || isVoided;
        const directorDone = isFinal || isVoided;

        return (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
            <div className="bg-[#101216] border border-white/10 rounded-sm shadow-2xl max-w-lg w-full overflow-hidden text-left animate-in fade-in zoom-in-95 duration-200">
              <div className="px-6 py-4 border-b border-white/5 bg-[#16181d] flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-sky-400" />
                  <div>
                    <h3 className="text-sm font-bold text-white font-serif">보고서 결재 현황</h3>
                    <p className="text-[10px] text-white/40 font-mono tracking-wider">REQUEST → INSPECTOR → DIRECTOR FINAL APPROVAL</p>
                  </div>
                </div>
                <button onClick={() => setApproveModalOpen(false)} className="p-1 text-white/40 hover:text-white rounded hover:bg-white/5">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div className="bg-[#0a0b0d] p-4 rounded border border-white/5 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-[10px] text-[#d4af37] font-mono tracking-wider uppercase font-bold">대상 보고서</span>
                      <h4 className="text-sm font-bold text-white font-serif mt-1">{currentReport.title}</h4>
                    </div>
                    <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-sm ${approvalStatusClass(status)}`}>
                      {approvalStatusLabel(status)}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/40">일시: {currentReport.date?.replace('T', ' ')} | 업무상태: {currentReport.status}</p>
                  {status === 'rejected' && currentReport.rejectionReason && (
                    <div className="mt-2 border-l-2 border-rose-400 bg-rose-500/5 px-3 py-2 text-[11px] text-rose-200">
                      <strong>{currentReport.rejectionRole === 'director' ? '감리단장' : '안전감독관'} 반려 사유:</strong> {currentReport.rejectionReason}
                    </div>
                  )}
                  {status === 'voided' && currentReport.voidReason && (
                    <div className="mt-2 border-l-2 border-orange-400 bg-orange-500/5 px-3 py-2 text-[11px] text-orange-200">
                      <strong>무효 처리 사유:</strong> {currentReport.voidReason}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="border border-white/5 rounded p-4 bg-[#16181d] flex flex-col items-center text-center space-y-3">
                    <span className="text-[10px] font-bold text-white/50 tracking-wider">1. 안전감독관</span>
                    <div className="w-24 h-24 bg-white rounded-full border border-gray-300 flex items-center justify-center relative overflow-hidden p-1 shadow-inner">
                      {inspectorDone && currentReport.inspectorApproved && inspectorStamp ? (
                        <img src={inspectorStamp} alt="안전감독관 도장" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <div className="text-[11px] text-gray-400 font-sans italic">{status === 'requested' ? '결재 대기' : status === 'rejected' ? '반려됨' : '서명 미승인'}</div>
                      )}
                    </div>
                    {status === 'requested' ? (
                      <div className="w-full grid grid-cols-2 gap-2">
                        <button onClick={() => handleSetApprovalStatus('inspector')} className="py-1.5 text-[11px] font-bold bg-sky-600 text-white rounded hover:bg-sky-500">결재 승인</button>
                        <button onClick={() => handleRejectClick('inspector')} className="py-1.5 text-[11px] font-bold bg-rose-500/10 text-rose-300 border border-rose-500/25 rounded hover:bg-rose-500/20">반려</button>
                      </div>
                    ) : (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-sm ${inspectorDone ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-white/5 text-white/35 border border-white/10'}`}>
                        {inspectorDone ? '● 결재 완료' : '○ 결재 대기'}
                      </span>
                    )}
                  </div>

                  <div className="border border-white/5 rounded p-4 bg-[#16181d] flex flex-col items-center text-center space-y-3">
                    <span className="text-[10px] font-bold text-white/50 tracking-wider">2. 감리단장</span>
                    <div className="w-24 h-24 bg-white rounded-full border border-gray-300 flex items-center justify-center relative overflow-hidden p-1 shadow-inner">
                      {directorDone && currentReport.directorApproved && directorStamp ? (
                        <img src={directorStamp} alt="감리단장 도장" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <div className="text-[11px] text-gray-400 font-sans italic">{status === 'inspector_approved' ? '최종 결재 대기' : isVoided ? '문서 무효' : '서명 미승인'}</div>
                      )}
                    </div>
                    {status === 'inspector_approved' ? (
                      <div className="w-full grid grid-cols-2 gap-2">
                        <button onClick={() => handleSetApprovalStatus('director')} className="py-1.5 text-[11px] font-bold bg-sky-600 text-white rounded hover:bg-sky-500">최종 결재</button>
                        <button onClick={() => handleRejectClick('director')} className="py-1.5 text-[11px] font-bold bg-rose-500/10 text-rose-300 border border-rose-500/25 rounded hover:bg-rose-500/20">반려</button>
                      </div>
                    ) : (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-sm ${directorDone ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-white/5 text-white/35 border border-white/10'}`}>
                        {directorDone ? '● 최종 결재 완료' : '○ 결재 대기'}
                      </span>
                    )}
                  </div>
                </div>

                {isFinal && (
                  <div className="space-y-3">
                    <div className="text-[11px] text-emerald-300 font-bold bg-emerald-500/10 py-2.5 px-3 rounded border border-emerald-500/20">
                      최종 결재가 완료되었습니다. 이 문서는 수정·삭제·결재 취소할 수 없습니다.
                    </div>
                    <button onClick={handleVoidClick} className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-bold bg-orange-500/10 text-orange-300 border border-orange-500/25 rounded hover:bg-orange-500/20">
                      <Ban className="w-3.5 h-3.5" /> 관리자 문서 무효 처리
                    </button>
                  </div>
                )}

                {isVoided && (
                  <div className="space-y-3">
                    <div className="text-[11px] text-orange-200 bg-orange-500/10 py-2.5 px-3 rounded border border-orange-500/20">
                      무효 처리된 원본은 기록 보존용으로 유지됩니다. 변경이 필요하면 정정본을 새로 작성해 결재를 진행합니다.
                    </div>
                    <button onClick={handleCreateCorrectedCopy} className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-bold bg-sky-600 text-white rounded hover:bg-sky-500">
                      <FilePlus2 className="w-3.5 h-3.5" /> 정정본 초안 작성
                    </button>
                  </div>
                )}

                {status === 'rejected' && (
                  <div className="text-[11px] text-rose-200 bg-rose-500/10 py-2.5 px-3 rounded border border-rose-500/20">
                    반려 문서는 작성자가 수정한 뒤 상단의 <strong>수정 후 재결재 요청</strong>으로 다시 결재를 진행합니다.
                  </div>
                )}
              </div>

              <div className="px-6 py-3 border-t border-white/5 bg-[#16181d] flex justify-end">
                <button onClick={() => setApproveModalOpen(false)} className="px-4 py-1.5 text-xs font-bold text-white bg-white/5 border border-white/10 rounded hover:bg-white/10">
                  닫기 (Close)
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Rejection / void reason modal */}
      {reasonModalOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-[120] p-4">
          <div className="bg-[#13151b] border border-[#d4af37]/40 rounded shadow-2xl max-w-md w-full overflow-hidden text-left">
            <div className="px-5 py-4 border-b border-white/5 bg-[#1a1d24] flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-[#d4af37]" />
              <h3 className="text-sm font-bold text-[#d4af37] font-mono tracking-wide">
                {reasonModalMode === 'reject' ? '보고서 반려 사유' : '최종 결재 문서 무효 처리 사유'}
              </h3>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-white/70 leading-relaxed">
                {reasonModalMode === 'reject'
                  ? '작성자가 수정·재결재할 수 있도록 구체적인 반려 사유를 입력해주십시오.'
                  : '원본은 삭제되지 않고 무효 처리 상태로 보존됩니다. 정정본 작성에 필요한 사유를 입력해주십시오.'}
              </p>
              <textarea
                value={reasonValue}
                onChange={(event) => setReasonValue(event.target.value)}
                placeholder={reasonModalMode === 'reject' ? '예: 현장 사진의 촬영 위치와 조치 내용 보완 필요' : '예: 잘못된 대상 구역으로 최종 결재되어 정정본 재작성 필요'}
                className="w-full h-28 bg-[#0a0b0d] border border-white/10 rounded p-3 text-sm text-white focus:outline-none focus:border-[#d4af37] resize-y"
                autoFocus
              />
              {reasonModalError && <p className="text-[11px] text-rose-300">{reasonModalError}</p>}
            </div>
            <div className="px-5 py-3 border-t border-white/5 bg-[#1a1d24] flex justify-end gap-2">
              <button onClick={() => setReasonModalOpen(false)} className="px-3.5 py-1.5 text-xs font-bold text-white/60 border border-white/10 rounded hover:bg-white/5">취소</button>
              <button onClick={handleReasonModalSubmit} className="px-3.5 py-1.5 text-xs font-bold text-[#0a0b0d] bg-[#d4af37] rounded hover:brightness-110">
                {reasonModalMode === 'reject' ? '반려 처리' : '무효 처리'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
