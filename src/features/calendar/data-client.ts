import { toSeoulTime, toSeoulYmd } from "@/features/calendar/date";
import { RESPONSE_COLORS, RESPONSE_ORDER } from "@/features/calendar/colors";
import type {
  CalendarAttendee,
  EventResponse,
  Resource,
  ResourceType,
} from "@/types/db";

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

/**
 * 참석자 선택기에 뿌리는 임직원 한 명.
 * 검색 대상(이름·직위·소속)을 미리 문자열로 만들어 두면 모달이 매 입력마다
 * 조직 트리를 다시 조립하지 않아도 된다.
 */
export interface AttendeeOption {
  id: string;
  name: string;
  position: string | null;
  /** '경영지원부 · 인사팀' */
  org: string | null;
  profileImageUrl: string | null;
}

/** 응답별 인원 + 분모 */
export type ResponseSummary = Record<EventResponse, number> & { total: number };

export function countResponses(
  attendees: CalendarAttendee[],
): ResponseSummary {
  const summary: ResponseSummary = {
    accepted: 0,
    tentative: 0,
    declined: 0,
    pending: 0,
    total: attendees.length,
  };
  attendees.forEach((attendee) => {
    summary[attendee.response] += 1;
  });
  return summary;
}

/**
 * '참석 3 · 미정 1 · 불참 0 · 미응답 2'
 *
 * 0인 칸도 지우지 않는다. "불참 0"이 사라지면 아무도 거절하지 않은 것과
 * 거절 칸이 없는 것이 같아 보인다 — 회의를 열지 말지 정하는 사람에게는
 * 그 0이 정보다.
 */
export function responseSummaryLine(summary: ResponseSummary): string {
  return RESPONSE_ORDER.map(
    (response) => `${RESPONSE_COLORS[response].label} ${summary[response]}`,
  ).join(" · ");
}

export function matchesAttendee(option: AttendeeOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [option.name, option.position ?? "", option.org ?? ""]
    .join(" ")
    .toLowerCase()
    .includes(q);
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

/*
 * 예약 운영 파라미터.
 *
 * 타임라인이 그리는 창(08:00~20:00)과 가동률의 분모(09:00~18:00 = 9시간)는
 * 서로 다른 값이다. 앞은 "언제까지 잡을 수 있나", 뒤는 "얼마나 쓰였나"의 기준이라
 * 나중에 따로 움직인다. 화면 세 곳(타임라인·예약 모달·요약 카드)이 같은 값을
 * 봐야 해서 여기에 모은다.
 */

/** 타임라인이 그리는 창. 이 밖의 예약은 양 끝으로 잘린다 */
export const TIMELINE_START_MIN = 8 * 60;
export const TIMELINE_END_MIN = 20 * 60;
/** 타임라인 빈칸 하나의 길이 */
export const TIMELINE_SLOT_MIN = 30;
/** 빈칸을 눌렀을 때 채워 넣는 기본 예약 길이 */
export const DEFAULT_BOOKING_MIN = 60;
/** 가동률 분모 — 리소스 한 대가 근무일 하루에 열려 있다고 보는 시간 */
export const OPEN_HOURS_PER_DAY = 9;
export const OPEN_HOURS_LABEL = "09:00~18:00";

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

/** 타임라인 창 안에서 그 시각이 놓이는 위치(%) */
export function timelinePct(minutes: number): number {
  const span = TIMELINE_END_MIN - TIMELINE_START_MIN;
  return Math.min(
    100,
    Math.max(0, ((minutes - TIMELINE_START_MIN) / span) * 100),
  );
}

/** 창을 슬롯 길이로 쪼갠 시작 시각들 */
export const TIMELINE_SLOTS: number[] = Array.from(
  { length: (TIMELINE_END_MIN - TIMELINE_START_MIN) / TIMELINE_SLOT_MIN },
  (_, i) => TIMELINE_START_MIN + i * TIMELINE_SLOT_MIN,
);

/**
 * 빈칸을 눌렀을 때 채울 시간 구간.
 *
 * 기본 길이로 잡되 바로 뒤 예약과 창 끝에서 자른다. 자르지 않으면 30분짜리 틈을
 * 눌렀는데 1시간이 들어가 열자마자 충돌 경고가 뜬다.
 * 이미 예약이 걸쳐 있는 자리면 null.
 */
export function slotRange(
  startMin: number,
  dayBookings: ResourceBookingBrief[],
): { startMin: number; endMin: number } | null {
  const busy = dayBookings.map((booking) => ({
    start: minutesOfIso(booking.startAt),
    end: minutesOfIso(booking.endAt),
  }));

  if (busy.some((b) => overlaps(startMin, startMin + 1, b.start, b.end))) {
    return null;
  }

  const nextStart = busy
    .map((b) => b.start)
    .filter((value) => value > startMin)
    .sort((a, b) => a - b)[0];

  const endMin = Math.min(
    startMin + DEFAULT_BOOKING_MIN,
    TIMELINE_END_MIN,
    nextStart ?? Number.POSITIVE_INFINITY,
  );

  return endMin > startMin ? { startMin, endMin } : null;
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
