"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, CalendarClock, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, SectionHeader } from "@/components/ui/Card";
import { EmptyState, TableEmptyRow } from "@/components/ui/EmptyState";
import { MiniMeter } from "@/components/ui/Progress";
import { DataTable, Td, Th } from "@/components/ui/Table";
import { FilterChip, TableToolbar } from "@/components/ui/TableToolbar";
import { deleteResourceBooking } from "@/server/actions/calendar";
import {
  WEEKDAY_LABELS,
  addDaysYmd,
  toSeoulTime,
  weekdayOf,
} from "@/features/calendar/date";
import { calendarHref, type CalendarScope } from "@/features/calendar/view";
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

/* 날짜 내비 화살표·[오늘] — CalendarHeader와 같은 문법 (09 실측) */
const STEP_CLASS =
  "grid size-8 place-items-center rounded-sm text-muted transition-colors duration-fast ease-standard hover:bg-subtle hover:text-ink";
const TODAY_CLASS =
  "ml-1 rounded-sm border border-line-strong px-2.5 py-1 text-label text-ink transition-colors duration-fast ease-standard hover:bg-subtle";

/** 일간/주간 세그먼트 (17 "예약" 실측 — 다우 자산 예약의 기간 단위) */
const MODES: { value: "day" | "week"; label: string }[] = [
  { value: "day", label: "일간" },
  { value: "week", label: "주간" },
];

/**
 * 리소스 예약 현황 (스펙 02 · 3.6 + 17 "예약" 실측 정밀화)
 *
 * 모듈 패널의 '리소스 예약'이 가리키는 화면.
 *
 * 예전에는 리소스 × 요일 표였다. 칸 안에 "10:00 김유진"처럼 시작 시각만 적혀
 * 있어서 그 회의실이 3시에 비는지는 알 수 없었고, 결국 예약 모달에서 시간을
 * 바꿔가며 저장 버튼으로 두드려 보는 수밖에 없었다(충돌은 DB 제약이 잡는다).
 *
 * 세로축 리소스 × 가로축 시간으로 바꾼다. 찬 구간은 블록, 빈 구간은 누를 수
 * 있는 칸이고, 누르면 그 시각이 들어간 예약 창이 열린다.
 *
 * 17 "예약" 실측(다우 "자산 예약 현황")으로 상단·하단을 정렬했다:
 *  - 일간/주간 세그먼트(캘린더 필 문법) + 날짜 내비 "YYYY-MM-DD (요일) · 오늘".
 *    일간은 하루씩, 주간은 한 주씩 걷는다 — 주간에서만 날짜 칩 줄을 편다.
 *  - 하단 "내 예약 현황" 표(다우 "내 예약/대여 현황" 대응) — 이미 받은
 *    bookings를 내 것으로 거른 표시 계층 filter. 취소는 기존 삭제 액션 재사용.
 */
