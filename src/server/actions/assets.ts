"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  requireSessionEmployee,
  requireSystemAdmin,
} from "@/lib/auth/session";
import { MANUAL_ASSET_STATUSES } from "@/features/assets/types";

/**
 * 자산·복지포인트 (스펙 13)
 *
 * 승인 계열은 전부 DB 함수를 호출한다. 상태 변경과 잔액·자산상태 갱신을
 * 한 트랜잭션에 묶어야 하는데(스펙 4장), PostgREST로 update를 두 번 이어 쏘면
 * 사이에서 끊겼을 때 "승인은 됐는데 포인트는 안 빠진" 행이 남고 그 상태는
 * 화면 어디를 봐도 정상으로 보인다.
 *
 * 함수가 raise한 메시지는 우리가 쓴 한국어라 그대로 화면에 올린다 —
 * "잔여 포인트가 부족합니다 (잔여 30000, 신청 50000)" 같은 문장이
 * 관리자에게 필요한 정보다.
 */

export interface AssetActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idSchema = z.string().regex(UUID, "대상을 찾을 수 없습니다.");

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * RPC 오류 문구 정리.
 *
 * 함수가 raise한 메시지는 그대로 쓴다. 그 밖의 오류(제약 위반 등)는 영어라
 * 걸러낸다 — 임직원이 읽고 할 수 있는 게 없는 문장이다.
 */
function rpcMessage(message: string, fallback: string): string {
  if (/[가-힣]/.test(message)) return message;
  console.error("[assets] RPC 실패:", message);
  return fallback;
}

function revalidateAssets() {
  revalidatePath("/assets");
  revalidatePath("/assets/my-loans");
  revalidatePath("/admin/assets");
}

function revalidateWelfare() {
  revalidatePath("/welfare");
  revalidatePath("/admin/welfare");
}

/* ── 자산 대여 ────────────────────────────────────────────────────── */

export async function requestAssetLoan(
  assetId: string,
  expectedReturnDate: string,
): Promise<AssetActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(assetId).success) {
    return { ok: false, message: "자산을 찾을 수 없습니다." };
  }

  const parsed = z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, "날짜 형식이 올바르지 않습니다.")
    .safeParse(expectedReturnDate);
  if (!parsed.success) {
    return { ok: false, fieldErrors: { expectedReturnDate: parsed.error.issues[0].message } };
  }

  const { data: asset } = await supabase
    .from("assets")
    .select("status")
    .eq("id", assetId)
    .maybeSingle<{ status: string }>();

  if (!asset) return { ok: false, message: "자산을 찾을 수 없습니다." };
  if (asset.status !== "available") {
    return { ok: false, message: "지금 대여할 수 없는 자산입니다." };
  }

  /*
   * 같은 자산에 내 신청이 이미 대기 중이면 또 넣지 않는다.
   * 두 번 눌러 두 건이 쌓이면 관리자 화면에 같은 사람이 두 줄로 뜬다.
   */
  const { count } = await supabase
    .from("asset_loans")
    .select("id", { count: "exact", head: true })
    .eq("asset_id", assetId)
    .eq("employee_id", me.id)
    .is("loaned_at", null)
    .is("rejected_at", null);

  if (count) return { ok: false, message: "이미 신청한 자산입니다." };

  const { error } = await supabase.from("asset_loans").insert({
    asset_id: assetId,
    employee_id: me.id,
    expected_return_date: parsed.data || null,
  });

  if (error) {
    return { ok: false, message: rpcMessage(error.message, "대여를 신청하지 못했습니다.") };
  }

  revalidateAssets();
  return { ok: true };
}

/** 신청 취소 — 아직 승인 전인 내 신청만 */
export async function cancelAssetLoan(loanId: string): Promise<AssetActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(loanId).success) {
    return { ok: false, message: "신청을 찾을 수 없습니다." };
  }

  const { data: deleted, error } = await supabase
    .from("asset_loans")
    .delete()
    .eq("id", loanId)
    .eq("employee_id", me.id)
    .is("loaned_at", null)
    .is("rejected_at", null)
    .select("id");

  if (error) {
    return { ok: false, message: rpcMessage(error.message, "취소하지 못했습니다.") };
  }
  if (!deleted || deleted.length === 0) {
    return { ok: false, message: "이미 처리된 신청은 취소할 수 없습니다." };
  }

  revalidateAssets();
  return { ok: true };
}

/** 반납하겠다는 표시 (스펙 3.2) — 실제 반납 확인은 관리자가 한다 */
export async function requestAssetReturn(loanId: string): Promise<AssetActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(loanId).success) {
    return { ok: false, message: "대여를 찾을 수 없습니다." };
  }

  const { data: updated, error } = await supabase
    .from("asset_loans")
    .update({ return_requested_at: new Date().toISOString() })
    .eq("id", loanId)
    .eq("employee_id", me.id)
    .not("loaned_at", "is", null)
    .is("returned_at", null)
    .select("id");

  if (error) {
    return { ok: false, message: rpcMessage(error.message, "반납 요청을 보내지 못했습니다.") };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, message: "반납 요청할 수 있는 대여가 아닙니다." };
  }

  revalidateAssets();
  return { ok: true };
}

