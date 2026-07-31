import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { addDaysYmd, todayYmd, weekdayOf } from "@/features/calendar/date";
import {
  accrualForLeaveYear,
  computeAccruedDays,
  leaveYearWindow,
  nextAccrual,
} from "./leave-accrual";
import type { AbsentDay, AttendanceRow } from "./data-client";
import {
  DAILY_WORK_HOURS,
  WEEKLY_LIMIT_HOURS,
  WEEKLY_TARGET_HOURS,
  WEEKLY_WARN_HOURS,
} from "./constants";
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
  /** 이번 연차연도 부여분 */
  accrued: number;
  /** 이번 연차연도 사용분 */
  used: number;
  adjustment: number;
  remaining: number;
  /** 소진율 0~1 */
  usageRate: number;
  /** 연차연도 구간 (입사기념일 ~ 다음 기념일 전날) */
  yearStart: string | null;
  yearEnd: string | null;
  yearIndex: number;
  /** 입사 이후 총 발생 누계 — 소멸 정책 미적용 상태의 참고값 */
  cumulativeAccrued: number;
  cumulativeUsed: number;
  next: { date: string; days: number } | null;
}

/**
 * 잔여 연차 요약 — 이번 연차연도 기준.
 *
 * 왜 연차연도 기준인가: computeAccruedDays는 입사 이후 발생분을 전부 더한다.
 * 법적으로는 맞지만(2년 6개월이면 11+15+15=41일), 각 연차는 발생일로부터
 * 1년 내 사용해야 하므로(제60조⑦) "잔여 41일"을 보여주면 실무와 어긋난다.
 * 그래서 화면에는 이번 연차연도 부여분과 그 기간의 사용분을 쓰고,
 * 누계는 참고값으로만 함께 돌려준다.
 *
 * leave_balances의 accrued_days는 계산값이 정답이므로 화면 진입 시 동기화한다.
 * 스케줄 작업이 밀리거나 실패해도 사용자가 화면을 보는 순간 자동 복구된다.
 *
 * 주의: DB의 승인 시 차감 로직은 여전히 누계 기준이다(소멸 정책 미확정).
 * 표시보다 관대한 방향이라 차단 오류는 생기지 않는다. PENDING.md 참고.
 */
