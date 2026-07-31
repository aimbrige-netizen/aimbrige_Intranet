"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, CalendarClock, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { MiniMeter } from "@/components/ui/Progress";
import { FilterChip, TableToolbar } from "@/components/ui/TableToolbar";
import { WEEKDAY_LABELS, weekdayOf } from "@/features/calendar/date";
import {
  OPEN_HOURS_LABEL,
  OPEN_HOURS_PER_DAY,
  RESOURCE_TYPES,
  RESOURCE_TYPE_LABELS,
  TIMELINE_END_MIN,
  TIMELINE_SLOT_MIN,
  TIMELINE_START_MIN,
  bookingHours,
  bookingYmd,
  formatBookingHours,
  minutesOfIso,
  timeOfMinutes,
} from "@/features/calendar/data-client";
import type { ResourceBookingBrief } from "@/features/calendar/data-client";
import {
  TimelineAxis,
  TimelineTrack,
} from "@/features/calendar/ResourceTimeline";
import { BookingModal, type BookingPreset } from "@/features/calendar/BookingModal";
import type { Holiday, Resource, ResourceType } from "@/types/db";

/**
 * 리소스 예약 현황 (스펙 02 · 3.6)
 *
 * 모듈 패널의 '리소스 예약'이 가리키는 화면.
 *
 * 예전에는 리소스 × 요일 표였다. 칸 안에 "10:00 김유진"처럼 시작 시각만 적혀
 * 있어서 그 회의실이 3시에 비는지는 알 수 없었고, 결국 예약 모달에서 시간을
 * 바꿔가며 저장 버튼으로 두드려 보는 수밖에 없었다(충돌은 DB 제약이 잡는다).
 *
 * 세로축 리소스 × 가로축 시간으로 바꾼다. 찬 구간은 블록, 빈 구간은 누를 수
 * 있는 칸이고, 누르면 그 시각이 들어간 예약 창이 열린다. 요일 축은 날짜 칩으로
 * 내렸다 — 하루씩 보되 어느 날이 몰렸는지는 칩의 건수로 읽는다.
 */
