import type { Metadata } from "next";
import {
  Boxes,
  CalendarDays,
  CalendarRange,
  Gauge,
  Plane,
  UserRound,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { PeriodNavigator } from "@/components/ui/PeriodNavigator";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StatCard } from "@/components/ui/StatCard";
import { CalendarBoard } from "@/features/calendar/CalendarBoard";
import { ResourceBoard } from "@/features/calendar/ResourceBoard";
import {
  bookingHours,
  bookingYmd,
  formatBookingHours,
  RESOURCE_TYPE_LABELS,
  RESOURCE_TYPES,
  type ResourceBookingBrief,
} from "@/features/calendar/data-client";
import {
  getActiveResources,
  getCalendarItems,
  getHolidayMap,
  getResourceBookingsInRange,
} from "@/features/calendar/data";
import {
  addDaysYmd,
  addMonthsYm,
  monthGrid,
  monthLabel,
  occursOn,
  rangeOf,
  seoulToDate,
  todayYmd,
  weekGrid,
  weekdayOf,
} from "@/features/calendar/date";
import {
  SCOPE_LABELS,
  VIEW_LABELS,
  SCHEDULE_VIEWS,
  calendarHref,
  countByKind,
  parseScope,
  parseView,
  type CalendarView,
} from "@/features/calendar/view";
import { requireSessionEmployee } from "@/lib/auth/session";
import type { CalendarItem, Holiday, Resource } from "@/types/db";

export const metadata: Metadata = { title: "캘린더" };

const YM_PATTERN = /^\d{4}-\d{2}$/;
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 리소스 한 대가 하루에 열려 있다고 보는 시간 (09:00~18:00) — ResourceBoard와 같은 규칙 */
const OPEN_HOURS_PER_DAY = 9;

