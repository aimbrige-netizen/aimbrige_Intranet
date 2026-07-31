/**
 * 내 할일 (스펙 09 · 3.2)
 *
 * 마이그레이션 18의 todos 테이블을 그대로 옮긴 모양이다.
 * is_completed와 completed_at은 CHECK 제약(todos_completed_consistent)으로
 * 묶여 있어 화면·액션 어디서도 따로 움직이지 않는다.
 */
export interface Todo {
  id: string;
  employee_id: string;
  content: string;
  is_completed: boolean;
  /** 완료 시각. is_completed와 항상 같이 채워지고 같이 비워진다 */
  completed_at: string | null;
  due_date: string | null;
  sort_order: number;
  created_at: string;
}

/** 목록 필터 — 건수를 달아 칩으로 노출한다 */
export type TodoFilter = "all" | "open" | "done";

export const TODO_FILTER_LABELS: Record<TodoFilter, string> = {
  all: "전체",
  open: "미완료",
  done: "완료",
};
