import type { Metadata } from "next";
import { AlarmClock, CalendarOff, Clock3, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Meter } from "@/components/ui/Progress";
import { Chip } from "@/components/ui/ChipStrip";
import { PeriodNavigator } from "@/components/ui/PeriodNavigator";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  AdminAttendanceTables,
  type AdminRecordRow,
  type AdminRow,
} from "./AdminAttendanceTables";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { computeAccruedDays } from "@/features/attendance/leave-accrual";
import {
  DAILY_WORK_HOURS,
  WEEKLY_LIMIT_HOURS,
  WEEKLY_TARGET_HOURS,
  WEEKLY_WARN_HOURS,
} from "@/features/attendance/constants";
import { formatHours } from "@/features/attendance/format";
import {
  addDaysYmd,
  addMonthsYm,
  monthLabel,
  todayYmd,
  weekdayOf,
} from "@/features/calendar/date";
import type {
  AttendanceRecord,
  AttendanceStatus,
  LeaveBalance,
} from "@/types/db";

export const metadata: Metadata = { title: "근태 관리" };

type View = "week" | "month";

interface EmployeeRow {
  id: string;
  name: string;
  hire_date: string | null;
  profile_image_url: string | null;
  department: { name: string } | null;
}

/** 52시간 모니터의 눈금 — 40h는 기준선일 뿐이라 경고 톤을 주지 않는다 */
const MONITOR_THRESHOLDS = [
  { at: WEEKLY_TARGET_HOURS, label: "40h", tone: "informative" as const },
  { at: WEEKLY_WARN_HOURS, label: "48h", tone: "warning" as const },
  { at: WEEKLY_LIMIT_HOURS, tone: "critical" as const },
];

/**
 * 전사 근태 관리.
 *
 * 예전에는 조회 범위가 당월로 하드코딩돼 전월 마감·특정 주 확인이 불가능했고,
 * 요약 4칸 중 분모가 붙은 것이 하나도 없었다("3명"이 전사 몇 명 중 3명인지 알 수 없음).
 * 지금은 기간 스테퍼 → 분모·임계선이 있는 요약 밴드 → 주52시간 모니터 →
 * 조밀 표 순서로, 근태 모듈의 기준 화면과 같은 골격을 쓴다.
 */
