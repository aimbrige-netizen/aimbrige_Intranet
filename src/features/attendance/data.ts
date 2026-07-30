import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { addDaysYmd, todayYmd, weekdayOf } from "@/features/calendar/date";
import { computeAccruedDays, nextAccrual } from "./leave-accrual";
import type { AbsentDay, AttendanceRow } from "./data-client";
import { DAILY_WORK_HOURS, WEEKLY_LIMIT_HOURS, WEEKLY_WARN_HOURS } from "./constants";
import type {
  AttendanceRecord,
  CorrectionRequest,
  Employee,
  LeaveAdjustment,
  LeaveBalance,
  LeaveRequest,
  OvertimeRequest,
} from "@/types/db";

export interface LeaveSummary {
  accrued: number;
  used: number;
  adjustment: number;
  remaining: number;
  next: { date: string; days: number } | null;
}

/**
 * 잔여 연차 요약.
 *
 * 발생일수는 입사일로부터 결정적으로 계산되므로(leave-accrual.ts 참고)
 * 화면 진입 시 계산값과 저장값이 다르면 저장값을 맞춰준다.
 * 스케줄 작업이 밀리거나 실패해도 사용자가 화면을 보는 순간 자동 복구된다.
 */
export async function getLeaveSummary(
  employeeId: string,
  hireDate: string | null,
): Promise<LeaveSummary> {
  const supabase = createServerSupabase();
  const asOf = todayYmd();
  const expectedAccrued = computeAccruedDays(hireDate, asOf);

  const { data } = await supabase
    .from("leave_balances")
    .select("*")
    .eq("employee_id", employeeId)
    .maybeSingle<LeaveBalance>();

  const used = Number(data?.used_days ?? 0);
  const adjustment = Number(data?.adjustment_days ?? 0);
  const storedAccrued = Number(data?.accrued_days ?? 0);

  // 저장값이 계산값과 다르면 맞춘다(발생분은 계산이 정답)
  if (storedAccrued !== expectedAccrued) {
    const admin = createAdminSupabase();
    const { error } = await admin.rpc("set_accrued_days", {
      target_employee_id: employeeId,
      new_accrued: expectedAccrued,
    });
    if (error) {
      console.error("[attendance] 발생 연차 동기화 실패:", error.message);
    }
  }

  return {
    accrued: expectedAccrued,
    used,
    adjustment,
    remaining: expectedAccrued - used + adjustment,
    next: nextAccrual(hireDate, asOf),
  };
}

/** 오늘의 출퇴근 기록 (홈 위젯 + 근태 화면 공용) */
export async function getTodayAttendance(
  employeeId: string,
): Promise<AttendanceRecord | null> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("attendance_records")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("work_date", todayYmd())
    .maybeSingle<AttendanceRecord>();
  return data ?? null;
}

/** 기간 내 본인 출퇴근 기록 */
export async function getAttendanceRange(
  employeeId: string,
  fromYmd: string,
  toYmd: string,
): Promise<AttendanceRecord[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("attendance_records")
    .select("*")
    .eq("employee_id", employeeId)
    .gte("work_date", fromYmd)
    .lte("work_date", toYmd)
    .order("work_date", { ascending: false });
  return (data ?? []) as AttendanceRecord[];
}

/** 근무시간(시간) — 체크인·아웃이 모두 있을 때만 */
export function workedHours(record: AttendanceRecord): number | null {
  if (!record.check_in_at || !record.check_out_at) return null;
  const ms =
    new Date(record.check_out_at).getTime() -
    new Date(record.check_in_at).getTime();
  return Math.round((ms / 3_600_000) * 10) / 10;
}

export interface WeeklyHours {
  weekStart: string;
  hours: number;
  level: "ok" | "warn" | "over";
}

/**
 * 주 52시간 경고 (스펙 3.2)
 * 정규 근무시간 + 승인된 초과근무를 합산한다.
 */
