"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  requireSessionEmployee,
  requireSystemAdmin,
} from "@/lib/auth/session";
import { CYCLE_STATUSES } from "@/features/reviews/types";

/**
 * 업무평가 (스펙 12)
 *
 * 규칙의 최종 방어선은 DB에 있다(마이그레이션 21의 guard_review_columns /
 * guard_review_goal_columns / CHECK 제약). 여기서 같은 조건을 다시 보는 이유는
 * 두 가지다.
 *
 *   1) 트리거가 raise한 문구는 Postgres 예외로 올라와 화면에 그대로 뿌리면
 *      사용자가 읽을 문장이 아니다.
 *   2) "제출 후 수정 불가" 같은 규칙은 버튼을 아예 안 보여주는 게 맞는데,
 *      화면이 그 판단을 하려면 서버도 같은 판단을 해야 어긋나지 않는다.
 *
 * 그래서 여기 검사가 통과했다고 안심하지 않는다 — 통과 못 하면 그때 막고,
 * 통과했는데 DB가 막으면 그건 경합이라 그 메시지를 다듬어 돌려준다.
 */

export interface ReviewActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idSchema = z.string().regex(UUID, "대상을 찾을 수 없습니다.");

const contentSchema = z
  .string()
  .trim()
  .min(1, "내용을 입력하세요.")
  .max(2000, "2000자 이내로 입력하세요.");

const reviewTextSchema = z
  .string()
  .trim()
  .min(1, "내용을 입력하세요.")
  .max(10000, "10000자 이내로 입력하세요.");

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * DB가 막았을 때의 문구 정리.
 *
 * 트리거가 raise한 메시지는 우리가 쓴 한국어라 그대로 쓸 만하지만,
 * 제약 위반(CHECK/unique)은 영어 원문이라 걸러낸다.
 */
function dbMessage(message: string, fallback: string): string {
  if (message.includes("violates") || message.includes("constraint")) {
    console.error("[reviews] 제약 위반:", message);
    return fallback;
  }
  return message;
}

function revalidateReview(cycleId: string) {
  revalidatePath("/reviews");
  revalidatePath(`/reviews/${cycleId}`);
  revalidatePath(`/reviews/${cycleId}/team`);
  revalidatePath("/admin/reviews");
}

/* ── 목표 ─────────────────────────────────────────────────────────── */

/**
 * 목표 추가.
 *
 * 제출한 뒤에는 못 넣는다. 제출은 "이 묶음으로 승인받겠다"는 선언이라
 * 그 뒤에 항목이 늘면 팀장이 본 것과 달라진다.
 */
export async function addReviewGoal(
  cycleId: string,
  content: string,
): Promise<ReviewActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  const parsedId = idSchema.safeParse(cycleId);
  if (!parsedId.success) return { ok: false, message: "사이클을 찾을 수 없습니다." };

  const parsed = contentSchema.safeParse(content);
  if (!parsed.success) {
    return { ok: false, fieldErrors: { content: parsed.error.issues[0].message } };
  }

  const locked = await goalsLocked(cycleId, me.id);
  if (locked) return { ok: false, message: locked };

  // 정렬값은 기존 최대치 뒤에 붙인다. 전부 0이면 순서가 입력 시각에 좌우된다
  const { data: last } = await supabase
    .from("review_goals")
    .select("sort_order")
    .eq("cycle_id", cycleId)
    .eq("employee_id", me.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();

  const { error } = await supabase.from("review_goals").insert({
    cycle_id: cycleId,
    employee_id: me.id,
    content: parsed.data,
    sort_order: (last?.sort_order ?? -1) + 1,
  });

  if (error) {
    return { ok: false, message: dbMessage(error.message, "목표를 추가하지 못했습니다.") };
  }

  revalidateReview(cycleId);
  return { ok: true };
}

