import type { Metadata } from "next";
import { CalendarCheck, CalendarDays, Clock3, Timer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionHeader } from "@/components/ui/Card";
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
import { monthLabel, todayYmd, toSeoulTime } from "@/features/calendar/date";
import {
  parsePeriod,
  periodHref,
  PERIOD_UNIT_LABELS,
  type PeriodSearchParams,
  type PeriodUnit,
} from "@/lib/period";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "내 근태" };

/** 이 화면이 지원하는 기간 단위 (= 토글 순서) */
const UNITS = ["week", "month"] as const satisfies readonly PeriodUnit[];
/** 개인 근태는 주 단위로 본다 — 주52시간·주휴가 판정의 단위가 주다 */
const DEFAULT_UNIT = "week";

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
  searchParams: PeriodSearchParams;
}) {
  const me = await requireSessionEmployee();
  const today = todayYmd();

  // 기간은 ?period=week|month & ?cursor= 로 읽는다 (lib/period 규약)
  const period = parsePeriod(searchParams, {
    units: UNITS,
    defaultUnit: DEFAULT_UNIT,
    today,
  });
  const view = period.unit;
  const cursor = period.cursor;

  // 주간이면 기준점이 곧 그 주의 시작일이다 (parsePeriod가 일요일로 맞춰 준다)
  const weekStart = view === "week" ? period.cursor : null;
  const rangeFrom = period.from;
  const rangeTo = period.to;

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

  const linkTo = (unit: PeriodUnit, next: string | null) =>
    periodHref(
      "/attendance",
      { unit, cursor: next },
      { defaultUnit: DEFAULT_UNIT },
    );

  const periodLabel = period.label;
  const inPeriod = period.includesToday;

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
            sublabel={period.sublabel}
            prevHref={linkTo(view, period.prevCursor)}
            nextHref={linkTo(view, period.nextCursor)}
            todayHref={linkTo(view, null)}
            atToday={inPeriod}
            className="mb-0"
            right={
              <SegmentedControl
                options={UNITS.map((unit) => ({
                  value: unit,
                  label: PERIOD_UNIT_LABELS[unit],
                  // 지난 기간을 보는 중이면 단위를 바꿔도 그 지점에 머문다
                  href: linkTo(unit, inPeriod ? null : cursor),
                }))}
                value={view}
                ariaLabel="기간 단위"
              />
            }
          />
        }
      />

      {/*
        요약 밴드 — 분모와 임계선이 있어야 숫자가 판단 재료가 된다.
        10 스윕 판단: StatCard의 hairline은 흰 시트 위에서 카드 면과 시트가
        같은 흰색이라 그 1겹이 유일한 구분선이다 — 카드가 카드를 감싸는
        이중 테두리가 아니므로 border를 걷지 않고 유지한다.
      */}
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

      {/*
        주간 스트립 — 표만으로는 한 주의 흐름이 보이지 않는다.
        md+ 흰 시트 위 .ab-card 이중 테두리를 걷고 섹션 제목 + 직접 배치
        (10 스윕, 기준: CalendarBoard). md 미만은 카드 면 유지.
      */}
      {view === "week" ? (
        <section className="mb-5">
          <SectionHeader
            title="주간 근무"
            description="정규 근무시간 09:00~18:00 · 지각 판정 09:10"
          />
          <div className="ab-card p-3 md:rounded-none md:border-0 md:p-0">
            <DayStrip days={week.days.map((day) => toStripDay(day, today))} />
          </div>
        </section>
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
    // 다우 tag-attendance 실측: vacation = 파랑(#0d99ff/#84c3ff) = info 톤
    chips.push({ lines: ["휴가"], tone: "info" });
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
