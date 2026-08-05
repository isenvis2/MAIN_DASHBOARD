export type ReportType = 'patrol' | 'incident';

/**
 * Approval workflow:
 * draft → requested → inspector_approved → final_approved
 *               ↘ rejected → (author edits) → requested
 * final_approved → voided (administrator only; record is preserved)
 */
export type ApprovalStatus =
  | 'draft'
  | 'requested'
  | 'inspector_approved'
  | 'rejected'
  | 'final_approved'
  | 'voided';

export type ApprovalRole = 'inspector' | 'director';

export interface ApprovalFields {
  approvalStatus?: ApprovalStatus;
  approvalRequestedAt?: string;
  inspectorApproved?: boolean;
  inspectorApprovedAt?: string;
  directorApproved?: boolean;
  directorApprovedAt?: string;
  rejectionRole?: ApprovalRole;
  rejectionReason?: string;
  rejectedAt?: string;
  voidedAt?: string;
  voidReason?: string;
  correctionOf?: string;
}

export interface PatrolReport extends ApprovalFields {
  id: string;
  type: 'patrol';
  title: string;
  date: string;
  inspector: string;
  area: string;
  status: '순찰 진행중' | '순찰 완료';
  check: string;
  voice: string;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentReport extends ApprovalFields {
  id: string;
  type: 'incident';
  title: string;
  reportId: string;
  date: string;
  location: string;
  status: '작업 중지' | '시정 조치';
  desc: string;
  action: string;
  image: string | null; // Base64 or URL
  createdAt: string;
  updatedAt: string;
}

export type Report = PatrolReport | IncidentReport;
