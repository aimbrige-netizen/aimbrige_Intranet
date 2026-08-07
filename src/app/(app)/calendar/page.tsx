import type { Metadata } from "next";
import {
  CalendarDays,
  CalendarRange,
  Flag,
  Plane,
  UserRound,
} from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { CalendarBoard } from "@/features/calendar/CalendarBoard";
import { CalendarHeader } from "@/features/calendar/CalendarHeader";
import { ResourceBoard } from "@/features/calendar/ResourceBoard";
import type {
  AttendeeOption,
  ResourceBookingBrief,
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
  type CalendarScope,
  type CalendarView,
} from "@/features/calendar/view";
import { requireSessionEmployee } from "@/lib/auth/session";
import type { CalendarItem, Holiday, Resource } from "@/types/db";

export const metadata: Metadata = { title: "캘린더" };

/**
 * 캘린더 (스펙 02 · 3.4~3.6 + 09-calendar.md 실측)
 *
 * 골격: 콘텐츠 제목 "일정목록" 20/500(09 — PageHeader급 밴드 없음, 결재 홈·
 * 리소스 뷰와 같은 단) → 날짜 내비 + 보기 전환 필 세그먼트(CalendarHeader)
 * → 분모 있는 요약 밴드 → 시각화 → 조밀 표.
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
    /** 리소스 뷰의 일간/주간 세그먼트 (17 "예약" 실측). week 외에는 일간 */
    mode?: string;
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
        scope={scope}
        mode={searchParams.mode === "week" ? "week" : "day"}
        focusDay={cursor}
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
      className="mb-5 mt-4"
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

  return (
    <>
      {/*
        콘텐츠 제목 "일정목록" 20/500 — 09 실측 그대로, PageHeader급 밴드
        없음(결재 홈·동호회 홈·리소스 뷰와 같은 단). 스코프는 아래 툴바
        세그먼트가, 오늘·공휴일은 격자의 오늘 필·빨간 날짜가 그대로 말한다.
      */}
      <h1 className="text-title-l text-ink">
        일정목록
      </h1>
      {scheduleHeader}

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

/**
 * 리소스 예약 현황 — 모듈 패널의 '리소스 예약'이 도착하는 화면.
 *
 * 17 "예약" 실측(다우 /gw/app/asset "자산 예약 현황") 재구축.
 * 콘텐츠 제목 20/500 아래 일간/주간 세그먼트 + 날짜 내비 + 시간축 타임라인 +
 * 하단 "내 예약 현황" 표(ResourceBoard가 그린다).
 *
 * 종전의 PageHeader 밴드·StatCard 4칸·PeriodNavigator는 다우 예약 화면에
 * 없어서 걷어냈다(결재 홈에서 지표 밴드를 걷어낸 것과 같은 판단). 리소스
 * 종수·이 주 예약 건수는 아래 필터 칩과 툴바 카운트가 그대로 말한다.
 * 데이터 경로는 그대로다 — 표시 계층만 바꿨다(e2e:calendar 불변의 근거).
 */
function ResourceScreen({
  resources,
  bookings,
  days,
  holidays,
  today,
  myId,
  bookingRange,
  scope,
  mode,
  focusDay,
}: {
  resources: Resource[];
  bookings: ResourceBookingBrief[];
  days: string[];
  holidays: Record<string, Holiday>;
  today: string;
  myId: string;
  bookingRange: { from: string; to: string };
  scope: CalendarScope;
  /** 일간/주간 세그먼트 — URL(?mode=)이 쥔다. 내비 링크로 다시 그려도 유지된다 */
  mode: "day" | "week";
  /** 날짜 내비 기준일(=?cursor). 주 경계를 넘는 하루 이동이 정확한 날에 내린다 */
  focusDay: string;
}) {
  return (
    <>
      {/*
        콘텐츠 제목 "리소스 예약 현황" 20/500 — 다우 "자산 예약 현황" 축.
        줄높이 30px은 06 heading-l 실측(결재 홈·동호회 홈과 같은 단).
      */}
      <h1 className="mb-5 text-title-l text-ink">
        리소스 예약 현황
      </h1>

      <ResourceBoard
        resources={resources}
        bookings={bookings}
        days={days}
        holidays={holidays}
        today={today}
        myId={myId}
        bookingRange={bookingRange}
        scope={scope}
        mode={mode}
        focusDay={focusDay}
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
