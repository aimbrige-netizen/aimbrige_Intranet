/**
 * 목표 (스펙 09 · 3.3)
 *
 * 마이그레이션 18의 goals 테이블 모양. status가 active가 아니면 closed_at이
 * 반드시 있어야 한다(goals_closed_consistent) — 두 값은 항상 함께 바뀐다.
 *
 * 이 화면의 목표는 스펙 12(업무평가)의 분기별 공식 목표와 별개인 개인용이다.
 */
export type GoalStatus = "active" | "completed" | "dropped";

export interface Goal {
  id: string;
  employee_id: string;
  title: string;
  description: string | null;
  target_date: string | null;
  status: GoalStatus;
  /** 완료·중단한 시각. status가 active면 반드시 null */
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const GOAL_STATUSES = ["active", "completed", "dropped"] as const;

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  active: "진행중",
  completed: "완료",
  dropped: "중단",
};

/**
 * 진행중은 danger가 아니다 — 아직 하고 있는 일이지 위반이 아니다.
 * 중단도 실패가 아니라 "더 안 하기로 한 것"이라 중립으로 둔다.
 */
export const GOAL_STATUS_TONES: Record<
  GoalStatus,
  "info" | "success" | "neutral"
> = {
  active: "info",
  completed: "success",
  dropped: "neutral",
};

export type GoalFilter = "all" | GoalStatus;

export const GOAL_FILTER_LABELS: Record<GoalFilter, string> = {
  all: "전체",
  ...GOAL_STATUS_LABELS,
};
