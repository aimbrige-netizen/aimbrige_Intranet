import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type { Goal } from "./types";

/**
 * 목표 조회.
 *
 * RLS(goals_select)는 본인 것 + 팀장이 보는 팀원 것 + 관리자 전체를 통과시킨다.
 * 그래도 employee_id를 명시한다 — 화면은 언제나 "한 사람의 목표"를 그리고,
 * 팀장이 팀원을 고르면 그 사람 것만 보여야 한다. 조건을 빼면 관리자 화면에
 * 전사 목표가 한 덩어리로 쏟아진다.
 *
 * 조회 대상 판정은 화면에서 팀 조인을 재현하지 않고 my_team_members() RPC에
 * 맡긴다(업무일지와 같은 규약) — 그래야 드롭다운과 RLS가 갈리지 않는다.
 */

const MAX_ROWS = 300;

const COLUMNS =
  "id, employee_id, title, description, target_date, status, closed_at, created_at, updated_at";

export interface GoalLoadResult {
  rows: Goal[];
  /** 조회 실패 사유. 화면에 그대로 노출한다 */
  error: string | null;
}

export async function getGoals(employeeId: string): Promise<GoalLoadResult> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("goals")
    .select(COLUMNS)
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    console.error("[goals] 목록 조회 실패:", error.message);
    return { rows: [], error: error.message };
  }

  const rows = (data ?? []) as Goal[];

  /*
   * 진행중이 먼저, 그 안에서는 목표일이 가까운 순.
   * 목표일이 없는 것은 뒤로 보낸다 — 날짜가 있는 쪽이 먼저 챙길 대상이다.
   * PostgREST의 nullsFirst 옵션 대신 여기서 정렬하는 이유는 상태 우선순위와
   * 날짜 정렬을 한 번에 표현해야 하기 때문이다.
   */
  const rank: Record<Goal["status"], number> = {
    active: 0,
    completed: 1,
    dropped: 2,
  };

  const sorted = [...rows].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    if (a.status === "active") {
      if (a.target_date && b.target_date) {
        return a.target_date.localeCompare(b.target_date);
      }
      if (a.target_date) return -1;
      if (b.target_date) return 1;
    } else {
      // 마감된 목표는 최근에 닫은 것부터
      const closed = (b.closed_at ?? "").localeCompare(a.closed_at ?? "");
      if (closed !== 0) return closed;
    }
    return b.created_at.localeCompare(a.created_at);
  });

  return { rows: sorted, error: null };
}
