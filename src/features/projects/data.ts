import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { isOpen } from "./format";
import type {
  ProjectDetail,
  ProjectListRow,
  ProjectMilestone,
  ProjectStatus,
  ProjectTeam,
  ProjectWorkLog,
} from "./types";

/**
 * 프로젝트 조회 (스펙 10 · 3.1 / 3.3)
 *
 * projects의 RLS는 전체 SELECT다 — 프로젝트별 비공개는 스펙 10 · 6장에서
 * 명시적으로 미룬 항목이라 목록에 소유자 필터를 걸지 않는다.
 *
 * 조회 실패를 빈 배열로 뭉개지 않는다. "아직 없다"와 "못 불러왔다"는
 * 사용자가 해야 할 행동이 완전히 다르므로 error를 함께 올려 화면이
 * 사실대로 말하게 한다.
 */

const MAX_ROWS = 300;

const PROJECT_COLUMNS =
  "id, name, team_id, owner_id, status, start_date, end_date, description, result_summary, created_at, updated_at";

/*
 * employees·teams와 projects 사이에는 FK가 각각 하나뿐이라 힌트 없이도 붙지만,
 * 컬럼명을 적어 두면 나중에 팀 담당자 FK가 늘어도 embed가 흔들리지 않는다
 * (세션 조회가 departments!department_id를 쓰는 것과 같은 이유).
 */
const TEAM_SELECT = "team:teams!team_id(id, name)";
const OWNER_SELECT =
  "owner:employees!owner_id(id, name, position, profile_image_url)";

export interface ProjectListResult {
  rows: ProjectListRow[];
  /** 조회 실패 사유. 화면에 그대로 노출한다 */
  error: string | null;
}

export interface ProjectListFilter {
  /** 프로젝트명 부분일치 */
  q?: string;
}

/**
 * 목록.
 *
 * 상태·팀 필터는 여기서 걸지 않는다 — 칩이 "각각 몇 건인지"를 누르기 전에
 * 보여주려면 걸러내기 전의 모수가 필요하다. 검색어만 DB에서 좁히고
 * 나머지는 화면에서 나눈다(요약 밴드와 칩 건수가 언제나 같은 모수를 본다).
 */
export async function getProjects(
  filter: ProjectListFilter = {},
): Promise<ProjectListResult> {
  const supabase = createServerSupabase();

  let query = supabase
    .from("projects")
    .select(
      `${PROJECT_COLUMNS}, ${TEAM_SELECT}, ${OWNER_SELECT}, milestones:project_milestones(id, is_completed, due_date)`,
    )
    .limit(MAX_ROWS);

  if (filter.q) {
    // PostgREST 필터 문법에서 구분자로 쓰이는 문자는 미리 털어낸다
    const keyword = filter.q.replace(/[,()%*]/g, "").trim();
    if (keyword) query = query.ilike("name", `%${keyword}%`);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    console.error("[projects] 목록 조회 실패:", error.message);
    return { rows: [], error: error.message };
  }

  const rows = (data ?? []) as unknown as ProjectListRow[];
  return { rows: sortProjects(rows), error: null };
}

/**
 * 굴러가는 것이 먼저, 그 안에서는 종료일이 가까운 순.
 * 종료일이 없는 것은 뒤로 보낸다 — 날짜가 있는 쪽이 먼저 챙길 대상이다.
 * 끝난 것은 최근에 손댄 순으로 내려 둔다.
 */
const STATUS_RANK: Record<ProjectStatus, number> = {
  in_progress: 0,
  planning: 1,
  on_hold: 2,
  completed: 3,
  cancelled: 4,
};

function sortProjects(rows: ProjectListRow[]): ProjectListRow[] {
  return [...rows].sort((a, b) => {
    if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) {
      return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    }
    if (isOpen(a.status)) {
      if (a.end_date && b.end_date) {
        const byDate = a.end_date.localeCompare(b.end_date);
        if (byDate !== 0) return byDate;
      } else if (a.end_date) {
        return -1;
      } else if (b.end_date) {
        return 1;
      }
      return a.name.localeCompare(b.name, "ko");
    }
    return b.updated_at.localeCompare(a.updated_at);
  });
}