export async function updateReviewGoal(
  goalId: string,
  content: string,
): Promise<ReviewActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(goalId).success) {
    return { ok: false, message: "목표를 찾을 수 없습니다." };
  }

  const parsed = contentSchema.safeParse(content);
  if (!parsed.success) {
    return { ok: false, fieldErrors: { content: parsed.error.issues[0].message } };
  }

  const { data: goal } = await supabase
    .from("review_goals")
    .select("cycle_id, employee_id, approved_at")
    .eq("id", goalId)
    .maybeSingle<{ cycle_id: string; employee_id: string; approved_at: string | null }>();

  if (!goal || goal.employee_id !== me.id) {
    return { ok: false, message: "목표를 찾을 수 없습니다." };
  }
  if (goal.approved_at) {
    return { ok: false, message: "승인된 목표는 수정할 수 없습니다." };
  }

  const locked = await goalsLocked(goal.cycle_id, me.id);
  if (locked) return { ok: false, message: locked };

  const { error } = await supabase
    .from("review_goals")
    .update({ content: parsed.data })
    .eq("id", goalId);

  if (error) {
    return { ok: false, message: dbMessage(error.message, "목표를 수정하지 못했습니다.") };
  }

  revalidateReview(goal.cycle_id);
  return { ok: true };
}

export async function deleteReviewGoal(goalId: string): Promise<ReviewActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(goalId).success) {
    return { ok: false, message: "목표를 찾을 수 없습니다." };
  }

  const { data: goal } = await supabase
    .from("review_goals")
    .select("cycle_id, employee_id, approved_at")
    .eq("id", goalId)
    .maybeSingle<{ cycle_id: string; employee_id: string; approved_at: string | null }>();

  if (!goal || goal.employee_id !== me.id) {
    return { ok: false, message: "목표를 찾을 수 없습니다." };
  }
  if (goal.approved_at) {
    return { ok: false, message: "승인된 목표는 삭제할 수 없습니다." };
  }

  const locked = await goalsLocked(goal.cycle_id, me.id);
  if (locked) return { ok: false, message: locked };

  const { error } = await supabase.from("review_goals").delete().eq("id", goalId);
  if (error) {
    return { ok: false, message: dbMessage(error.message, "목표를 삭제하지 못했습니다.") };
  }

  revalidateReview(goal.cycle_id);
  return { ok: true };
}

/** 목표 묶음 제출 — reviews 행이 없으면 이때 만든다 */
export async function submitReviewGoals(
  cycleId: string,
): Promise<ReviewActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(cycleId).success) {
    return { ok: false, message: "사이클을 찾을 수 없습니다." };
  }

  const locked = await goalsLocked(cycleId, me.id);
  if (locked) return { ok: false, message: locked };

  // 빈 묶음을 제출하면 팀장 화면에 "제출 완료 · 목표 0개"가 뜬다
  const { count } = await supabase
    .from("review_goals")
    .select("id", { count: "exact", head: true })
    .eq("cycle_id", cycleId)
    .eq("employee_id", me.id);

  if (!count) {
    return { ok: false, message: "제출할 목표가 없습니다. 목표를 먼저 등록하세요." };
  }

  const { error } = await supabase.from("reviews").upsert(
    {
      cycle_id: cycleId,
      employee_id: me.id,
      goals_submitted_at: new Date().toISOString(),
    },
    { onConflict: "cycle_id,employee_id" },
  );

  if (error) {
    return { ok: false, message: dbMessage(error.message, "목표를 제출하지 못했습니다.") };
  }

  revalidateReview(cycleId);
  return { ok: true };
}

/** 제출·사이클 상태 때문에 목표를 더 못 건드리는 상태면 그 사유를 돌려준다 */
async function goalsLocked(
  cycleId: string,
  employeeId: string,
): Promise<string | null> {
  const supabase = createServerSupabase();

  const [{ data: cycle }, { data: review }] = await Promise.all([
    supabase
      .from("review_cycles")
      .select("status")
      .eq("id", cycleId)
      .maybeSingle<{ status: string }>(),
    supabase
      .from("reviews")
      .select("goals_submitted_at")
      .eq("cycle_id", cycleId)
      .eq("employee_id", employeeId)
      .maybeSingle<{ goals_submitted_at: string | null }>(),
  ]);

  if (!cycle) return "사이클을 찾을 수 없습니다.";
  if (cycle.status !== "goal_setting") {
    return "목표설정 단계가 끝나 목표를 변경할 수 없습니다.";
  }
  if (review?.goals_submitted_at) {
    return "이미 제출한 목표는 변경할 수 없습니다.";
  }
  return null;
}

/* ── 목표 승인 (팀장) ─────────────────────────────────────────────── */