export default async function AdminAttendancePage({
  searchParams,
}: {
  searchParams: { view?: string; cursor?: string };
}) {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const today = todayYmd();
  const view: View = searchParams.view === "week" ? "week" : "month";

  const cursor =
    view === "week"
      ? (searchParams.cursor ?? today).slice(0, 10)
      : (searchParams.cursor ?? today.slice(0, 7)).slice(0, 7);

  const weekStart =
    view === "week" ? addDaysYmd(cursor, -weekdayOf(cursor)) : null;
  const rangeFrom = weekStart ?? `${cursor}-01`;
  const rangeTo = weekStart
    ? addDaysYmd(weekStart, 6)
    : addDaysYmd(`${addMonthsYm(cursor, 1)}-01`, -1);

  // 직전 기간 — 지각 건수를 "전 기간 대비"로 읽히게 하기 위한 비교값
  const prevTo = addDaysYmd(rangeFrom, -1);
  const prevFrom = weekStart
    ? addDaysYmd(rangeFrom, -7)
    : `${addMonthsYm(cursor, -1)}-01`;

  const [
    { data: employees },
    { data: records },
    { data: balances },
    { data: holidays },
    { data: leaves },
    { data: prevRecords },
    { data: setting },
  ] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, name, hire_date, profile_image_url, department:departments!department_id(name)",
      )
      .eq("employment_status", "active")
      .order("name"),
    supabase
      .from("attendance_records")
      .select("*")
      .gte("work_date", rangeFrom)
      .lte("work_date", rangeTo)
      .order("work_date", { ascending: false }),
    supabase.from("leave_balances").select("*"),
    supabase
      .from("holidays")
      .select("date")
      .eq("is_non_working", true)
      .gte("date", rangeFrom)
      .lte("date", rangeTo),
    supabase
      .from("leave_requests")
      .select("employee_id, start_date, end_date")
      .eq("status", "approved")
      .lte("start_date", rangeTo)
      .gte("end_date", rangeFrom),
    supabase
      .from("attendance_records")
      .select("status")
      .gte("work_date", prevFrom)
      .lte("work_date", prevTo),
    supabase
      .from("compensatory_leave_settings")
      .select("rate")
      .is("group_scope", null)
      .maybeSingle<{ rate: number }>(),
  ]);

  const employeeList = (employees ?? []) as unknown as EmployeeRow[];
  const recordList = (records ?? []) as AttendanceRecord[];
  const balanceMap = new Map(
    ((balances ?? []) as LeaveBalance[]).map((b) => [b.employee_id, b]),
  );
  const nameMap = new Map(employeeList.map((e) => [e.id, e.name]));
  const nonWorking = new Set((holidays ?? []).map((h) => h.date as string));

  // 승인 휴가일은 결근이 아니다
  const leaveDays = new Map<string, Set<string>>();
  ((leaves ?? []) as {
    employee_id: string;
    start_date: string;
    end_date: string;
  }[]).forEach((leave) => {
    const set = leaveDays.get(leave.employee_id) ?? new Set<string>();
    let day = leave.start_date;
    for (let guard = 0; guard < 400 && day <= leave.end_date; guard += 1) {
      set.add(day);
      day = addDaysYmd(day, 1);
    }
    leaveDays.set(leave.employee_id, set);
  });

  const hoursOf = (record: AttendanceRecord) =>
    record.check_in_at && record.check_out_at
      ? (new Date(record.check_out_at).getTime() -
          new Date(record.check_in_at).getTime()) /
        3_600_000
      : 0;

  // 결근 판정은 이미 지난 날까지만 한다 (오늘은 아직 퇴근 전일 수 있다)
  const judgedTo = rangeTo < today ? rangeTo : addDaysYmd(today, -1);
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const rows: AdminRow[] = employeeList.map((employee) => {
    const mine = recordList.filter((r) => r.employee_id === employee.id);
    const recorded = new Set(mine.map((r) => r.work_date));
    const onLeave = leaveDays.get(employee.id) ?? new Set<string>();
    const balance = balanceMap.get(employee.id);

    // 발생분은 저장값이 아니라 계산값을 기준으로 보여준다(동기화 지연 방지)
    const accrued = computeAccruedDays(employee.hire_date, today);
    const remaining =
      accrued -
      Number(balance?.used_days ?? 0) +
      Number(balance?.adjustment_days ?? 0);

    // 주 단위로 접어 가장 긴 한 주를 찾는다 — 52시간 판정의 기준
    const weekTotals = new Map<string, number>();
    mine.forEach((record) => {
      const start = addDaysYmd(
        record.work_date,
        -weekdayOf(record.work_date),
      );
      weekTotals.set(start, (weekTotals.get(start) ?? 0) + hoursOf(record));
    });
    let peakWeekStart: string | null = null;
    let peakWeeklyHours = 0;
    weekTotals.forEach((hours, start) => {
      if (hours > peakWeeklyHours) {
        peakWeeklyHours = hours;
        peakWeekStart = start;
      }
    });

    // 근무예정일 = 평일 - 공휴일, 입사 전과 미래는 제외
    const judgeFrom =
      employee.hire_date && employee.hire_date > rangeFrom
        ? employee.hire_date
        : rangeFrom;
    let plannedDays = 0;
    let absentDays = 0;
    let day = judgeFrom;
    for (let guard = 0; guard < 400 && day <= judgedTo; guard += 1) {
      const weekday = weekdayOf(day);
      if (weekday !== 0 && weekday !== 6 && !nonWorking.has(day)) {
        plannedDays += 1;
        if (!recorded.has(day) && !onLeave.has(day)) absentDays += 1;
      }
      day = addDaysYmd(day, 1);
    }

    return {
      employeeId: employee.id,
      name: employee.name,
      departmentName: employee.department?.name ?? null,
      profileImageUrl: employee.profile_image_url,
      workDays: mine.filter((r) => r.check_in_at).length,
      plannedDays,
      totalHours: round1(mine.reduce((sum, r) => sum + hoursOf(r), 0)),
      lateCount: mine.filter((r) => r.status === "late").length,
      earlyLeaveCount: mine.filter((r) => r.status === "early_leave").length,
      absentDays,
      remainingLeave: Math.round(remaining * 100) / 100,
      accruedLeave: accrued,
      peakWeeklyHours: round1(peakWeeklyHours),
      peakWeekStart,
    };
  });

  const recordRows: AdminRecordRow[] = recordList.slice(0, 300).map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeName: nameMap.get(r.employee_id) ?? "(알 수 없음)",
    workDate: r.work_date,
    checkInAt: r.check_in_at,
    checkOutAt: r.check_out_at,
    status: r.status as AttendanceStatus,
    reason: r.manual_adjustment_reason ?? r.location_warning,
  }));

  // ── 전사 집계 ──────────────────────────────────────────────
  const headcount = rows.length;
  const sum = (pick: (row: AdminRow) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);

  const lateTotal = sum((r) => r.lateCount);
  const earlyTotal = sum((r) => r.earlyLeaveCount);
  const absentTotal = sum((r) => r.absentDays);
  const plannedTotal = sum((r) => r.plannedDays);
  const totalHours = sum((r) => r.totalHours);

  const prevLate = ((prevRecords ?? []) as { status: string }[]).filter(
    (r) => r.status === "late",
  ).length;
  const lateDelta = lateTotal - prevLate;

  const avgHours = headcount > 0 ? totalHours / headcount : 0;
  const avgPlannedDays = headcount > 0 ? plannedTotal / headcount : 0;
  const targetHours = avgPlannedDays * DAILY_WORK_HOURS;

  const over52 = rows.filter((r) => r.peakWeeklyHours > WEEKLY_LIMIT_HOURS);
  const near48 = rows.filter(
    (r) =>
      r.peakWeeklyHours >= WEEKLY_WARN_HOURS &&
      r.peakWeeklyHours <= WEEKLY_LIMIT_HOURS,
  );
  const normal40 = rows.filter(
    (r) =>
      r.peakWeeklyHours >= WEEKLY_TARGET_HOURS &&
      r.peakWeeklyHours < WEEKLY_WARN_HOURS,
  );
  const under40 = headcount - over52.length - near48.length - normal40.length;
  const watchCount = over52.length + near48.length;

  const monitorRows = [...rows]
    .sort((a, b) => b.peakWeeklyHours - a.peakWeeklyHours)
    .slice(0, 8)
    .filter((row) => row.peakWeeklyHours > 0);

  const step = (delta: number) => {
    const next =
      view === "week"
        ? addDaysYmd(weekStart as string, delta * 7)
        : addMonthsYm(cursor, delta);
    return `/admin/attendance?view=${view}&cursor=${next}`;
  };

  const periodLabel =
    view === "week" ? `${rangeFrom} ~ ${rangeTo}` : monthLabel(cursor);
  const inPeriod = today >= rangeFrom && today <= rangeTo;

  return (
    <>
      <PageHeader
        title="근태 관리"
        meta={
          <>
            <span>재직 {headcount}명</span>
            <span>·</span>
            <span>정규 근무 09:00~18:00</span>
            <span>·</span>
            <span>수동 조정은 감사 로그에 기록</span>
          </>
        }
        toolbar={
          <PeriodNavigator
            label={periodLabel}
            sublabel={view === "week" ? "주간" : "월간"}
            prevHref={step(-1)}
            nextHref={step(1)}
            nextDisabled={rangeTo >= today}
            todayHref={`/admin/attendance?view=${view}`}
            atToday={inPeriod}
            className="mb-0"
            right={
              <SegmentedControl
                options={[
                  {
                    value: "week",
                    label: "주간",
                    href: "/admin/attendance?view=week",
                  },
                  {
                    value: "month",
                    label: "월간",
                    href: "/admin/attendance?view=month",
                  },
                ]}
                value={view}
                ariaLabel="기간 단위"
              />
            }
          />
        }
      />

      {/* 요약 밴드 — 모든 숫자에 분모나 비교값을 붙인다 */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="1인 평균 근무"
          value={formatHours(avgHours)}
          denominator={`${Math.round(targetHours)}h`}
          tone="brand"
          icon={Clock3}
          emphasis
          max={targetHours || 1}
          meterValue={avgHours}
          sub={`근무일 평균 ${(headcount > 0 ? sum((r) => r.workDays) / headcount : 0).toFixed(1)}일 / 예정 ${avgPlannedDays.toFixed(1)}일`}
        />
        <StatCard
          label={`주 ${WEEKLY_LIMIT_HOURS}시간 근접·초과`}
          value={watchCount}
          unit="명"
          denominator={headcount}
          denominatorUnit="명"
          tone={
            over52.length > 0
              ? "critical"
              : watchCount > 0
                ? "warning"
                : "positive"
          }
          icon={TriangleAlert}
          max={headcount || 1}
          meterValue={watchCount}
          sub={
            watchCount > 0
              ? `52h 초과 ${over52.length}명 · 48h 이상 ${near48.length}명`
              : "임계선을 넘은 인원 없음"
          }
        />
        <StatCard
          label="지각"
          value={lateTotal}
          unit="건"
          tone="informative"
          icon={AlarmClock}
          delta={{
            label: `${lateDelta > 0 ? "+" : ""}${lateDelta}`,
            direction: lateDelta > 0 ? "up" : lateDelta < 0 ? "down" : "flat",
            goodDirection: "down",
          }}
          sub={`직전 기간 ${prevLate}건 · 조퇴 ${earlyTotal}건`}
        />
        <StatCard
          label="결근"
          value={absentTotal}
          unit="일"
          denominator={plannedTotal}
          denominatorUnit="일"
          tone="neutral"
          icon={CalendarOff}
          state={plannedTotal === 0 ? "empty" : "ok"}
          sub={
            plannedTotal === 0
              ? "아직 지난 근무일이 없습니다"
              : "전사 근무예정일 대비 기록 없는 날"
          }
        />
      </div>

      {/* 주 52시간 모니터 — 분포 한 줄 + 상위 인원 진행바 */}
      <Card className="mb-5">
        <CardHeader
          title={`주 ${WEEKLY_LIMIT_HOURS}시간 모니터`}
          description="조회 기간에 포함된 주 가운데 가장 길게 일한 한 주를 기준으로 봅니다"
          density="compact"
        />
        <CardBody density="compact">
          {headcount === 0 ? (
            <EmptyState
              title="재직 중인 임직원이 없습니다"
              description="임직원을 등록하면 주간 근로시간 분포가 여기에 표시됩니다."
              compact
            />
          ) : (
            <>
              <Meter
                max={headcount}
                segments={[
                  { value: under40, tone: "neutral", label: "40h 미만" },
                  {
                    value: normal40.length,
                    tone: "informative",
                    label: "40~48h",
                  },
                  { value: near48.length, tone: "warning", label: "48~52h" },
                  { value: over52.length, tone: "critical", label: "52h 초과" },
                ]}
                label="주간 근로시간 분포"
                valueLabel={`${headcount}명`}
              />
              <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                <Chip
                  lines={[`${under40}명`, { text: "40h 미만", dim: true }]}
                  tone="neutral"
                />
                <Chip
                  lines={[
                    `${normal40.length}명`,
                    { text: "40~48h", dim: true },
                  ]}
                  tone="info"
                />
                <Chip
                  lines={[`${near48.length}명`, { text: "48~52h", dim: true }]}
                  tone="warn"
                />
                <Chip
                  lines={[
                    `${over52.length}명`,
                    { text: "52h 초과", dim: true },
                  ]}
                  tone="danger"
                />
              </div>

              <div className="mt-4 space-y-3 border-t border-line pt-3.5">
                {monitorRows.length === 0 ? (
                  <p className="py-2 text-center text-caption">
                    이 기간에 기록된 근무시간이 없습니다.
                  </p>
                ) : (
                  monitorRows.map((row) => (
                    <Meter
                      key={row.employeeId}
                      value={row.peakWeeklyHours}
                      max={WEEKLY_LIMIT_HOURS}
                      tone="informative"
                      thresholds={MONITOR_THRESHOLDS}
                      showScale={false}
                      label={
                        <>
                          <span className="text-ink">{row.name}</span>
                          <span className="ml-1.5">
                            {row.departmentName ?? "부서 미지정"}
                            {row.peakWeekStart
                              ? ` · ${row.peakWeekStart.slice(5)} 주`
                              : ""}
                          </span>
                        </>
                      }
                      valueLabel={formatHours(row.peakWeeklyHours)}
                      aria-label={`${row.name} 주간 최대 근무 ${row.peakWeeklyHours}시간`}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <AdminAttendanceTables
        rows={rows}
        records={recordRows}
        periodLabel={periodLabel}
        compensatoryRate={Number(setting?.rate ?? 1.5)}
      />
    </>
  );
}
