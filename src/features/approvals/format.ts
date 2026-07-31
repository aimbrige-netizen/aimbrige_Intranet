import {
  DOCUMENT_TYPE_META,
  type DocumentType,
  type ExpenseItem,
} from "./types";

/**
 * 결재 화면 공통 포맷.
 *
 * 목록에 "제목·유형·기안일"만 있던 시절엔 결재자가 판단에 필요한 값
 * (얼마짜리인지, 며칠짜리인지, 며칠 묵었는지)을 보려고 문서를 하나씩
 * 열어야 했다. 그 값들은 전부 form_data와 created_at 안에 이미 있다.
 */

/** 1234000 → "1,234,000원" */
export function formatWon(amount: number): string {
  return `${Math.round(amount).toLocaleString("ko-KR")}원`;
}

const DAY_MS = 86_400_000;

/** 기안 후 지난 일수 (내림). 서버에서 계산해 값으로 넘긴다 */
export function elapsedDays(from: string, now: number = Date.now()): number {
  const started = new Date(from).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((now - started) / DAY_MS));
}

/** "3일 2시간" — 0일이면 "4시간", 1시간 미만이면 "방금" */
export function elapsedLabel(from: string, now: number = Date.now()): string {
  const started = new Date(from).getTime();
  if (!Number.isFinite(started)) return "-";
  const diff = Math.max(0, now - started);
  const days = Math.floor(diff / DAY_MS);
  const hours = Math.floor((diff % DAY_MS) / 3_600_000);
  if (days > 0) return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`;
  if (hours > 0) return `${hours}시간`;
  return "방금";
}

/** 두 시각 사이 대기시간 — 결재 단계 사이 캡션용 */
export function waitLabel(from: string, to: string): string {
  const end = new Date(to).getTime();
  if (!Number.isFinite(end)) return "-";
  return elapsedLabel(from, end);
}

/**
 * 방치 정도.
 * 3일은 주의, 7일은 실제 지연 — 이때만 빨강을 쓴다.
 */
export const AGING_WARN_DAYS = 3;
export const AGING_LATE_DAYS = 7;

export type AgingLevel = "fresh" | "aging" | "late";

export function agingLevel(days: number): AgingLevel {
  if (days >= AGING_LATE_DAYS) return "late";
  if (days >= AGING_WARN_DAYS) return "aging";
  return "fresh";
}

export interface DocumentHighlight {
  /** "1,240,000원", "07-06 ~ 07-08 (3일)" 처럼 한 줄로 압축한 핵심값 */
  text: string;
  /** 보조 설명 — 항목 수, 목적지 등 */
  sub?: string;
  /** 금액이 있으면 합계 비교·정렬에 쓴다 */
  amount?: number;
}

/** 'YYYY-MM-DD' 두 개를 "07-06 ~ 07-08 (3일)" 로 */
function rangeText(start: unknown, end: unknown): string | null {
  if (typeof start !== "string" || typeof end !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return null;
  }
  const days =
    Math.round(
      (new Date(`${end}T00:00:00Z`).getTime() -
        new Date(`${start}T00:00:00Z`).getTime()) /
        DAY_MS,
    ) + 1;
  return start === end
    ? `${start.slice(5)} (1일)`
    : `${start.slice(5)} ~ ${end.slice(5)} (${days}일)`;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 목록의 '핵심값' 컬럼.
 * DOC_SELECT가 이미 form_data를 가져오는데 목록에서 버려지고 있었다.
 */
export function documentHighlight(
  type: DocumentType,
  formData: Record<string, unknown> | null | undefined,
): DocumentHighlight | null {
  const data = formData ?? {};

  switch (type) {
    case "expense": {
      const items = (data.items as ExpenseItem[] | undefined) ?? [];
      const total =
        toNumber(data.total) ??
        items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      if (!total) return null;
      return {
        text: formatWon(total),
        sub: items.length > 0 ? `${items.length}개 항목` : undefined,
        amount: total,
      };
    }
    case "business_trip": {
      const range = rangeText(data.startDate, data.endDate);
      const cost = toNumber(data.estimatedCost);
      const destination =
        typeof data.destination === "string" ? data.destination : undefined;
      if (!range && cost === null) return null;
      return {
        text: range ?? formatWon(cost ?? 0),
        sub: [destination, cost ? `예상 ${formatWon(cost)}` : null]
          .filter(Boolean)
          .join(" · "),
        amount: cost ?? undefined,
      };
    }
    case "remote_work": {
      const range = rangeText(data.startDate, data.endDate);
      return range ? { text: range } : null;
    }
    case "purchase_request": {
      const name = typeof data.itemName === "string" ? data.itemName : "";
      const qty = toNumber(data.quantity);
      const cost = toNumber(data.estimatedCost);
      if (!name && qty === null) return null;
      return {
        text: qty !== null ? `${name} × ${qty}` : name,
        sub: cost !== null ? `예상 ${formatWon(cost)}` : undefined,
        amount: cost ?? undefined,
      };
    }
    case "special_request":
    default:
      return null;
  }
}

/**
 * 단계 이름. 1차 검토가 생략된 1단계 문서에서는 단계 1이 곧 최종 승인이다 —
 * "1차 검토"로 고정해 찍으면 실제 결재선과 화면이 어긋난다.
 */
export function stepLabel(order: number, totalSteps: number): string {
  if (order >= totalSteps) return "최종 승인";
  return order === 1 ? "1차 검토" : `${order}차 검토`;
}

/** 유형 라벨 — 좁은 자리용 */
export function typeShort(type: DocumentType): string {
  return DOCUMENT_TYPE_META[type].short;
}