export async function setReviewGoalApproval(
  goalId: string,
  approve: boolean,
): Promise<ReviewActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(goalId).success) {
    return { ok: false, message: "목표를 찾을 수 없습니다." };
  }

  const { data: goal } = await supabase
    .from("review_goals")
    .select("cycle_id, employee_id")
    .eq("id", goalId)
    .maybeSingle<{ cycle_id: string; employee_id: string }>();

  if (!goal) return { ok: false, message: "목표를 찾을 수 없습니다." };
  if (goal.employee_id === me.id) {
    return { ok: false, message: "본인의 목표는 승인할 수 없습니다." };
  }

  /*
   * approved_by와 approved_at은 CHECK(review_goals_approved_consistent)로
   * 묶여 있어 항상 같은 update에 함께 쓴다. 하나만 지우면 제약에 걸린다.
   */
  /*
   * .select()로 갱신된 행을 되받는다. 그냥 update만 하면 RLS가 대상 행을
   * 감췄을 때(내가 관리하는 사람이 아닌 경우) 0행 갱신 · 에러 없음으로 끝나서
   * 화면에는 "승인했습니다"가 뜨고 실제로는 아무것도 안 바뀐다.
   */
  const { data: updated, error } = await supabase
    .from("review_goals")
    .update(
      approve
        ? { approved_by: me.id, approved_at: new Date().toISOString() }
        : { approved_by: null, approved_at: null },
    )
    .eq("id", goalId)
    .select("id");

  if (error) {
    return {
      ok: false,
      message: dbMessage(
        error.message,
        approve ? "승인하지 못했습니다." : "승인을 취소하지 못했습니다.",
      ),
    };
  }

  if (!updated || updated.length === 0) {
    return { ok: false, message: "이 목표를 승인할 권한이 없습니다." };
  }

  revalidateReview(goal.cycle_id);
  return { ok: true };
}

/* ── 자기평가 ─────────────────────────────────────────────────────── */

export async function saveSelfReview(
  cycleId: string,
  text: string,
  submit: boolean,
): Promise<ReviewActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(cycleId).success) {
    return { ok: false, message: "사이클을 찾을 수 없습니다." };
  }

  /*
   * 임시저장은 빈 내용을 허용해야 자연스럽지만, DB CHECK
   * (reviews_self_submitted_has_content)는 제출 시 내용을 요구한다.
   * 그래서 제출일 때만 필수로 본다.
   */
  const parsed = submit
    ? reviewTextSchema.safeParse(text)
    : z.string().trim().max(10000, "10000자 이내로 입력하세요.").safeParse(text);

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const [{ data: cycle }, { data: review }] = await Promise.all([
    supabase
      .from("review_cycles")
      .select("status")
      .eq("id", cycleId)
      .maybeSingle<{ status: string }>(),
    supabase
      .from("reviews")
      .select("self_submitted_at")
      .eq("cycle_id", cycleId)
      .eq("employee_id", me.id)
      .maybeSingle<{ self_submitted_at: string | null }>(),
  ]);

  if (!cycle) return { ok: false, message: "사이클을 찾을 수 없습니다." };
  if (cycle.status === "goal_setting") {
    return { ok: false, message: "아직 목표설정 단계라 자기평가를 쓸 수 없습니다." };
  }
  /*
   * 완료된 사이클은 더 못 쓴다. 이걸 안 막으면 '완료' 전환이 표시만 바꾸고
   * 실제로는 아무것도 잠그지 않아서, 마감 뒤에 낸 평가가 조용히 섞인다.
   */
  if (cycle.status === "completed") {
    return { ok: false, message: "완료된 사이클에는 자기평가를 쓸 수 없습니다." };
  }
  if (review?.self_submitted_at) {
    return { ok: false, message: "이미 제출한 자기평가는 수정할 수 없습니다." };
  }

  const { error } = await supabase.from("reviews").upsert(
    {
      cycle_id: cycleId,
      employee_id: me.id,
      self_review: parsed.data,
      ...(submit ? { self_submitted_at: new Date().toISOString() } : {}),
    },
    { onConflict: "cycle_id,employee_id" },
  );

  if (error) {
    return {
      ok: false,
      message: dbMessage(
        error.message,
        submit ? "제출하지 못했습니다." : "저장하지 못했습니다.",
      ),
    };
  }

  revalidateReview(cycleId);
  return { ok: true };
}

/* ── 팀장평가 ─────────────────────────────────────────────────────── */