export async function getThisWeekHours(
  employeeId: string,
): Promise<WeeklyHours> {
  const today = todayYmd();
  const weekStart = addDaysYmd(today, -weekdayOf(today));
  const weekEnd = addDaysYmd(weekStart, 6);

  const supabase = createServerSupabase();
  const [{ data: records }, { data: overtimes }] = await Promise.all([
    supabase
      .from("attendance_records")
      .select("check_in_at, check_out_at")
      .eq("employee_id", employeeId)
      .gte("work_date", weekStart)
      .lte("work_date", weekEnd),
    supabase
      .from("overtime_requests")
      .select("start_time, end_time")
      .eq("employee_id", employeeId)
      .eq("status", "approved")
      .gte("work_date", weekStart)
      .lte("work_date", weekEnd),
  ]);

  let hours = 0;
  (records ?? []).forEach((r) => {
    if (!r.check_in_at || !r.check_out_at) return;
    hours +=
      (new Date(r.check_out_at as string).getTime() -
        new Date(r.check_in_at as string).getTime()) /
      3_600_000;
  });
  (overtimes ?? []).forEach((o) => {
    hours += diffTimeHours(o.start_time as string, o.end_time as string);
  });

  const rounded = Math.round(hours * 10) / 10;
  return {
    weekStart,
    hours: rounded,
    level:
      rounded > WEEKLY_LIMIT_HOURS
        ? "over"
        : rounded >= WEEKLY_WARN_HOURS
          ? "warn"
          : "ok",
  };
}

export function diffTimeHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh * 60 + em - (sh * 60 + sm)) / 60;
}

/**
 * 근무일 중 기록이 없는 날을 결근으로 채운다.
 *
 * attendance_records에는 '출근한 날'만 행이 생기므로, 결근은 행의 부재로 나타난다.
 * status='absent'를 쓰는 코드 경로가 없어 화면에서 결근이 아예 안 보이던 문제를
 * 조회 시점 계산으로 해결한다(cron 없이 정확).
 * 주말·공휴일과 승인된 휴가일은 결근이 아니다.
 */
export async function getAttendanceWithAbsences(
  employeeId: string,
  fromYmd: string,
  toYmd: string,
): Promise<AttendanceRow[]> {
  const supabase = createServerSupabase();
  const today = todayYmd();
  // 오늘은 아직 퇴근 전일 수 있어 결근 판정에서 제외한다
  const lastJudgedDay = toYmd < today ? toYmd : addDaysYmd(today, -1);

  const [records, { data: holidays }, { data: leaves }] = await Promise.all([
    getAttendanceRange(employeeId, fromYmd, toYmd),
    supabase
      .from("holidays")
      .select("date")
      .eq("is_non_working", true)
      .gte("date", fromYmd)
      .lte("date", toYmd),
    supabase
      .from("leave_requests")
      .select("start_date, end_date")
      .eq("employee_id", employeeId)
      .eq("status", "approved")
      .lte("start_date", toYmd)
      .gte("end_date", fromYmd),
  ]);

  const recorded = new Set(records.map((r) => r.work_date));
  const nonWorking = new Set((holidays ?? []).map((h) => h.date as string));

  const onLeave = new Set<string>();
  (leaves ?? []).forEach((l) => {
    let cursor = l.start_date as string;
    for (let guard = 0; guard < 400 && cursor <= (l.end_date as string); guard += 1) {
      onLeave.add(cursor);
      cursor = addDaysYmd(cursor, 1);
    }
  });

  const absences: AbsentDay[] = [];
  let cursor = fromYmd;
  for (let guard = 0; guard < 400 && cursor <= lastJudgedDay; guard += 1) {
    const weekday = weekdayOf(cursor);
    const isWeekend = weekday === 0 || weekday === 6;
    if (
      !isWeekend &&
      !nonWorking.has(cursor) &&
      !recorded.has(cursor) &&
      !onLeave.has(cursor)
    ) {
      absences.push({ absent: true, work_date: cursor });
    }
    cursor = addDaysYmd(cursor, 1);
  }

  return [...records, ...absences].sort((a, b) =>
    b.work_date.localeCompare(a.work_date),
  );
}

