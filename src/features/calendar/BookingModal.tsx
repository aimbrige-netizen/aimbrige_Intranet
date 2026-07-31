"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Car, DoorOpen, Package } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field, Input } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { OptionCardGrid } from "@/components/ui/OptionCardGrid";
import { FilterChip } from "@/components/ui/TableToolbar";
import { createResourceBooking } from "@/server/actions/calendar";
import { toSeoulTime, WEEKDAY_LABELS, weekdayOf } from "@/features/calendar/date";
import {
  RESOURCE_TYPES,
  RESOURCE_TYPE_LABELS,
  bookingYmd,
  minutesOfIso,
  minutesOfTime,
  overlaps,
  resourceMeta,
  timeOfMinutes,
  type ResourceBookingBrief,
} from "@/features/calendar/data-client";
import {
  TimelineAxis,
  TimelineTrack,
} from "@/features/calendar/ResourceTimeline";
import type { Resource, ResourceType } from "@/types/db";

const TYPE_ICONS: Record<ResourceType, LucideIcon> = {
  meeting_room: DoorOpen,
  vehicle: Car,
  equipment: Package,
};

export interface BookingPreset {
  resourceId?: string;
  date?: string;
  /** 타임라인 빈칸에서 열었을 때 미리 채워 넣을 시간 */
  startTime?: string;
  endTime?: string;
}

const DEFAULT_START = "09:00";
const DEFAULT_END = "10:00";

/**
 * 리소스 예약 모달 (스펙 02 · 3.6)
 *
 * 예전에는 optgroup 드롭다운 하나였다. 정원·위치가 option 문자열 안에 접혀
 * 들어가 펼치기 전에는 아무것도 안 보였고, 이미 예약된 시간인지는 저장 버튼을
 * 누른 뒤 서버 에러("이미 예약된 시간입니다")로만 알 수 있었다.
 *
 * 순서를 뒤집었다 — 날짜·시간을 먼저 정하고, 그 시간대의 가용 상태가 카드에
 * 그려진 뒤에 리소스를 고른다.
 */
