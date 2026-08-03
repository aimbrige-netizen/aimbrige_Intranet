"use client";

import { useMemo, useState } from "react";
import { CalendarClock, CalendarPlus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { SectionHeader } from "@/components/ui/Card";
import { EmptyState, TableEmptyRow } from "@/components/ui/EmptyState";
import { Meter, type MeterSegment, type MeterTone } from "@/components/ui/Progress";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { FilterChip, TableToolbar } from "@/components/ui/TableToolbar";
import {
  EVENT_COLORS,
  RESPONSE_COLORS,
  milestoneMark,
} from "@/features/calendar/colors";
import {
  WEEKDAY_LABELS,
  occursOn,
  toSeoulTime,
  weekdayOf,
} from "@/features/calendar/date";
import {
  countResponses,
  type AttendeeOption,
  type ResourceBookingBrief,
} from "@/features/calendar/data-client";
import {
  SCOPE_LABELS,
  calendarHref,
  kindsForScope,
  type CalendarScope,
  type CalendarView,
} from "@/features/calendar/view";
import { EventModal } from "@/features/calendar/EventModal";
import { BookingModal } from "@/features/calendar/BookingModal";
import { EventDetail } from "@/features/calendar/EventDetail";
import { CalendarPanelFilters } from "@/features/calendar/CalendarPanelFilters";
import type {
  CalendarItem,
  CalendarItemKind,
  Holiday,
  Resource,
} from "@/types/db";

/**
 * 캘린더 본문 (스펙 02 · 3.4)
 *
 * 기간 이동·뷰 전환은 서버(page.tsx)가 링크로 처리하고, 여기서는
 * 종류 필터 · 날짜 선택 · 모달만 담당한다.
 *
 * 예전 구조와의 차이:
 *  - 컨트롤 5그룹이 한 줄에 뒤엉켜 있었다 → 기간/뷰는 헤더 툴바로,
 *    스코프·종류 필터·주요 액션은 목록 툴바로 나눴다.
 *  - 범례는 색 이름만 읽어주는 죽은 줄이었다 → 건수 달린 필터 칩.
 *  - '+N건 더'가 <p>라 4번째 일정부터는 열 방법이 없었다 → 버튼으로 바꾸고
 *    그 날의 전체 목록을 아래 상세 표로 편다.
 */

/**
 * 날짜 숫자 색 — 일요일·공휴일 빨강, 토요일 파랑 (국내 캘린더 관습).
 * 이달 밖 날짜는 톤을 흐리는(opacity) 게 아니라 #bbbbbb(ghost) 단색이다 —
 * 09 실측. 월간 격자가 호출부에서 text-ghost로 직접 처리한다.
 */
function dayToneClass(weekday: number, isHoliday: boolean): string {
  return isHoliday || weekday === 0
    ? "text-danger"
    : weekday === 6
      ? "text-info"
      : "text-ink";
}

/** 요일별 분포 막대에서 쓸 종류별 톤 */
const KIND_METER_TONE: Record<CalendarItemKind, MeterTone> = {
  personal: "brand",
  invited: "brand",
  team: "positive",
  company: "informative",
  leave: "warning",
  approval: "neutral",
  milestone: "informative",
  resource_booking: "neutral",
};

const MONTH_CHIP_LIMIT = 4;

/**
 * '본사 3층 대회의실 · 참석 2/4명' — 없으면 빈 문자열.
 *
 * 명단 인원(4명)만으로는 회의가 성립하는지 알 수 없다. 지정된 사람 수가 아니라
 * "오겠다고 한 사람 / 지정된 사람"을 붙여 분모를 남긴다.
 */
function placeLine(item: CalendarItem): string {
  const summary =
    item.attendees.length > 0 ? countResponses(item.attendees) : null;
  return [
    item.location,
    summary ? `참석 ${summary.accepted}/${summary.total}명` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * 내가 불참으로 답한 항목.
 *
 * 목록에서 지우지 않는 이유: 거절은 삭제가 아니다. 숨기면 마음이 바뀌었을 때
 * 되돌릴 경로가 화면에서 사라지고, 옆자리 동료의 팀 캘린더에는 그대로 있는
 * 일정이 내 화면에만 없어 같은 화면을 보며 이야기할 수 없게 된다.
 * 대신 흐리게 + 취소선으로 "내 시간은 비어 있다"를 한눈에 보이게 한다.
 */
function declinedClass(item: CalendarItem): string | false {
  return item.myResponse === "declined" && "opacity-60";
}

interface DayRow {
  date: string;
  item: CalendarItem;
}

export function CalendarBoard({
  items,
  resources,
  bookings,
  bookingRange,
  holidays,
  days,
  scope,
  view,
  cursorMonth,
  today,
  focusDate,
  canCreateTeamEvent,
  attendeeOptions,
  openCreateOnMount,
  isAdmin,
}: {
  items: CalendarItem[];
  resources: Resource[];
  bookings: ResourceBookingBrief[];
  /** 예약 가용성을 확인할 수 있는 구간 (yyyy-MM-dd) */
  bookingRange: { from: string; to: string };
  /** 'yyyy-MM-dd' → 공휴일 */
  holidays: Record<string, Holiday>;
  /** 표시 기간의 날짜 배열 — 서버가 만든 격자를 그대로 쓴다 */
  days: string[];
  scope: CalendarScope;
  view: CalendarView;
  /** 월간 격자에서 "이번 달"로 볼 'yyyy-MM' */
  cursorMonth: string;
  today: string;
  /** 상세 패널이 처음 여는 날짜 */
  focusDate: string;
  canCreateTeamEvent: boolean;
  /** 참석자로 고를 수 있는 재직 임직원 (본인 제외) */
  attendeeOptions: AttendeeOption[];
  /** ?new=1로 들어오면 마운트 직후 작성 모달을 연다 */
  openCreateOnMount?: boolean;
  /** 패널 하단 ⚙ 캘린더 환경설정(관리자 전용 /admin/holidays) 노출 여부 */
  isAdmin?: boolean;
}) {
  const [hidden, setHidden] = useState<Set<CalendarItemKind>>(new Set());
  const [selectedDate, setSelectedDate] = useState(focusDate);
  const [eventModalOpen, setEventModalOpen] = useState(!!openCreateOnMount);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarItem | null>(null);
  const [detail, setDetail] = useState<CalendarItem | null>(null);
  const [presetDate, setPresetDate] = useState<string | null>(null);

  const kinds = useMemo(() => kindsForScope(scope), [scope]);

  /*
   * 기간을 옮기면 서버가 새 days를 주지만 컴포넌트는 그대로 살아 있어서
   * 지난 달에 고른 날짜가 그대로 남는다. 표시 기간 밖이면 기준일로 되돌린다.
   */
  const activeDate = days.includes(selectedDate) ? selectedDate : focusDate;

  const counts = useMemo(() => {
    const map = new Map<CalendarItemKind, number>();
    kinds.forEach((kind) => map.set(kind, 0));
    items.forEach((item) =>
      map.set(item.kind, (map.get(item.kind) ?? 0) + 1),
    );
    return map;
  }, [items, kinds]);

  const visible = useMemo(
    () => items.filter((item) => !hidden.has(item.kind)),
    [items, hidden],
  );

  /*
   * 아직 답하지 않은 참석 요청. 상세를 하나씩 열기 전에는 "내가 뭔가 답해야
   * 하는 게 있나"를 알 길이 없었다 — 건수만 툴바에 얹어 둔다.
   */
  const awaiting = useMemo(
    () => visible.filter((item) => item.myResponse === "pending").length,
    [visible],
  );

  /** 날짜 → 그 날 걸치는 항목 */
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    days.forEach((day) => {
      map.set(
        day,
        visible.filter((item) => occursOn(item, day)),
      );
    });
    return map;
  }, [days, visible]);

  const toggle = (kind: CalendarItemKind) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const openCreate = (date?: string) => {
    setDetail(null);
    setEditing(null);
    setPresetDate(date ?? activeDate);
    setEventModalOpen(true);
  };

  const openEdit = (item: CalendarItem) => {
    setDetail(null);
    setEditing(item);
    setPresetDate(null);
    setEventModalOpen(true);
  };

  // 빈 상태는 세 뷰가 같은 문구·같은 다음 행동을 쓴다
  const filtered = items.length > 0 && visible.length === 0;
  const empty = visible.length === 0;
  const emptyTitle = filtered
    ? "선택한 종류의 일정이 없습니다"
    : "이 기간에 표시할 일정이 없습니다";
  const emptyDescription = filtered
    ? `이 기간에 ${items.length}건이 있지만 지금 켜둔 종류에는 없습니다.`
    : "일정 추가로 개인·팀·전사 일정을 만들거나, 리소스 예약으로 회의실·차량을 잡을 수 있습니다.";
  const emptyAction = filtered ? (
    <Button size="small" variant="secondary" onClick={() => setHidden(new Set())}>
      필터 초기화
    </Button>
  ) : (
    <Button size="small" variant="secondary" onClick={() => openCreate()}>
      <CalendarPlus className="size-3.5" />
      일정 추가
    </Button>
  );

  const selectedItems = byDay.get(activeDate) ?? [];

  return (
    <>
      {/*
        종류 필터는 모듈 패널의 체크박스가 정본이다(09 패널 3~6).
        필터 상태(hidden)는 여기 살고, 패널에는 포털로 같은 상태를 잇는다.
      */}
      <CalendarPanelFilters
        kinds={kinds}
        hiddenKinds={hidden}
        onToggle={toggle}
        showSettings={!!isAdmin}
      />

      <TableToolbar
        filters={
          <>
            <SegmentedControl
              size="small"
              ariaLabel="캘린더 범위"
              value={scope}
              options={(Object.keys(SCOPE_LABELS) as CalendarScope[]).map(
                (key) => ({
                  value: key,
                  label: SCOPE_LABELS[key],
                  href: calendarHref({ scope: key, view }),
                }),
              )}
            />
            {/*
              md 미만에는 모듈 패널이 없다(레일 드로어 문법) — 종류 필터가
              통째로 사라지지 않게 칩을 모바일 한정으로 남긴다. md+는 패널
              체크박스가 담당하므로 같은 상태를 두 곳에 그리지 않는다.
            */}
            <span
              className="flex flex-wrap items-center gap-2 md:hidden"
              aria-label="종류 필터"
            >
              <FilterChip
                active={hidden.size === 0}
                count={items.length}
                onClick={() => setHidden(new Set())}
              >
                전체
              </FilterChip>
              {kinds.map((kind) => {
                const color = EVENT_COLORS[kind];
                return (
                  <FilterChip
                    key={kind}
                    active={!hidden.has(kind)}
                    count={counts.get(kind) ?? 0}
                    onClick={() => toggle(kind)}
                  >
                    <span
                      className={cn("size-2 rounded-full", color.dot)}
                      aria-hidden
                    />
                    {color.label}
                  </FilterChip>
                );
              })}
            </span>
          </>
        }
        count={
          awaiting > 0
            ? `${visible.length}건 표시 · 참석 응답 대기 ${awaiting}건`
            : `${visible.length}건 표시`
        }
        actions={
          <>
            <Button size="small" onClick={() => openCreate()}>
              <Plus className="size-3.5" />
              일정 추가
            </Button>
            {/* 콘텐츠 상단 툴바 보조 액션은 고스트(07·10) — primary는 '일정 추가' 하나 */}
            <Button
              size="small"
              variant="ghost"
              onClick={() => setBookingModalOpen(true)}
            >
              <CalendarClock className="size-3.5" />
              리소스 예약
            </Button>
          </>
        }
      />

      {/* 월간에서만 — 격자는 "언제"를 보여주지만 "어디에 몰려 있는지"는 못 보여준다 */}
      {view === "month" ? (
        <WeekdayDistribution days={days} byDay={byDay} total={visible.length} />
      ) : null}

      {/* 빈 상태는 격자를 지우지 않는다. 구조가 사라지면 무엇을 담는 화면인지 알 수 없다 */}
      {empty && view !== "list" ? (
        <div className="mb-5 rounded-card border border-dashed border-line-strong bg-subtle">
          <EmptyState
            icon={CalendarPlus}
            title={emptyTitle}
            description={emptyDescription}
            action={emptyAction}
            compact
          />
        </div>
      ) : null}

      {/*
        08 흰 시트: md+에서는 본문 전체가 흰 면이라 .ab-card 래퍼가 흰 면 위
        이중 테두리가 된다 — 격자를 시트에 직접 놓는다. md 미만은 패널 없는
        회청 canvas 위 카드 문법이 그대로라 카드 면을 유지한다.
      */}
      <div
        className={cn(
          "ab-card md:rounded-none md:border-0",
          view !== "list" && "p-2 md:p-0",
        )}
      >
        {view === "month" ? (
          <MonthGrid
            days={days}
            byDay={byDay}
            holidays={holidays}
            today={today}
            cursorMonth={cursorMonth}
            activeDate={activeDate}
            onSelectDay={setSelectedDate}
            onPick={setDetail}
            onAdd={openCreate}
          />
        ) : view === "week" ? (
          <WeekGrid
            days={days}
            byDay={byDay}
            holidays={holidays}
            today={today}
            activeDate={activeDate}
            onSelectDay={setSelectedDate}
            onPick={setDetail}
            onAdd={openCreate}
          />
        ) : (
          <ItemTable
            rows={days.flatMap((day) =>
              (byDay.get(day) ?? []).map((item) => ({ date: day, item })),
            )}
            holidays={holidays}
            showDate
            onPick={setDetail}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
            emptyAction={emptyAction}
          />
        )}
      </div>

      {/* 선택한 날 상세 — 월간 셀에 다 못 들어간 항목이 여기로 온다.
          흰 시트 위라 카드가 아니라 섹션 제목 + 표 직접 배치(08 문법). */}
      {view !== "list" ? (
        <section className="mt-5">
          <SectionHeader
            title={
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "tabular-nums",
                    dayToneClass(
                      weekdayOf(activeDate),
                      !!holidays[activeDate],
                    ),
                  )}
                >
                  {activeDate} ({WEEKDAY_LABELS[weekdayOf(activeDate)]})
                </span>
                {holidays[activeDate] ? (
                  <span className="text-label text-danger">
                    {holidays[activeDate].name}
                  </span>
                ) : null}
                {activeDate === today ? (
                  <span className="text-label text-muted">오늘</span>
                ) : null}
              </span>
            }
            description={`${selectedItems.length}건 · 날짜 숫자를 누르면 다른 날로 바뀝니다`}
            action={
              <Button
                size="small"
                variant="secondary"
                onClick={() => openCreate(activeDate)}
              >
                <Plus className="size-3.5" />
                일정 추가
              </Button>
            }
          />
          <div className="ab-card md:rounded-none md:border-0">
            <ItemTable
              rows={selectedItems.map((item) => ({
                date: activeDate,
                item,
              }))}
              holidays={holidays}
              onPick={setDetail}
              emptyTitle="이 날에는 일정이 없습니다"
              emptyDescription="비어 있는 날도 골격은 남깁니다. 위 '일정 추가'로 이 날짜에 바로 등록할 수 있습니다."
              emptyAction={
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => openCreate(activeDate)}
                >
                  <CalendarPlus className="size-3.5" />
                  일정 추가
                </Button>
              }
            />
          </div>
        </section>
      ) : null}

      <EventModal
        open={eventModalOpen}
        onClose={() => setEventModalOpen(false)}
        editing={editing}
        presetDate={presetDate}
        canCreateTeamEvent={canCreateTeamEvent}
        attendeeOptions={attendeeOptions}
      />

      <BookingModal
        open={bookingModalOpen}
        onClose={() => setBookingModalOpen(false)}
        resources={resources}
        bookings={bookings}
        rangeFrom={bookingRange.from}
        rangeTo={bookingRange.to}
        defaultDate={
          activeDate >= bookingRange.from && activeDate <= bookingRange.to
            ? activeDate
            : today
        }
      />

      <EventDetail
        item={detail}
        onClose={() => setDetail(null)}
        onEdit={openEdit}
      />
    </>
  );
}