export async function getLeaveSummary(
  employeeId: string,
  hireDate: string | null,
): Promise<LeaveSummary> {
  const supabase = createServerSupabase();
  const asOf = todayYmd();
  const cumulativeAccrued = computeAccruedDays(hireDate, asOf);
  const window = leaveYearWindow(hireDate, asOf);
  const granted = accrualForLeaveYear(hireDate, asOf).days;

  const [{ data: balance }, { data: yearLeaves }] = await Promise.all([
    supabase
      .from("leave_balances")
      .select("*")
      .eq("employee_id", employeeId)
      .maybeSingle<LeaveBalance>(),
    window
      ? supabase
          .from("leave_requests")
          .select("days")
          .eq("employee_id", employeeId)
          .eq("status", "approved")
          .eq("leave_category", "annual")
          .gte("start_date", window.start)
          .lte("start_date", window.end)
      : Promise.resolve({ data: [] as { days: number }[] }),
  ]);

  const cumulativeUsed = Number(balance?.used_days ?? 0);
  const adjustment = Number(balance?.adjustment_days ?? 0);
  const storedAccrued = Number(balance?.accrued_days ?? 0);

  const used =
    (yearLeaves ?? []).reduce((sum, row) => sum + Number(row.days ?? 0), 0) ||
    0;

  // 저장값이 계산값과 다르면 맞춘다(발생분은 계산이 정답)
  if (storedAccrued !== cumulativeAccrued) {
    const admin = createAdminSupabase();
    const { error } = await admin.rpc("set_accrued_days", {
      target_employee_id: employeeId,
      new_accrued: cumulativeAccrued,
    });
    if (error) {
      console.error("[attendance] 발생 연차 동기화 실패:", error.message);
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const remaining = round(granted - used + adjustment);

  return {
    accrued: granted,
    used: round(used),
    adjustment,
    remaining,
    usageRate: granted > 0 ? Math.min(1, used / granted) : 0,
    yearStart: window?.start ?? null,
    yearEnd: window?.end ?? null,
    yearIndex: window?.yearIndex ?? 0,
    cumulativeAccrued,
    cumulativeUsed: round(cumulativeUsed),
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

export interface WeeklyDay {
  /** YYYY-MM-DD */
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  /** 정규 근무시간. 퇴근 전이면 0 */
  workedHours: number;
  /** 승인된 초과근무 */
  overtimeHours: number;
  isWeekend: boolean;
  holidayName: string | null;
  onLeave: boolean;
}

export interface WeeklyHours {
  weekStart: string;
  weekEnd: string;
  /** 정규 + 승인 초과 */
  hours: number;
  regularHours: number;
  overtimeHours: number;
  level: "ok" | "warn" | "over";
  /** 요일 스트립·일별 분해용 7칸 */
  days: WeeklyDay[];
  workedDayCount: number;
  /** 주중에서 공휴일을 뺀 근무 예정일 수 — "2d /5d"의 분모 */
  plannedWorkDayCount: number;
  targetHours: number;
  warnHours: number;
  limitHours: number;
}

/**
 * 주간 근무 요약 (스펙 3.2)
 *
 * 예전에는 주간 레코드를 전부 fetch한 뒤 시간 합계 스칼라 하나로 접어버려서,
 * "2d /5d"·"14h46m /40h" 같은 분모도, 요일 칩 스트립의 일별 값도 만들 수 없었다.
 * 이미 손에 들고 있던 데이터였다.
 *
 * 승인된 초과근무는 합계에는 더하되 일별로도 따로 남긴다 —
 * 정규 근무와 섞이면 칩을 나눠 표시할 수 없다.
 */
export async function getThisWeekHours(
  employeeId: string,
  weekStartYmd?: string,
): Promise<WeeklyHours> {
  const today = todayYmd();
  const weekStart = weekStartYmd ?? addDaysYmd(today, -weekdayOf(today));
  const weekEnd = addDaysYmd(weekStart, 6);

  const supabase = createServerSupabase();
  const [{ data: records }, { data: overtimes }, { data: holidays }, { data: leaves }] =
    await Promise.all([
      supabase
        .from("attendance_records")
        .select("work_date, check_in_at, check_out_at")
        .eq("employee_id", employeeId)
        .gte("work_date", weekStart)
        .lte("work_date", weekEnd),
      supabase
        .from("overtime_requests")
        .select("work_date, start_time, end_time")
        .eq("employee_id", employeeId)
        .eq("status", "approved")
        .gte("work_date", weekStart)
        .lte("work_date", weekEnd),
      supabase
        .from("holidays")
        .select("date, name")
        .eq("is_non_working", true)
        .gte("date", weekStart)
        .lte("date", weekEnd),
      supabase
        .from("leave_requests")
        .select("start_date, end_date")
        .eq("employee_id", employeeId)
        .eq("status", "approved")
        .lte("start_date", weekEnd)
        .gte("end_date", weekStart),
    ]);

  const byDate = new Map<string, { checkIn: string | null; checkOut: string | null }>();
  (records ?? []).forEach((r) => {
    byDate.set(r.work_date as string, {
      checkIn: (r.check_in_at as string | null) ?? null,
      checkOut: (r.check_out_at as string | null) ?? null,
    });
  });

  const overtimeByDate = new Map<string, number>();
  (overtimes ?? []).forEach((o) => {
    const date = o.work_date as string;
    const add = diffTimeHours(o.start_time as string, o.end_time as string);
    overtimeByDate.set(date, (overtimeByDate.get(date) ?? 0) + add);
  });

  const holidayByDate = new Map<string, string>();
  (holidays ?? []).forEach((h) => {
    holidayByDate.set(h.date as string, h.name as string);
  });

  const onLeave = new Set<string>();
  (leaves ?? []).forEach((l) => {
    let cursor = l.start_date as string;
    for (
      let guard = 0;
      guard < 400 && cursor <= (l.end_date as string);
      guard += 1
    ) {
      onLeave.add(cursor);
      cursor = addDaysYmd(cursor, 1);
    }
  });

  const days: WeeklyDay[] = [];
  let regular = 0;
  let overtime = 0;
  let workedDayCount = 0;
  let plannedWorkDayCount = 0;

  for (let i = 0; i < 7; i += 1) {
    const date = addDaysYmd(weekStart, i);
    const record = byDate.get(date);
    const weekday = weekdayOf(date);
    const isWeekend = weekday === 0 || weekday === 6;
    const holidayName = holidayByDate.get(date) ?? null;

    const worked =
      record?.checkIn && record?.checkOut
        ? (new Date(record.checkOut).getTime() -
            new Date(record.checkIn).getTime()) /
          3_600_000
        : 0;
    const ot = overtimeByDate.get(date) ?? 0;

    regular += worked;
    overtime += ot;
    if (record?.checkIn) workedDayCount += 1;
    if (!isWeekend && !holidayName) plannedWorkDayCount += 1;

    days.push({
      date,
      checkIn: record?.checkIn ?? null,
      checkOut: record?.checkOut ?? null,
      workedHours: Math.round(worked * 10) / 10,
      overtimeHours: Math.round(ot * 10) / 10,
      isWeekend,
      holidayName,
      onLeave: onLeave.has(date),
    });
  }

  const round = (n: number) => Math.round(n * 10) / 10;
  const total = round(regular + overtime);

  return {
    weekStart,
    weekEnd,
    hours: total,
    regularHours: round(regular),
    overtimeHours: round(overtime),
    level:
      total > WEEKLY_LIMIT_HOURS
        ? "over"
        : total >= WEEKLY_WARN_HOURS
          ? "warn"
          : "ok",
    days,
    workedDayCount,
    plannedWorkDayCount,
    targetHours: WEEKLY_TARGET_HOURS,
    warnHours: WEEKLY_WARN_HOURS,
    limitHours: WEEKLY_LIMIT_HOURS,
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
  hireDate?: string | null,
): Promise<AttendanceRow[]> {
  const supabase = createServerSupabase();
  const today = todayYmd();
  // 오늘은 아직 퇴근 전일 수 있어 결근 판정에서 제외한다
  const lastJudgedDay = toYmd < today ? toYmd : addDaysYmd(today, -1);
  // 입사 전 날짜를 결근으로 찍으면 안 된다.
  // (입사 당일 조회 시 그 달 앞부분이 전부 결근으로 보이던 문제)
  const judgeFrom = hireDate && hireDate > fromYmd ? hireDate : fromYmd;

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
  let cursor = judgeFrom;
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