export function BookingModal({
  open,
  onClose,
  resources,
  bookings,
  rangeFrom,
  rangeTo,
  defaultDate,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  resources: Resource[];
  /** rangeFrom~rangeTo 구간의 전체 예약 (남의 예약 포함) */
  bookings: ResourceBookingBrief[];
  rangeFrom: string;
  rangeTo: string;
  defaultDate: string;
  preset?: BookingPreset | null;
}) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<ResourceType | null>(null);
  const [resourceId, setResourceId] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState(DEFAULT_START);
  const [endTime, setEndTime] = useState(DEFAULT_END);
  const [purpose, setPurpose] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setTypeFilter(null);
    setDate(preset?.date ?? defaultDate);
    setResourceId(preset?.resourceId ?? resources[0]?.id ?? "");
    setStartTime(preset?.startTime ?? DEFAULT_START);
    setEndTime(preset?.endTime ?? DEFAULT_END);
    setPurpose("");
    setErrors({});
    setMessage(null);
  }, [open, preset, defaultDate, resources]);

  const startMin = minutesOfTime(startTime);
  const endMin = minutesOfTime(endTime);
  const validRange = endMin > startMin;

  const dayBookings = useMemo(
    () => bookings.filter((booking) => bookingYmd(booking) === date),
    [bookings, date],
  );

  const visibleResources = useMemo(
    () =>
      typeFilter
        ? resources.filter((resource) => resource.type === typeFilter)
        : resources,
    [resources, typeFilter],
  );

  const conflictOf = (id: string) =>
    validRange
      ? dayBookings.find(
          (booking) =>
            booking.resourceId === id &&
            overlaps(
              startMin,
              endMin,
              minutesOfIso(booking.startAt),
              minutesOfIso(booking.endAt),
            ),
        )
      : undefined;

  const selected = resources.find((resource) => resource.id === resourceId);
  const selectedConflict = resourceId ? conflictOf(resourceId) : undefined;
  const selectedBookings = dayBookings.filter(
    (booking) => booking.resourceId === resourceId,
  );

  const submit = () => {
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await createResourceBooking({
        resourceId,
        date,
        startTime,
        endTime,
        purpose,
      });
      if (result.ok) {
        onClose();
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message ?? null);
    });
  };

  const weekday = /^\d{4}-\d{2}-\d{2}$/.test(date) ? weekdayOf(date) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="리소스 예약"
      description="회의실·차량·비품을 시간대로 예약합니다."
      size="lg"
      footer={
        resources.length > 0 ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              취소
            </Button>
            <Button
              onClick={submit}
              disabled={pending || !resourceId || !!selectedConflict}
            >
              {pending ? "예약 중…" : "예약"}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
        )
      }
    >
      {resources.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="예약 가능한 리소스가 없습니다"
          description="회의실·차량·비품이 등록되면 여기에서 시간대로 예약할 수 있습니다."
          compact
        />
      ) : (
        <div className="space-y-5">
          {/* 1단계 — 언제 */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Field
              label="날짜"
              required
              htmlFor="b-date"
              error={errors.date}
              className="col-span-2"
            >
              <Input
                id="b-date"
                type="date"
                value={date}
                min={rangeFrom}
                max={rangeTo}
                onChange={(e) => setDate(e.target.value)}
                disabled={pending}
              />
            </Field>
            <Field
              label="시작"
              required
              htmlFor="b-start"
              error={errors.startTime}
            >
              <Input
                id="b-start"
                type="time"
                step={900}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={pending}
                invalid={!!errors.startTime}
              />
            </Field>
            <Field label="종료" required htmlFor="b-end" error={errors.endTime}>
              <Input
                id="b-end"
                type="time"
                step={900}
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={pending}
                invalid={!!errors.endTime || !validRange}
              />
            </Field>
          </div>

          {!validRange ? (
            <Callout tone="warn" title="종료 시각이 시작 시각보다 앞섭니다">
              시간대를 먼저 정해야 어느 리소스가 비어 있는지 확인할 수 있습니다.
            </Callout>
          ) : null}

          {/* 2단계 — 무엇을. 고르면 어떻게 되는지가 카드에 그대로 보인다 */}
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-label font-bold text-ink">
                리소스<span className="ml-0.5 text-danger">*</span>
              </p>
              <FilterChip
                active={typeFilter === null}
                count={resources.length}
                onClick={() => setTypeFilter(null)}
              >
                전체
              </FilterChip>
              {RESOURCE_TYPES.filter((type) =>
                resources.some((resource) => resource.type === type),
              ).map((type) => (
                <FilterChip
                  key={type}
                  active={typeFilter === type}
                  count={
                    resources.filter((resource) => resource.type === type)
                      .length
                  }
                  onClick={() => setTypeFilter(type)}
                >
                  {RESOURCE_TYPE_LABELS[type]}
                </FilterChip>
              ))}
            </div>

            <OptionCardGrid
              columns={2}
              value={resourceId || null}
              onChange={setResourceId}
              className={pending ? "pointer-events-none opacity-60" : undefined}
              options={visibleResources.map((resource) => {
                const conflict = conflictOf(resource.id);
                const count = dayBookings.filter(
                  (booking) => booking.resourceId === resource.id,
                ).length;
                return {
                  value: resource.id,
                  title: resource.name,
                  description: RESOURCE_TYPE_LABELS[resource.type],
                  icon: TYPE_ICONS[resource.type],
                  meta: [...resourceMeta(resource), `이 날 예약 ${count}건`],
                  disabled: !!conflict,
                  disabledLabel: conflict
                    ? `${toSeoulTime(conflict.startAt)}–${toSeoulTime(conflict.endAt)} 예약됨`
                    : undefined,
                };
              })}
            />

            {errors.resourceId ? (
              <p className="mt-1 text-label text-danger">{errors.resourceId}</p>
            ) : null}
          </div>

          {/* 3단계 — 그 날 그 리소스가 실제로 어떻게 차 있는지 */}
          {selected ? (
            <div className="rounded-card border border-line p-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-label font-bold text-ink">
                  {selected.name} 예약 현황
                </p>
                <p className="text-nano tabular-nums text-muted">
                  {date}
                  {weekday !== null ? ` (${WEEKDAY_LABELS[weekday]})` : ""} ·
                  기존 예약 {selectedBookings.length}건
                </p>
              </div>
              <TimelineTrack
                blocks={selectedBookings}
                selection={validRange ? { startMin, endMin } : null}
                conflict={!!selectedConflict}
                slotLabel={selected.name}
                onPickSlot={(range) => {
                  setStartTime(timeOfMinutes(range.startMin));
                  setEndTime(timeOfMinutes(range.endMin));
                }}
              />
              <TimelineAxis className="mt-1" />
              <p className="mt-1.5 text-nano text-muted">
                빈 구간을 누르면 그 시간이 위 시작·종료에 들어갑니다.
              </p>
            </div>
          ) : null}

          {selectedConflict ? (
            <Callout tone="danger" title="이 시간대에는 이미 예약이 있습니다">
              {selectedConflict.bookerName ?? "다른 직원"} ·{" "}
              {toSeoulTime(selectedConflict.startAt)}–
              {toSeoulTime(selectedConflict.endAt)}
              {selectedConflict.purpose ? ` · ${selectedConflict.purpose}` : ""}
            </Callout>
          ) : null}

          <Field label="예약 목적" htmlFor="b-purpose">
            <Input
              id="b-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              disabled={pending}
              placeholder="주간 팀 회의"
            />
          </Field>

          {message ? <p className="text-label text-danger">{message}</p> : null}
        </div>
      )}
    </Modal>
  );
}
