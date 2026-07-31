/**
 * 업무평가 (스펙 12)
 *
 * 마이그레이션 21의 세 테이블 모양.
 *
 * 이 모듈의 '목표'(review_goals)는 사이클 단위 공식 목표이고, 스펙 09의
 * goals는 개인이 상시로 쓰는 목표다. 이름이 겹쳐서 헷갈리기 쉬운데
 * 승인 절차와 잠금 규칙이 완전히 다르다 — 섞어 쓰면 안 된다.
 */

export type CycleStatus = "goal_setting" | "in_progress" | "completed";

export const CYCLE_STATUSES = [
  "goal_setting",
  "in_progress",
  "completed",
] as const;

export const CYCLE_STATUS_LABELS: Record<CycleStatus, string> = {
  goal_setting: "목표설정",
  in_progress: "진행중",
  completed: "완료",
};

/**
 * 목표설정·진행중은 경고가 아니다 — 정해진 순서대로 가고 있는 상태다.
 * 완료만 success로 닫는다.
 */
export const CYCLE_STATUS_TONES: Record<
  CycleStatus,
  "info" | "neutral" | "success"
> = {
  goal_setting: "info",
  in_progress: "info",
  completed: "success",
};

export interface ReviewCycle {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: CycleStatus;
  created_at: string;
  updated_at: string;
}

export interface ReviewGoal {
  id: string;
  cycle_id: string;
  employee_id: string;
  content: string;
  sort_order: number;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Review {
  id: string;
  cycle_id: string;
  employee_id: string;
  /** 목표 묶음 제출 시각. 스펙 4장에 없지만 3.2 흐름에 필요해 추가했다 */
  goals_submitted_at: string | null;
  self_review: string | null;
  self_submitted_at: string | null;
  manager_review: string | null;
  manager_id: string | null;
  manager_submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** review_team_status() RPC 반환 행 */
export interface ReviewTeamRow {
  employee_id: string;
  name: string;
  position: string | null;
  team_name: string | null;
  review_id: string | null;
  goal_count: number;
  approved_goal_count: number;
  goals_submitted_at: string | null;
  self_submitted_at: string | null;
  manager_submitted_at: string | null;
}

/** review_cycle_progress() RPC 반환 행 */
export interface ReviewCycleProgress {
  total_employees: number;
  goals_submitted: number;
  self_submitted: number;
  manager_submitted: number;
}

/**
 * 한 사람이 한 사이클에서 어디까지 왔는가.
 *
 * 화면 세 곳(내 이력·작성·팀원 평가)이 같은 판정을 해야 해서 한 곳에 둔다.
 * 이걸 각 화면에서 if로 재현하면 "제출했는데 아직 작성중으로 보이는" 종류의
 * 어긋남이 생긴다.
 */
export type ReviewStage =
  | "goal_draft"
  | "goal_submitted"
  | "self_draft"
  | "self_submitted"
  | "completed";

export const REVIEW_STAGE_LABELS: Record<ReviewStage, string> = {
  goal_draft: "목표 작성중",
  goal_submitted: "목표 제출 · 승인 대기",
  self_draft: "자기평가 작성중",
  self_submitted: "자기평가 제출 · 팀장평가 대기",
  completed: "완료",
};

export const REVIEW_STAGE_TONES: Record<
  ReviewStage,
  "neutral" | "info" | "success"
> = {
  goal_draft: "neutral",
  goal_submitted: "info",
  self_draft: "neutral",
  self_submitted: "info",
  completed: "success",
};

export function reviewStage(
  review: Pick<
    Review,
    "goals_submitted_at" | "self_submitted_at" | "manager_submitted_at"
  > | null,
  cycleStatus: CycleStatus,
): ReviewStage {
  if (review?.manager_submitted_at) return "completed";
  if (review?.self_submitted_at) return "self_submitted";

  /*
   * 사이클이 목표설정 단계면 자기평가 칸은 아직 열리지도 않는다.
   * 여기서 cycleStatus를 안 보면, 목표만 낸 사람이 "자기평가 작성중"으로
   * 표시되어 지금 뭘 해야 하는지 잘못 안내한다.
   */
  if (cycleStatus === "goal_setting") {
    return review?.goals_submitted_at ? "goal_submitted" : "goal_draft";
  }

  return "self_draft";
}
