"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { EVENT_COLORS, PENDING_SOURCES } from "@/features/calendar/colors";
import {
  WEEKDAY_LABELS,
  addMonthsYm,
  addDaysYmd,
  monthGrid,
  monthLabel,
  occursOn,
  todayYmd,
  toSeoulTime,
  toSeoulYmd,
  weekGrid,
  weekdayOf,
} from "@/features/calendar/date";
import { EventModal } from "@/features/calendar/EventModal";
import { BookingModal } from "@/features/calendar/BookingModal";
import { EventDetail } from "@/features/calendar/EventDetail";
import type { CalendarItem, Holiday, Resource } from "@/types/db";

/**
 * 날짜 숫자 색상 — 일요일·공휴일은 빨강, 토요일은 파랑.
 * 국내 캘린더의 기본 관습이라 별도 옵션 없이 항상 적용한다.
 */
function dayToneClass(
  weekday: number,
  isHoliday: boolean,
  inRange: boolean,
): string {
  const tone =
    isHoliday || weekday === 0
      ? "text-danger"
      : weekday === 6
        ? "text-primary"
        : "text-ink";
  // 이번 달이 아닌 날은 같은 색조를 유지하면서 흐리게
  return inRange ? tone : `${tone} opacity-40`;
}

export type CalendarView = "month" | "week" | "list";
export type CalendarScope = "personal" | "team" | "company";

const SCOPE_LABELS: Record<CalendarScope, string> = {
  personal: "개인",
  team: "팀",
  company: "전사",
};

const VIEW_LABELS: Record<CalendarView, string> = {
  month: "월간",
  week: "주간",
  list: "리스트",
};

/**
 * 캘린더 메인 (스펙 02 · 3.4)
 * 데이터 조회는 서버가 하고, 여기서는 격자 배치·모달·네비게이션만 담당한다.
 * 뷰/기준일/스코프는 URL 쿼리로 유지해 새로고침·뒤로가기가 자연스럽게 동작한다.
 */
