import type { Metadata } from "next";
import { CalendarCheck, CalendarDays, Clock3, Timer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { PeriodNavigator } from "@/components/ui/PeriodNavigator";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { DayStrip, type StripDay } from "@/components/ui/ChipStrip";
import { AttendanceView } from "@/features/attendance/AttendanceView";
import {
  getAttendanceWithAbsences,
  getLeaveSummary,
  getMyCorrectionRequests,
  getMyLeaveAdjustments,
  getMyLeaveRequests,
  getMyOvertimeRequests,
  getThisWeekHours,
  type WeeklyDay,
} from "@/features/attendance/data";
import { isAbsentDay } from "@/features/attendance/data-client";
import {
  formatDays,
  formatHours,
  hoursBetween,
} from "@/features/attendance/format";
import { requireSessionEmployee } from "@/lib/auth/session";
import {
  addDaysYmd,
  addMonthsYm,
  monthLabel,
  todayYmd,
  toSeoulTime,
  weekdayOf,
} from "@/features/calendar/date";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "내 근태" };

type View = "week" | "month";

/**
 * 내 근태 — 모듈의 기준 화면.
 *
 * 구성은 위에서부터 기간 스테퍼 → 진행바 있는 요약 밴드 → 7일 칩 스트립 → 조밀 표.
 * 예전에는 맨숫자 카드 5개 뒤에 폭 2/3짜리 텍스트 안내 카드가 있었고,
 * 시각화가 하나도 없어서 화면 절반이 빈 흰 여백이었다.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: { view?: string; cursor?: string };
}) {
  const me = await requireSessionEmployee();
  const today = todayYmd();
  const view: View = searchParams.view === "month" ? "month" : "week";

  // 주간이면 커서가 그 주의 아무 날, 월간이면 YYYY-MM
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

  const [summary, records, leaves, overtimes, corrections, week, adjustments] =
    await Promise.all([
      getLeaveSummary(me.id, me.hire_date),
      getAttendanceWithAbsences(me.id, rangeFrom, rangeTo, me.hire_date),
      getMyLeaveRequests(me.id),
      getMyOvertimeRequests(me.id),
      getMyCorrectionRequests(me.id),
      getThisWeekHours(me.id, weekStart ?? undefined),
      getMyLeaveAdjustments(me.id),
    ]);

  const periodHours = records.reduce((sum, row) => {
    if (isAbsentDay(row)) return sum;
    return sum + (hoursBetween(row.check_in_at, row.check_out_at) ?? 0);
  }, 0);
  const workedDays = records.filter(
    (row) => !isAbsentDay(row) && row.check_in_at,
  ).length;

  const step = (delta: number) => {
    const next =
      view === "week"
        ? addDaysYmd(weekStart as string, delta * 7)
        : addMonthsYm(cursor, delta);
    return `/attendance?view=${view}&cursor=${next}`;
  };

  const periodLabel =
    view === "week" ? `${rangeFrom} ~ ${rangeTo}` : monthLabel(cursor);
  const inPeriod = today >= rangeFrom && today <= rangeTo;

  return (
    <>
      <PageHeader
        title="내 근태"
        meta={
          <>
            <span>{me.department?.name ?? "부서 미지정"}</span>
            <span>·</span>
            <span>입사 {formatDate(me.hire_date)}</span>
            {summary.yearStart ? (
              <>
                <span>·</span>
                <span>
                  연차연도 {summary.yearStart} ~ {summary.yearEnd}
                </span>
              </>
            ) : null}
          </>
        }
        toolbar={
          <PeriodNavigator
            label={periodLabel}
            sublabel={view === "week" ? "주간" : "월간"}
            prevHref={step(-1)}
            nextHref={step(1)}
            todayHref={`/attendance?view=${view}`}
            atToday={inPeriod}
            className="mb-0"
            right={
              <SegmentedControl
                options={[
                  {
                    value: "week",
                    label: "주간",
                    href: "/attendance?view=week",
                  },
                  {
                    value: "month",
                    label: "월간",
                    href: "/attendance?view=month",
                  },
                ]}
                value={view}
                ariaLabel="기간 단위"
              />
            }
          />
        }
      />

      {/* 요약 밴드 — 분모와 임계선이 있어야 숫자가 판단 재료가 된다 */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="잔여 연차"
          value={formatDays(summary.remaining)}
          unit="일"
          denominator={formatDays(summary.accrued + summary.adjustment)}
          denominatorUnit="일"
          tone="brand"
          icon={CalendarCheck}
          emphasis
          max={summary.accrued + summary.adjustment || 1}
          meterValue={summary.used}
          sub={
            summary.next
              ? `소진율 ${Math.round(summary.usageRate * 100)}% · 다음 발생 ${summary.next.date.slice(5)} +${summary.next.days}일`
              : `소진율 ${Math.round(summary.usageRate * 100)}%`
          }
        />
        <StatCard
          label="이번 주 근무"
          value={formatHours(week.hours)}
          denominator={`${week.targetHours}h`}
          tone="neutral"
          icon={Clock3}
          max={week.limitHours}
          meterValue={week.hours}
          thresholds={[
            {
              at: week.targetHours,
              label: `${week.targetHours}h`,
              tone: "brand",
            },
            {
              at: week.warnHours,
              label: `${week.warnHours}h`,
              tone: "warning",
            },
            { at: week.limitHours, tone: "critical" },
          ]}
          scale
          scaleMaxLabel={`${week.limitHours}h`}
        />
        <StatCard
          label="이번 주 근무일"
          value={week.workedDayCount}
          unit="일"
          denominator={week.plannedWorkDayCount}
          denominatorUnit="일"
          tone="informative"
          icon={CalendarDays}
          max={week.plannedWorkDayCount || 1}
          meterValue={week.workedDayCount}
          sub={
            week.overtimeHours > 0
              ? `승인 초과근무 ${formatHours(week.overtimeHours)}`
              : "승인 초과근무 없음"
          }
        />
        <StatCard
          label={view === "week" ? "이 주 누적" : `${monthLabel(cursor)} 누적`}
          value={formatHours(periodHours)}
          tone="neutral"
          icon={Timer}
          sub={`근무일 ${workedDays}일`}
        />
      </div>

      {/* 주간 스트립 — 표만으로는 한 주의 흐름이 보이지 않는다 */}
      {view === "week" ? (
        <Card className="mb-5">
          <CardHeader
            title="주간 근무"
            description="정규 근무시간 09:00~18:00 · 지각 판정 09:10"
            density="compact"
          />
          <CardBody density="compact">
            <DayStrip days={week.days.map((day) => toStripDay(day, today))} />
          </CardBody>
        </Card>
      ) : null}

      <AttendanceView
        records={records}
        leaves={leaves}
        overtimes={overtimes}
        corrections={corrections}
        adjustments={adjustments}
        remainingDays={summary.remaining}
        periodLabel={periodLabel}
      />
    </>
  );
}

/** WeeklyDay → 스트립 한 칸 */
function toStripDay(day: WeeklyDay, today: string): StripDay {
  const chips: NonNullable<StripDay["chips"]> = [];

  if (day.workedHours > 0 || day.checkIn) {
    chips.push({
      lines: [
        day.workedHours > 0 ? formatHours(day.workedHours) : "근무 중",
        {
          text: `출 ${day.checkIn ? toSeoulTime(day.checkIn) : "--:--"} · 퇴 ${
            day.checkOut ? toSeoulTime(day.checkOut) : "--:--"
          }`,
          dim: true,
        },
      ],
      tone: day.workedHours > 0 ? "success" : "info",
    });
  }

  if (day.overtimeHours > 0) {
    chips.push({
      lines: [`초과 ${formatHours(day.overtimeHours)}`],
      tone: "warn",
    });
  }

  if (day.onLeave) {
    chips.push({ lines: ["휴가"], tone: "primary" });
  }

  const isNonWorking = day.isWeekend || !!day.holidayName;

  return {
    date: day.date,
    chips,
    holiday: day.holidayName ?? undefined,
    // 주말·공휴일·미래는 "기록 없음"이 아니다
    muted: isNonWorking || day.date > today,
    selected: day.date === today,
  };
}
