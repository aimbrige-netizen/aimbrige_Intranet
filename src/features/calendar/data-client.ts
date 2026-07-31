import { toSeoulTime, toSeoulYmd } from "@/features/calendar/date";
import type { Resource, ResourceType } from "@/types/db";

/**
 * 리소스 예약을 클라이언트에서 다루기 위한 최소 표현 + 시간 계산.
 *
 * data.ts는 "server-only"라 클라이언트 컴포넌트가 타입조차 가져갈 수 없다.
 * 예약 가용성은 모달·타임라인 양쪽에서 같은 규칙으로 계산해야 하므로
 * 순수 함수만 여기에 모은다. (근태 모듈의 data-client.ts와 같은 역할)
 */
export interface ResourceBookingBrief {
  id: string;
  resourceId: string;
  startAt: string;
  endAt: string;
  purpose: string | null;
  bookerId: string;
  bookerName: string | null;
}

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  meeting_room: "회의실",
  vehicle: "차량",
  equipment: "비품",
};

export const RESOURCE_TYPES: ResourceType[] = [
  "meeting_room",
  "vehicle",
  "equipment",
];

/** 예약 타임라인이 그리는 창. 08:00~20:00 밖의 예약은 양 끝으로 잘린다 */
export const TIMELINE_START_MIN = 8 * 60;
export const TIMELINE_END_MIN = 20 * 60;

/** ISO → 서울 기준 자정으로부터의 분 */
export function minutesOfIso(iso: string): number {
  const [h, m] = toSeoulTime(iso).split(":").map(Number);
  return h * 60 + m;
}

/** "HH:MM" → 분 */
export function minutesOfTime(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 분 → "HH:MM" */
export function timeOfMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function bookingYmd(booking: ResourceBookingBrief): string {
  return toSeoulYmd(booking.startAt);
}

/** 두 구간이 겹치는가 (끝 경계는 배타 — 10:00 종료와 10:00 시작은 겹치지 않는다) */
export function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function bookingHours(booking: ResourceBookingBrief): number {
  const ms =
    new Date(booking.endAt).getTime() - new Date(booking.startAt).getTime();
  return ms > 0 ? ms / 3_600_000 : 0;
}

/** 소수점 한 자리까지만. "12.5h" / "3h" */
export function formatBookingHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`;
}

export function resourceMeta(resource: Resource): string[] {
  return [
    resource.capacity ? `정원 ${resource.capacity}인` : "정원 제한 없음",
    resource.location ?? "위치 미지정",
  ];
}
