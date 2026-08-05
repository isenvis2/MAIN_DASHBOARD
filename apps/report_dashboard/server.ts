import express from "express";
import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import type { ApprovalRole, ApprovalStatus, Report } from "./src/types";

type ReportDashboardConfig = {
  service: {
    host: string;
    port: number;
  };
  storage: {
    databaseFile: string;
  };
  http: {
    requestBodyLimit: string;
  };
};

const PROJECT_ROOT = process.cwd();
dotenv.config({ path: path.resolve(PROJECT_ROOT, ".env") });

const CONFIG_FILE = path.resolve(PROJECT_ROOT, "config", "report_dashboard.json");
const IS_DEVELOPMENT = process.argv.includes("--dev");
const config = loadReportDashboardConfig();
const app = express();
const PORT = config.service.port;
const HOST = config.service.host;
const DB_FILE = resolveConfigRelativePath(config.storage.databaseFile);
const BODY_LIMIT = config.http.requestBodyLimit;
let writeQueue: Promise<void> = Promise.resolve();

// 결재/무효처리 암호(비밀 값)는 config JSON이 아니라 apps/report_dashboard/.env에서만 읽습니다.
// .env에 값이 없으면 기존 프론트엔드 기본값과 동일한 값으로 폴백하되 경고를 남깁니다.
const DEFAULT_PASSWORDS = { admin: "raon1234", inspector: "1111", director: "2222" } as const;
const PASSWORDS = {
  admin: process.env.REPORT_ADMIN_PASSWORD || DEFAULT_PASSWORDS.admin,
  inspector: process.env.REPORT_INSPECTOR_PASSWORD || DEFAULT_PASSWORDS.inspector,
  director: process.env.REPORT_DIRECTOR_PASSWORD || DEFAULT_PASSWORDS.director,
};
if (!process.env.REPORT_ADMIN_PASSWORD || !process.env.REPORT_INSPECTOR_PASSWORD || !process.env.REPORT_DIRECTOR_PASSWORD) {
  console.warn(
    "[CONFIG] REPORT_ADMIN_PASSWORD / REPORT_INSPECTOR_PASSWORD / REPORT_DIRECTOR_PASSWORD is not set in apps/report_dashboard/.env - falling back to default passwords. Set real values before production use."
  );
}

function checkPassword(expected: string, provided: unknown): boolean {
  return typeof provided === "string" && provided.length > 0 && provided === expected;
}

type AuthRole = "admin" | "inspector" | "director";
function isAuthRole(value: unknown): value is AuthRole {
  return value === "admin" || value === "inspector" || value === "director";
}

function parsePort(value: unknown, fieldName: string): number {
  const port = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
    throw new Error(`${fieldName} must be an integer between 1 and 65535.`);
  }
  return port;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function loadReportDashboardConfig(): ReportDashboardConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fsSync.readFileSync(CONFIG_FILE, "utf-8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read Report Dashboard configuration (${CONFIG_FILE}): ${detail}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Report Dashboard configuration must be a JSON object: ${CONFIG_FILE}`);
  }

  const raw = parsed as Record<string, unknown>;
  const service = raw.service as Record<string, unknown> | undefined;
  const storage = raw.storage as Record<string, unknown> | undefined;
  const http = raw.http as Record<string, unknown> | undefined;

  if (!service || !storage || !http) {
    throw new Error(`Report Dashboard configuration requires service, storage, and http sections: ${CONFIG_FILE}`);
  }

  const requestBodyLimit = requireNonEmptyString(http.requestBodyLimit, "http.requestBodyLimit");
  if (!/^\d+(?:b|kb|mb|gb)$/i.test(requestBodyLimit)) {
    throw new Error("http.requestBodyLimit must use a byte unit such as 15mb.");
  }

  return {
    service: {
      host: requireNonEmptyString(service.host, "service.host"),
      port: parsePort(service.port, "service.port"),
    },
    storage: {
      databaseFile: requireNonEmptyString(storage.databaseFile, "storage.databaseFile"),
    },
    http: {
      requestBodyLimit,
    },
  };
}

function resolveConfigRelativePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(path.dirname(CONFIG_FILE), value);
}

function timestampForFileName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function now(): string {
  return new Date().toISOString();
}

function inferApprovalStatus(report: Report): ApprovalStatus {
  if (report.approvalStatus) return report.approvalStatus;
  if (report.directorApproved) return "final_approved";
  if (report.inspectorApproved) return "inspector_approved";
  return "draft";
}

function normalizeReport(report: Report): Report {
  const approvalStatus = inferApprovalStatus(report);
  return {
    ...report,
    approvalStatus,
    // A voided record preserves the original final approval evidence for audit/print review.
    inspectorApproved: approvalStatus === "inspector_approved" || approvalStatus === "final_approved" || (approvalStatus === "voided" && !!report.inspectorApproved),
    directorApproved: approvalStatus === "final_approved" || (approvalStatus === "voided" && !!report.directorApproved),
  } as Report;
}

function normalizeReports(reports: Report[]): Report[] {
  return reports.map(normalizeReport);
}

function isEditable(status: ApprovalStatus): boolean {
  return status === "draft" || status === "rejected";
}

function isDeletable(status: ApprovalStatus): boolean {
  // Submission starts the audit trail. Only never-submitted drafts may be removed.
  return status === "draft";
}

function canRequest(status: ApprovalStatus): boolean {
  return status === "draft" || status === "rejected";
}