/* ── 자산 관리 (시스템 관리자) ────────────────────────────────────── */

const assetSchema = z.object({
  name: z.string().trim().min(1, "자산명을 입력하세요.").max(120, "120자 이내로 입력하세요."),
  assetType: z.string().trim().max(60, "60자 이내로 입력하세요.").optional(),
  serialNumber: z.string().trim().max(120, "120자 이내로 입력하세요.").optional(),
});

export async function createAsset(input: {
  name: string;
  assetType?: string;
  serialNumber?: string;
}): Promise<AssetActionResult> {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const parsed = assetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const { error } = await supabase.from("assets").insert({
    name: parsed.data.name,
    asset_type: parsed.data.assetType || null,
    // 빈 문자열을 넣으면 부분 유니크 인덱스가 "값 있음"으로 보지 않도록 null로
    serial_number: parsed.data.serialNumber || null,
  });

  if (error) {
    return {
      ok: false,
      message: error.message.includes("assets_serial_unique")
        ? "같은 시리얼번호의 자산이 이미 있습니다."
        : rpcMessage(error.message, "자산을 등록하지 못했습니다."),
    };
  }

  revalidateAssets();
  return { ok: true };
}

export async function setAssetStatus(
  assetId: string,
  status: string,
): Promise<AssetActionResult> {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(assetId).success) {
    return { ok: false, message: "자산을 찾을 수 없습니다." };
  }
  /*
   * 'loaned'는 여기서 받지 않는다. 대여중은 approve_asset_loan()이 대여 행과
   * 함께 만드는 상태고, 손으로 지정하면 대여 기록 없는 '대여중' 자산이 생긴다.
   */
  const parsed = z.enum(MANUAL_ASSET_STATUSES).safeParse(status);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        status === "loaned"
          ? "대여중은 대여 신청을 승인할 때만 지정됩니다."
          : "알 수 없는 상태입니다.",
    };
  }

  /*
   * 대여중인 자산의 상태를 손으로 바꾸면 대여 이력과 어긋난다.
   * 반납 확인을 먼저 하도록 막는다.
   */
  const { count } = await supabase
    .from("asset_loans")
    .select("id", { count: "exact", head: true })
    .eq("asset_id", assetId)
    .not("loaned_at", "is", null)
    .is("returned_at", null);

  if (count) {
    return { ok: false, message: "대여 중인 자산입니다. 반납 확인을 먼저 처리하세요." };
  }

  const { error } = await supabase
    .from("assets")
    .update({ status: parsed.data })
    .eq("id", assetId);

  if (error) {
    return { ok: false, message: rpcMessage(error.message, "상태를 변경하지 못했습니다.") };
  }

  revalidateAssets();
  return { ok: true };
}

export async function approveAssetLoan(
  loanId: string,
  expectedReturnDate?: string,
): Promise<AssetActionResult> {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(loanId).success) {
    return { ok: false, message: "신청을 찾을 수 없습니다." };
  }

  const { error } = await supabase.rpc("approve_asset_loan", {
    p_loan_id: loanId,
    p_expected_return_date: expectedReturnDate || null,
  });

  if (error) {
    return { ok: false, message: rpcMessage(error.message, "승인하지 못했습니다.") };
  }

  revalidateAssets();
  return { ok: true };
}

export async function rejectAssetLoan(
  loanId: string,
  reason?: string,
): Promise<AssetActionResult> {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(loanId).success) {
    return { ok: false, message: "신청을 찾을 수 없습니다." };
  }

  const { error } = await supabase.rpc("reject_asset_loan", {
    p_loan_id: loanId,
    p_reason: reason?.trim() || null,
  });

  if (error) {
    return { ok: false, message: rpcMessage(error.message, "반려하지 못했습니다.") };
  }

  revalidateAssets();
  return { ok: true };
}

export async function confirmAssetReturn(loanId: string): Promise<AssetActionResult> {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(loanId).success) {
    return { ok: false, message: "대여를 찾을 수 없습니다." };
  }

  const { error } = await supabase.rpc("confirm_asset_return", { p_loan_id: loanId });

  if (error) {
    return { ok: false, message: rpcMessage(error.message, "반납 확인에 실패했습니다.") };
  }

  revalidateAssets();
  return { ok: true };
}

/* ── 복지포인트 ───────────────────────────────────────────────────── */

