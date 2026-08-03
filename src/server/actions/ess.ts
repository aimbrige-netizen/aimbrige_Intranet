"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  requireSessionEmployee,
  requireSystemAdmin,
} from "@/lib/auth/session";
import { payMonthFirstDay } from "@/features/ess/data";

/**
 * ⚑ ESS 3종 액션 (스펙 13 · 마이그레이션 30)
 *
 * 급여명세 등록은 admin_save_payroll_slip() RPC 한 곳으로 몬다 — 명세 upsert와
 * 항목 교체가 한 트랜잭션이어야 하고, 합계 3종은 DB 트리거가 재계산한다
 * (여기서 계산해 보내는 값은 애초에 없다). 나머지는 RLS 아래의 직접
 * INSERT/UPDATE/DELETE인데, RLS에 막힌 UPDATE/DELETE는 에러가 아니라 0행으로
 * 끝나므로 전부 count/select로 반영을 확인한다(규약 3 — mail.ts와 같은 이유).
 *
 * 증명서 상태 전이(requested→issued/rejected)와 processed_at·processed_by는
 * 가드 트리거가 서버 값으로 강제한다 — 액션은 상태와 사유만 보낸다.
 */

export interface EssActionResult {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  message?: string;
  /** 만들어지거나 갱신된 행의 id — 화면이 상세로 이동할 때 쓴다 */
  id?: string;
}

/**
 * ESS 화면을 다시 만든다. 실제 라우트는 스펙 13 구현 결정의 6개다 —
 * 존재하지 않는 경로를 돌리면 겉으로만 동작해 보이는 잠복 버그가 된다
 * (mail.ts revalidateMailPaths의 교훈).
 */
function revalidateEssPaths(): void {
  revalidatePath("/hr");
  revalidatePath("/payroll");
  revalidatePath("/contracts");
  revalidatePath("/admin/hr");
  revalidatePath("/admin/payroll");
  revalidatePath("/admin/contracts");
}

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

/** RPC·DB가 한글 문장으로 던진 예외는 그대로, 날것 메시지는 fallback으로 */
function rpcMessage(message: string, fallback: string): string {
  if (/[가-힣]/.test(message)) return message;
  console.error("[ess] 처리 실패:", message);
  return fallback;
}

const uuidSchema = z.string().uuid("대상을 찾을 수 없습니다.");
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 올바르지 않습니다.");
/** "YYYY-MM"과 "YYYY-MM-DD"를 모두 받는다 — payMonthFirstDay가 정규화 */
const monthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, "급여월 형식이 올바르지 않습니다.");

// ---------------------------------------------------------------------
// 증명서 — 본인 신청/취소
// ---------------------------------------------------------------------

const certRequestSchema = z.object({
  certType: z.enum(["employment", "career"], {
    message: "증명서 종류를 선택하세요.",
  }),
  purpose: z
    .string()
    .trim()
    .min(1, "용도를 입력하세요.")
    .max(500, "용도는 500자 이내로 입력하세요."),
});

const CERT_TYPE_LABELS: Record<"employment" | "career", string> = {
  employment: "재직증명서",
  career: "경력증명서",
};

