import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { addDaysYmd, todayYmd, weekdayOf } from "@/features/calendar/date";
import { isProjectStatus } from "@/features/projects/types";
import type {
  ProjectOption,
  TeamMember,
  WorkLog,
  WorkLogQuery,
  WorklogStreak,
} from "./types";

/** 연속 기록일수를 세는 창. 12주 = 근무일 60일 남짓 */
const STREAK_WINDOW_DAYS = 84;

const WORK_LOG_COLUMNS =
  "id, employee_id, log_date, content, project_id, created_at, updated_at";

/**
 * 기간 내 업무일지.
 *
 * projects를 embed하지 않는다: work_logs.project_id는 마이그레이션 19가
 * 적용되기 전까지 FK가 없어서 PostgREST가 관계를 찾지 못한다.
 * 이름은 getProjectOptions/getProjectNames로 따로 붙인다.
 */
export async function getWorkLogs(
  employeeId: string,
  fromYmd: string,
  toYmd: string,
): Promise<WorkLogQuery> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("work_logs")
    .select(WORK_LOG_COLUMNS)
    .eq("employee_id", employeeId)
    .gte("log_date", fromYmd)
    .lte("log_date", toYmd)
    .order("log_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[worklog] 업무일지 조회 실패:", error.message);
    return { logs: [], error: error.message };
  }

  return { logs: (data ?? []) as WorkLog[], error: null };
}

/** 지난 기간 대비를 만들기 위한 건수만 세는 조회 */
export async function countWorkLogs(
  employeeId: string,
  fromYmd: string,
  toYmd: string,
): Promise<number> {
  const supabase = createServerSupabase();
  const { count, error } = await supabase
    .from("work_logs")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", employeeId)
    .gte("log_date", fromYmd)
    .lte("log_date", toYmd);

  if (error) {
    console.error("[worklog] 지난 기간 기록 수 조회 실패:", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * 연속 기록일수.
 *
 * 조회 창 안의 기록일 집합과 휴일 집합을 받아 근무일만 따라 걷는다.
 * 오늘은 아직 안 썼을 수 있으므로 오늘의 공백은 연속을 끊지 않는다 —
 * 그렇지 않으면 매일 아침 모든 사람의 연속이 0으로 보인다.
 */
export async function getRecordStreak(
  employeeId: string,
  referenceYmd: string = todayYmd(),
): Promise<WorklogStreak> {
  const from = addDaysYmd(referenceYmd, -(STREAK_WINDOW_DAYS - 1));
  const supabase = createServerSupabase();

  const [{ data: rows, error }, holidays] = await Promise.all([
    supabase
      .from("work_logs")
      .select("log_date")
      .eq("employee_id", employeeId)
      .gte("log_date", from)
      .lte("log_date", referenceYmd),
    getHolidayNames(from, referenceYmd),
  ]);

  if (error) {
    console.error("[worklog] 연속 기록일수 조회 실패:", error.message);
    return { current: 0, longest: 0, lastDate: null };
  }

  const recorded = new Set(
    (rows ?? []).map((row) => row.log_date as string),
  );
  const nonWorking = new Set(Object.keys(holidays));

  return computeStreak(recorded, nonWorking, from, referenceYmd);
}

/** 근무일인가 — 주말도 공휴일도 아닌 날 */
function isWorkingDay(ymd: string, nonWorking: Set<string>): boolean {
  const weekday = weekdayOf(ymd);
  return weekday !== 0 && weekday !== 6 && !nonWorking.has(ymd);
}

function computeStreak(
  recorded: Set<string>,
  nonWorking: Set<string>,
  fromYmd: string,
  referenceYmd: string,
): WorklogStreak {
  let current = 0;
  let cursor = referenceYmd;

  // 오늘이 근무일인데 아직 안 썼다면 어제부터 센다
  if (isWorkingDay(cursor, nonWorking) && !recorded.has(cursor)) {
    cursor = addDaysYmd(cursor, -1);
  }

  for (let guard = 0; guard < 400 && cursor >= fromYmd; guard += 1) {
    if (!isWorkingDay(cursor, nonWorking)) {
      cursor = addDaysYmd(cursor, -1);
      continue;
    }
    if (!recorded.has(cursor)) break;
    current += 1;
    cursor = addDaysYmd(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let day = fromYmd;
  for (let guard = 0; guard < 400 && day <= referenceYmd; guard += 1) {
    if (isWorkingDay(day, nonWorking)) {
      if (recorded.has(day)) {
        run += 1;
        if (run > longest) longest = run;
      } else {
        run = 0;
      }
    }
    day = addDaysYmd(day, 1);
  }

  const lastDate = Array.from(recorded).sort().pop() ?? null;
  return { current, longest, lastDate };
}

/** 기간 내 비근무 공휴일 이름 — 스트립 색과 근무일 분모에 함께 쓴다 */
export async function getHolidayNames(
  fromYmd: string,
  toYmd: string,
): Promise<Record<string, string>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("holidays")
    .select("date, name")
    .eq("is_non_working", true)
    .gte("date", fromYmd)
    .lte("date", toYmd);

  if (error) {
    console.error("[worklog] 공휴일 조회 실패:", error.message);
    return {};
  }

  const result: Record<string, string> = {};
  (data ?? []).forEach((row) => {
    result[row.date as string] = row.name as string;
  });
  return result;
}

/**
 * 팀장이 조회할 수 있는 팀원 목록.
 *
 * 화면에서 팀·부서 조인을 재현하지 않는다 — 그러면 판정 기준이
 * manages_employee()와 갈려서 RLS가 막는 사람을 드롭다운에 띄우게 된다.
 */
export async function getTeamMembers(): Promise<TeamMember[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("my_team_members");

  if (error) {
    console.error("[worklog] 팀원 목록 조회 실패:", error.message);
    return [];
  }

  return ((data ?? []) as TeamMember[]).map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position ?? null,
    team_name: row.team_name ?? null,
  }));
}

/**
 * 태깅 드롭다운에 올릴 프로젝트.
 *
 * projects는 마이그레이션 19에서 생긴다. 아직 없으면 조회가 실패하는데,
 * 그때 화면 전체를 죽이지 않고 빈 목록으로 떨어뜨린다 —
 * 업무일지는 프로젝트 없이도 성립하는 기록이다.
 */
export async function getProjectOptions(): Promise<ProjectOption[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, status")
    .neq("status", "cancelled")
    .order("name");

  if (error) {
    console.error("[worklog] 프로젝트 목록 조회 실패:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    /*
     * CHECK 제약이 다섯 값을 보장하지만, 상태가 늘어난 뒤 배포 순서가 어긋나면
     * 화면이 라벨을 찾지 못한다. 모르는 값은 기획중으로 떨어뜨린다 —
     * 목록에서 통째로 빼면 태깅할 수 있던 프로젝트가 조용히 사라진다.
     */
    status: isProjectStatus(row.status) ? row.status : "planning",
  }));
}

/**
 * 드롭다운에 없는 프로젝트의 이름.
 * 이미 취소된 프로젝트를 달아 둔 옛 기록이 이름을 잃지 않게 한다.
 */
export async function getProjectNames(
  ids: string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name")
    .in("id", ids);

  if (error) {
    console.error("[worklog] 프로젝트 이름 조회 실패:", error.message);
    return {};
  }

  const result: Record<string, string> = {};
  (data ?? []).forEach((row) => {
    result[row.id as string] = row.name as string;
  });
  return result;
}
