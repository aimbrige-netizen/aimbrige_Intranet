import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { todayYmd } from "@/features/calendar/date";

/**
 * 관리자 대시보드 집계 (스펙 18 · 마이그레이션 25).
 *
 * 전부 security definer 함수다. 전사 집계는 RLS를 우회해야 나오고
 * (employees는 본인 행만, 근태·휴가는 본인+팀원만 보인다), 그래서 함수 첫 줄의
 * is_system_admin()이 곧 권한 경계다. 여기서 다시 검사하지 않는다 —
 * 같은 검사를 두 벌 두면 한쪽만 고쳐지는 날이 온다.
 *
 * 실패하면 전부 null을 돌려준다. 빈 값이나 0으로 대체하면 화면이 "전사 0명"과
 * "못 불러왔다"를 같은 모양으로 그리고, 관리자는 그 0을 사실로 믿는다.
 * getAuditActionCounts(features/audit/data.ts)가 세운 태도를 따른다.
 *
 * ⚠ 위젯 C(연차 사용률)는 leave_balances를 한 글자도 읽지 않는다.
 * accrued_days는 직원이 /attendance를 열어야 채워지는 lazy write 캐시라
 * (호출 지점이 getLeaveSummary() 한 곳뿐이고 스케줄러가 없다) 한 번도 화면을
 * 안 연 직원이 발생 0일로 잡혀 회사 평균 사용률이 실제보다 높게 나온다.
 * 발생일수는 leave_year_of()가 입사일에서 계산하고, 산정할 수 없는 인원은
 * uncomputedCount로 따로 온다.
 */

/** 위젯 E가 "최근"으로 보는 구간. 마이그레이션 25 recent_hires의 기본값과 같다 */
export const RECENT_HIRE_DAYS = 90;

/** numeric은 드라이버에 따라 문자열로 올 수 있다 — 합계에 쓰기 전에 한 번 맞춘다 */
function num(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

/* ── A. 인원 현황 ──────────────────────────────────────────────────── */

export interface HeadcountSummary {
  total: number;
  active: number;
  onLeave: number;
  terminated: number;
  /**
   * auth_user_id가 비어 로그인할 수 없는 인원. 퇴사자는 빼고 센다 —
   * 계정은 첫 로그인 때 연결되므로 로그인 없이 퇴사한 사람은 영원히
   * 미연결로 남고, 그걸 세면 조치할 것이 없는데 경고가 상시 켜진다.
   * 분모도 같은 기준(재직+휴직)이어야 한다.
   */
  unlinked: number;
  departments: number;
  teams: number;
}

interface HeadcountSummaryRow {
  total_count: number | string;
  active_count: number | string;
  on_leave_count: number | string;
  terminated_count: number | string;
  unlinked_count: number | string;
  department_count: number | string;
  team_count: number | string;
}

export async function getHeadcountSummary(): Promise<HeadcountSummary | null> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("headcount_summary");

  if (error) {
    console.error("[admin] 인원 현황 조회 실패:", error.message);
    return null;
  }

  const row = ((data ?? []) as HeadcountSummaryRow[])[0];
  if (!row) return null;

  return {
    total: num(row.total_count),
    active: num(row.active_count),
    onLeave: num(row.on_leave_count),
    terminated: num(row.terminated_count),
    unlinked: num(row.unlinked_count),
    departments: num(row.department_count),
    teams: num(row.team_count),
  };
}

export interface DepartmentHeadcount {
  departmentId: string | null;
  /** null은 부서 미지정 인원. 빼면 막대 합이 재직 인원과 안 맞는다 */
  name: string | null;
  active: number;
  onLeave: number;
  terminated: number;
}

interface DepartmentHeadcountRow {
  department_id: string | null;
  department_name: string | null;
  active_count: number | string;
  on_leave_count: number | string;
  terminated_count: number | string;
}

/** 재직 인원 많은 순으로 이미 정렬돼 온다 — 화면에서 다시 정렬하지 않는다 */
export async function getHeadcountByDepartment(): Promise<
  DepartmentHeadcount[] | null
> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("headcount_by_department");

  if (error) {
    console.error("[admin] 부서별 인원 조회 실패:", error.message);
    return null;
  }

  return ((data ?? []) as DepartmentHeadcountRow[]).map((row) => ({
    departmentId: row.department_id,
    name: row.department_name,
    active: num(row.active_count),
    onLeave: num(row.on_leave_count),
    terminated: num(row.terminated_count),
  }));
}

/* ── B. 오늘의 출근 현황 ───────────────────────────────────────────── */

export interface TodayAttendance {
  /** 집계 기준일 — 화면이 넘긴 값을 그대로 되돌려 준다 */
  date: string;
  /** 그날 근무 대상인 재직자. 입사 예정자(미래 입사일)는 빠져 있다 */
  activeTotal: number;
  checkedIn: number;
  partialLeave: number;
  fullDayLeave: number;
  absent: number;
  /**
   * 기준일이 근무일이 아니면 true(주말 또는 holidays.is_non_working).
   * 이날의 absent는 조치 대상이 아니다 — 거의 전원이 그 칸에 들어간다.
   */
  nonWorking: boolean;
  /** 비근무일의 이유(공휴일 이름 또는 "주말"). 근무일이면 null */
  nonWorkingLabel: string | null;
}

interface TodayAttendanceRow {
  active_total: number | string;
  checked_in_count: number | string;
  partial_leave_count: number | string;
  full_day_leave_count: number | string;
  absent_count: number | string;
  non_working: boolean;
  non_working_label: string | null;
}

/**
 * 네 칸의 합은 구조적으로 activeTotal과 같다(한 사람이 정확히 한 칸).
 * 그러니 화면에서 빼기로 만들지 말 것 — 합이 어긋나면 그건 화면 버그가 아니라
 * 데이터 이상이고, 그때 드러나야 한다.
 *
 * 기준일은 함수 기본값(서울 오늘)에 맡기지 않고 화면이 넘긴다. 화면이 카드에
 * 적는 날짜와 집계한 날짜가 같은 값이어야 하기 때문이다.
 */
export async function getTodayAttendanceSummary(
  date: string = todayYmd(),
): Promise<TodayAttendance | null> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("today_attendance_summary", {
    p_date: date,
  });

  if (error) {
    console.error("[admin] 오늘 출근 현황 조회 실패:", error.message);
    return null;
  }

  const row = ((data ?? []) as TodayAttendanceRow[])[0];
  if (!row) return null;

  return {
    date,
    activeTotal: num(row.active_total),
    checkedIn: num(row.checked_in_count),
    partialLeave: num(row.partial_leave_count),
    fullDayLeave: num(row.full_day_leave_count),
    absent: num(row.absent_count),
    nonWorking: row.non_working === true,
    nonWorkingLabel: row.non_working_label,
  };
}

/* ── C. 연차 사용률 (연차연도 기준) ────────────────────────────────── */

export interface TeamLeaveUsage {
  teamId: string | null;
  /** null은 팀 미지정 인원 */
  teamName: string | null;
  departmentName: string | null;
  /** 그 팀의 재직 인원 */
  memberCount: number;
  /** 그중 연차연도를 산정할 수 있었던 인원 = 부여합·사용합의 실제 분모 */
  computedCount: number;
  /** 입사일이 없거나 아직 입사 전이라 산정에서 뺀 인원 */
  uncomputedCount: number;
  grantedDays: number;
  usedDays: number;
}

interface TeamLeaveUsageRow {
  team_id: string | null;
  team_name: string | null;
  department_name: string | null;
  member_count: number | string;
  computed_count: number | string;
  uncomputed_count: number | string;
  granted_days: number | string;
  used_days: number | string;
}

/**
 * 비율은 함수가 내지 않는다. 화면이 사용합/부여합으로 내되 uncomputedCount와
 * 함께 보여야 분모를 신뢰할 수 있어서 일부러 나누지 않은 값으로 온다.
 */