function createReportId(): string {
  return `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function writeReports(reports: Report[]): Promise<void> {
  const tempFile = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
  const serialized = `${JSON.stringify(reports, null, 2)}\n`;

  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
    await fs.writeFile(tempFile, serialized, "utf-8");
    await fs.rename(tempFile, DB_FILE);
  });

  return writeQueue;
}

async function recoverDatabase(raw: string, reason: string): Promise<Report[]> {
  const trimmed = raw.trim();
  if (trimmed) {
    const backupPath = `${DB_FILE}.invalid-${timestampForFileName()}.json`;
    await fs.writeFile(backupPath, raw, "utf-8");
    console.warn(`Invalid report database was backed up to: ${backupPath} (${reason})`);
  } else {
    console.warn(`Empty report database was reinitialized (${reason})`);
  }

  const reports: Report[] = [];
  await writeReports(reports);
  return reports;
}

async function readReports(): Promise<Report[]> {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });

  let raw: string;
  try {
    raw = await fs.readFile(DB_FILE, "utf-8");
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      const reports: Report[] = [];
      await writeReports(reports);
      return reports;
    }
    throw error;
  }

  if (!raw.trim()) {
    return recoverDatabase(raw, "empty file");
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return recoverDatabase(raw, "root value is not an array");
    }
    return normalizeReports(parsed as Report[]);
  } catch {
    return recoverDatabase(raw, "invalid JSON");
  }
}

async function initDb(): Promise<void> {
  await readReports();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sendServerError(res: express.Response, action: string, error: unknown): void {
  console.error(`${action}:`, error);
  res.status(500).json({ error: `${action} failed`, detail: getErrorMessage(error) });
}

function getReportOr404(reports: Report[], id: string, res: express.Response): { report: Report; index: number } | null {
  const index = reports.findIndex((report) => report.id === id);
  if (index === -1) {
    res.status(404).json({ error: "Report not found" });
    return null;
  }
  return { report: reports[index], index };
}

function rejectInvalidAction(res: express.Response, message: string): void {
  res.status(409).json({ error: message });
}

function pickEditableDocumentFields(incoming: Partial<Report>, current: Report): Report {
  const base: Record<string, unknown> = { ...current };
  const blockedKeys = new Set([
    "id", "type", "createdAt", "updatedAt",
    "approvalStatus", "approvalRequestedAt",
    "inspectorApproved", "inspectorApprovedAt",
    "directorApproved", "directorApprovedAt",
    "rejectionRole", "rejectionReason", "rejectedAt",
    "voidedAt", "voidReason", "correctionOf",
  ]);

  for (const [key, value] of Object.entries(incoming)) {
    if (!blockedKeys.has(key)) base[key] = value;
  }

  return {
    ...(base as unknown as Report),
    id: current.id,
    type: current.type,
    createdAt: current.createdAt,
    updatedAt: now(),
    approvalStatus: current.approvalStatus,
    inspectorApproved: current.inspectorApproved,
    inspectorApprovedAt: current.inspectorApprovedAt,
    directorApproved: current.directorApproved,
    directorApprovedAt: current.directorApprovedAt,
    approvalRequestedAt: current.approvalRequestedAt,
    rejectionRole: current.rejectionRole,
    rejectionReason: current.rejectionReason,
    rejectedAt: current.rejectedAt,
    voidedAt: current.voidedAt,
    voidReason: current.voidReason,
    correctionOf: current.correctionOf,
  } as Report;
}

function clearApprovalData(report: Report): Report {
  const { inspectorApprovedAt, directorApprovedAt, approvalRequestedAt, rejectionRole, rejectionReason, rejectedAt, ...rest } = report;
  void inspectorApprovedAt;
  void directorApprovedAt;
  void approvalRequestedAt;
  void rejectionRole;
  void rejectionReason;
  void rejectedAt;
  return {
    ...rest,
    inspectorApproved: false,
    directorApproved: false,
  } as Report;
}

app.disable("x-powered-by");
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ limit: BODY_LIMIT, extended: true }));

app.get("/api/health", async (_req, res) => {
  try {
    const reports = await readReports();
    const counts = reports.reduce<Record<string, number>>((acc, report) => {
      const status = inferApprovalStatus(report);
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    }, {});
    res.set("Cache-Control", "no-store").json({
      ok: true,
      service: "report-dashboard",
      database: "ready",
      reportCount: reports.length,
      approvalCounts: counts,
      now: now(),
    });
  } catch (error) {
    sendServerError(res, "Health check", error);
  }
});

app.get("/api/reports", async (_req, res) => {
  try {
    const reports = await readReports();
    res.set("Cache-Control", "no-store").json(reports);
  } catch (error) {
    sendServerError(res, "Read reports", error);
  }
});

app.post("/api/auth/verify-password", (req, res) => {
  const role = req.body?.role;
  if (!isAuthRole(role)) {
    res.status(400).json({ error: "A valid role is required" });
    return;
  }
  const ok = checkPassword(PASSWORDS[role], req.body?.password);
  res.status(ok ? 200 : 401).json({ ok });
});

// 관리자 암호 확인 후 안전감독관/감리단장 결재 암호를 바꿉니다.
// 재시작 전까지만 유지되는 메모리 상 변경이며, 영구 반영하려면 apps/report_dashboard/.env를 직접 수정하세요.
app.post("/api/auth/change-password", (req, res) => {
  if (!checkPassword(PASSWORDS.admin, req.body?.adminPassword)) {
    res.status(401).json({ error: "관리자 암호가 일치하지 않습니다." });
    return;
  }

  const role = req.body?.role;
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword.trim() : "";
  if ((role !== "inspector" && role !== "director") || !newPassword) {
    res.status(400).json({ error: "역할과 새 암호를 입력해야 합니다." });
    return;
  }

  PASSWORDS[role] = newPassword;
  console.log(`[CONFIG] ${role} approval password changed via admin UI (in-memory only, resets on restart to .env value).`);
  res.json({ ok: true });
});

app.post("/api/reports", async (req, res) => {
  try {
    const incoming = req.body as Partial<Report>;
    if (!incoming || (incoming.type !== "patrol" && incoming.type !== "incident")) {
      res.status(400).json({ error: "A valid report type is required" });
      return;
    }

    const reports = await readReports();
    const createdAt = now();
    const reportToSave: Report = {
      ...(incoming as Report),
      id: createReportId(),
      createdAt,
      updatedAt: createdAt,
      approvalStatus: "draft",
      inspectorApproved: false,
      directorApproved: false,
    };

    reports.unshift(reportToSave);
    await writeReports(reports);
    res.status(201).json(reportToSave);
  } catch (error) {
    sendServerError(res, "Create report", error);
  }
});

app.put("/api/reports/:id", async (req, res) => {
  try {
    const reports = await readReports();
    const found = getReportOr404(reports, req.params.id, res);
    if (!found) return;

    const current = normalizeReport(found.report);
    const status = inferApprovalStatus(current);
    if (!isEditable(status)) {
      rejectInvalidAction(res, "결재 요청 이후의 문서는 수정할 수 없습니다. 반려된 문서만 수정 후 재결재할 수 있습니다.");
      return;
    }

    const incoming = req.body as Partial<Report>;
    if (incoming.type && incoming.type !== current.type) {
      res.status(400).json({ error: "Report type cannot be changed" });
      return;
    }

    const candidate = pickEditableDocumentFields(incoming, current);
    reports[found.index] = candidate;
    await writeReports(reports);
    res.json(candidate);
  } catch (error) {
    sendServerError(res, "Update report", error);
  }
});

app.post("/api/reports/:id/request", async (req, res) => {
  try {
    const reports = await readReports();
    const found = getReportOr404(reports, req.params.id, res);
    if (!found) return;

    const current = normalizeReport(found.report);
    const status = inferApprovalStatus(current);
    if (!canRequest(status)) {
      rejectInvalidAction(res, "결재 요청은 작성 중 또는 반려된 문서에서만 할 수 있습니다.");
      return;
    }

    const requestedAt = now();
    const requested = {
      ...clearApprovalData(current),
      approvalStatus: "requested" as const,
      approvalRequestedAt: requestedAt,
      updatedAt: requestedAt,
    } as Report;

    reports[found.index] = requested;
    await writeReports(reports);
    res.json(requested);
  } catch (error) {
    sendServerError(res, "Request approval", error);
  }
});

app.post("/api/reports/:id/approve", async (req, res) => {
  try {
    const role = (req.body?.role ?? "") as ApprovalRole;
    if (role !== "inspector" && role !== "director") {
      res.status(400).json({ error: "A valid approval role is required" });
      return;
    }
    if (!checkPassword(PASSWORDS[role], req.body?.password)) {
      res.status(401).json({ error: "결재 암호가 일치하지 않습니다." });
      return;
    }

    const reports = await readReports();
    const found = getReportOr404(reports, req.params.id, res);
    if (!found) return;

    const current = normalizeReport(found.report);
    const status = inferApprovalStatus(current);
    const approvedAt = now();
    let approved: Report;

    if (role === "inspector") {
      if (status !== "requested") {
        rejectInvalidAction(res, "안전감독관 결재는 결재 요청 상태의 문서에서만 할 수 있습니다.");
        return;
      }
      approved = {
        ...current,
        approvalStatus: "inspector_approved",
        inspectorApproved: true,
        inspectorApprovedAt: approvedAt,
        directorApproved: false,
        updatedAt: approvedAt,
      } as Report;
    } else {
      if (status !== "inspector_approved") {
        rejectInvalidAction(res, "감리단장 결재는 안전감독관 결재가 완료된 후에만 할 수 있습니다.");
        return;
      }
      approved = {
        ...current,
        approvalStatus: "final_approved",
        inspectorApproved: true,
        directorApproved: true,
        directorApprovedAt: approvedAt,
        updatedAt: approvedAt,
      } as Report;
    }

    reports[found.index] = approved;
    await writeReports(reports);
    res.json(approved);
  } catch (error) {
    sendServerError(res, "Approve report", error);
  }
});

app.post("/api/reports/:id/reject", async (req, res) => {
  try {
    const role = (req.body?.role ?? "") as ApprovalRole;
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if ((role !== "inspector" && role !== "director") || !reason) {
      res.status(400).json({ error: "반려 역할과 반려 사유를 입력해야 합니다." });
      return;
    }
    if (!checkPassword(PASSWORDS[role], req.body?.password)) {
      res.status(401).json({ error: "결재 암호가 일치하지 않습니다." });
      return;
    }

    const reports = await readReports();
    const found = getReportOr404(reports, req.params.id, res);
    if (!found) return;

    const current = normalizeReport(found.report);
    const status = inferApprovalStatus(current);
    const permitted = (role === "inspector" && status === "requested") || (role === "director" && status === "inspector_approved");
    if (!permitted) {
      rejectInvalidAction(res, "현재 결재 단계에서는 반려할 수 없습니다.");
      return;
    }

    const rejectedAt = now();
    const rejected = {
      ...clearApprovalData(current),
      approvalStatus: "rejected" as const,
      rejectionRole: role,
      rejectionReason: reason,
      rejectedAt,
      updatedAt: rejectedAt,
    } as Report;

    reports[found.index] = rejected;
    await writeReports(reports);
    res.json(rejected);
  } catch (error) {
    sendServerError(res, "Reject report", error);
  }
});

app.post("/api/reports/:id/void", async (req, res) => {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) {
      res.status(400).json({ error: "문서 무효 처리 사유를 입력해야 합니다." });
      return;
    }
    if (!checkPassword(PASSWORDS.admin, req.body?.password)) {
      res.status(401).json({ error: "관리자 암호가 일치하지 않습니다." });
      return;
    }

    const reports = await readReports();
    const found = getReportOr404(reports, req.params.id, res);
    if (!found) return;

    const current = normalizeReport(found.report);
    if (inferApprovalStatus(current) !== "final_approved") {
      rejectInvalidAction(res, "최종 결재가 완료된 문서만 무효 처리할 수 있습니다.");
      return;
    }

    const voidedAt = now();
    const voided = {
      ...current,
      approvalStatus: "voided" as const,
      voidedAt,
      voidReason: reason,
      updatedAt: voidedAt,
    } as Report;

    reports[found.index] = voided;
    await writeReports(reports);
    res.json(voided);
  } catch (error) {
    sendServerError(res, "Void report", error);
  }
});

app.post("/api/reports/:id/corrected-copy", async (req, res) => {
  try {
    const reports = await readReports();
    const found = getReportOr404(reports, req.params.id, res);
    if (!found) return;

    const current = normalizeReport(found.report);
    if (inferApprovalStatus(current) !== "voided") {
      rejectInvalidAction(res, "정정본은 무효 처리된 문서에서만 작성할 수 있습니다.");
      return;
    }

    const createdAt = now();
    const newTitle = current.title.startsWith("[정정]") ? current.title : `[정정] ${current.title}`;
    const copied: Report = {
      ...clearApprovalData(current),
      id: createReportId(),
      title: newTitle,
      createdAt,
      updatedAt: createdAt,
      approvalStatus: "draft",
      correctionOf: current.id,
      inspectorApproved: false,
      directorApproved: false,
      ...(current.type === "incident"
        ? { reportId: `${current.reportId || "INC"}-R1` }
        : {}),
    } as Report;

    reports.unshift(copied);
    await writeReports(reports);
    res.status(201).json(copied);
  } catch (error) {
    sendServerError(res, "Create corrected copy", error);
  }
});

app.delete("/api/reports/:id", async (req, res) => {
  try {
    const reports = await readReports();
    const found = getReportOr404(reports, req.params.id, res);
    if (!found) return;

    const current = normalizeReport(found.report);
    if (!isDeletable(inferApprovalStatus(current))) {
      rejectInvalidAction(res, "결재 요청 이후의 문서는 삭제할 수 없습니다. 최종 결재 문서는 관리자 무효 처리 후 정정본을 작성하세요.");
      return;
    }

    reports.splice(found.index, 1);
    await writeReports(reports);
    res.json({ success: true });
  } catch (error) {
    sendServerError(res, "Delete report", error);
  }
});

async function startServer(): Promise<void> {
  await initDb();

  if (IS_DEVELOPMENT) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(PROJECT_ROOT, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) {
        next();
        return;
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Report dashboard is running on http://localhost:${PORT}`);
    console.log(`Report configuration: ${CONFIG_FILE}`);
    console.log(`Report database: ${DB_FILE}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start report dashboard:", error);
  process.exit(1);
});
