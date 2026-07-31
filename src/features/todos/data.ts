import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type { Todo } from "./types";

/**
 * 할일 조회.
 *
 * 개인 데이터라 RLS(todos_all)가 본인 행만 통과시킨다. 그래도 employee_id를
 * 명시해 조건을 눈에 보이게 남긴다 — 정책이 바뀌어도 이 화면의 의미는 같다.
 */

/** 한 사람이 들고 있을 법한 최대치. 넘으면 오래된 완료 건이 잘린다 */
const MAX_ROWS = 500;

const COLUMNS =
  "id, employee_id, content, is_completed, completed_at, due_date, sort_order, created_at";

export interface TodoLoadResult {
  rows: Todo[];
  /** 조회 실패 사유. 화면에 그대로 노출한다 — 조용히 0건으로 만들지 않는다 */
  error: string | null;
}

export async function getMyTodos(employeeId: string): Promise<TodoLoadResult> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("todos")
    .select(COLUMNS)
    // 미완료가 위, 그 안에서는 사용자가 정한 순서(sort_order)
    .order("is_completed", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .eq("employee_id", employeeId)
    .limit(MAX_ROWS);

  if (error) {
    console.error("[todos] 목록 조회 실패:", error.message);
    return { rows: [], error: error.message };
  }

  const rows = (data ?? []) as Todo[];

  /*
   * 완료 항목은 sort_order가 아니라 "언제 끝냈는가" 순으로 본다.
   * 미완료의 수동 정렬과 완료의 시간 정렬은 축이 다르므로 여기서 갈라 둔다.
   */
  const open = rows.filter((r) => !r.is_completed);
  const done = rows
    .filter((r) => r.is_completed)
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));

  return { rows: [...open, ...done], error: null };
}