/** 증명서 발급 신청 (스펙 13 #hr/cert-isu — "증명서 발급 요청" 버튼) */
export async function requestCertificate(
  input: unknown,
): Promise<EssActionResult> {
  const me = await requireSessionEmployee();
  const parsed = certRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = createServerSupabase();

  /*
   * 같은 종류의 신청이 이미 대기 중이면 또 넣지 않는다 — 두 번 누르면
   * 관리자 화면에 같은 사람이 두 줄로 뜬다(asset_loans 중복 가드와 같은
   * 이유). 가드 조회가 실패하면 통과시키지 않고 실패로 말한다 — 조용히
   * 삼키면 가드가 있는 척만 하게 된다.
   */
  const { count, error: pendingError } = await supabase
    .from("certificate_requests")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", me.id)
    .eq("cert_type", parsed.data.certType)
    .eq("status", "requested");

  if (pendingError) {
    return {
      ok: false,
      message: rpcMessage(pendingError.message, "증명서 신청에 실패했습니다."),
    };
  }
  if (count) {
    return {
      ok: false,
      message: `이미 처리 대기 중인 ${CERT_TYPE_LABELS[parsed.data.certType]} 신청이 있습니다.`,
    };
  }
  // 상태·처리 정보는 보내지 않는다 — 가드 트리거가 requested로 강제한다
  const { data, error } = await supabase
    .from("certificate_requests")
    .insert({
      employee_id: me.id,
      cert_type: parsed.data.certType,
      purpose: parsed.data.purpose,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    return {
      ok: false,
      message: rpcMessage(error.message, "증명서 신청에 실패했습니다."),
    };
  }

  revalidateEssPaths();
  return { ok: true, id: data.id };
}

/**
 * 신청 취소 — 본인의 requested만. 처리된 신청(발급/반려)은 기록이라
 * RLS가 삭제 자체를 막는다(0행 → 안내 메시지).
 */
export async function cancelCertificateRequest(
  requestId: string,
): Promise<EssActionResult> {
  const me = await requireSessionEmployee();
  if (!uuidSchema.safeParse(requestId).success) {
    return { ok: false, message: "신청을 찾을 수 없습니다." };
  }

  const supabase = createServerSupabase();
  const { error, count } = await supabase
    .from("certificate_requests")
    .delete({ count: "exact" })
    .eq("id", requestId)
    .eq("employee_id", me.id)
    .eq("status", "requested");

  if (error) {
    return {
      ok: false,
      message: rpcMessage(error.message, "신청을 취소하지 못했습니다."),
    };
  }
  if (count === 0) {
    return { ok: false, message: "처리 대기 중인 본인 신청만 취소할 수 있습니다." };
  }

  revalidateEssPaths();
  return { ok: true };
}

// ---------------------------------------------------------------------
// 증명서 — 관리자 처리 (발급/반려)
// 전이 규칙·처리 시각·처리자는 가드 트리거가 강제한다.
// ---------------------------------------------------------------------

export async function issueCertificate(
  requestId: string,
): Promise<EssActionResult> {
  await requireSystemAdmin();
  if (!uuidSchema.safeParse(requestId).success) {
    return { ok: false, message: "신청을 찾을 수 없습니다." };
  }

  const supabase = createServerSupabase();
  const { error, count } = await supabase
    .from("certificate_requests")
    .update({ status: "issued" }, { count: "exact" })
    .eq("id", requestId)
    .eq("status", "requested");

  if (error) {
    return {
      ok: false,
      message: rpcMessage(error.message, "발급 처리에 실패했습니다."),
    };
  }
  if (count === 0) {
    return { ok: false, message: "처리 대기 중인 신청이 아닙니다." };
  }

  revalidateEssPaths();
  return { ok: true };
}

export async function rejectCertificate(
  requestId: string,
  reason: string,
): Promise<EssActionResult> {
  await requireSystemAdmin();
  if (!uuidSchema.safeParse(requestId).success) {
    return { ok: false, message: "신청을 찾을 수 없습니다." };
  }
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "반려 사유를 입력하세요." };
  }
  if (trimmed.length > 500) {
    return { ok: false, message: "반려 사유는 500자 이내로 입력하세요." };
  }

  const supabase = createServerSupabase();
  const { error, count } = await supabase
    .from("certificate_requests")
    .update(
      { status: "rejected", reject_reason: trimmed },
      { count: "exact" },
    )
    .eq("id", requestId)
    .eq("status", "requested");

  if (error) {
    return {
      ok: false,
      message: rpcMessage(error.message, "반려 처리에 실패했습니다."),
    };
  }
  if (count === 0) {
    return { ok: false, message: "처리 대기 중인 신청이 아닙니다." };
  }

  revalidateEssPaths();
  return { ok: true };
}

// ---------------------------------------------------------------------
// 급여 — 관리자 (급여상세 · 명세)
// ---------------------------------------------------------------------

const payrollProfileSchema = z
  .object({
    employeeId: uuidSchema,
    payType: z.enum(["annual", "monthly"], {
      message: "급여유형을 선택하세요.",
    }),
    annualSalary: z
      .number()
      .int("연봉은 정수로 입력하세요.")
      .min(0, "연봉은 0 이상이어야 합니다.")
      .max(1_000_000_000_000, "연봉이 너무 큽니다.")
      .nullable()
      .optional(),
    monthlySalary: z
      .number()
      .int("월급은 정수로 입력하세요.")
      .min(0, "월급은 0 이상이어야 합니다.")
      .max(1_000_000_000_000, "월급이 너무 큽니다.")
      .nullable()
      .optional(),
    fixedAllowance: z
      .number()
      .int("고정수당은 정수로 입력하세요.")
      .min(0, "고정수당은 0 이상이어야 합니다.")
      .max(1_000_000_000_000, "고정수당이 너무 큽니다.")
      .optional(),
    note: z.string().trim().max(1000, "비고는 1000자 이내로 입력하세요.").optional(),
  })
  .refine(
    (v) => v.payType !== "annual" || v.annualSalary != null,
    { path: ["annualSalary"], message: "연봉제는 연봉을 입력해야 합니다." },
  )
  .refine(
    (v) => v.payType !== "monthly" || v.monthlySalary != null,
    { path: ["monthlySalary"], message: "월급제는 월급을 입력해야 합니다." },
  );

