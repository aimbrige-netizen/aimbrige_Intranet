"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSessionEmployee } from "@/lib/auth/session";

/**
 * 내 할일 (스펙 09 · 3.2)
 *
 * todos는 완전 개인 데이터라 RLS(todos_all)가 본인 행만 통과시킨다.
 * 그래도 모든 쓰기에 employee_id 조건을 함께 건다 — 정책 한 줄에 기대는 대신
 * 쿼리 자체가 "내 것만 건드린다"를 말하게 한다.
 *
 * DB 제약 두 가지를 코드가 먼저 지킨다:
 *   todos_content_not_blank      공백만 있는 내용 금지
 *   todos_completed_consistent   is_completed와 completed_at은 함께 움직인다
 */

export interface TodoActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const idSchema = z.string().regex(UUID, "대상을 찾을 수 없습니다.");

const contentSchema = z
  .string()
  .trim()
  .min(1, "할 일을 입력하세요.")
  .max(300, "300자 이내로 입력하세요.");

/** 빈 문자열은 "마감일 없음"이다 — 폼에서 지우면 null로 저장된다 */
const dueSchema = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "날짜 형식이 올바르지 않습니다.")
  .optional();

const createSchema = z.object({
  content: contentSchema,
  dueDate: dueSchema,
});

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * 항목 추가.
 *
 * 입력창이 목록 위에 상시 노출돼 있으므로 새 항목도 미완료 목록 맨 위에 붙는다.
 * 끝에 붙이면 목록이 길 때 방금 넣은 것이 화면 밖으로 나가 "안 들어갔나?"가 된다.
 */
export async function createTodo(input: unknown): Promise<TodoActionResult> {
  const me = await requireSessionEmployee();

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const supabase = createServerSupabase();

  const { data: head, error: headError } = await supabase
    .from("todos")
    .select("sort_order")
    .eq("employee_id", me.id)
    .eq("is_completed", false)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();

  if (headError) {
    console.error("[todos] 정렬 기준 조회 실패:", headError.message);
    return { ok: false, message: headError.message };
  }

  const { error } = await supabase.from("todos").insert({
    employee_id: me.id,
    content: parsed.data.content,
    due_date: parsed.data.dueDate ? parsed.data.dueDate : null,
    sort_order: head ? head.sort_order - 1 : 0,
    // 완료 두 컬럼은 항상 짝으로 쓴다 (todos_completed_consistent)
    is_completed: false,
    completed_at: null,
  });

  if (error) {
    console.error("[todos] 추가 실패:", error.message);
    return { ok: false, message: error.message };
  }

  revalidatePath("/todos");
  return { ok: true };
}

/** 체크로 완료·해제. 두 컬럼을 한 번에 쓴다 */
export async function setTodoCompleted(
  id: string,
  completed: boolean,
): Promise<TodoActionResult> {
  const me = await requireSessionEmployee();

  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: "대상을 찾을 수 없습니다." };

  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("todos")
    .update({
      is_completed: completed,
      completed_at: completed ? new Date().toISOString() : null,
    })
    .eq("id", parsed.data)
    .eq("employee_id", me.id);

  if (error) {
    console.error("[todos] 완료 처리 실패:", error.message);
    return { ok: false, message: error.message };
  }

  revalidatePath("/todos");
  return { ok: true };
}

/**
 * 순서 변경 — 미완료 목록의 전체 순서를 받는다.
 *
 * 받은 순서를 그대로 0..n-1로 쓰되, 지금 값과 다른 행만 갱신한다.
 * 전부 다시 쓰면 30건짜리 목록에서 한 칸 옮길 때마다 30번을 왕복한다.
 *
 * upsert로 한 번에 보내지 않는 이유: todos는 content가 NOT NULL이라
 * (id, sort_order)만 담은 배열을 upsert하면 content가 NULL로 덮여
 * todos_content_not_blank에 걸린다.
 */
export async function reorderTodos(ids: string[]): Promise<TodoActionResult> {
  const me = await requireSessionEmployee();

  const parsed = z.array(idSchema).max(500).safeParse(ids);
  if (!parsed.success) return { ok: false, message: "순서를 읽지 못했습니다." };

  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("todos")
    .select("id, sort_order")
    .eq("employee_id", me.id)
    .eq("is_completed", false);

  if (error) {
    console.error("[todos] 현재 순서 조회 실패:", error.message);
    return { ok: false, message: error.message };
  }

  const current = new Map(
    ((data ?? []) as { id: string; sort_order: number }[]).map((row) => [
      row.id,
      row.sort_order,
    ]),
  );

  const changed = parsed.data
    .map((id, index) => ({ id, index }))
    // 내 미완료 목록에 없는 id는 무시한다 (화면이 낡았을 때의 방어)
    .filter(({ id, index }) => current.has(id) && current.get(id) !== index);

  if (changed.length === 0) return { ok: true };

  const results = await Promise.all(
    changed.map(({ id, index }) =>
      supabase
        .from("todos")
        .update({ sort_order: index })
        .eq("id", id)
        .eq("employee_id", me.id),
    ),
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) {
    console.error("[todos] 순서 저장 실패:", failed.error.message);
    return { ok: false, message: failed.error.message };
  }

  revalidatePath("/todos");
  return { ok: true };
}

export async function deleteTodo(id: string): Promise<TodoActionResult> {
  const me = await requireSessionEmployee();

  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: "대상을 찾을 수 없습니다." };

  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("todos")
    .delete()
    .eq("id", parsed.data)
    .eq("employee_id", me.id);

  if (error) {
    console.error("[todos] 삭제 실패:", error.message);
    return { ok: false, message: error.message };
  }

  revalidatePath("/todos");
  return { ok: true };
}
