import type { Metadata } from "next";
import {
  Boxes,
  CalendarDays,
  CalendarRange,
  Flag,
  Gauge,
  Plane,
  UserRound,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { PeriodNavigator } from "@/components/ui/PeriodNavigator";
import { StatCard } from "@/components/ui/StatCard";
import { CalendarBoard } from "@/features/calendar/CalendarBoard";
import { CalendarHeader } from "@/features/calendar/CalendarHeader";
import { ResourceBoard } from "@/features/calendar/ResourceBoard";
import {
  bookingHours,
  bookingYmd,
  formatBookingHours,
  OPEN_HOURS_LABEL,
  OPEN_HOURS_PER_DAY,
  RESOURCE_TYPE_LABELS,
  RESOURCE_TYPES,
  type AttendeeOption,
  type ResourceBookingBrief,
} from "@/features/calendar/data-client";
import {
  getActiveResources,
  getAttendeeOptions,
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
  calendarCursorOf,
  calendarHref,
  calendarViewOf,
  countByKind,
  parseScope,
  type CalendarView,
} from "@/features/calendar/view";
import { requireSessionEmployee } from "@/lib/auth/session";
import type { CalendarItem, Holiday, Resource } from "@/types/db";

export const metadata: Metadata = { title: "캘린더" };

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
    /** 표시 방식 — 월간·주간·리스트·리소스 */
    view?: string;
    /** 기간 규약의 기준점 (lib/period와 같은 이름) */
    cursor?: string;
    /** 다른 화면에서 넘어온 기간 단위. view가 없을 때만 본다 */
    period?: string;
    /** ?new=1 이면 일정 작성 모달을 열고 시작한다 (홈 빈 상태에서 바로 진입) */
    new?: string;
  };
}) {
  const me = await requireSessionEmployee();
  const scope = parseScope(searchParams.scope);
  const today = todayYmd();

  /*
   * 표시 방식은 ?view=, 기준점은 ?cursor= 로 읽는다. 기간 규약(lib/period)의
   * ?period= 를 달고 들어온 링크도 view.ts가 받아 준다 — 잘못된 값이 와도
   * 화면이 깨지지 않게 형식을 맞춰 떨어뜨린다.
   */
  const view = calendarViewOf(searchParams);
  const cursor = calendarCursorOf(view, searchParams.cursor, today);

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

  const [items, resources, holidays, bookings, attendeeOptions] =
    await Promise.all([
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
      // 참석자 선택기는 일정 모달에서만 쓴다
      view === "resources"
        ? Promise.resolve<AttendeeOption[]>([])
        : getAttendeeOptions(me.id),
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

  if (view === "resources") {
    // 리소스 화면은 09 스펙 대상이 아니라 공용 PeriodNavigator를 유지한다
    return (
      <ResourceScreen
        resources={resources}
        bookings={bookings}
        days={days}
        holidays={holidays}
        today={today}
        myId={me.id}
        bookingRange={{ from: bookingFrom, to: bookingTo }}
        navigator={
          <PeriodNavigator
            label={periodLabel}
            sublabel={periodSub}
            prevHref={step(-1)}
            nextHref={step(1)}
            todayHref={calendarHref({ scope, view })}
            atToday={inPeriod}
            className="mb-0"
          />
        }
      />
    );
  }

  /*
   * 콘텐츠 헤더 (09): "2026.08" 24/500 + 화살표 + 오늘, 우측 보기 전환 필
   * 세그먼트. 월간은 커서(YYYY-MM)를 점 표기로, 주간·리스트는 표시 구간을
   * 같은 표기로 잇는다.
   */
  const headerLabel =
    view === "month"
      ? cursor.replace("-", ".")
      : `${first.replace(/-/g, ".")} ~ ${last.replace(/-/g, ".")}`;

  const scheduleHeader = (
    <CalendarHeader
      label={headerLabel}
      prevHref={step(-1)}
      nextHref={step(1)}
      todayHref={calendarHref({ scope, view })}
      atToday={inPeriod}
      active={view}
      segments={SCHEDULE_VIEWS.map((option) => ({
        value: option,
        label: VIEW_LABELS[option],
        href: calendarHref({ scope, view: option }),
      }))}
    />
  );

  const counts = countByKind(items);
  const own =
    scope === "team"
      ? counts.team
      : scope === "company"
        ? counts.company
        : counts.personal;
  const away = counts.leave + counts.approval;
  /* 일정도 부재도 아닌 것 — 프로젝트 마감과 자원 예약 */
  const others = counts.milestone + counts.resource_booking;
  const total = items.length;
  const daysWithItems = days.filter((day) =>
    items.some((item) => occursOn(item, day)),
  ).length;
  /*
   * 참석자로 지정된 남의 일정은 공개범위 칸에 잡히지 않는다. 그런데 읽는 사람에게는
   * "내가 가야 하는 자리"라 내 일정과 같은 무게다 — 합쳐 세고 sub에서 쪼갠다.
   */
  const mine = own + counts.invited;

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
        toolbar={scheduleHeader}
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
          value={mine}
          unit="건"
          denominator={total}
          denominatorUnit="건"
          tone="informative"
          icon={scope === "personal" ? UserRound : CalendarRange}
          max={total || 1}
          meterValue={mine}
          sub={`내가 등록 ${own}건 · 참석 요청 ${counts.invited}건`}
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
        {/*
          네 칸이 전체를 남김없이 나눈다: 내 일정 + 휴가·출장 + (마일스톤·예약).
          마일스톤이 병합되면서 어느 칸에도 안 잡히는 나머지가 생기면,
          "이 기간 24건"과 아래 세 칸의 합이 어긋나 보인다.
        */}
        <StatCard
          label="마일스톤·예약"
          value={others}
          unit="건"
          denominator={total}
          denominatorUnit="건"
          tone="neutral"
          icon={Flag}
          max={total || 1}
          meterValue={others}
          sub={`프로젝트 마일스톤 ${counts.milestone}건 · 리소스 예약 ${counts.resource_booking}건`}
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
        attendeeOptions={attendeeOptions}
        openCreateOnMount={searchParams.new === "1"}
        isAdmin={me.isSystemAdmin}
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
          sub={`가동률 ${rate}% · 근무일 ${OPEN_HOURS_LABEL} 기준`}
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
