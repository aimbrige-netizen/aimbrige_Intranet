"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSessionEmployee } from "@/lib/auth/session";
import { GOAL_STATUSES, type GoalStatus } from "@/features/goals/types";

/**
 * 목표 (스펙 09 · 3.3)
 *
 * DB 제약 두 가지를 코드가 먼저 지킨다:
 *   goals_title_not_blank      공백만 있는 제목 금지
 *   goals_closed_consistent    status가 active가 아니면 closed_at이 반드시 있고,
 *                              active면 반드시 없다
 * 그래서 상태와 closed_at은 언제나 같은 update 한 번에 함께 쓴다.
 */

export interface GoalActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const idSchema = z.string().regex(UUID, "대상을 찾을 수 없습니다.");

const formSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "목표 제목을 입력하세요.")
    .max(120, "120자 이내로 입력하세요."),
  description: z.string().trim().max(2000, "2000자 이내로 입력하세요.").optional(),
  /** 빈 문자열은 "목표일 없음" */
  targetDate: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, "날짜 형식이 올바르지 않습니다.")
    .optional(),
});

const statusSchema = z.enum(GOAL_STATUSES);

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** 목표 추가 — 언제나 진행중으로 시작하므로 closed_at은 null이다 */
export async function createGoal(input: unknown): Promise<GoalActionResult> {
  const me = await requireSessionEmployee();

  const parsed = formSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const supabase = createServerSupabase();
  const { error } = await supabase.from("goals").insert({
    employee_id: me.id,
    title: parsed.data.title,
    description: parsed.data.description ? parsed.data.description : null,
    target_date: parsed.data.targetDate ? parsed.data.targetDate : null,
    status: "active",
    closed_at: null,
  });

  if (error) {
    console.error("[goals] 추가 실패:", error.message);
    return { ok: false, message: error.message };
  }

  revalidatePath("/goals");
  return { ok: true };
}

/** 제목·설명·목표일 수정. 상태는 setGoalStatus가 따로 다룬다 */
export async function updateGoal(
  id: string,
  input: unknown,
): Promise<GoalActionResult> {
  const me = await requireSessionEmployee();

  const key = idSchema.safeParse(id);
  if (!key.success) return { ok: false, message: "대상을 찾을 수 없습니다." };

  const parsed = formSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("goals")
    .update({
      title: parsed.data.title,
      description: parsed.data.description ? parsed.data.description : null,
      target_date: parsed.data.targetDate ? parsed.data.targetDate : null,
    })
    .eq("id", key.data)
    .eq("employee_id", me.id);

  if (error) {
    console.error("[goals] 수정 실패:", error.message);
    return { ok: false, message: error.message };
  }

  revalidatePath("/goals");
  return { ok: true };
}

/**
 * 상태 변경 (진행중 / 완료 / 중단).
 *
 * closed_at을 같은 update에 실어 보낸다. 나눠 쓰면 그 사이에
 * goals_closed_consistent를 어기는 순간이 생긴다.
 * 진행중으로 되돌리면 closed_at은 null로 지운다.
 */
export async function setGoalStatus(
  id: string,
  status: GoalStatus,
): Promise<GoalActionResult> {
  const me = await requireSessionEmployee();

  const key = idSchema.safeParse(id);
  if (!key.success) return { ok: false, message: "대상을 찾을 수 없습니다." };

  const parsedStatus = statusSchema.safeParse(status);
  if (!parsedStatus.success) {
    return { ok: false, message: "알 수 없는 상태입니다." };
  }

  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("goals")
    .update({
      status: parsedStatus.data,
      closed_at:
        parsedStatus.data === "active" ? null : new Date().toISOString(),
    })
    .eq("id", key.data)
    .eq("employee_id", me.id);

  if (error) {
    console.error("[goals] 상태 변경 실패:", error.message);
    return { ok: false, message: error.message };
  }

  revalidatePath("/goals");
  return { ok: true };
}

export async function deleteGoal(id: string): Promise<GoalActionResult> {
  const me = await requireSessionEmployee();

  const key = idSchema.safeParse(id);
  if (!key.success) return { ok: false, message: "대상을 찾을 수 없습니다." };

  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("goals")
    .delete()
    .eq("id", key.data)
    .eq("employee_id", me.id);

  if (error) {
    console.error("[goals] 삭제 실패:", error.message);
    return { ok: false, message: error.message };
  }

  revalidatePath("/goals");
  return { ok: true };
}