export function CalendarBoard({
  items,
  resources,
  holidays,
  scope,
  view,
  cursor,
  canCreateTeamEvent,
}: {
  items: CalendarItem[];
  resources: Resource[];
  /** 'yyyy-MM-dd' → 공휴일 */
  holidays: Record<string, Holiday>;
  scope: CalendarScope;
  view: CalendarView;
  /** 월간은 'yyyy-MM', 주간·리스트는 'yyyy-MM-dd' 기준 */
  cursor: string;
  canCreateTeamEvent: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarItem | null>(null);
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [presetDate, setPresetDate] = useState<string | null>(null);

  const setParam = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(patch).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    const search = params.toString();
    router.push(search ? `/calendar?${search}` : "/calendar");
  };

  const today = todayYmd();
  const days =
    view === "month"
      ? monthGrid(cursor)
      : view === "week"
        ? weekGrid(cursor)
        : [];

  const shift = (direction: 1 | -1) => {
    if (view === "month") {
      setParam({ cursor: addMonthsYm(cursor, direction) });
    } else if (view === "week") {
      setParam({ cursor: addDaysYmd(cursor, direction * 7) });
    } else {
      setParam({ cursor: addDaysYmd(cursor, direction * 30) });
    }
  };

  const goToday = () =>
    setParam({ cursor: view === "month" ? today.slice(0, 7) : today });

  const headingLabel =
    view === "month"
      ? monthLabel(cursor)
      : view === "week"
        ? `${days[0]} ~ ${days[6]}`
        : `${cursor} 이후 30일`;

  const openCreate = (date?: string) => {
    setEditing(null);
    setPresetDate(date ?? today);
    setEventModalOpen(true);
  };

  const openEdit = (item: CalendarItem) => {
    setSelected(null);
    setEditing(item);
    setPresetDate(null);
    setEventModalOpen(true);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* 뷰 탭: 개인/팀/전사 */}
        <div
          role="tablist"
          className="inline-flex rounded-card border border-line bg-subtle p-1"
        >
          {(Object.keys(SCOPE_LABELS) as CalendarScope[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={scope === key}
              onClick={() => setParam({ scope: key === "personal" ? null : key })}
              className={cn(
                "rounded-sm px-3 py-1.5 text-body-sm transition-colors",
                scope === key
                  ? "bg-surface font-bold text-ink"
                  : "text-muted hover:text-ink",
              )}
            >
              {SCOPE_LABELS[key]}
            </button>
          ))}
        </div>

        {/* 월간/주간/리스트 */}
        <div className="inline-flex rounded-card border border-line bg-subtle p-1">
          {(Object.keys(VIEW_LABELS) as CalendarView[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() =>
                setParam({
                  view: key === "month" ? null : key,
                  // 뷰가 바뀌면 기준 단위도 달라지므로 커서를 오늘로 리셋
                  cursor: key === "month" ? today.slice(0, 7) : today,
                })
              }
              className={cn(
                "rounded-sm px-3 py-1.5 text-body-sm transition-colors",
                view === key
                  ? "bg-surface font-bold text-ink"
                  : "text-muted hover:text-ink",
              )}
            >
              {VIEW_LABELS[key]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <Button size="small" variant="secondary" onClick={() => shift(-1)}>
            <ChevronLeft className="size-3.5" />
            <span className="sr-only">이전</span>
          </Button>
          <Button size="small" variant="secondary" onClick={goToday}>
            오늘
          </Button>
          <Button size="small" variant="secondary" onClick={() => shift(1)}>
            <ChevronRight className="size-3.5" />
            <span className="sr-only">다음</span>
          </Button>
        </div>

        <span className="text-h2 text-ink">{headingLabel}</span>

        <div className="ml-auto flex gap-2">
          <Button size="small" onClick={() => openCreate()}>
            <Plus className="size-3.5" />
            일정 추가
          </Button>
          <Button
            size="small"
            variant="secondary"
            onClick={() => setBookingModalOpen(true)}
          >
            <CalendarClock className="size-3.5" />
            리소스 예약
          </Button>
        </div>
      </div>

      {/* 범례 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {Object.entries(EVENT_COLORS).map(([key, color]) => (
          <span key={key} className="flex items-center gap-1.5 text-label text-muted">
            <span className={cn("size-2 rounded-full", color.dot)} aria-hidden />
            {color.label}
          </span>
        ))}
        {PENDING_SOURCES.map((source) => (
          <span
            key={source.label}
            className="flex items-center gap-1.5 text-label text-muted/60"
            title={`${source.spec} 작업 때 연동 예정`}
          >
            <span className="size-2 rounded-full bg-muted/40" aria-hidden />
            {source.label}
            <span className="text-[10px]">곧 연동 예정</span>
          </span>
        ))}
      </div>

      <Card>
        <CardBody className={view === "list" ? undefined : "p-2 md:p-3"}>
          {view === "month" ? (
            <MonthGrid
              days={days}
              cursor={cursor}
              items={items}
              holidays={holidays}
              today={today}
              onPick={setSelected}
              onAdd={openCreate}
            />
          ) : view === "week" ? (
            <WeekGrid
              days={days}
              items={items}
              holidays={holidays}
              today={today}
              onPick={setSelected}
              onAdd={openCreate}
            />
          ) : (
            <ListView items={items} holidays={holidays} onPick={setSelected} />
          )}
        </CardBody>
      </Card>

      <EventModal
        open={eventModalOpen}
        onClose={() => setEventModalOpen(false)}
        editing={editing}
        presetDate={presetDate}
        canCreateTeamEvent={canCreateTeamEvent}
      />

      <BookingModal
        open={bookingModalOpen}
        onClose={() => setBookingModalOpen(false)}
        resources={resources}
      />

      <EventDetail
        item={selected}
        onClose={() => setSelected(null)}
        onEdit={openEdit}
      />
    </>
  );
}

function EventChip({
  item,
  onPick,
  showTime = true,
}: {
  item: CalendarItem;
  onPick: (item: CalendarItem) => void;
  showTime?: boolean;
}) {
  const color = EVENT_COLORS[item.kind];
  return (
    <button
      type="button"
      onClick={() => onPick(item)}
      title={item.title}
      className={cn(
        "flex w-full items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-left text-[11px] transition-opacity hover:opacity-80",
        color.chip,
      )}
    >
      {showTime && !item.allDay ? (
        <span className="shrink-0 tabular-nums opacity-80">
          {toSeoulTime(item.startAt)}
        </span>
      ) : null}
      <span className="truncate">{item.title}</span>
    </button>
  );
}

function MonthGrid({
  days,
  cursor,
  items,
  holidays,
  today,
  onPick,
  onAdd,
}: {
  days: string[];
  cursor: string;
  items: CalendarItem[];
  holidays: Record<string, Holiday>;
  today: string;
  onPick: (item: CalendarItem) => void;
  onAdd: (date: string) => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAY_LABELS.map((label, index) => (
          <div
            key={label}
            className={cn(
              "px-2 py-2 text-center text-label font-bold",
              index === 0
                ? "text-danger"
                : index === 6
                  ? "text-primary"
                  : "text-muted",
            )}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const dayItems = items.filter((item) => occursOn(item, day));
          const inMonth = day.startsWith(cursor);
          const isToday = day === today;
          const dayNumber = Number(day.slice(8, 10));
          const holiday = holidays[day];
          const weekday = index % 7;

          return (
            <div
              key={day}
              className={cn(
                "min-h-24 border-b border-r border-line p-1 last:border-r-0",
                !inMonth && "bg-canvas/60",
              )}
            >
              <div className="mb-1 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onAdd(day)}
                  title={`${day} 일정 추가`}
                  className={cn(
                    "grid size-6 place-items-center rounded-full text-label transition-colors hover:bg-primary-light",
                    isToday
                      ? "bg-primary font-bold text-white hover:bg-primary"
                      : dayToneClass(weekday, !!holiday, inMonth),
                  )}
                >
                  {dayNumber}
                </button>
                {holiday ? (
                  <span
                    className={cn(
                      "truncate text-[10px] text-danger",
                      !inMonth && "opacity-40",
                    )}
                    title={holiday.name}
                  >
                    {holiday.name}
                  </span>
                ) : null}
              </div>

              <div className="space-y-0.5">
                {dayItems.slice(0, 3).map((item) => (
                  <EventChip key={item.id} item={item} onPick={onPick} />
                ))}
                {dayItems.length > 3 ? (
                  <p className="px-1.5 text-[10px] text-muted">
                    +{dayItems.length - 3}건 더
                  </p>
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
  items,
  holidays,
  today,
  onPick,
  onAdd,
}: {
  days: string[];
  items: CalendarItem[];
  holidays: Record<string, Holiday>;
  today: string;
  onPick: (item: CalendarItem) => void;
  onAdd: (date: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
      {days.map((day, index) => {
        const dayItems = items.filter((item) => occursOn(item, day));
        const isToday = day === today;
        const holiday = holidays[day];

        return (
          <div
            key={day}
            className={cn(
              "rounded-card border border-line p-2",
              isToday && "border-primary bg-primary-light/40",
            )}
          >
            <button
              type="button"
              onClick={() => onAdd(day)}
              className="mb-2 w-full text-left"
              title={`${day} 일정 추가`}
            >
              <span className="flex items-baseline gap-1.5">
                <span
                  className={cn(
                    "text-label font-bold",
                    index === 0
                      ? "text-danger"
                      : index === 6
                        ? "text-primary"
                        : "text-muted",
                  )}
                >
                  {WEEKDAY_LABELS[index]}
                </span>
                <span
                  className={cn(
                    "text-body",
                    isToday
                      ? "font-bold text-primary"
                      : dayToneClass(index, !!holiday, true),
                  )}
                >
                  {Number(day.slice(8, 10))}
                </span>
              </span>
              {holiday ? (
                <span className="mt-0.5 block truncate text-[10px] text-danger">
                  {holiday.name}
                </span>
              ) : null}
            </button>

            <div className="space-y-1">
              {dayItems.length === 0 ? (
                <p className="py-2 text-center text-[11px] text-muted/60">-</p>
              ) : (
                dayItems.map((item) => (
                  <EventChip key={item.id} item={item} onPick={onPick} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListView({
  items,
  holidays,
  onPick,
}: {
  items: CalendarItem[];
  holidays: Record<string, Holiday>;
  onPick: (item: CalendarItem) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="표시할 일정이 없습니다"
        description="상단 '일정 추가'로 새 일정을 만들어 보세요."
      />
    );
  }

  // 날짜별로 묶어 보여준다
  const groups = new Map<string, CalendarItem[]>();
  items.forEach((item) => {
    const key = toSeoulYmd(item.startAt);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });

  return (
    <ul className="divide-y divide-line">
      {Array.from(groups.entries()).map(([date, group]: [string, CalendarItem[]]) => (
        <li key={date} className="px-4 py-3">
          <p className="mb-2 flex items-center gap-2 text-label font-bold text-muted">
            <span
              className={cn(
                weekdayOf(date) === 0
                  ? "text-danger"
                  : weekdayOf(date) === 6
                    ? "text-primary"
                    : undefined,
              )}
            >
              {date} ({WEEKDAY_LABELS[weekdayOf(date)]})
            </span>
            {holidays[date] ? (
              <span className="font-normal text-danger">
                {holidays[date].name}
              </span>
            ) : null}
          </p>
          <ul className="space-y-1.5">
            {group.map((item) => {
              const color = EVENT_COLORS[item.kind];
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onPick(item)}
                    className="flex w-full items-center gap-2 rounded-card px-2 py-1.5 text-left transition-colors hover:bg-canvas"
                  >
                    <span
                      className={cn("size-2 shrink-0 rounded-full", color.dot)}
                      aria-hidden
                    />
                    <span className="w-24 shrink-0 text-label tabular-nums text-muted">
                      {item.allDay
                        ? "종일"
                        : `${toSeoulTime(item.startAt)}–${toSeoulTime(item.endAt)}`}
                    </span>
                    <span className="truncate text-body text-ink">
                      {item.title}
                    </span>
                    {item.ownerName ? (
                      <span className="ml-auto shrink-0 text-caption">
                        {item.ownerName}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
