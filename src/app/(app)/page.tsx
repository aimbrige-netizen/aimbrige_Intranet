import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarCheck, CalendarDays, Clock3, FileCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Callout } from "@/components/ui/Callout";
import { PeriodNavigator } from "@/components/ui/PeriodNavigator";
import { requireSessionEmployee } from "@/lib/auth/session";
import {
  carryPeriod,
  parsePeriod,
  periodHref,
  type PeriodSearchParams,
} from "@/lib/period";
import {
  DashboardGrid,
  type WidgetSlot,
} from "@/features/dashboard/DashboardGrid";
import {
  ApprovalPendingWidget,
  CalendarUpcomingWidget,
  FavoritesWidget,
  NoticesWidget,
  WeekAttendanceWidget,
} from "@/features/dashboard/widgets";
import {
  defaultWidgetOrder,
  getApprovalWorkload,
  getCalendarUpcoming,
  getFavorites,
  getNotices,
  getWidgetSettings,
  getWorkSnapshot,
} from "@/features/dashboard/widget-data";
import {
  MailWidget,
  MailWidgetSkeleton,
} from "@/features/mail/MailWidget";
import { formatDays, formatHours } from "@/features/attendance/format";
import {
  addDaysYmd,
  todayYmd,
  weekdayOf,
  WEEKDAY_LABELS,
} from "@/features/calendar/date";
import type { WidgetKey } from "@/types/db";

export const metadata: Metadata = { title: "대시보드" };

/** 다가오는 일정 조회 범위 — 오늘부터 며칠 */
const UPCOMING_DAYS = 7;

const WIDGET_LABELS: Record<WidgetKey, string> = {
  approval_pending: "결재 대기",
  attendance_today: "주간 근태",
  notices: "공지사항",
  calendar_upcoming: "다가오는 일정",
  favorites: "즐겨찾기",
  mail: "메일",
};

