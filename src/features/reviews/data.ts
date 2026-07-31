import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type {
  Review,
  ReviewCycle,
  ReviewCycleProgress,
  ReviewGoal,
  ReviewTeamRow,
} from "./types";

/**
 * 업무평가 조회 (스펙 12)
 *
 * 조회 대상 판정은 화면에서 팀 조인을 재현하지 않고 RPC(review_team_status)에
 * 맡긴다 — 업무일지·목표와 같은 규약이다. 그래야 목록과 RLS가 갈리지 않는다.
 *
 * 모든 함수가 던지지 않고 error 문자열을 함께 돌려준다. 평가 화면은 여러
 * 조회를 병렬로 하는데 하나가 실패했다고 화면 전체가 사라지면, 무엇이 안 되는
 * 상태인지도 알 수 없게 된다.
 */

const CYCLE_COLUMNS =
  "id, name, start_date, end_date, status, created_at, updated_at";
const GOAL_COLUMNS =
  "id, cycle_id, employee_id, content, sort_order, approved_by, approved_at, created_at, updated_at";
const REVIEW_COLUMNS =
  "id, cycle_id, employee_id, goals_submitted_at, self_review, self_submitted_at, manager_review, manager_id, manager_submitted_at, created_at, updated_at";

export interface LoadResult<T> {
  data: T;
  error: string | null;
}

export async function getCycles(): Promise<LoadResult<ReviewCycle[]>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("review_cycles")
    .select(CYCLE_COLUMNS)
    // 시작일이 없는 사이클(관리자가 날짜를 아직 안 정함)은 최근 생성 순으로 뒤에
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[reviews] 사이클 목록 조회 실패:", error.message);
    return { data: [], error: error.message };
  }
  return { data: (data ?? []) as ReviewCycle[], error: null };
}

export async function getCycle(
  cycleId: string,
): Promise<LoadResult<ReviewCycle | null>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("review_cycles")
    .select(CYCLE_COLUMNS)
    .eq("id", cycleId)
    .maybeSingle<ReviewCycle>();

  if (error) {
    console.error("[reviews] 사이클 조회 실패:", error.message);
    return { data: null, error: error.message };
  }
  return { data: data ?? null, error: null };
}

/** 한 사람의 사이클별 평가 행 — 없을 수 있다(아직 아무것도 안 쓴 상태) */
export async function getReview(
  cycleId: string,
  employeeId: string,
): Promise<LoadResult<Review | null>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("reviews")
    .select(REVIEW_COLUMNS)
    .eq("cycle_id", cycleId)
    .eq("employee_id", employeeId)
    .maybeSingle<Review>();

  if (error) {
    console.error("[reviews] 평가 조회 실패:", error.message);
    return { data: null, error: error.message };
  }
  return { data: data ?? null, error: null };
}

/** 여러 사이클에 걸친 내 평가 행 — /reviews 이력 목록에서 단계 표시에 쓴다 */
export async function getMyReviews(
  employeeId: string,
): Promise<LoadResult<Review[]>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("reviews")
    .select(REVIEW_COLUMNS)
    .eq("employee_id", employeeId)
    .limit(100);

  if (error) {
    console.error("[reviews] 내 평가 목록 조회 실패:", error.message);
    return { data: [], error: error.message };
  }
  return { data: (data ?? []) as Review[], error: null };
}

export async function getReviewGoals(
  cycleId: string,
  employeeId: string,
): Promise<LoadResult<ReviewGoal[]>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("review_goals")
    .select(GOAL_COLUMNS)
    .eq("cycle_id", cycleId)
    .eq("employee_id", employeeId)
    .order("sort_order")
    .order("created_at");

  if (error) {
    console.error("[reviews] 목표 조회 실패:", error.message);
    return { data: [], error: error.message };
  }
  return { data: (data ?? []) as ReviewGoal[], error: null };
}