/** 팀원 주간 근무시간 (스펙 3.2 — 팀장에게도 52시간 경고 노출) */
export async function getTeamWeeklyHours(): Promise<
  { employeeId: string; name: string; hours: number }[]
> {
  const supabase = createServerSupabase();
  const today = todayYmd();
  const weekStart = addDaysYmd(today, -weekdayOf(today));

  const { data, error } = await supabase.rpc("team_weekly_hours", {
    p_week_start: weekStart,
  });

  if (error) {
    console.error("[attendance] 팀 주간 근무시간 조회 실패:", error.message);
    return [];
  }

  return ((data ?? []) as { employee_id: string; employee_name: string; hours: number }[]).map(
    (row) => ({
      employeeId: row.employee_id,
      name: row.employee_name,
      hours: Number(row.hours),
    }),
  );
}

/** 본인 휴가 신청 이력 */
export async function getMyLeaveRequests(
  employeeId: string,
  limit = 50,
): Promise<LeaveRequest[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("leave_requests")
    .select("*")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as LeaveRequest[];
}

export async function getMyOvertimeRequests(
  employeeId: string,
  limit = 30,
): Promise<OvertimeRequest[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("overtime_requests")
    .select("*")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as OvertimeRequest[];
}

export async function getMyCorrectionRequests(
  employeeId: string,
  limit = 30,
): Promise<CorrectionRequest[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("attendance_correction_requests")
    .select("*")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as CorrectionRequest[];
}

export async function getMyLeaveAdjustments(
  employeeId: string,
): Promise<LeaveAdjustment[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("leave_adjustments")
    .select("*")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as LeaveAdjustment[];
}

/**
 * 승인함 데이터 (스펙 3.6)
 * RLS가 "내가 관리하는 팀원 + 관리자는 전체"로 이미 걸러주므로 여기서는 상태만 나눈다.
 */
export async function getApprovalQueue(): Promise<{
  leaves: (LeaveRequest & { employee: Pick<Employee, "id" | "name"> | null })[];
  overtimes: (OvertimeRequest & {
    employee: Pick<Employee, "id" | "name"> | null;
  })[];
  corrections: (CorrectionRequest & {
    employee: Pick<Employee, "id" | "name"> | null;
  })[];
}> {
  const supabase = createServerSupabase();

  const [leaves, overtimes, corrections] = await Promise.all([
    supabase
      .from("leave_requests")
      .select("*, employee:employees!employee_id(id, name)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("overtime_requests")
      .select("*, employee:employees!employee_id(id, name)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("attendance_correction_requests")
      .select("*, employee:employees!employee_id(id, name)")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  return {
    leaves: (leaves.data ?? []) as never,
    overtimes: (overtimes.data ?? []) as never,
    corrections: (corrections.data ?? []) as never,
  };
}

/** 승인된 연차를 캘린더에 표시하기 위한 조회 (스펙 6장) */
export async function getApprovedLeavesForCalendar(
  fromYmd: string,
  toYmd: string,
): Promise<
  (Pick<
    LeaveRequest,
    "id" | "employee_id" | "leave_type" | "leave_category" | "start_date" | "end_date" | "start_time" | "hours"
  > & { employee: Pick<Employee, "id" | "name"> | null })[]
> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("leave_requests")
    .select(
      `id, employee_id, leave_type, leave_category, start_date, end_date, start_time, hours,
       employee:employees!employee_id(id, name)`,
    )
    .eq("status", "approved")
    .lte("start_date", toYmd)
    .gte("end_date", fromYmd);

  return (data ?? []) as never;
}

export { DAILY_WORK_HOURS };
