import { DisasterImportance } from "../types";

function normalizeImportance(value: unknown): DisasterImportance {
  const v = String(value ?? "").trim();
  if (v === DisasterImportance.URGENT) return DisasterImportance.URGENT;
  if (v === DisasterImportance.ALERT) return DisasterImportance.ALERT;
  if (v === DisasterImportance.INFO) return DisasterImportance.INFO;
  const lower = v.toLowerCase();
  if (lower.includes("urgent") || lower.includes("긴급") || lower.includes("rose") || lower.includes("red")) {
    return DisasterImportance.URGENT;
  }
  if (lower.includes("alert") || lower.includes("주의") || lower.includes("amber") || lower.includes("yellow") || lower.includes("orange")) {
    return DisasterImportance.ALERT;
  }
  return DisasterImportance.INFO;
}

function normalizeArea(value: unknown): string {
  const v = String(value ?? "").trim();
  return v || "전국";
}

export async function analyzeNewsWithAI(title: string, content: string) {
  try {
    const response = await fetch("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ title, content }),
    });

    if (!response.ok) {
      throw new Error(`AI 분석 백엔드 오류: HTTP ${response.status}`);
    }

    const result = await response.json();
    return {
      area: normalizeArea(result.area),
      importance: normalizeImportance(result.importance),
      summary: String(result.summary ?? "요약을 생성할 수 없습니다."),
    };
  } catch (error) {
    console.error("AI Analysis failed through backend proxy:", error);
    return {
      area: "전국",
      importance: DisasterImportance.INFO,
      summary: "요약을 생성할 수 없습니다.",
    };
  }
}