const welfareRequestSchema = z.object({
  amount: z
    .number({ message: "금액을 입력하세요." })
    .positive("0보다 큰 금액을 입력하세요.")
    .max(100_000_000, "금액이 너무 큽니다."),
  purpose: z
    .string()
    .trim()
    .min(1, "사용 용도를 입력하세요.")
    .max(500, "500자 이내로 입력하세요."),
});

export async function requestWelfarePoints(input: {
  amount: number;
  purpose: string;
  year: number;
}): Promise<AssetActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  const parsed = welfareRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  /*
   * 잔여를 미리 본다. DB CHECK(used_points <= granted_points)는 승인 시점에
   * 걸리는데, 그때 막히면 신청한 사람은 며칠 뒤에야 "안 됐다"를 알게 된다.
   * 대기 중인 신청까지 빼서 본다 — 안 그러면 같은 금액을 두 번 신청하고
   * 둘 다 승인 대기로 남는다.
   */
  const [{ data: balance }, { data: pending }] = await Promise.all([
    supabase
      .from("welfare_point_balances")
      .select("granted_points, used_points")
      .eq("employee_id", me.id)
      .eq("year", input.year)
      .maybeSingle<{ granted_points: number; used_points: number }>(),
    supabase
      .from("welfare_point_requests")
      .select("amount")
      .eq("employee_id", me.id)
      .eq("year", input.year)
      .eq("status", "pending"),
  ]);

  if (!balance) {
    return { ok: false, message: `${input.year}년 복지포인트가 아직 지급되지 않았습니다.` };
  }

  const pendingTotal = (pending ?? []).reduce(
    (sum, row) => sum + Number((row as { amount: number }).amount),
    0,
  );
  const available =
    Number(balance.granted_points) - Number(balance.used_points) - pendingTotal;

  if (parsed.data.amount > available) {
    return {
      ok: false,
      message: `신청 가능한 포인트를 넘습니다. 사용 가능 ${Math.round(available).toLocaleString("ko-KR")}점${
        pendingTotal > 0
          ? ` (승인 대기 ${Math.round(pendingTotal).toLocaleString("ko-KR")}점 제외)`
          : ""
      }`,
    };
  }

  const { error } = await supabase.from("welfare_point_requests").insert({
    employee_id: me.id,
    year: input.year,
    amount: parsed.data.amount,
    purpose: parsed.data.purpose,
    status: "pending",
  });

  if (error) {
    return { ok: false, message: rpcMessage(error.message, "신청하지 못했습니다.") };
  }

  revalidateWelfare();
  return { ok: true };
}

export async function cancelWelfareRequest(
  requestId: string,
): Promise<AssetActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(requestId).success) {
    return { ok: false, message: "신청을 찾을 수 없습니다." };
  }

  const { data: deleted, error } = await supabase
    .from("welfare_point_requests")
    .delete()
    .eq("id", requestId)
    .eq("employee_id", me.id)
    .eq("status", "pending")
    .select("id");

  if (error) {
    return { ok: false, message: rpcMessage(error.message, "취소하지 못했습니다.") };
  }
  if (!deleted || deleted.length === 0) {
    return { ok: false, message: "이미 처리된 신청은 취소할 수 없습니다." };
  }

  revalidateWelfare();
  return { ok: true };
}

export async function approveWelfareRequest(
  requestId: string,
): Promise<AssetActionResult> {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(requestId).success) {
    return { ok: false, message: "신청을 찾을 수 없습니다." };
  }

  const { error } = await supabase.rpc("approve_welfare_request", {
    p_request_id: requestId,
  });

  if (error) {
    return { ok: false, message: rpcMessage(error.message, "승인하지 못했습니다.") };
  }

  revalidateWelfare();
  return { ok: true };
}

export async function rejectWelfareRequest(
  requestId: string,
  reason?: string,
): Promise<AssetActionResult> {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(requestId).success) {
    return { ok: false, message: "신청을 찾을 수 없습니다." };
  }

  const { error } = await supabase.rpc("reject_welfare_request", {
    p_request_id: requestId,
    p_reason: reason?.trim() || null,
  });

  if (error) {
    return { ok: false, message: rpcMessage(error.message, "반려하지 못했습니다.") };
  }

  revalidateWelfare();
  return { ok: true };
}

export async function grantWelfarePoints(
  year: number,
  points: number,
): Promise<AssetActionResult & { granted?: number }> {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const parsed = z
    .object({
      year: z.number().int().min(2000).max(2100),
      points: z.number().min(0, "0 이상을 입력하세요.").max(100_000_000, "금액이 너무 큽니다."),
    })
    .safeParse({ year, points });

  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const { data, error } = await supabase.rpc("grant_welfare_points", {
    p_year: parsed.data.year,
    p_points: parsed.data.points,
  });

  if (error) {
    return { ok: false, message: rpcMessage(error.message, "지급하지 못했습니다.") };
  }

  revalidateWelfare();
  return { ok: true, granted: Number(data ?? 0) };
}