/**
 * 홈 대시보드.
 *
 * 예전 구성은 "인사말 h1 → 맨숫자 4개 → 링크 리스트 카드 5개"였다.
 * 가장 큰 활자가 정보량 0인 인사말에 배정됐고, 지표 4개는 전부 아래 위젯이
 * 이미 보여주는 값의 재출력이라 실질 정보 증가량이 0이었다.
 *
 * 지금은 기준 화면(내 근태)과 같은 골격이다:
 *   기간 스테퍼 → 분모·임계선 있는 요약 밴드 → 주간 칩 스트립 → 목록 위젯.
 * 밴드 4칸은 아래 위젯이 보여주지 않는 집계만 담는다 —
 * 주간 누적(40h·52h 임계), 연차 소진율, 근무일 n/m, 내 차례 결재 n/진행중 m.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: PeriodSearchParams & { denied?: string };
}) {
  const me = await requireSessionEmployee();

  const today = todayYmd();

  // 기간은 ?period=week & ?cursor= 로 읽는다 (lib/period 규약)
  const period = parsePeriod(searchParams, { units: ["week"], today });
  const weekStart = period.from;
  const isThisWeek = period.includesToday;

  // 다가오는 일정은 기간 스테퍼와 무관하게 늘 "오늘부터 7일"이다.
  // 지난주를 되짚어 보는 중에 다음 일정이 사라지면 안 된다.
  const upcomingFrom = today;
  const upcomingTo = addDaysYmd(today, UPCOMING_DAYS - 1);

  const [approval, snapshot, notices, events, favorites, settings] =
    await Promise.all([
      getApprovalWorkload(me.id),
      getWorkSnapshot(me.id, me.hire_date, weekStart),
      getNotices(me.id),
      getCalendarUpcoming(me.id, upcomingFrom, upcomingTo),
      getFavorites(me.id),
      getWidgetSettings(me.id),
    ]);

  const { leave, week } = snapshot;

  /* ── 요약 밴드에 쓸 파생값 ─────────────────────────────────────── */

  const weekThresholds = [
    { at: week.targetHours, label: `${week.targetHours}h`, tone: "brand" as const },
    { at: week.warnHours, label: `${week.warnHours}h`, tone: "warning" as const },
    { at: week.limitHours, tone: "critical" as const },
  ];

  const toTarget = week.targetHours - week.hours;
  const weekSub =
    week.hours > week.limitHours
      ? `주 ${week.limitHours}h 초과 ${formatHours(week.hours - week.limitHours)}`
      : toTarget > 0
        ? `${week.targetHours}h까지 ${formatHours(toTarget)}`
        : `${week.targetHours}h 초과 ${formatHours(-toTarget)}`;

  const plannedDays = week.days.filter((d) => !d.isWeekend && !d.holidayName);
  const leaveDays = plannedDays.filter((d) => d.onLeave).length;
  const upcomingDays = plannedDays.filter(
    (d) => d.date > today && !d.onLeave,
  ).length;
  const missingDays = plannedDays.filter(
    (d) => d.date < today && !d.onLeave && !d.checkIn,
  ).length;

  const workDaySub =
    missingDays > 0
      ? `기록 없는 근무일 ${missingDays}일`
      : upcomingDays > 0
        ? `남은 근무일 ${upcomingDays}일`
        : leaveDays > 0
          ? `휴가 ${leaveDays}일`
          : "빠짐없이 기록됨";

  const leaveTotal = leave.accrued;
  const leaveRate = Math.round(leave.usageRate * 100);

  const approvalSub =
    approval.myTurn === 0
      ? approval.inProgress > 0
        ? "다른 결재자 차례"
        : "처리할 문서 없음"
      : approval.oldestWaitingDays !== null && approval.oldestWaitingDays > 0
        ? `가장 오래 대기 ${approval.oldestWaitingDays}일`
        : "오늘 올라온 문서";

  const step = (cursor: string | null) =>
    periodHref("/", { unit: "week", cursor }, { defaultUnit: "week" });

  /* ── 위젯 ──────────────────────────────────────────────────────── */

  const nodes: Record<WidgetKey, React.ReactNode> = {
    approval_pending: <ApprovalPendingWidget items={approval.items} />,
    attendance_today: (
      <WeekAttendanceWidget
        week={week}
        today={today}
        title={isThisWeek ? "이번 주 근태" : "주간 근태"}
      />
    ),
    notices: <NoticesWidget notices={notices} />,
    calendar_upcoming: (
      <CalendarUpcomingWidget
        events={events}
        rangeLabel={`${upcomingFrom.slice(5)} ~ ${upcomingTo.slice(5)}`}
      />
    ),
    favorites: <FavoritesWidget favorites={favorites} />,
    /*
      메일만 Suspense로 감싼다. 다른 위젯의 데이터는 위에서 Promise.all로 이미
      다 받아둔 상태고, 이건 지금부터 구글에 다녀와야 한다. 여기서 await하면
      구글 응답이 늦는 만큼 대시보드 전체가 늦게 뜬다.
    */
    mail: (
      <Suspense fallback={<MailWidgetSkeleton />}>
        <MailWidget email={me.email} canConfigure={me.isSystemAdmin} />
      </Suspense>
    ),
  };

  const slots: WidgetSlot[] = defaultWidgetOrder(me.roleName).map((key) => ({
    key,
    label: WIDGET_LABELS[key],
    node: nodes[key],
    // 7칸 스트립은 1/3 폭에서 칩이 뭉개진다
    span: key === "attendance_today" ? 2 : 1,
  }));

  const visibility = Object.fromEntries(
    slots.map((slot) => [slot.key, settings[slot.key] ?? true]),
  );

  return (
    <>
      <PageHeader
        title="대시보드"
        meta={
          <>
            <span>
              오늘 {today} ({WEEKDAY_LABELS[weekdayOf(today)]})
            </span>
            {leave.next ? (
              <>
                <span>·</span>
                <span>
                  다음 연차 발생 {leave.next.date} +{formatDays(leave.next.days)}
                  일
                </span>
              </>
            ) : null}
          </>
        }
        toolbar={
          <PeriodNavigator
            label={period.label}
            sublabel={isThisWeek ? "이번 주" : period.sublabel}
            prevHref={step(period.prevCursor)}
            nextHref={step(period.nextCursor)}
            nextDisabled={isThisWeek}
            todayHref={step(null)}
            atToday={isThisWeek}
            className="mb-0"
          />
        }
      />

      {searchParams.denied === "admin_only" ? (
        <Callout tone="warn" className="mb-4">
          시스템 관리자만 접근할 수 있는 화면입니다.
        </Callout>
      ) : null}

      {/* 요약 밴드 — 아래 위젯이 보여주지 않는 집계만, 항상 분모와 함께 */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={isThisWeek ? "이번 주 근무" : "주간 근무"}
          value={formatHours(week.hours)}
          denominator={`${week.targetHours}h`}
          // 보고 있던 주를 그대로 들고 내 근태로 넘어간다
          href={carryPeriod("/attendance", period, { defaultUnit: "week" })}
          tone="neutral"
          icon={Clock3}
          max={week.limitHours}
          meterValue={week.hours}
          thresholds={weekThresholds}
          scale
          scaleMaxLabel={`${week.limitHours}h`}
          sub={weekSub}
        />
        <StatCard
          label="연차 소진율"
          value={leaveRate}
          unit="%"
          tone="brand"
          icon={CalendarCheck}
          max={leaveTotal || 1}
          meterValue={leave.used}
          sub={`사용 ${formatDays(leave.used)}/${formatDays(leaveTotal)}일 · 잔여 ${formatDays(leave.remaining)}일`}
        />
        <StatCard
          label={isThisWeek ? "이번 주 근무일" : "주간 근무일"}
          value={week.workedDayCount}
          unit="일"
          denominator={week.plannedWorkDayCount}
          denominatorUnit="일"
          href={carryPeriod("/attendance", period, { defaultUnit: "week" })}
          tone="informative"
          icon={CalendarDays}
          max={week.plannedWorkDayCount || 1}
          meterValue={week.workedDayCount}
          sub={workDaySub}
        />
        <StatCard
          label="내 차례 결재"
          value={approval.myTurn}
          unit="건"
          denominator={approval.inProgress}
          denominatorUnit="건"
          tone={approval.myTurn > 0 ? "informative" : "neutral"}
          icon={FileCheck}
          max={approval.inProgress || 1}
          meterValue={approval.myTurn}
          sub={approvalSub}
        />
      </div>

      <DashboardGrid slots={slots} initialVisibility={visibility} />
    </>
  );
}
