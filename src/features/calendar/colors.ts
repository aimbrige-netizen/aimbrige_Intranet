import type { CalendarItemKind } from "@/types/db";

/**
 * 이벤트 색상 구분 (스펙 02 · 3.4)
 * 전사·리소스 색상은 이 모듈에서 새로 추가된 값이다.
 */
export const EVENT_COLORS: Record<
  CalendarItemKind,
  { label: string; hex: string; chip: string; dot: string }
> = {
  personal: {
    label: "개인 일정",
    hex: "#1D4E8F",
    chip: "bg-primary-light text-primary",
    dot: "bg-primary",
  },
  team: {
    label: "팀 일정",
    hex: "#2FA36B",
    chip: "bg-success/10 text-success",
    dot: "bg-success",
  },
  company: {
    label: "전사 일정",
    hex: "#7C5CBF",
    chip: "bg-event-company/10 text-event-company-ink",
    dot: "bg-event-company",
  },
  resource_booking: {
    label: "리소스 예약",
    hex: "#D97C3C",
    chip: "bg-event-resource/10 text-event-resource-ink",
    dot: "bg-event-resource",
  },
  // 스펙 03 연동 — 승인된 연차·휴가
  leave: {
    label: "연차·휴가",
    hex: "#2FA36B",
    chip: "bg-success/10 text-success",
    dot: "bg-success",
  },
  // 스펙 04 연동 — 승인된 출장·재택근무
  approval: {
    label: "출장·재택",
    hex: "#7C5CBF",
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