export async function getAnnualLeaveUsageByTeam(
  asOf: string = todayYmd(),
): Promise<TeamLeaveUsage[] | null> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("annual_leave_usage_by_team", {
    p_as_of: asOf,
  });

  if (error) {
    console.error("[admin] 팀별 연차 사용률 조회 실패:", error.message);
    return null;
  }

  return ((data ?? []) as TeamLeaveUsageRow[]).map((row) => ({
    teamId: row.team_id,
    teamName: row.team_name,
    departmentName: row.department_name,
    memberCount: num(row.member_count),
    computedCount: num(row.computed_count),
    uncomputedCount: num(row.uncomputed_count),
    grantedDays: num(row.granted_days),
    usedDays: num(row.used_days),
  }));
}

/* ── D. 결재 처리 현황 ─────────────────────────────────────────────── */

export interface ApprovalActivity {
  /** 기간 안에 상신된 문서 */
  submitted: number;
  /** 기간 안에 결재가 끝난 문서 — 상신과 분모가 다르다(지난달 상신분이 섞인다) */
  approved: number;
  rejected: number;
  decided: number;
  /** 결재된 건이 없으면 null. 화면은 "—"를 찍고 0.0으로 대체하지 않는다 */
  avgDecisionDays: number | null;
  /** 기간과 무관한 '지금' 값 */
  pending: number;
  oldestPendingDays: number;
}

interface ApprovalActivityRow {
  submitted_count: number | string;
  approved_count: number | string;
  rejected_count: number | string;
  decided_count: number | string;
  avg_decision_days: number | string | null;
  pending_count: number | string;
  oldest_pending_days: number | string;
}

/**
 * 상신·결재 시각을 approval_steps에서 잰다.
 * approval_documents.updated_at은 touch_updated_at 트리거가 모든 UPDATE에
 * 붙어 있고 complete_approval_document()의 시행완료 처리가 그걸 다시 밀어서,
 * "결재가 끝난 시각"이 아니다.
 */
export async function getApprovalActivity(
  from: string,
  to: string,
): Promise<ApprovalActivity | null> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("approval_activity", {
    p_from: from,
    p_to: to,
  });

  if (error) {
    console.error("[admin] 결재 처리 현황 조회 실패:", error.message);
    return null;
  }

  const row = ((data ?? []) as ApprovalActivityRow[])[0];
  if (!row) return null;

  return {
    submitted: num(row.submitted_count),
    approved: num(row.approved_count),
    rejected: num(row.rejected_count),
    decided: num(row.decided_count),
    // null은 "결재된 건이 없음"이다 — num()에 넣으면 0.0일로 둔갑한다
    avgDecisionDays:
      row.avg_decision_days === null ? null : num(row.avg_decision_days),
    pending: num(row.pending_count),
    oldestPendingDays: num(row.oldest_pending_days),
  };
}

/* ── E. 최근 입사자 ────────────────────────────────────────────────── */

export interface RecentHire {
  employeeId: string;
  name: string;
  position: string | null;
  departmentName: string | null;
  teamName: string | null;
  hiredOn: string;
  daysSince: number;
  /** 계정 미연결 = 아직 로그인할 수 없는 상태 */
  isUnlinked: boolean;
}

interface RecentHireRow {
  employee_id: string;
  employee_name: string;
  position: string | null;
  department_name: string | null;
  team_name: string | null;
  hired_on: string;
  days_since: number | string;
  is_unlinked: boolean;
}

/** 입사 예정자(미래 hire_date)는 함수가 빼고 준다 — 건수는 행 수가 그대로 답이다 */
export async function getRecentHires(
  days: number = RECENT_HIRE_DAYS,
): Promise<RecentHire[] | null> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("recent_hires", { p_days: days });

  if (error) {
    console.error("[admin] 최근 입사자 조회 실패:", error.message);
    return null;
  }

  return ((data ?? []) as RecentHireRow[]).map((row) => ({
    employeeId: row.employee_id,
    name: row.employee_name,
    position: row.position,
    departmentName: row.department_name,
    teamName: row.team_name,
    hiredOn: row.hired_on,
    daysSince: num(row.days_since),
    isUnlinked: row.is_unlinked,
  }));
}
