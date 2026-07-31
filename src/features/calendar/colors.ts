import type { MeterTone } from "@/components/ui/Progress";
import type { CalendarItemKind, EventResponse } from "@/types/db";

/**
 * 이벤트 색상 구분 (스펙 02 · 3.4)
 *
 * hex는 Tailwind가 아니라 외부(ICS export·프린트)로 나가는 값이라 리터럴로 둔다.
 *
 * 예전 매핑은 팀 일정과 연차·휴가가 같은 초록, 전사 일정과 출장·재택이 같은
 * 파랑이었다. 범례에는 6줄이 있는데 화면에서 구분되는 색은 4가지뿐이라
 * "초록 칩"이 팀 회의인지 동료 휴가인지 알 수 없었다. 6종을 전부 다른
 * 색상축에 배정한다 — 오렌지는 개인 일정 하나에만 남긴다.
 *
 * 면은 알파(/10)가 아니라 solid 틴트를 쓴다. 알파는 얹히는 면(흰 카드 / 선택된
 * 셀 / 회색 바닥)마다 합성 결과가 달라져 같은 종류가 다른 색으로 보인다.
 */
export interface EventColor {
  label: string;
  hex: string;
  /** 칩 배경 + 글자 */
  chip: string;
  /** 범례·표에서 쓰는 점 */
  dot: string;
}

export const EVENT_COLORS: Record<CalendarItemKind, EventColor> = {
  personal: {
    label: "개인 일정",
    hex: "#ff6f0f", // primary
    chip: "bg-primary-light text-primary",
    dot: "bg-primary",
  },
  /*
   * 남이 만든 일정에 참석자로 지정된 것.
   * 색상축을 하나 더 만들면 6종이 이미 다 쓴 hue와 부딪힌다. 대신 같은
   * 오렌지축에서 면(내가 만든 것) ↔ 테두리(초대받은 것)로 나눈다 —
   * "내 일정과 같은 무게로 봐야 하지만 내가 고칠 수는 없다"가 그대로 읽힌다.
   */
  invited: {
    label: "참석 일정",
    hex: "#ff6f0f", // primary
    chip: "border border-primary bg-surface text-primary",
    dot: "border border-primary bg-surface",
  },
  team: {
    label: "팀 일정",
    hex: "#1aa174", // success
    chip: "bg-success-light text-success-ink",
    dot: "bg-success",
  },
  company: {
    label: "전사 일정",
    hex: "#009ceb", // info
    chip: "bg-info-light text-info-ink",
    dot: "bg-info",
  },
  // 스펙 03 연동 — 승인된 연차·휴가. "그날 자리에 없다"는 조율 신호라 앰버.
  leave: {
    label: "연차·휴가",
    hex: "#f59f0a", // warn
    chip: "bg-warn-light text-warn-ink",
    dot: "bg-warn",
  },
  // 스펙 04 연동 — 승인된 출장·재택근무. 근무는 하되 장소가 다르다.
  approval: {
    label: "출장·재택",
    hex: "#212124", // ink
    chip: "bg-subtle text-ink",
    dot: "bg-ink",
  },
  resource_booking: {
    label: "리소스 예약",
    hex: "#868b94", // muted
    chip: "bg-subtle text-event-resource-ink",
    dot: "bg-event-resource",
  },
};

/**
 * 참석 응답 색.
 *
 * 종류(EVENT_COLORS)와 축이 다르다 — 종류는 "이게 무슨 일정인가", 응답은
 * "그 자리에 사람이 오는가"다. 그래서 같은 오렌지·초록을 재사용하지 않고
 * 상태 3색(success/warn/danger)에 중립 하나를 붙인 별도 축으로 둔다.
 *
 * 불참에 danger를 쓰는 건 "위반"이어서가 아니라 확정된 부정 응답이기 때문이다.
 * 아직 답하지 않은 상태(pending)는 대기이므로 중립으로 남긴다 — 사람을 재촉하는
 * 빨강은 명단을 읽는 사람에게 잘못된 긴급도를 준다.
 */
export interface ResponseColor {
  label: string;
  /** 이름 옆 작은 배지 */
  badge: string;
  /** 목록·요약에서 쓰는 점 */
  dot: string;
  /** 응답 분포 막대 조각 */
  tone: MeterTone;
}

export const RESPONSE_COLORS: Record<EventResponse, ResponseColor> = {
  accepted: {
    label: "참석",
    badge: "bg-success-light text-success-ink",
    dot: "bg-success",
    tone: "positive",
  },
  tentative: {
    label: "미정",
    badge: "bg-warn-light text-warn-ink",
    dot: "bg-warn",
    tone: "warning",
  },
  declined: {
    label: "불참",
    badge: "bg-danger-light text-danger-ink",
    dot: "bg-danger",
    tone: "critical",
  },
  pending: {
    label: "미응답",
    badge: "bg-subtle text-muted",
    dot: "bg-line-strong",
    tone: "neutral",
  },
};

/**
 * 요약에 쓰는 표시 순서 — 참석 → 미정 → 불참 → 미응답.
 * "확정된 참석"에서 "아직 모른다"로 내려가는 순서라 한 줄로 읽힌다.
 */
export const RESPONSE_ORDER: EventResponse[] = [
  "accepted",
  "tentative",
  "declined",
  "pending",
];