export interface ProjectDetailResult {
  project: ProjectDetail | null;
  error: string | null;
}

export async function getProject(id: string): Promise<ProjectDetailResult> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("projects")
    .select(
      `${PROJECT_COLUMNS}, ${TEAM_SELECT}, ${OWNER_SELECT},
       milestones:project_milestones(id, project_id, title, due_date, is_completed, completed_at, sort_order, created_at),
       files:project_files(id, project_id, file_url, file_name, file_size, uploaded_by, uploaded_at)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[projects] 상세 조회 실패:", error.message);
    return { project: null, error: error.message };
  }
  if (!data) return { project: null, error: null };

  const row = data as unknown as ProjectDetail;

  return {
    project: {
      ...row,
      // 임베드는 순서를 보장하지 않는다. 화면 정렬은 여기서 한 번만 확정한다
      milestones: sortMilestones(row.milestones ?? []),
      files: [...(row.files ?? [])].sort((a, b) =>
        b.uploaded_at.localeCompare(a.uploaded_at),
      ),
    },
    error: null,
  };
}

/**
 * 등록 순서(sort_order)를 먼저 본다 — 마일스톤은 "일이 벌어지는 차례"라
 * 목표일만으로 정렬하면 날짜를 안 정한 항목이 전부 뒤로 밀린다.
 */
function sortMilestones(rows: ProjectMilestone[]): ProjectMilestone[] {
  return [...rows].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    if (a.due_date && b.due_date) {
      const byDate = a.due_date.localeCompare(b.due_date);
      if (byDate !== 0) return byDate;
    } else if (a.due_date) {
      return -1;
    } else if (b.due_date) {
      return 1;
    }
    return a.created_at.localeCompare(b.created_at);
  });
}

export interface ProjectWorkLogResult {
  logs: ProjectWorkLog[];
  error: string | null;
}

/**
 * 이 프로젝트로 태깅된 업무일지 (스펙 09 연동, 읽기전용).
 *
 * work_logs의 RLS가 본인 것 + 팀장이 보는 팀원 것 + 관리자 전체만 통과시키므로,
 * 여기 담기는 건 "보는 사람이 볼 권한이 있는" 기록이다. 권한 밖의 기록은
 * 애초에 넘어오지 않는다 — 화면에서 따로 거르지 않는다.
 */
export async function getProjectWorkLogs(
  projectId: string,
): Promise<ProjectWorkLogResult> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("work_logs")
    .select(
      "id, employee_id, log_date, content, created_at, employee:employees!employee_id(id, name, position)",
    )
    .eq("project_id", projectId)
    .order("log_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    console.error("[projects] 업무일지 조회 실패:", error.message);
    return { logs: [], error: error.message };
  }

  return { logs: (data ?? []) as unknown as ProjectWorkLog[], error: null };
}

/** 등록 폼·필터의 담당팀 목록 */
export async function getTeams(): Promise<ProjectTeam[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("teams")
    .select("id, name")
    .order("name");

  if (error) {
    console.error("[projects] 팀 목록 조회 실패:", error.message);
    return [];
  }
  return (data ?? []) as ProjectTeam[];
}

export interface OwnerOption {
  id: string;
  name: string;
  position: string | null;
  team_id: string | null;
}

/** 등록 폼의 담당자 후보 — 재직 중인 임직원 */
export async function getOwnerOptions(): Promise<OwnerOption[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("employees")
    .select("id, name, position, team_id")
    .eq("employment_status", "active")
    .order("name");

  if (error) {
    console.error("[projects] 담당자 후보 조회 실패:", error.message);
    return [];
  }
  return (data ?? []) as OwnerOption[];
}
