import type { CalendarItemKind } from "@/types/db";

/**
 * 이벤트 색상 구분 (스펙 02 · 3.4)
 *
 * hex는 Tailwind가 아니라 외부(ICS export·프린트)로 나가는 값이라 리터럴로 둔다.
 * 디자인시스템 v2.0(SEED) 토큰과 같은 값을 쓰되, 액센트인 오렌지는
 * "개인 일정"에만 배정한다 — 한 화면에서 오렌지가 여러 의미를 갖지 않도록.
 */
export const EVENT_COLORS: Record<
  CalendarItemKind,
  { label: string; hex: string; chip: string; dot: string }
> = {
  personal: {
    label: "개인 일정",
    hex: "#ff6f0f", // primary
    chip: "bg-primary-light text-primary",
    dot: "bg-primary",
  },
  team: {
    label: "팀 일정",
    hex: "#1aa174", // success
    chip: "bg-success/10 text-success",
    dot: "bg-success",
  },
  company: {
    label: "전사 일정",
    hex: "#009ceb", // event.company = info
    chip: "bg-event-company/10 text-event-company-ink",
    dot: "bg-event-company",
  },
  resource_booking: {
    label: "리소스 예약",
    hex: "#868b94", // event.resource = muted
    chip: "bg-event-resource/10 text-event-resource-ink",
    dot: "bg-event-resource",
  },
  // 스펙 03 연동 — 승인된 연차·휴가
  leave: {
    label: "연차·휴가",
    hex: "#1aa174",
    chip: "bg-success/10 text-success",
    dot: "bg-success",
  },
  // 스펙 04 연동 — 승인된 출장·재택근무
  approval: {
    label: "출장·재택",
    hex: "#009ceb",
    chip: "bg-event-company/10 text-event-company-ink",
    dot: "bg-event-company",
  },
};

/**
 * 아직 연동되지 않은 항목들 — 자리만 확보하고 회색으로 표시한다.
 * (연차·반차는 스펙 03, 출장·재택은 스펙 04에서 연동 완료)
 */
export const PENDING_SOURCES = [
  { label: "프로젝트 마일스톤", spec: "스펙 10 프로젝트 관리" },
];