/** 급여상세 등록/수정 (upsert — employee_id가 PK다) */
export async function savePayrollProfile(
  input: unknown,
): Promise<EssActionResult> {
  await requireSystemAdmin();
  const parsed = payrollProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const supabase = createServerSupabase();
  // upsert 반영 확인은 select 반환으로 한다(규약 3) — RLS에 막히면 행이 없다
  const { data, error } = await supabase
    .from("payroll_profiles")
    .upsert({
      employee_id: v.employeeId,
      pay_type: v.payType,
      annual_salary: v.annualSalary ?? null,
      monthly_salary: v.monthlySalary ?? null,
      fixed_allowance: v.fixedAllowance ?? 0,
      note: v.note || null,
    })
    .select("employee_id")
    .maybeSingle<{ employee_id: string }>();

  if (error) {
    return {
      ok: false,
      message: rpcMessage(error.message, "급여상세를 저장하지 못했습니다."),
    };
  }
  if (!data) {
    return { ok: false, message: "급여상세를 저장하지 못했습니다." };
  }

  revalidateEssPaths();
  return { ok: true, id: data.employee_id };
}

const slipItemSchema = z.object({
  kind: z.enum(["payment", "deduction"], {
    message: "항목 종류가 올바르지 않습니다.",
  }),
  name: z
    .string()
    .trim()
    .min(1, "항목명을 입력하세요.")
    .max(60, "항목명은 60자 이내로 입력하세요."),
  amount: z
    .number()
    .int("금액은 정수로 입력하세요.")
    .min(0, "금액은 0 이상이어야 합니다.")
    .max(9_999_999_999_999, "금액이 너무 큽니다."),
  sort: z.number().int().optional(),
});

const saveSlipSchema = z.object({
  employeeId: uuidSchema,
  payMonth: monthSchema,
  payDate: dateSchema,
  memo: z.string().trim().max(1000, "메모는 1000자 이내로 입력하세요.").optional(),
  items: z
    .array(slipItemSchema)
    .min(1, "지급·공제 항목을 1건 이상 입력하세요.")
    .max(100, "항목은 100건 이내로 입력하세요."),
});

/**
 * 명세 등록/수정 — 같은 직원·같은 달이면 덮어쓴다(항목 전체 교체).
 * 합계 3종은 DB 재계산 트리거의 몫이다.
 */