export function ResourceBoard({
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
  /** 일간/주간 세그먼트 — URL(?mode=)이 쥐어 내비 링크로 다시 그려도 유지된다 */
  mode: "day" | "week";
  /** 날짜 내비 기준일(=?cursor) */
  focusDay: string;
}) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<ResourceType | null>(null);
  const [preset, setPreset] = useState<BookingPreset | null>(null);
  const [open, setOpen] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [canceling, startCancel] = useTransition();

  const from = days[0];
  const to = days[days.length - 1];
  /*
   * 처음 여는 날 — 내비 기준일(focusDay)이 이 주 안이면 그 날.
   * 일간 이동이 주 경계를 넘으면 cursor가 목표일로 실려 오므로, 이전 주로
   * 갔을 때 주의 첫 날이 아니라 넘어간 바로 그 날에 내린다.
   */
  const defaultDay =
    focusDay >= from && focusDay <= to
      ? focusDay
      : today >= from && today <= to
        ? today
        : from;
  const [activeDay, setActiveDay] = useState(defaultDay);

  /*
   * 내비를 걸으면 서버가 새 cursor(focusDay)·days를 주는데 컴포넌트는 살아
   * 있다 — 기준일이 바뀔 때마다 그 날로 내려선다. 같은 주 안의 하루 이동도
   * cursor가 바뀌므로 여기서 잡힌다(범위 검사만 하면 라벨이 제자리에 남는다).
   * 칩으로 고른 날은 defaultDay가 안 변하는 한(router.refresh 등) 유지된다.
   */
  useEffect(() => {
    setActiveDay(defaultDay);
  }, [defaultDay]);

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

  /*
   * 날짜 내비 링크. calendarHref는 view=resources를 항상 쿼리에 남기므로
   * 세그먼트 값은 &로 이어도 안전하다 — 일간이 기본값이라 쿼리에서 뺀다.
   */
  const resourceHref = (cursor: string | undefined, m: "day" | "week") => {
    const base = calendarHref({ scope, view: "resources", cursor });
    return m === "week" ? `${base}&mode=week` : base;
  };
  const stepDays = mode === "day" ? 1 : 7;
  const prevHref = resourceHref(addDaysYmd(activeDay, -stepDays), mode);
  const nextHref = resourceHref(addDaysYmd(activeDay, stepDays), mode);
  const navLabel =
    mode === "day"
      ? `${activeDay} (${WEEKDAY_LABELS[weekdayOf(activeDay)]})`
      : `${from} ~ ${to}`;

  const resourceById = useMemo(
    () => new Map(resources.map((resource) => [resource.id, resource])),
    [resources],
  );

  /*
   * 하단 "내 예약 현황" — 이미 받은 bookings(표시 주간 ∪ 오늘~+60일)를 내
   * 것으로 거른 표시 계층 filter다. 새 조회 없음. 질문이 "앞으로 내가 잡아 둔
   * 것"이라 표시 주간과 무관하게 오늘 이후만 시작 시각순으로 눕힌다.
   */
  const myBookings = useMemo(
    () =>
      bookings
        .filter(
          (booking) =>
            booking.bookerId === myId && bookingYmd(booking) >= today,
        )
        .sort(
          (a, b) =>
            new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
        ),
    [bookings, myId, today],
  );

  /* 취소 = 기존 삭제 액션(deleteResourceBooking) 재사용 — EventDetail과 같은 확인 절차 */
  const cancelBooking = (booking: ResourceBookingBrief) => {
    const name = resourceById.get(booking.resourceId)?.name ?? "리소스";
    const when = `${bookingYmd(booking)} ${toSeoulTime(booking.startAt)}–${toSeoulTime(booking.endAt)}`;
    if (!window.confirm(`${name} ${when} 예약을 취소하시겠습니까?`)) return;
    setCancelingId(booking.id);
    startCancel(async () => {
      const result = await deleteResourceBooking(booking.id);
      setCancelingId(null);
      if (!result.ok) {
        window.alert(result.message ?? "예약을 취소하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <>
      {/*
        날짜 내비 + 일간/주간 세그먼트 — 17 "예약" 실측.
        캘린더 콘텐츠 헤더(CalendarHeader)와 같은 문법이지만, [오늘]이
        클라이언트 상태(activeDay)를 만지므로 링크·버튼을 섞어 여기서 그린다.
      */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Link
            href={prevHref}
            aria-label={mode === "day" ? "이전 날" : "이전 주"}
            className={STEP_CLASS}
          >
            <ChevronLeft className="size-5" aria-hidden />
          </Link>

          {/* 24/500 — CalendarHeader의 기간 라벨과 같은 단 (09 실측) */}
          <p className="px-1 text-center text-[24px] font-medium leading-[36px] tracking-[-0.48px] tabular-nums text-ink-sub">
            {navLabel}
          </p>

          <Link
            href={nextHref}
            aria-label={mode === "day" ? "다음 날" : "다음 주"}
            className={STEP_CLASS}
          >
            <ChevronRight className="size-5" aria-hidden />
          </Link>

          {activeDay === today ? (
            <button
              type="button"
              disabled
              className="ml-1 rounded-sm border border-line px-2.5 py-1 text-label text-muted"
            >
              오늘
            </button>
          ) : today >= from && today <= to ? (
            /* 오늘이 이미 이 주 안이면 서버를 다시 부를 이유가 없다 */
            <button
              type="button"
              onClick={() => setActiveDay(today)}
              className={TODAY_CLASS}
            >
              오늘
            </button>
          ) : (
            <Link href={resourceHref(undefined, mode)} className={TODAY_CLASS}>
              오늘
            </Link>
          )}
        </div>

        {/* 일간/주간 필 — CalendarHeader 세그먼트 문법 그대로(49×32 · radius 16) */}
        <div
          role="tablist"
          aria-label="기간 단위"
          className="ml-auto flex items-center"
        >
          {MODES.map((option) => {
            const selected = option.value === mode;
            return (
              <Link
                key={option.value}
                href={resourceHref(activeDay, option.value)}
                role="tab"
                aria-selected={selected}
                className={cn(
                  "grid h-8 w-[49px] place-items-center whitespace-nowrap rounded-[16px] text-label transition-colors duration-fast ease-standard",
                  selected
                    ? "bg-seg-active text-white"
                    : "text-line-dark hover:bg-subtle",
                )}
              >
                {option.label}
              </Link>
            );
          })}
        </div>
      </div>

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

      {/*
        날짜 축 — 주간 세그먼트에서만 편다. 칩의 건수가 예전 요일 표가 하던
        "어느 날이 몰렸나"를 대신한다. 일간은 위 내비가 하루씩 걷는다.
      */}
      {mode === "week" ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-label text-muted">날짜</span>
          {days.map((day, index) => {
            const holiday = holidays[day];
            const tone =
              holiday || index === 0
                ? "text-danger"
                : index === 6
                  ? "text-info-ink"
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
      ) : null}

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
                      ? "text-info-ink"
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
                  : /* 다우 원문 "이용가능한 자산이 없습니다." 대응 (17 실측) */
                    "이용 가능한 리소스가 없습니다."
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

      {/*
        하단 "내 예약 현황" 표 — 다우 "내 예약/대여 현황" 대응 (17 실측).
        섹션 제목 14/600 + 07 표 문법. 리소스 종류 필터와 무관하게 내 것 전부를
        보인다 — "내가 잡아 둔 게 뭐였지"가 질문이라 필터로 줄이면 잊는다.
      */}
      <section className="mt-6">
        <SectionHeader
          title="내 예약 현황"
          description={`오늘부터 ${bookingRange.to}까지 내 예약 ${myBookings.length}건`}
        />
        <Card className="overflow-hidden">
          <DataTable minWidth={640} fixed>
            <thead>
              <tr>
                <Th>리소스</Th>
                <Th>제목</Th>
                <Th className="w-64">시간</Th>
                {/* w-32: 진행 라벨 "취소 중…"(약 84px)이 셀 padding 32px을 빼고도 들어가는 폭 */}
                <Th className="w-32">취소</Th>
              </tr>
            </thead>
            <tbody>
              {myBookings.length === 0 ? (
                <TableEmptyRow
                  colSpan={4}
                  title="예약한 리소스가 없습니다."
                  description="타임라인의 빈 구간을 누르면 그 시간으로 바로 예약할 수 있습니다."
                />
              ) : (
                myBookings.map((booking) => {
                  const resource = resourceById.get(booking.resourceId);
                  const ymd = bookingYmd(booking);
                  return (
                    <tr key={booking.id}>
                      <Td>
                        <span className="block truncate text-ink">
                          {resource?.name ?? "-"}
                        </span>
                        {resource ? (
                          <span className="block truncate text-nano text-muted">
                            {RESOURCE_TYPE_LABELS[resource.type]}
                            {resource.location ? ` · ${resource.location}` : ""}
                          </span>
                        ) : null}
                      </Td>
                      <Td>
                        {booking.purpose ? (
                          <span className="block truncate">
                            {booking.purpose}
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </Td>
                      <Td numeric nowrap>
                        {ymd} ({WEEKDAY_LABELS[weekdayOf(ymd)]}){" "}
                        {toSeoulTime(booking.startAt)}–
                        {toSeoulTime(booking.endAt)}
                      </Td>
                      <Td>
                        {/* 행마다 반복되는 버튼이라 secondary (원칙 1) */}
                        <Button
                          size="small"
                          variant="secondary"
                          disabled={canceling}
                          onClick={() => cancelBooking(booking)}
                          aria-label={`${resource?.name ?? "리소스"} ${ymd} ${toSeoulTime(booking.startAt)}–${toSeoulTime(booking.endAt)} 예약 취소`}
                        >
                          {canceling && cancelingId === booking.id
                            ? "취소 중…"
                            : "취소"}
                        </Button>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </DataTable>
        </Card>
      </section>

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
