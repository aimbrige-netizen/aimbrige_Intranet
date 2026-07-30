"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSessionEmployee, requireSystemAdmin } from "@/lib/auth/session";
import { buildTitle, DOCUMENT_TYPES, type DocumentType } from "@/features/approvals/types";

export interface ApprovalActionResult {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  message?: string;
  documentId?: string;
}

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜를 선택하세요.");
const requiredText = (label: string, max = 2000) =>
  z.string().trim().min(1, `${label}을(를) 입력하세요.`).max(max);

/**
 * 비어 있으면 null, 값이 있으면 0 이상의 숫자여야 한다.
 * 예전에는 음수·NaN을 조용히 null로 바꿨는데, 그러면 사용자가 -50000을 넣어도
 * "저장됐지만 값이 사라진" 상태가 되어 원인을 알 수 없다. 이제는 오류로 알린다.
 */
const optionalNumber = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "숫자를 입력하세요." });
      return null;
    }
    if (n < 0) {
      ctx.addIssue({ code: "custom", message: "0 이상으로 입력하세요." });
      return null;
    }
    return n;
  })
  .nullable();

/** 유형별 form_data 검증 (스펙 3.3) */
const FORM_SCHEMAS = {
  special_request: z.object({
    title: requiredText("제목", 120),
    content: requiredText("내용"),
  }),
  business_trip: z
    .object({
      destination: requiredText("출장지", 120),
      startDate: ymd,
      endDate: ymd,
      purpose: requiredText("출장목적"),
      estimatedCost: optionalNumber,
    })
    .superRefine((v, ctx) => {
      if (v.endDate < v.startDate) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: "종료일은 시작일보다 뒤여야 합니다.",
        });
      }
    }),
  expense: z
    .object({
      items: z
        .array(
          z.object({
            name: requiredText("항목명", 120),
            amount: z.coerce.number().positive("금액은 0보다 커야 합니다."),
            receiptUrl: z.string().nullable().optional(),
            receiptName: z.string().nullable().optional(),
          }),
        )
        .min(1, "청구 항목을 1건 이상 입력하세요."),
      reason: z
        .string()
        .trim()
        .transform((v) => (v === "" ? null : v))
        .nullable()
        .optional(),
    })
    .transform((v) => ({
      ...v,
      total: v.items.reduce((s, i) => s + i.amount, 0),
    })),
  purchase_request: z.object({
    itemName: requiredText("품목", 120),
    quantity: z.coerce.number().int().positive("수량은 1 이상이어야 합니다."),
    estimatedCost: optionalNumber,
    reason: requiredText("사유"),
  }),
  remote_work: z
    .object({
      startDate: ymd,
      endDate: ymd,
      reason: requiredText("사유"),
    })
    .superRefine((v, ctx) => {
      if (v.endDate < v.startDate) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: "종료일은 시작일보다 뒤여야 합니다.",
        });
      }
    }),
} as const;

/**
 * 기안 제출 (스펙 5장 1번)
 * 문서 생성과 결재단계 2건 생성을 DB 함수에서 한 트랜잭션으로 처리한다.
 */