export async function getTeamStatus(
  cycleId: string,
): Promise<LoadResult<ReviewTeamRow[]>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("review_team_status", {
    p_cycle_id: cycleId,
  });

  if (error) {
    console.error("[reviews] 팀원 현황 조회 실패:", error.message);
    return { data: [], error: error.message };
  }
  return { data: (data ?? []) as ReviewTeamRow[], error: null };
}

/** 전사 집계 — RPC 안에서 관리자만 통과시킨다(마이그레이션 21) */
export async function getCycleProgress(
  cycleId: string,
): Promise<LoadResult<ReviewCycleProgress | null>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("review_cycle_progress", {
    p_cycle_id: cycleId,
  });

  if (error) {
    console.error("[reviews] 진행 현황 조회 실패:", error.message);
    return { data: null, error: error.message };
  }
  const rows = (data ?? []) as ReviewCycleProgress[];
  return { data: rows[0] ?? null, error: null };
}

/**
 * 자기평가 작성 화면의 참고자료 (스펙 3.2 · 5장)
 *
 * 스펙 09의 업무일지·상시목표와 스펙 10의 참여 프로젝트를 읽기전용으로 끌어온다.
 * 사이클 기간이 정해져 있지 않으면 업무일지를 기간으로 못 자르는데, 이때
 * 전 기간을 다 끌어오면 수백 건이 쏟아져 참고자료가 아니라 방해물이 된다.
 * 그래서 기간이 없으면 최근 것부터 상한만큼만 준다.
 */
const REFERENCE_LOG_LIMIT = 60;

export interface ReviewReference {
  workLogs: { id: string; log_date: string; content: string }[];
  goals: { id: string; title: string; status: string; target_date: string | null }[];
  projects: { id: string; name: string; status: string }[];
  /** 상한에 걸려 뒤가 잘렸는지 — 화면에서 "일부만 표시" 안내에 쓴다 */
  workLogsTruncated: boolean;
  error: string | null;
}

export async function getReviewReference(
  employeeId: string,
  from: string | null,
  to: string | null,
): Promise<ReviewReference> {
  const supabase = createServerSupabase();

  let logQuery = supabase
    .from("work_logs")
    .select("id, log_date, content, project_id")
    .eq("employee_id", employeeId)
    .order("log_date", { ascending: false })
    .limit(REFERENCE_LOG_LIMIT + 1);

  if (from) logQuery = logQuery.gte("log_date", from);
  if (to) logQuery = logQuery.lte("log_date", to);

  const [logs, goals, projects] = await Promise.all([
    logQuery,
    /*
     * 상시 목표와 프로젝트는 사이클 기간으로 자르지 않는다.
     * 이쪽은 "이 기간에 일어난 일"이 아니라 "지금 무엇을 들고 있는가"라
     * 기간을 걸면 사이클 전에 세워 지금도 진행 중인 목표가 사라진다 —
     * 자기평가에서 가장 근거로 쓸 만한 항목이 빠지는 셈이다.
     */
    supabase
      .from("goals")
      .select("id, title, status, target_date")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(30),
    /*
     * 참여 프로젝트는 담당자로만 잡는다. work_logs.project_id로 역추적하면
     * "한 번 태깅했을 뿐인 프로젝트"까지 참여로 잡혀 목록이 부정확해진다.
     */
    supabase
      .from("projects")
      .select("id, name, status")
      .eq("owner_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const error =
    logs.error?.message ?? goals.error?.message ?? projects.error?.message ?? null;
  if (error) console.error("[reviews] 참고자료 조회 실패:", error);

  const logRows = (logs.data ?? []) as {
    id: string;
    log_date: string;
    content: string;
  }[];

  return {
    workLogs: logRows.slice(0, REFERENCE_LOG_LIMIT),
    workLogsTruncated: logRows.length > REFERENCE_LOG_LIMIT,
    goals: (goals.data ?? []) as ReviewReference["goals"],
    projects: (projects.data ?? []) as ReviewReference["projects"],
    error,
  };
}