export function ResourceBoard({
  resources,
  bookings,
  days,
  holidays,
  today,
  myId,
  bookingRange,
}: {
  resources: Resource[];
  bookings: ResourceBookingBrief[];
  days: string[];
  holidays: Record<string, Holiday>;
  today: string;
  myId: string;
  bookingRange: { from: string; to: string };
}) {
  const [typeFilter, setTypeFilter] = useState<ResourceType | null>(null);
  const [preset, setPreset] = useState<BookingPreset | null>(null);
  const [open, setOpen] = useState(false);

  const from = days[0];
  const to = days[days.length - 1];
  const defaultDay = today >= from && today <= to ? today : from;
  const [activeDay, setActiveDay] = useState(defaultDay);

  // 기간을 옮기면 서버가 새 days를 주는데 컴포넌트는 살아 있다 — 지난 주 날짜가
  // 그대로 남으면 아무 예약도 없는 타임라인을 보게 된다
  useEffect(() => {
    setActiveDay((current) =>
      current >= from && current <= to ? current : defaultDay,
    );
  }, [from, to, defaultDay]);

  /** 표시 주간 안의 예약만 */
  const weekBookings = useMemo(
    () =>
      bookings.filter((booking) => {
        const ymd = bookingYmd(booking);
        return ymd >= from && ymd <= to;
      }),
    [bookings, from, to],
  );

  const byResourceDay = useMemo(() => {
    const map = new Map<string, ResourceBookingBrief[]>();
    weekBookings.forEach((booking) => {
      const key = `${booking.resourceId}|${bookingYmd(booking)}`;
      map.set(key, [...(map.get(key) ?? []), booking]);
    });
    map.forEach((list) =>
      list.sort((a, b) => minutesOfIso(a.startAt) - minutesOfIso(b.startAt)),
    );
    return map;
  }, [weekBookings]);

  const countByDay = useMemo(() => {
    const map = new Map<string, number>();
    weekBookings.forEach((booking) => {
      const ymd = bookingYmd(booking);
      map.set(ymd, (map.get(ymd) ?? 0) + 1);
    });
    return map;
  }, [weekBookings]);

  const rows = typeFilter
    ? resources.filter((resource) => resource.type === typeFilter)
    : resources;

  const dayCount = countByDay.get(activeDay) ?? 0;
  const activeWeekday = weekdayOf(activeDay);
  const activeHoliday = holidays[activeDay];

  const openBooking = (next?: BookingPreset) => {
    setPreset(next ?? null);
    setOpen(true);
  };

  return (
    <>
      <TableToolbar
        filters={
          <>
            <FilterChip
              active={typeFilter === null}
              count={resources.length}
              onClick={() => setTypeFilter(null)}
            >
              전체
            </FilterChip>
            {RESOURCE_TYPES.map((type) => (
              <FilterChip
                key={type}
                active={typeFilter === type}
                count={
                  resources.filter((resource) => resource.type === type).length
                }
                onClick={() => setTypeFilter(type)}
              >
                {RESOURCE_TYPE_LABELS[type]}
              </FilterChip>
            ))}
          </>
        }
        count={`이 주 예약 ${weekBookings.length}건`}
        actions={
          <Button size="small" onClick={() => openBooking({ date: activeDay })}>
            <Plus className="size-3.5" />
            리소스 예약
          </Button>
        }
      />

      {/* 날짜 축. 칩의 건수가 예전 요일 표가 하던 "어느 날이 몰렸나"를 대신한다 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-label text-muted">날짜</span>
        {days.map((day, index) => {
          const holiday = holidays[day];
          const tone =
            holiday || index === 0
              ? "text-danger"
              : index === 6
                ? "text-info"
                : undefined;
          return (
            <FilterChip
              key={day}
              active={day === activeDay}
              count={countByDay.get(day) ?? 0}
              onClick={() => setActiveDay(day)}
            >
              <span className={cn("tabular-nums", tone)}>
                {day.slice(5)} ({WEEKDAY_LABELS[index]})
              </span>
              {day === today ? (
                <span className="text-nano text-muted">오늘</span>
              ) : null}
            </FilterChip>
          );
        })}
      </div>

      <Card>
        <CardHeader
          density="compact"
          title={
            <span className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "tabular-nums",
                  activeHoliday || activeWeekday === 0
                    ? "text-danger"
                    : activeWeekday === 6
                      ? "text-info"
                      : "text-ink",
                )}
              >
                {activeDay} ({WEEKDAY_LABELS[activeWeekday]})
              </span>
              {activeHoliday ? (
                <span className="text-label text-danger">
                  {activeHoliday.name}
                </span>
              ) : null}
              <span className="text-label font-normal text-muted tabular-nums">
                예약 {dayCount}건 / 리소스 {rows.length}종
              </span>
            </span>
          }
          description={`빈 구간을 누르면 그 시간으로 예약 창이 열립니다 · ${timeOfMinutes(TIMELINE_START_MIN)}~${timeOfMinutes(TIMELINE_END_MIN)} · ${TIMELINE_SLOT_MIN}분 단위`}
        />
        <CardBody density="compact" className="!p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title={
                typeFilter
                  ? `${RESOURCE_TYPE_LABELS[typeFilter]} 리소스가 없습니다`
                  : "예약 가능한 리소스가 없습니다"
              }
              description="회의실·차량·비품이 등록되면 이 타임라인에 한 줄씩 쌓이고, 빈 구간을 눌러 바로 예약할 수 있습니다."
              action={
                typeFilter ? (
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => setTypeFilter(null)}
                  >
                    필터 초기화
                  </Button>
                ) : undefined
              }
              compact
            />
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[880px]">
                <div className="flex items-end gap-3 border-b border-line px-4 py-2">
                  <span className="w-48 shrink-0 text-label text-muted">
                    리소스
                  </span>
                  <div className="flex-1">
                    <TimelineAxis />
                  </div>
                  <span className="w-44 shrink-0 text-label text-muted">
                    이 날 가동
                  </span>
                </div>

                {rows.map((resource) => {
                  const dayBookings =
                    byResourceDay.get(`${resource.id}|${activeDay}`) ?? [];
                  const used = dayBookings.reduce(
                    (sum, booking) => sum + bookingHours(booking),
                    0,
                  );
                  const rate = Math.round((used / OPEN_HOURS_PER_DAY) * 100);
                  const weekCount = weekBookings.filter(
                    (booking) => booking.resourceId === resource.id,
                  ).length;

                  return (
                    <div
                      key={resource.id}
                      className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-b-0"
                    >
                      <div className="w-48 shrink-0">
                        <p className="truncate text-body-sm font-bold text-ink">
                          {resource.name}
                        </p>
                        <p className="truncate text-nano text-muted">
                          {RESOURCE_TYPE_LABELS[resource.type]}
                          {resource.capacity
                            ? ` · 정원 ${resource.capacity}인`
                            : ""}
                          {resource.location ? ` · ${resource.location}` : ""}
                          {` · 이 주 ${weekCount}건`}
                        </p>
                      </div>

                      <div className="flex-1">
                        <TimelineTrack
                          blocks={dayBookings}
                          myId={myId}
                          slotLabel={`${resource.name} ${activeDay}`}
                          size="md"
                          onPickSlot={(range) =>
                            openBooking({
                              resourceId: resource.id,
                              date: activeDay,
                              startTime: timeOfMinutes(range.startMin),
                              endTime: timeOfMinutes(range.endMin),
                            })
                          }
                        />
                      </div>

                      <div className="flex w-44 shrink-0 items-center gap-2">
                        <MiniMeter
                          value={used}
                          max={OPEN_HOURS_PER_DAY}
                          tone="informative"
                          aria-label={`${resource.name} ${activeDay} 가동 ${rate}%`}
                        />
                        <span className="whitespace-nowrap text-nano tabular-nums text-muted">
                          {formatBookingHours(used)} /{OPEN_HOURS_PER_DAY}h ·{" "}
                          {rate}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <p className="mt-2.5 flex items-center gap-1.5 text-caption">
        <CalendarClock className="size-3.5 shrink-0" aria-hidden />
        가동률은 하루 {OPEN_HOURS_LABEL}({OPEN_HOURS_PER_DAY}시간)을 분모로
        계산합니다. 타임라인은 {timeOfMinutes(TIMELINE_START_MIN)}~
        {timeOfMinutes(TIMELINE_END_MIN)}까지 그리며, 그 밖의 예약은 양 끝에서
        잘려 보입니다.
      </p>

      <BookingModal
        open={open}
        onClose={() => setOpen(false)}
        resources={resources}
        bookings={bookings}
        rangeFrom={bookingRange.from}
        rangeTo={bookingRange.to}
        defaultDate={activeDay}
        preset={preset}
      />
    </>
  );
}
