/**
 * 자산관리 & 복지포인트 (스펙 13)
 *
 * asset_loans에는 status 컬럼이 없다. 신청·승인·반납요청·반납확인의 시각
 * 컬럼 조합으로 상태를 읽는다 — "언제 무엇이 일어났는가"가 남아야 이력으로
 * 쓸 수 있고, status와 시각이 따로 있으면 둘이 어긋난 행이 반드시 생긴다.
 * 판정은 loanStage() 한 곳에서만 한다.
 */

export type AssetStatus = "available" | "loaned" | "maintenance" | "retired";

export const ASSET_STATUSES = [
  "available",
  "loaned",
  "maintenance",
  "retired",
] as const;

/**
 * 관리자가 손으로 지정할 수 있는 상태.
 *
 * 'loaned'가 빠져 있다. 대여중은 승인 함수(approve_asset_loan)가 대여 행과
 * 함께 만드는 상태라, 손으로 지정하면 대여 기록 없는 '대여중' 자산이 생긴다 —
 * 화면에는 사용자가 "—"로 뜨고, 아무도 새로 신청할 수 없고, 반납 확인으로
 * 되돌릴 대여 행도 없다.
 */
export const MANUAL_ASSET_STATUSES = [
  "available",
  "maintenance",
  "retired",
] as const;

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  available: "대여가능",
  loaned: "대여중",
  maintenance: "수리중",
  retired: "폐기",
};

/**
 * 대여중은 경고가 아니다 — 정상적으로 쓰이고 있는 상태다.
 * 수리중만 "지금 손이 필요한 것"이라 warn, 폐기는 끝난 것이라 중립.
 */
export const ASSET_STATUS_TONES: Record<
  AssetStatus,
  "success" | "info" | "warn" | "neutral"
> = {
  available: "success",
  loaned: "info",
  maintenance: "warn",
  retired: "neutral",
};

/** list_assets() RPC 반환 행 */
export interface AssetRow {
  id: string;
  name: string;
  asset_type: string | null;
  serial_number: string | null;
  status: AssetStatus;
  note: string | null;
  /** 지금 쓰고 있는 사람. 대여중이 아니면 null */
  holder_name: string | null;
  expected_return_date: string | null;
  /** 내가 넣어둔 대기 중 신청 — 있으면 '신청함'으로 표시한다 */
  my_pending_loan_id: string | null;
}

export interface AssetLoan {
  id: string;
  asset_id: string;
  employee_id: string;
  requested_at: string;
  loaned_at: string | null;
  expected_return_date: string | null;
  return_requested_at: string | null;
  returned_at: string | null;
  rejected_at: string | null;
  note: string | null;
}

export type LoanStage =
  | "requested"
  | "rejected"
  | "loaned"
  | "return_requested"
  | "returned";

export const LOAN_STAGE_LABELS: Record<LoanStage, string> = {
  requested: "승인 대기",
  rejected: "반려",
  loaned: "대여중",
  return_requested: "반납 확인 대기",
  returned: "반납 완료",
};

export const LOAN_STAGE_TONES: Record<
  LoanStage,
  "neutral" | "info" | "success" | "warn"
> = {
  requested: "info",
  rejected: "neutral",
  loaned: "info",
  return_requested: "warn",
  returned: "success",
};

export function loanStage(
  loan: Pick<
    AssetLoan,
    "loaned_at" | "returned_at" | "rejected_at" | "return_requested_at"
  >,
): LoanStage {
  if (loan.returned_at) return "returned";
  if (loan.rejected_at) return "rejected";
  if (loan.return_requested_at) return "return_requested";
  if (loan.loaned_at) return "loaned";
  return "requested";
}

/** 반납 예정일이 지났는지 — 대여중일 때만 의미가 있다 */
export function isOverdue(loan: AssetLoan, today: string): boolean {
  return (
    loanStage(loan) === "loaned" &&
    Boolean(loan.expected_return_date) &&
    loan.expected_return_date! < today
  );
}

/* ── 복지포인트 ───────────────────────────────────────────────────── */

export type WelfareStatus = "pending" | "approved" | "rejected";

export const WELFARE_STATUS_LABELS: Record<WelfareStatus, string> = {
  pending: "승인 대기",
  approved: "승인",
  rejected: "반려",
};

export const WELFARE_STATUS_TONES: Record<
  WelfareStatus,
  "info" | "success" | "neutral"
> = {
  pending: "info",
  approved: "success",
  // 반려는 위반이 아니라 "이번엔 안 된다"는 결과라 중립으로 둔다
  rejected: "neutral",
};

export interface WelfareBalance {
  employee_id: string;
  year: number;
  granted_points: number;
  used_points: number;
  updated_at: string;
}

export interface WelfareRequest {
  id: string;
  employee_id: string;
  year: number;
  amount: number;
  purpose: string;
  status: WelfareStatus;
  requested_at: string;
  processed_at: string | null;
  processed_by: string | null;
  reject_reason: string | null;
}

/**
 * 잔여는 저장하지 않고 뺄셈으로 낸다(스펙 13 · 설계 결정, 스펙 03과 동일).
 *
 * 대기 중 신청까지 빼서 "지금 더 쓸 수 있는 금액"을 따로 준다 — 대기 중인 걸
 * 빼지 않으면 이미 신청한 금액을 또 신청하고, 승인 단계에서야 잔액 부족으로
 * 막힌다.
 */
export function welfareSummary(
  balance: WelfareBalance | null,
  requests: WelfareRequest[],
) {
  const granted = balance?.granted_points ?? 0;
  const used = balance?.used_points ?? 0;
  const pending = requests
    .filter((r) => r.status === "pending")
    .reduce((sum, r) => sum + Number(r.amount), 0);

  return {
    granted,
    used,
    remaining: granted - used,
    pending,
    available: Math.max(granted - used - pending, 0),
  };
}

/** 1,250,000 형태. 원 단위라 소수점은 버린다 */
export function formatPoints(value: number): string {
  return Math.round(Number(value)).toLocaleString("ko-KR");
}