export async function submitApprovalDocument(
  documentType: string,
  formInput: unknown,
): Promise<ApprovalActionResult> {
  await requireSessionEmployee();

  if (!(DOCUMENT_TYPES as readonly string[]).includes(documentType)) {
    return { ok: false, message: "알 수 없는 문서 유형입니다." };
  }
  const type = documentType as DocumentType;

  const parsed = FORM_SCHEMAS[type].safeParse(formInput);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const formData = parsed.data as Record<string, unknown>;

  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("submit_approval_document", {
    p_document_type: type,
    p_title: buildTitle(type, formData),
    p_form_data: formData,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/approvals");
  revalidatePath("/");
  return { ok: true, documentId: data as string };
}

/** 승인 / 반려 (스펙 5장 2·3번) */
export async function processApprovalStep(
  documentId: string,
  approve: boolean,
  comment?: string,
): Promise<ApprovalActionResult> {
  await requireSessionEmployee();

  if (!approve && !comment?.trim()) {
    return { ok: false, fieldErrors: { comment: "반려 사유는 필수입니다." } };
  }

  const supabase = createServerSupabase();
  const { error } = await supabase.rpc("process_approval_step", {
    p_document_id: documentId,
    p_approve: approve,
    p_comment: comment?.trim() ?? null,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/approvals");
  revalidatePath(`/approvals/${documentId}`);
  revalidatePath("/");
  revalidatePath("/calendar");
  return { ok: true };
}

/** 시행완료 처리 (스펙 3.4) */
export async function completeApprovalDocument(
  documentId: string,
): Promise<ApprovalActionResult> {
  await requireSystemAdmin();

  const supabase = createServerSupabase();
  const { error } = await supabase.rpc("complete_approval_document", {
    p_document_id: documentId,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/approvals");
  revalidatePath(`/approvals/${documentId}`);
  return { ok: true };
}

/** 결재라인 최종승인자 지정 (스펙 3.5) */
export async function setFinalApprover(
  documentType: string,
  approverId: string | null,
): Promise<ApprovalActionResult> {
  await requireSystemAdmin();

  if (!(DOCUMENT_TYPES as readonly string[]).includes(documentType)) {
    return { ok: false, message: "알 수 없는 문서 유형입니다." };
  }

  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("approval_line_configs")
    .update({ step2_approver_id: approverId })
    .eq("document_type", documentType);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/approval-lines");
  revalidatePath("/approvals/new");
  return { ok: true };
}

/**
 * 첨부파일 메타 등록 — 실제 파일은 클라이언트가 Storage에 올린 뒤 호출한다.
 *
 * storagePath는 반드시 `<auth uid>/<문서id>/<파일명>` 형식이어야 한다.
 * 이 경로 규칙으로 스토리지 조회 권한을 판정하므로(마이그레이션 11),
 * 임의 경로를 등록해 남의 파일을 자기 문서에 붙이는 escalation을 막는다.
 */
export async function registerAttachment(
  documentId: string,
  storagePath: string,
  fileName: string,
  fileSize: number,
): Promise<ApprovalActionResult> {
  await requireSessionEmployee();

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "세션이 만료되었습니다." };

  const expectedPrefix = `${user.id}/${documentId}/`;
  if (!storagePath.startsWith(expectedPrefix)) {
    return {
      ok: false,
      message: "첨부 경로가 올바르지 않습니다.",
    };
  }

  const { error } = await supabase.from("approval_attachments").insert({
    document_id: documentId,
    file_url: storagePath,
    file_name: fileName,
    file_size: fileSize,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath(`/approvals/${documentId}`);
  return { ok: true };
}

/** 첨부파일 삭제 (진행중 문서, 기안자 본인) */
export async function removeAttachment(
  attachmentId: string,
  documentId: string,
): Promise<ApprovalActionResult> {
  await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { data: row } = await supabase
    .from("approval_attachments")
    .select("file_url")
    .eq("id", attachmentId)
    .maybeSingle<{ file_url: string }>();

  const { error, count } = await supabase
    .from("approval_attachments")
    .delete({ count: "exact" })
    .eq("id", attachmentId);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return { ok: false, message: "삭제 권한이 없습니다." };
  }

  // 메타를 지웠으면 실제 파일도 정리한다(실패는 치명적이지 않음)
  if (row?.file_url) {
    const { error: storageError } = await supabase.storage
      .from("approval-attachments")
      .remove([row.file_url]);
    if (storageError) {
      console.error("[approvals] 첨부 파일 삭제 실패:", storageError.message);
    }
  }

  revalidatePath(`/approvals/${documentId}`);
  return { ok: true };
}

/** 첨부 다운로드용 서명 URL (스펙 3.4 "다운로드 링크") */
export async function getAttachmentUrl(
  storagePath: string,
): Promise<{ ok: boolean; url?: string; message?: string }> {
  await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { data, error } = await supabase.storage
    .from("approval-attachments")
    .createSignedUrl(storagePath, 60 * 5);

  if (error) return { ok: false, message: error.message };
  return { ok: true, url: data.signedUrl };
}
