"use client";

import { useMemo, useState } from "react";
import { Boxes, CalendarClock, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import { MiniMeter } from "@/components/ui/Progress";
import { FilterChip, TableToolbar } from "@/components/ui/TableToolbar";
import { WEEKDAY_LABELS, toSeoulTime, weekdayOf } from "@/features/calendar/date";
import {
  RESOURCE_TYPES,
  RESOURCE_TYPE_LABELS,
  bookingHours,
  bookingYmd,
  formatBookingHours,
  minutesOfIso,
  type ResourceBookingBrief,
} from "@/features/calendar/data-client";
import { BookingModal, type BookingPreset } from "@/features/calendar/BookingModal";
import type { Holiday, Resource, ResourceType } from "@/types/db";

/** 리소스 한 대가 하루에 열려 있다고 보는 시간 (09:00~18:00) */
const OPEN_HOURS_PER_DAY = 9;

/**
 * 리소스 예약 현황 (스펙 02 · 3.6)
 *
 * 모듈 패널의 '리소스 예약'이 가리키는 화면. 예전에는 이 주소가 월간 캘린더로
 * 떨어져서, 회의실이 언제 비는지 보려면 예약 모달을 열고 시간을 바꿔가며
 * 저장 버튼으로 두드려 보는 수밖에 없었다.
 *
 * 세로축 리소스 × 가로축 일주일. 빈 칸은 그 자리에서 바로 예약으로 이어진다.
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

  const rows = typeFilter
    ? resources.filter((resource) => resource.type === typeFilter)
    : resources;

  /** 근무일(주말·공휴일 제외) 기준으로 열려 있는 시간 */
  const openHours =
    days.filter((day) => {
      const weekday = weekdayOf(day);
      return weekday !== 0 && weekday !== 6 && !holidays[day];
    }).length * OPEN_HOURS_PER_DAY || OPEN_HOURS_PER_DAY;

  const openBooking = (resourceId?: string, date?: string) => {
    setPreset({ resourceId, date });
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
          <Button size="small" onClick={() => openBooking()}>
            <Plus className="size-3.5" />
            리소스 예약
          </Button>
        }
      />

      <Card>
        <CardBody density="compact" className="!p-0">
          <div className="overflow-x-auto">
            <table className="ab-table ab-table--compact min-w-[1000px]">
              <thead>
                <tr>
                  <th className="w-52">리소스</th>
                  {days.map((day, index) => {
                    const holiday = holidays[day];
                    const tone =
                      holiday || index === 0
                        ? "text-danger"
                        : index === 6
                          ? "text-info"
                          : day === today
                            ? "text-primary"
                            : "text-muted";
                    return (
                      <th key={day} className="text-center">
                        <span className={cn("tabular-nums", tone)}>
                          {day.slice(5)} ({WEEKDAY_LABELS[index]})
                        </span>
                        {holiday ? (
                          <span className="block truncate font-normal text-danger">
                            {holiday.name}
                          </span>
                        ) : null}
                      </th>
                    );
                  })}
                  <th className="w-48">주간 가동</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <TableEmptyRow
                    colSpan={days.length + 2}
                    icon={Boxes}
                    title={
                      typeFilter
                        ? `${RESOURCE_TYPE_LABELS[typeFilter]} 리소스가 없습니다`
                        : "예약 가능한 리소스가 없습니다"
                    }
                    description="회의실·차량·비품이 등록되면 이 표에 한 줄씩 쌓이고, 빈 칸을 눌러 바로 예약할 수 있습니다."
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
                  />
                ) : (
                  rows.map((resource) => {
                    const used = weekBookings
                      .filter((booking) => booking.resourceId === resource.id)
                      .reduce((sum, booking) => sum + bookingHours(booking), 0);
                    const rate = Math.round((used / openHours) * 100);

                    return (
                      <tr key={resource.id}>
                        <td className="align-top">
                          <p className="truncate text-body-sm font-bold text-ink">
                            {resource.name}
                          </p>
                          <p className="truncate text-nano text-muted">
                            {RESOURCE_TYPE_LABELS[resource.type]}
                            {resource.capacity
                              ? ` · 정원 ${resource.capacity}인`
                              : ""}
                            {resource.location ? ` · ${resource.location}` : ""}
                          </p>
                        </td>

                        {days.map((day) => {
                          const cell =
                            byResourceDay.get(`${resource.id}|${day}`) ?? [];
                          return (
                            <td key={day} className="align-top">
                              {cell.length === 0 ? (
                                <button
                                  type="button"
                                  onClick={() => openBooking(resource.id, day)}
                                  aria-label={`${resource.name} ${day} 예약`}
                                  title={`${resource.name} ${day} 예약`}
                                  className="w-full rounded-sm border border-dashed border-line-strong py-1 text-nano text-muted transition-colors duration-fast ease-standard hover:border-primary hover:text-primary"
                                >
                                  비어 있음
                                </button>
                              ) : (
                                <div className="space-y-0.5">
                                  {cell.map((booking) => (
                                    <span
                                      key={booking.id}
                                      title={`${toSeoulTime(booking.startAt)}–${toSeoulTime(booking.endAt)} ${booking.bookerName ?? ""}${booking.purpose ? ` · ${booking.purpose}` : ""}`}
                                      className={cn(
                                        "block truncate rounded-sm px-1 py-0.5 text-nano",
                                        booking.bookerId === myId
                                          ? "bg-primary-light text-primary"
                                          : "bg-subtle text-ink",
                                      )}
                                    >
                                      <span className="tabular-nums">
                                        {toSeoulTime(booking.startAt)}
                                      </span>{" "}
                                      {booking.bookerName ?? "예약"}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                          );
                        })}

                        <td>
                          <div className="flex items-center gap-2">
                            <MiniMeter
                              value={used}
                              max={openHours}
                              tone="informative"
                              aria-label={`${resource.name} 주간 가동 ${rate}%`}
                            />
                            <span className="whitespace-nowrap text-nano tabular-nums text-muted">
                              {formatBookingHours(used)} /{openHours}h · {rate}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <p className="mt-2.5 flex items-center gap-1.5 text-caption">
        <CalendarClock className="size-3.5 shrink-0" aria-hidden />
        가동률은 근무일 09:00~18:00을 분모로 계산합니다. 주말·공휴일은 제외합니다.
      </p>

      <BookingModal
        open={open}
        onClose={() => setOpen(false)}
        resources={resources}
        bookings={bookings}
        rangeFrom={bookingRange.from}
        rangeTo={bookingRange.to}
        defaultDate={today >= from && today <= to ? today : from}
        preset={preset}
      />
    </>
  );
}
