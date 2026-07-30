import type { Employee } from "@/types/db";

/**
 * 전자결재 문서 유형별 정의 (스펙 04 · 3.3)
 *
 * 동적 양식빌더 대신 유형별 고정 폼을 쓴다. 새 유형이 필요하면
 * 여기에 정의를 추가하고 폼 컴포넌트에 분기를 하나 더 넣으면 된다.
 */
export const DOCUMENT_TYPES = [
  "special_request",
  "business_trip",
  "expense",
  "purchase_request",
  "remote_work",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type DocumentStatus = "pending" | "rejected" | "approved" | "completed";
export type StepStatus = "pending" | "approved" | "rejected";

export const DOCUMENT_TYPE_META: Record<
  DocumentType,
  { label: string; description: string; hasDateRange: boolean }
> = {
  special_request: {
    label: "특별처리신청서",
    description: "정해진 양식으로 담기 어려운 예외 처리를 요청합니다.",
    hasDateRange: false,
  },
  business_trip: {
    label: "출장신청서",
    description: "출장지·기간·목적과 예상경비를 신청합니다.",
    hasDateRange: true,
  },
  expense: {
    label: "경비청구서",
    description: "지출한 경비를 항목별로 청구합니다.",
    hasDateRange: false,
  },
  purchase_request: {
    label: "비품구매요청서",
    description: "업무에 필요한 비품 구매를 요청합니다.",
    hasDateRange: false,
  },
  remote_work: {
    label: "재택근무신청서",
    description: "재택근무 기간과 사유를 신청합니다.",
    hasDateRange: true,
  },
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  pending: "진행중",
  rejected: "반려",
  approved: "승인",
  completed: "시행완료",
};

export const DOCUMENT_STATUS_TONES: Record<
  DocumentStatus,
  "warn" | "danger" | "success" | "primary"
> = {
  pending: "warn",
  rejected: "danger",
  approved: "success",
  completed: "primary",
};

/** 경비청구서 항목 */
export interface ExpenseItem {
  name: string;
  amount: number;
  receiptUrl?: string | null;
  receiptName?: string | null;
}

/** 유형별 form_data 구조 */
export interface SpecialRequestData {
  content: string;
}
export interface BusinessTripData {
  destination: string;
  startDate: string;
  endDate: string;
  purpose: string;
  estimatedCost?: number | null;
}
export interface ExpenseData {
  items: ExpenseItem[];
  total: number;
  reason?: string | null;
}
export interface PurchaseRequestData {
  itemName: string;
  quantity: number;
  estimatedCost?: number | null;
  reason: string;
}
export interface RemoteWorkData {
  startDate: string;
  endDate: string;
  reason: string;
}

export type ApprovalFormData =
  | SpecialRequestData
  | BusinessTripData
  | ExpenseData
  | PurchaseRequestData
  | RemoteWorkData;

export interface ApprovalDocument {
  id: string;
  document_type: DocumentType;
  title: string;
  form_data: Record<string, unknown>;
  requester_id: string;
  status: DocumentStatus;
  current_step: number;
  created_at: string;
  updated_at: string;
}

export interface ApprovalStep {
  id: string;
  document_id: string;
  step_order: number;
  approver_id: string | null;
  status: StepStatus;
  comment: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface ApprovalStepWithApprover extends ApprovalStep {
  approver: Pick<Employee, "id" | "name" | "position"> | null;
}

export interface ApprovalAttachment {
  id: string;
  document_id: string;
  file_url: string;
  file_name: string | null;
  file_size: number | null;
  uploaded_at: string;
}

export interface ApprovalDocumentWithRelations extends ApprovalDocument {
  requester: Pick<Employee, "id" | "name" | "position"> | null;
  steps: ApprovalStepWithApprover[];
  attachments: ApprovalAttachment[];
}

export interface ApprovalLineConfig {
  id: string;
  document_type: DocumentType;
  step2_approver_id: string | null;
  updated_at: string;
}

export function isDocumentType(value: unknown): value is DocumentType {
  return (
    typeof value === "string" &&
    (DOCUMENT_TYPES as readonly string[]).includes(value)
  );
}

/** 제목 자동생성 (스펙 3.3) */
export function buildTitle(
  type: DocumentType,
  data: Record<string, unknown>,
): string {
  const won = (n: number) => n.toLocaleString("ko-KR");
  switch (type) {
    case "business_trip":
      return `출장 - ${data.destination ?? ""} (${data.startDate ?? ""}~${data.endDate ?? ""})`;
    case "expense": {
      const items = (data.items as ExpenseItem[] | undefined) ?? [];
      const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
      return `경비청구 - ${won(total)}원 (${items.length}건)`;
    }
    case "purchase_request":
      return `비품구매 - ${data.itemName ?? ""}`;
    case "remote_work":
      return `재택근무 - ${data.startDate ?? ""}~${data.endDate ?? ""}`;
    case "special_request":
    default:
      // 특별처리신청서는 자유서술이라 사용자가 직접 입력한 제목을 쓴다
      return String(data.title ?? "특별처리신청서");
  }
}
