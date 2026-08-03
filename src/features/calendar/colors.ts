import { Check, Flag, type LucideIcon } from "lucide-react";
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
 * 색상축에 배정한다 — 브랜드 시안은 개인 일정 하나에만 남긴다.
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
    hex: "#08a7bf", // primary
    chip: "bg-primary-light text-primary",
    dot: "bg-primary",
  },
  /*
   * 남이 만든 일정에 참석자로 지정된 것.
   * 색상축을 하나 더 만들면 6종이 이미 다 쓴 hue와 부딪힌다. 대신 같은 시안
   * 축에서 면(내가 만든 것) ↔ 테두리(초대받은 것)로 나눈다 —
   * "내 일정과 같은 무게로 봐야 하지만 내가 고칠 수는 없다"가 그대로 읽힌다.
   */
  invited: {
    label: "참석 일정",
    hex: "#08a7bf", // primary
    chip: "border border-primary bg-surface text-primary",
    dot: "border border-primary bg-surface",
  },
  team: {
    label: "팀 일정",
    hex: "#00af52", // success (green-52)
    chip: "bg-success-light text-success-ink",
    dot: "bg-success",
  },
  company: {
    label: "전사 일정",
    hex: "#0d99ff", // info (blue-52)
    chip: "bg-info-light text-info-ink",
    dot: "bg-info",
  },
  // 스펙 03 연동 — 승인된 연차·휴가. "그날 자리에 없다"는 조율 신호라 앰버.
  leave: {
    label: "연차·휴가",
    hex: "#f0bc00", // warn (yellow-40)
    chip: "bg-warn-light text-warn-ink",
    dot: "bg-warn",
  },
  // 스펙 04 연동 — 승인된 출장·재택근무. 근무는 하되 장소가 다르다.
  approval: {
    label: "출장·재택",
    hex: "#1c1c1c", // ink
    chip: "bg-subtle text-ink",
    dot: "bg-ink",
  },
  /*
   * 스펙 10 연동 — 프로젝트 마일스톤의 목표일.
   *
   * 새 hue를 만들지 않는다. 위 6종이 시안·초록·파랑·앰버·먹·회색을 이미
   * 다 쓰고 있어서 7번째 색상축은 남아 있지 않고, 억지로 하나 더 만들면
   * 범례가 다시 "구분되지 않는 색 목록"이 된다.
   *
   * 마일스톤은 "아직 달성하지 못한 목표점"이다. 디자인 규칙상 진행중·미완료는
   * informative(파랑)이나 중립이므로 파랑 축에 얹되, 전사 일정이 파랑 '면'을
   * 쓰고 있으므로 마일스톤은 같은 축의 '테두리'를 쓴다 —
   * personal(면) ↔ invited(테두리)가 시안 축을 나눈 방법 그대로다.
   * 테두리는 "아직 채워지지 않았다"는 뜻까지 같이 준다.
   *
   * 달성/미달성은 색이 아니라 형태로 가른다(MILESTONE_MARK). 색을 하나 더
   * 쓰면 종류 축과 상태 축이 섞이고, 취소선은 이미 '내가 불참으로 답한 일정'이
   * 가져갔다.
   */
  milestone: {
    label: "마일스톤",
    hex: "#0d99ff", // info (blue-52)
    chip: "border border-info bg-surface text-info-ink",
    dot: "border border-info bg-surface",
  },
  resource_booking: {
    label: "리소스 예약",
    hex: "#969799", // muted (gray-52)
    chip: "bg-subtle text-event-resource-ink",
    dot: "bg-event-resource",
  },
};

/**
 * 마일스톤의 달성 여부 — 색이 아니라 형태로 가른다.
 *
 * 미달성은 깃발(세워둔 목표점), 달성은 체크다. 달성한 목표는 더 챙길 대상이
 * 아니므로 무게를 한 단계 내린다(opacity). 취소선을 쓰지 않는 이유는 그 형태가
 * 이미 '내가 불참으로 답한 일정'을 뜻하고 있어서, 같은 격자 위에서 한 표시가
 * 두 가지를 말하게 되기 때문이다.
 *
 * badge는 종류 축(EVENT_COLORS)이 아니라 상태 축이다 — 참석 응답 배지
 * (RESPONSE_COLORS)와 같은 자리에 같은 문법으로 붙는다.
 */
export interface MilestoneMark {
  icon: LucideIcon;
  label: string;
  /** 칩·행 전체에 얹는 무게 조절 */
  className: string;
  /** 제목 옆 작은 상태 배지 */
  badge: string;
}

export const MILESTONE_MARKS: Record<"open" | "done", MilestoneMark> = {
  open: {
    icon: Flag,
    label: "진행 중",
    className: "",
    badge: "bg-info-light text-info-ink",
  },
  done: {
    icon: Check,
    label: "달성",
    className: "opacity-60",
    badge: "bg-success-light text-success-ink",
  },
};

export function milestoneMark(completed: boolean | undefined): MilestoneMark {
  return completed ? MILESTONE_MARKS.done : MILESTONE_MARKS.open;
}

/**
 * 참석 응답 색.
 *
 * 종류(EVENT_COLORS)와 축이 다르다 — 종류는 "이게 무슨 일정인가", 응답은
 * "그 자리에 사람이 오는가"다. 그래서 같은 시안·초록을 재사용하지 않고
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