export async function saveManagerReview(
  cycleId: string,
  employeeId: string,
  text: string,
  submit: boolean,
): Promise<ReviewActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  if (
    !idSchema.safeParse(cycleId).success ||
    !idSchema.safeParse(employeeId).success
  ) {
    return { ok: false, message: "대상을 찾을 수 없습니다." };
  }
  if (employeeId === me.id) {
    return { ok: false, message: "본인의 평가는 작성할 수 없습니다." };
  }

  const parsed = submit
    ? reviewTextSchema.safeParse(text)
    : z.string().trim().max(10000, "10000자 이내로 입력하세요.").safeParse(text);

  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const [{ data: cycle }, { data: review }] = await Promise.all([
    supabase
      .from("review_cycles")
      .select("status")
      .eq("id", cycleId)
      .maybeSingle<{ status: string }>(),
    supabase
      .from("reviews")
      .select("manager_submitted_at")
      .eq("cycle_id", cycleId)
      .eq("employee_id", employeeId)
      .maybeSingle<{ manager_submitted_at: string | null }>(),
  ]);

  if (!cycle) return { ok: false, message: "사이클을 찾을 수 없습니다." };
  // 자기평가와 같은 이유 — '완료'가 실제로 잠그지 않으면 마감의 의미가 없다
  if (cycle.status === "completed") {
    return { ok: false, message: "완료된 사이클에는 팀장평가를 쓸 수 없습니다." };
  }
  if (review?.manager_submitted_at) {
    return { ok: false, message: "이미 제출한 팀장평가는 수정할 수 없습니다." };
  }

  /*
   * manager_id를 항상 함께 쓴다. CHECK(reviews_manager_submitted_has_author)가
   * 제출 시 작성자를 요구하기도 하고, 팀장이 바뀐 뒤에도 "누가 평가했는지"가
   * 남아야 평가 자료로 쓸 수 있다.
   */
  const { error } = await supabase.from("reviews").upsert(
    {
      cycle_id: cycleId,
      employee_id: employeeId,
      manager_review: parsed.data,
      manager_id: me.id,
      ...(submit ? { manager_submitted_at: new Date().toISOString() } : {}),
    },
    { onConflict: "cycle_id,employee_id" },
  );

  if (error) {
    return {
      ok: false,
      message: dbMessage(
        error.message,
        submit ? "제출하지 못했습니다." : "저장하지 못했습니다.",
      ),
    };
  }

  revalidateReview(cycleId);
  return { ok: true };
}

/* ── 사이클 관리 (시스템 관리자) ──────────────────────────────────── */

const cycleSchema = z
  .object({
    name: z.string().trim().min(1, "사이클 이름을 입력하세요.").max(120, "120자 이내로 입력하세요."),
    startDate: z
      .string()
      .trim()
      .regex(/^(\d{4}-\d{2}-\d{2})?$/, "날짜 형식이 올바르지 않습니다.")
      .optional(),
    endDate: z
      .string()
      .trim()
      .regex(/^(\d{4}-\d{2}-\d{2})?$/, "날짜 형식이 올바르지 않습니다.")
      .optional(),
  })
  .refine(
    (v) => !v.startDate || !v.endDate || v.startDate <= v.endDate,
    // 기간이 거꾸로면 참고자료(해당 기간 업무일지)가 언제나 비어 나온다
    { path: ["endDate"], message: "종료일이 시작일보다 빠릅니다." },
  );

export async function createReviewCycle(
  input: { name: string; startDate?: string; endDate?: string },
): Promise<ReviewActionResult> {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const parsed = cycleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const { error } = await supabase.from("review_cycles").insert({
    name: parsed.data.name,
    start_date: parsed.data.startDate || null,
    end_date: parsed.data.endDate || null,
    status: "goal_setting",
  });

  if (error) {
    return { ok: false, message: dbMessage(error.message, "사이클을 만들지 못했습니다.") };
  }

  revalidatePath("/admin/reviews");
  revalidatePath("/reviews");
  return { ok: true };
}

export async function setReviewCycleStatus(
  cycleId: string,
  status: string,
): Promise<ReviewActionResult> {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  if (!idSchema.safeParse(cycleId).success) {
    return { ok: false, message: "사이클을 찾을 수 없습니다." };
  }

  const parsed = z.enum(CYCLE_STATUSES).safeParse(status);
  if (!parsed.success) return { ok: false, message: "알 수 없는 단계입니다." };

  const { error } = await supabase
    .from("review_cycles")
    .update({ status: parsed.data })
    .eq("id", cycleId);

  if (error) {
    return { ok: false, message: dbMessage(error.message, "단계를 변경하지 못했습니다.") };
  }

  revalidateReview(cycleId);
  return { ok: true };
}