export async function savePayrollSlip(
  input: unknown,
): Promise<EssActionResult> {
  await requireSystemAdmin();
  const parsed = saveSlipSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const firstDay = payMonthFirstDay(v.payMonth);
  if (!firstDay) {
    return { ok: false, fieldErrors: { payMonth: "급여월이 올바르지 않습니다." } };
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("admin_save_payroll_slip", {
    p_employee_id: v.employeeId,
    p_pay_month: firstDay,
    p_pay_date: v.payDate,
    p_memo: v.memo || null,
    p_items: v.items.map((item, index) => ({
      kind: item.kind,
      name: item.name,
      amount: item.amount,
      sort: item.sort ?? index + 1,
    })),
  });

  if (error) {
    return {
      ok: false,
      message: rpcMessage(error.message, "급여명세를 저장하지 못했습니다."),
    };
  }

  revalidateEssPaths();
  return { ok: true, id: data as string };
}

/** 명세 삭제 — 항목은 cascade로 함께 지워진다 */
export async function deletePayrollSlip(
  slipId: string,
): Promise<EssActionResult> {
  await requireSystemAdmin();
  if (!uuidSchema.safeParse(slipId).success) {
    return { ok: false, message: "명세를 찾을 수 없습니다." };
  }

  const supabase = createServerSupabase();
  const { error, count } = await supabase
    .from("payroll_slips")
    .delete({ count: "exact" })
    .eq("id", slipId);

  if (error) {
    return {
      ok: false,
      message: rpcMessage(error.message, "명세를 삭제하지 못했습니다."),
    };
  }
  if (count === 0) {
    return { ok: false, message: "명세를 찾을 수 없습니다." };
  }

  revalidateEssPaths();
  return { ok: true };
}

// ---------------------------------------------------------------------
// 계약 — 관리자 등록/상태 변경 + 파일 열람 URL
// 파일 업로드 경로는 `<employee_id>/<파일명>` — 스토리지 정책이 첫
// 세그먼트로 열람자를 판정하므로(마이그레이션 30) 서버에서도 대조한다.
// ---------------------------------------------------------------------

const contractStatusSchema = z.enum(["draft", "signed", "expired"], {
  message: "계약 상태가 올바르지 않습니다.",
});

const createContractSchema = z
  .object({
    employeeId: uuidSchema,
    title: z
      .string()
      .trim()
      .min(1, "계약서명을 입력하세요.")
      .max(200, "계약서명은 200자 이내로 입력하세요."),
    status: contractStatusSchema.optional(),
    signedAt: dateSchema.nullable().optional(),
    filePath: z.string().max(1024).nullable().optional(),
  })
  .refine(
    (v) => (v.status ?? "draft") !== "signed" || v.signedAt != null,
    { path: ["signedAt"], message: "서명완료 계약은 체결일이 필요합니다." },
  );

/** 계약 등록 (스펙 13 /admin/contracts) */
export async function createContract(
  input: unknown,
): Promise<EssActionResult> {
  await requireSystemAdmin();
  const parsed = createContractSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  if (v.filePath && !v.filePath.startsWith(`${v.employeeId}/`)) {
    return { ok: false, message: "계약 파일 경로가 올바르지 않습니다." };
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("employment_contracts")
    .insert({
      employee_id: v.employeeId,
      title: v.title,
      status: v.status ?? "draft",
      signed_at: v.signedAt ?? null,
      file_path: v.filePath ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    return {
      ok: false,
      message: rpcMessage(error.message, "계약을 등록하지 못했습니다."),
    };
  }

  revalidateEssPaths();
  return { ok: true, id: data.id };
}

/**
 * 계약 상태 변경. 서명완료로 바꿀 때는 체결일이 필요하다(CHECK와 같은 규칙 —
 * DB 예외의 날것 메시지 대신 여기서 먼저 안내한다).
 */
export async function updateContractStatus(
  contractId: string,
  status: string,
  signedAt?: string | null,
): Promise<EssActionResult> {
  await requireSystemAdmin();
  if (!uuidSchema.safeParse(contractId).success) {
    return { ok: false, message: "계약을 찾을 수 없습니다." };
  }
  const parsedStatus = contractStatusSchema.safeParse(status);
  if (!parsedStatus.success) {
    return { ok: false, message: "계약 상태가 올바르지 않습니다." };
  }
  if (signedAt != null && !dateSchema.safeParse(signedAt).success) {
    return { ok: false, message: "체결일 형식이 올바르지 않습니다." };
  }
  if (parsedStatus.data === "signed" && !signedAt) {
    return { ok: false, message: "서명완료 처리에는 체결일이 필요합니다." };
  }

  const supabase = createServerSupabase();
  const fields: { status: string; signed_at?: string | null } = {
    status: parsedStatus.data,
  };
  // 체결일은 넘어온 경우에만 만진다 — 만료 처리로 기존 체결일이 지워지면 안 된다
  if (signedAt !== undefined) fields.signed_at = signedAt;

  const { error, count } = await supabase
    .from("employment_contracts")
    .update(fields, { count: "exact" })
    .eq("id", contractId);

  if (error) {
    return {
      ok: false,
      message: rpcMessage(error.message, "계약 상태를 변경하지 못했습니다."),
    };
  }
  if (count === 0) {
    return { ok: false, message: "계약을 찾을 수 없습니다." };
  }

  revalidateEssPaths();
  return { ok: true };
}

/**
 * 계약 파일 열람 URL (5분 서명 URL).
 * 경로를 직접 받지 않고 계약 id로 행을 다시 찾는다 — 행 조회에 RLS
 * (본인 + 관리자)가 걸리고, 스토리지 select 정책이 한 번 더 잠근다.
 */
export async function getContractFileUrl(
  contractId: string,
): Promise<{ ok: boolean; url?: string; message?: string }> {
  await requireSessionEmployee();
  if (!uuidSchema.safeParse(contractId).success) {
    return { ok: false, message: "계약을 찾을 수 없습니다." };
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("employment_contracts")
    .select("file_path")
    .eq("id", contractId)
    .maybeSingle<{ file_path: string | null }>();

  if (error) {
    return {
      ok: false,
      message: rpcMessage(error.message, "계약을 조회하지 못했습니다."),
    };
  }
  if (!data) return { ok: false, message: "계약을 찾을 수 없습니다." };
  if (!data.file_path) {
    return { ok: false, message: "등록된 계약 파일이 없습니다." };
  }

  const { data: signed, error: signError } = await supabase.storage
    .from("employment-contracts")
    .createSignedUrl(data.file_path, 60 * 5);

  if (signError) {
    return {
      ok: false,
      message: rpcMessage(signError.message, "파일 열람 URL 발급에 실패했습니다."),
    };
  }
  return { ok: true, url: signed.signedUrl };
}