/**
 * 캘린더 (스펙 02 · 3.4~3.6)
 *
 * 골격은 근태 화면과 같다 —
 *   PageHeader(기간 스테퍼 + 기간 단위 토글) → 분모 있는 요약 밴드 → 시각화 → 조밀 표.
 *
 * 예전에는 제목 한 줄 다음이 곧바로 격자였고, 그 사이에 스코프 탭·뷰 탭·
 * 스테퍼·기간 라벨·액션 2개가 flex-wrap 한 줄로 뭉쳐 있었다. 지표는 0개였다.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: {
    scope?: string;
    view?: string;
    cursor?: string;
    /** ?new=1 이면 일정 작성 모달을 열고 시작한다 (홈 빈 상태에서 바로 진입) */
    new?: string;
  };
}) {
  const me = await requireSessionEmployee();
  const scope = parseScope(searchParams.scope);
  const view = parseView(searchParams.view);
  const today = todayYmd();

  // 잘못된 cursor가 들어와도 화면이 깨지지 않게 형식을 검증한다
  const cursor =
    view === "month"
      ? YM_PATTERN.test(searchParams.cursor ?? "")
        ? searchParams.cursor!
        : today.slice(0, 7)
      : YMD_PATTERN.test(searchParams.cursor ?? "")
        ? searchParams.cursor!
        : today;

  const days =
    view === "month"
      ? monthGrid(cursor)
      : view === "list"
        ? // 리스트 뷰는 기준일부터 30일
          Array.from({ length: 30 }, (_, i) => addDaysYmd(cursor, i))
        : weekGrid(cursor);

  const first = days[0];
  const last = days[days.length - 1];
  const { from, to } = rangeOf(days);

  /*
   * 예약 가용성은 표시 기간과 별개다. 지난 달을 보고 있어도 "다음 주 회의실"을
   * 잡을 수 있어야 하므로, 표시 기간과 오늘~+60일을 합집합으로 확보한다.
   */
  const bookingFrom = first < today ? first : today;
  const bookingTo = maxYmd(last, addDaysYmd(today, 60));

  const [items, resources, holidays, bookings] = await Promise.all([
    // 리소스 화면은 일정 격자를 그리지 않는다 — 4개 테이블을 헛되이 읽지 않는다
    view === "resources"
      ? Promise.resolve<CalendarItem[]>([])
      : getCalendarItems({
          scope,
          from,
          to,
          employeeId: me.id,
          teamId: me.team_id,
        }),
    getActiveResources(),
    getHolidayMap(first, last),
    getResourceBookingsInRange(
      seoulToDate(bookingFrom),
      seoulToDate(addDaysYmd(bookingTo, 1)),
    ),
  ]);

  const inPeriod = today >= first && today <= last;
  const step = (delta: number) =>
    calendarHref({
      scope,
      view,
      cursor:
        view === "month"
          ? addMonthsYm(cursor, delta)
          : addDaysYmd(cursor, delta * (view === "list" ? 30 : 7)),
    });

  const monthFrom = `${cursor}-01`;
  const monthTo = addDaysYmd(`${addMonthsYm(cursor, 1)}-01`, -1);
  const periodLabel =
    view === "month" ? monthLabel(cursor) : `${first} ~ ${last}`;
  const periodSub =
    view === "month"
      ? `${monthFrom} ~ ${monthTo}`
      : view === "week"
        ? "주간"
        : view === "list"
          ? "기준일 이후 30일"
          : "주간 예약 현황";

  const navigator = (
    <PeriodNavigator
      label={periodLabel}
      sublabel={periodSub}
      prevHref={step(-1)}
      nextHref={step(1)}
      todayHref={calendarHref({ scope, view })}
      atToday={inPeriod}
      className="mb-0"
      right={
        view === "resources" ? undefined : (
          <SegmentedControl
            ariaLabel="기간 단위"
            value={view}
            options={SCHEDULE_VIEWS.map((option) => ({
              value: option,
              label: VIEW_LABELS[option],
              href: calendarHref({ scope, view: option }),
            }))}
          />
        )
      }
    />
  );

  if (view === "resources") {
    return (
      <ResourceScreen
        resources={resources}
        bookings={bookings}
        days={days}
        holidays={holidays}
        today={today}
        myId={me.id}
        bookingRange={{ from: bookingFrom, to: bookingTo }}
        navigator={navigator}
      />
    );
  }

  const counts = countByKind(items);
  const own =
    scope === "team"
      ? counts.team
      : scope === "company"
        ? counts.company
        : counts.personal;
  const away = counts.leave + counts.approval;
  const total = items.length;
  const daysWithItems = days.filter((day) =>
    items.some((item) => occursOn(item, day)),
  ).length;
  // 종류 이름과 스코프 이름이 같다 — personal/team/company
  const allDay = items.filter(
    (item) => item.allDay && item.kind === scope,
  ).length;

  const bandLabel =
    view === "month"
      ? monthLabel(cursor)
      : view === "week"
        ? "이 주"
        : "이후 30일";

  const holidayCount = days.filter((day) => holidays[day]).length;

  return (
    <>
      <PageHeader
        title="캘린더"
        meta={
          <>
            <span>{SCOPE_LABELS[scope]} 일정</span>
            <span>·</span>
            <span>오늘 {today}</span>
            <span>·</span>
            <span>이 기간 공휴일 {holidayCount}일</span>
          </>
        }
        toolbar={navigator}
      />

      {/* 요약 밴드 — 분모 없는 숫자는 두지 않는다 */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={`${bandLabel} 일정`}
          value={total}
          unit="건"
          tone="brand"
          icon={CalendarDays}
          emphasis
          max={days.length}
          meterValue={daysWithItems}
          sub={`일정 있는 날 ${daysWithItems}일 / ${days.length}일`}
        />
        <StatCard
          label={`${SCOPE_LABELS[scope]} 일정`}
          value={own}
          unit="건"
          denominator={total}
          denominatorUnit="건"
          tone="informative"
          icon={scope === "personal" ? UserRound : CalendarRange}
          max={total || 1}
          meterValue={own}
          sub={`종일 ${allDay}건 · 시간 지정 ${own - allDay}건`}
        />
        <StatCard
          label="휴가·출장"
          value={away}
          unit="건"
          denominator={total}
          denominatorUnit="건"
          tone="neutral"
          icon={Plane}
          max={total || 1}
          meterValue={away}
          sub={`연차·휴가 ${counts.leave}건 · 출장·재택 ${counts.approval}건`}
        />
        <StatCard
          label="리소스 예약"
          value={counts.resource_booking}
          unit="건"
          denominator={total}
          denominatorUnit="건"
          tone="neutral"
          icon={Boxes}
          max={total || 1}
          meterValue={counts.resource_booking}
          sub={`예약 가능 리소스 ${resources.length}종`}
        />
      </div>

      <CalendarBoard
        items={items}
        resources={resources}
        bookings={bookings}
        bookingRange={{ from: bookingFrom, to: bookingTo }}
        holidays={holidays}
        days={days}
        scope={scope}
        view={view}
        cursorMonth={cursor}
        today={today}
        focusDate={focusDateOf(view, days, today, cursor)}
        canCreateTeamEvent={!!me.team_id}
        openCreateOnMount={searchParams.new === "1"}
      />
    </>
  );
}

/** 리소스 예약 현황 — 모듈 패널의 '리소스 예약'이 도착하는 화면 */
function ResourceScreen({
  resources,
  bookings,
  days,
  holidays,
  today,
  myId,
  bookingRange,
  navigator,
}: {
  resources: Resource[];
  bookings: ResourceBookingBrief[];
  days: string[];
  holidays: Record<string, Holiday>;
  today: string;
  myId: string;
  bookingRange: { from: string; to: string };
  navigator: React.ReactNode;
}) {
  const first = days[0];
  const last = days[days.length - 1];
  const week = bookings.filter((booking) => {
    const ymd = bookingYmd(booking);
    return ymd >= first && ymd <= last;
  });

  const mine = week.filter((booking) => booking.bookerId === myId).length;
  const bookedResources = new Set(week.map((booking) => booking.resourceId))
    .size;
  const usedHours = week.reduce((sum, b) => sum + bookingHours(b), 0);
  const workdays =
    days.filter((day) => {
      const weekday = weekdayOf(day);
      return weekday !== 0 && weekday !== 6 && !holidays[day];
    }).length || 1;
  const openHours = workdays * OPEN_HOURS_PER_DAY * (resources.length || 1);
  const rate = Math.round((usedHours / (openHours || 1)) * 100);

  const typeSummary = RESOURCE_TYPES.filter((type) =>
    resources.some((resource) => resource.type === type),
  )
    .map(
      (type) =>
        `${RESOURCE_TYPE_LABELS[type]} ${resources.filter((r) => r.type === type).length}`,
    )
    .join(" · ");

  return (
    <>
      <PageHeader
        title="리소스 예약"
        meta={
          <>
            <span>회의실·차량·비품</span>
            <span>·</span>
            <span>오늘 {today}</span>
            <span>·</span>
            <span>근무일 {workdays}일</span>
          </>
        }
        toolbar={navigator}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="이 주 예약"
          value={week.length}
          unit="건"
          tone="brand"
          icon={Boxes}
          emphasis
          max={resources.length || 1}
          meterValue={bookedResources}
          sub={`예약된 리소스 ${bookedResources}종 / ${resources.length}종`}
        />
        <StatCard
          label="내 예약"
          value={mine}
          unit="건"
          denominator={week.length}
          denominatorUnit="건"
          tone="informative"
          icon={UserRound}
          max={week.length || 1}
          meterValue={mine}
          sub={`다른 직원 예약 ${week.length - mine}건`}
        />
        <StatCard
          label="주간 가동"
          value={formatBookingHours(usedHours)}
          denominator={`${openHours}h`}
          tone="neutral"
          icon={Gauge}
          max={openHours || 1}
          meterValue={usedHours}
          scale
          scaleMaxLabel={`${openHours}h`}
          sub={`가동률 ${rate}% · 근무일 09:00~18:00 기준`}
        />
        <StatCard
          label="예약 가능 리소스"
          value={resources.length}
          unit="종"
          tone="neutral"
          icon={CalendarRange}
          sub={typeSummary || "등록된 리소스가 없습니다"}
        />
      </div>

      <ResourceBoard
        resources={resources}
        bookings={bookings}
        days={days}
        holidays={holidays}
        today={today}
        myId={myId}
        bookingRange={bookingRange}
      />
    </>
  );
}

/** 상세 패널이 처음 여는 날 — 오늘이 기간 안이면 오늘, 아니면 기간의 첫 날 */
function focusDateOf(
  view: CalendarView,
  days: string[],
  today: string,
  cursor: string,
): string {
  if (today >= days[0] && today <= days[days.length - 1]) return today;
  return view === "month" ? `${cursor}-01` : days[0];
}

function maxYmd(a: string, b: string): string {
  return a > b ? a : b;
}