/**
 * 요일별 분포.
 * "이번 달 24건"만으로는 회의가 화·목에 몰렸다는 걸 알 수 없다.
 * 종류별로 쌓아 막대 하나에 구성비까지 담는다.
 */
function WeekdayDistribution({
  days,
  byDay,
  total,
}: {
  days: string[];
  byDay: Map<string, CalendarItem[]>;
  total: number;
}) {
  const columns = useMemo(() => {
    return Array.from({ length: 7 }, (_, weekday) => {
      const counts = new Map<CalendarItemKind, number>();
      let sum = 0;
      days
        .filter((day) => weekdayOf(day) === weekday)
        .forEach((day) => {
          (byDay.get(day) ?? []).forEach((item) => {
            counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
            sum += 1;
          });
        });
      const segments: MeterSegment[] = Array.from(counts.entries()).map(
        ([kind, value]) => ({
          value,
          tone: KIND_METER_TONE[kind],
          label: `${EVENT_COLORS[kind].label} ${value}건`,
        }),
      );
      return { weekday, sum, segments };
    });
  }, [days, byDay]);

  const max = Math.max(1, ...columns.map((column) => column.sum));
  const peak = columns.reduce((a, b) => (b.sum > a.sum ? b : a));

  return (
    // 흰 시트 위 카드 래퍼 제거(08) — 섹션 제목 + 내용 직접 배치
    <section className="mb-5">
      <SectionHeader
        title="요일별 일정 분포"
        description={
          total === 0
            ? "이 기간에 표시할 일정이 없습니다"
            : `${total}건 · 가장 많은 요일 ${WEEKDAY_LABELS[peak.weekday]}요일 ${peak.sum}건`
        }
      />
      <div className="grid grid-cols-7 gap-2">
        {columns.map((column) => (
          <div key={column.weekday}>
            <p
              className={cn(
                "mb-1.5 text-nano font-bold",
                column.weekday === 0
                  ? "text-danger"
                  : column.weekday === 6
                    ? "text-info"
                    : "text-muted",
              )}
            >
              {WEEKDAY_LABELS[column.weekday]}
            </p>
            <Meter
              max={max}
              segments={column.segments}
              size="md"
              aria-label={`${WEEKDAY_LABELS[column.weekday]}요일 ${column.sum}건 (최대 ${max}건)`}
            />
            <p className="mt-1 text-nano tabular-nums text-muted">
              {column.sum}건 /{max}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function EventChip({
  item,
  onPick,
}: {
  item: CalendarItem;
  onPick: (item: CalendarItem) => void;
}) {
  const color = EVENT_COLORS[item.kind];
  const time = item.allDay
    ? "종일"
    : `${toSeoulTime(item.startAt)}–${toSeoulTime(item.endAt)}`;
  const place = placeLine(item);
  const declined = item.myResponse === "declined";
  // 마일스톤은 색이 아니라 형태(깃발/체크)로 달성 여부를 말한다
  const mark = item.kind === "milestone" ? milestoneMark(item.completed) : null;

  return (
    <button
      type="button"
      onClick={() => onPick(item)}
      title={[
        `${color.label} · ${time} · ${item.title}`,
        place,
        mark ? mark.label : null,
        // 흐린 칩이 "지난 일정"이 아니라 "내가 거절한 일정"임을 말해준다
        declined ? "내 응답: 불참" : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      className={cn(
        "flex w-full items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-left text-nano transition-opacity duration-fast ease-standard hover:opacity-80",
        color.chip,
        mark?.className,
        declinedClass(item),
      )}
    >
      {mark ? <mark.icon className="size-2.5 shrink-0" aria-hidden /> : null}
      {!item.allDay ? (
        <span className="shrink-0 tabular-nums opacity-80">
          {toSeoulTime(item.startAt)}
        </span>
      ) : null}
      {/* 색을 빼는 것만으로는 "옅은 종류"와 구분되지 않는다 — 취소선을 함께 준다 */}
      <span className={cn("truncate", declined && "line-through")}>
        {item.title}
      </span>
    </button>
  );
}

function MonthGrid({
  days,
  byDay,
  holidays,
  today,
  cursorMonth,
  activeDate,
  onSelectDay,
  onPick,
  onAdd,
}: {
  days: string[];
  byDay: Map<string, CalendarItem[]>;
  holidays: Record<string, Holiday>;
  today: string;
  cursorMonth: string;
  activeDate: string;
  onSelectDay: (date: string) => void;
  onPick: (item: CalendarItem) => void;
  onAdd: (date: string) => void;
}) {
  return (
    <div>
      {/* 요일 헤더 — 07-modules.md 실측: h-48 · 14px/400 · 일요일 rgb(255,0,10) · 토요일 파랑(info) */}
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAY_LABELS.map((label, index) => (
          <div
            key={label}
            className={cn(
              "flex h-12 items-center justify-center text-body",
              index === 0
                ? "text-sunday"
                : index === 6
                  ? "text-info"
                  : "text-muted",
            )}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const dayItems = byDay.get(day) ?? [];
          const inMonth = day.startsWith(cursorMonth);
          const isToday = day === today;
          const isSelected = day === activeDate;
          const holiday = holidays[day];
          const weekday = index % 7;
          const rest = dayItems.length - MONTH_CHIP_LIMIT;

          return (
            <div
              key={day}
              className={cn(
                /*
                 * 09 실측: 날짜 칸 ~206×106 · td 테두리 없음, 격자선은 안쪽
                 * 얇은 선(line #eaecef) — 7열 끝의 오른선만 접어 바깥 테두리를
                 * 만들지 않는다. 이달 밖 칸의 회청 면(bg-canvas/60)은 걷는다 —
                 * 원본은 칸 배경이 아니라 숫자색(#bbbbbb)으로만 가른다.
                 */
                "group relative min-h-[106px] border-b border-r border-line py-1 [&:nth-child(7n)]:border-r-0",
                isSelected && "ring-1 ring-inset ring-primary",
              )}
            >
              {/* 날짜 숫자는 칸 좌상단 pl-[18px] 정렬 (09) */}
              <div className="mb-1 flex items-center gap-1 pl-[18px] pr-1">
                <button
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-pressed={isSelected}
                  title={`${day} 일정 보기`}
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full text-body tabular-nums transition-colors duration-fast ease-standard",
                    isToday
                      ? // 오늘 = 먹색(#1c1c1c) 원형 필 + 흰 숫자 (09)
                        "bg-ink text-white"
                      : cn(
                          inMonth
                            ? dayToneClass(weekday, !!holiday)
                            : "text-ghost", // 이달 밖 날짜 #bbbbbb (09)
                          "hover:bg-subtle",
                        ),
                  )}
                >
                  {Number(day.slice(8, 10))}
                </button>

                {holiday ? (
                  <span
                    className={cn(
                      "truncate text-nano text-danger",
                      !inMonth && "opacity-40",
                    )}
                    title={holiday.name}
                  >
                    {holiday.name}
                  </span>
                ) : null}

                <button
                  type="button"
                  onClick={() => onAdd(day)}
                  aria-label={`${day} 일정 추가`}
                  title={`${day} 일정 추가`}
                  className="ml-auto grid size-5 shrink-0 place-items-center rounded-sm text-muted opacity-0 transition-opacity duration-fast ease-standard hover:bg-subtle hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Plus className="size-3.5" aria-hidden />
                </button>
              </div>

              {/* 칸 좌우 padding이 숫자 행(pl-18)으로 넘어가서 칩은 px-1을 따로 갖는다 */}
              <div className="space-y-0.5 px-1">
                {dayItems.slice(0, MONTH_CHIP_LIMIT).map((item) => (
                  <EventChip key={item.id} item={item} onPick={onPick} />
                ))}
                {rest > 0 ? (
                  <button
                    type="button"
                    onClick={() => onSelectDay(day)}
                    className="w-full rounded-sm px-1.5 py-0.5 text-left text-nano text-muted transition-colors duration-fast ease-standard hover:bg-subtle hover:text-ink"
                  >
                    +{rest}건 더 보기
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({
  days,
  byDay,
  holidays,
  today,
  activeDate,
  onSelectDay,
  onPick,
  onAdd,
}: {
  days: string[];
  byDay: Map<string, CalendarItem[]>;
  holidays: Record<string, Holiday>;
  today: string;
  activeDate: string;
  onSelectDay: (date: string) => void;
  onPick: (item: CalendarItem) => void;
  onAdd: (date: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
      {days.map((day, index) => {
        const dayItems = byDay.get(day) ?? [];
        const isToday = day === today;
        const isSelected = day === activeDate;
        const holiday = holidays[day];

        return (
          <div
            key={day}
            className={cn(
              "group flex min-h-40 flex-col rounded-card border border-line p-2",
              isSelected && "border-primary bg-surface shadow-raised",
            )}
          >
            <button
              type="button"
              onClick={() => onSelectDay(day)}
              aria-pressed={isSelected}
              title={`${day} 일정 보기`}
              className="mb-2 w-full rounded-sm text-left transition-colors duration-fast ease-standard hover:bg-subtle"
            >
              <span className="flex items-baseline gap-1.5 px-1 py-0.5">
                <span
                  className={cn(
                    "text-label font-bold",
                    index === 0
                      ? "text-danger"
                      : index === 6
                        ? "text-info"
                        : "text-muted",
                  )}
                >
                  {WEEKDAY_LABELS[index]}
                </span>
                <span
                  className={cn(
                    "text-body tabular-nums",
                    isToday
                      ? "font-bold text-primary"
                      : dayToneClass(index, !!holiday),
                  )}
                >
                  {Number(day.slice(8, 10))}
                </span>
                <span className="ml-auto text-nano tabular-nums text-muted">
                  {dayItems.length}건
                </span>
              </span>
              {holiday ? (
                <span className="block truncate px-1 text-nano text-danger">
                  {holiday.name}
                </span>
              ) : null}
            </button>

            <div className="flex flex-1 flex-col gap-1">
              {dayItems.map((item) => (
                <EventChip key={item.id} item={item} onPick={onPick} />
              ))}
              {/* 하이픈 한 글자는 "없음"을 알려줄 뿐 다음 행동을 주지 않는다 */}
              <button
                type="button"
                onClick={() => onAdd(day)}
                className={cn(
                  "w-full rounded-sm border border-dashed border-line-strong px-1.5 py-1 text-nano text-muted transition-colors duration-fast ease-standard hover:border-primary hover:text-primary",
                  dayItems.length > 0 &&
                    "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
                )}
                title={`${day} 일정 추가`}
              >
                + 일정
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 리스트 뷰와 '선택한 날' 패널이 공유하는 조밀 표.
 * 예전 리스트 뷰는 ul + 커스텀 행이라 다른 화면의 표와 스캔 방식이 달랐고,
 * 비면 thead 없이 통째로 사라졌다.
 */
function ItemTable({
  rows,
  holidays,
  showDate = false,
  onPick,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  rows: DayRow[];
  holidays: Record<string, Holiday>;
  showDate?: boolean;
  onPick: (item: CalendarItem) => void;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}) {
  const colSpan = showDate ? 5 : 4;

  return (
    <div className="overflow-x-auto">
      <table
        className={cn(
          "ab-table ab-table--compact",
          showDate ? "min-w-[720px]" : "min-w-[560px]",
        )}
      >
        <thead>
          <tr>
            {showDate ? <th className="w-40">날짜</th> : null}
            <th className="w-28">시간</th>
            <th className="w-28">종류</th>
            <th>제목</th>
            <th className="w-32">관련자</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <TableEmptyRow
              colSpan={colSpan}
              icon={CalendarClock}
              title={emptyTitle}
              description={emptyDescription}
              action={emptyAction}
            />
          ) : (
            rows.map(({ date, item }) => {
              const color = EVENT_COLORS[item.kind];
              const weekday = weekdayOf(date);
              const holiday = holidays[date];
              const mark =
                item.kind === "milestone"
                  ? milestoneMark(item.completed)
                  : null;

              return (
                <tr key={`${date}-${item.id}`}>
                  {showDate ? (
                    <td className="whitespace-nowrap tabular-nums">
                      <span className={dayToneClass(weekday, !!holiday)}>
                        {date.slice(5)} ({WEEKDAY_LABELS[weekday]})
                      </span>
                      {holiday ? (
                        <span className="ml-1.5 text-nano text-danger">
                          {holiday.name}
                        </span>
                      ) : null}
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap tabular-nums text-muted">
                    {item.allDay
                      ? "종일"
                      : `${toSeoulTime(item.startAt)}–${toSeoulTime(item.endAt)}`}
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-label text-muted">
                      <span
                        className={cn("size-2 rounded-full", color.dot)}
                        aria-hidden
                      />
                      {color.label}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => onPick(item)}
                      className={cn(
                        "block w-full text-left transition-colors duration-fast ease-standard hover:text-primary",
                        mark?.className,
                        declinedClass(item),
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "min-w-0 truncate text-body-sm text-ink",
                            item.myResponse === "declined" && "line-through",
                          )}
                        >
                          {item.title}
                        </span>
                        {/* 내가 답해야 하는 자리인지가 제목 옆에서 끝나야 한다 */}
                        {item.myResponse ? (
                          <span
                            className={cn(
                              "shrink-0 rounded-sm px-1.5 text-nano",
                              RESPONSE_COLORS[item.myResponse].badge,
                            )}
                          >
                            {RESPONSE_COLORS[item.myResponse].label}
                          </span>
                        ) : null}
                        {/* 마일스톤은 같은 자리에서 달성 여부가 끝나야 한다 */}
                        {mark ? (
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1.5 text-nano",
                              mark.badge,
                            )}
                          >
                            <mark.icon className="size-2.5" aria-hidden />
                            {mark.label}
                          </span>
                        ) : null}
                      </span>
                      {/* 회의는 "어디서 · 누가"까지 봐야 갈지 말지가 정해진다 */}
                      {placeLine(item) ? (
                        <span className="block truncate text-nano text-muted">
                          {placeLine(item)}
                        </span>
                      ) : null}
                    </button>
                  </td>
                  <td className="truncate text-caption">
                    {item.ownerName ?? "-"}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
