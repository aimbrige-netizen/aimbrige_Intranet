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
    chip: "bg-success/12 text-success",
    dot: "bg-success",
  },
  company: {
    label: "전사 일정",
    hex: "#7C5CBF",
    chip: "bg-[#7C5CBF]/12 text-[#5F44A0]",
    dot: "bg-[#7C5CBF]",
  },
  resource_booking: {
    label: "리소스 예약",
    hex: "#D97C3C",
    chip: "bg-[#D97C3C]/12 text-[#B25F26]",
    dot: "bg-[#D97C3C]",
  },
};

/**
 * 아직 연동되지 않은 항목들 — 자리만 확보하고 회색으로 표시한다.
 * 각 모듈 스펙 작업 때 실제 데이터로 채운다.
 */
export const PENDING_SOURCES = [
  { label: "연차·반차", spec: "스펙 03 출퇴근관리" },
  { label: "결재 마감일", spec: "스펙 04 전자결재" },
  { label: "프로젝트 마일스톤", spec: "스펙 10 프로젝트 관리" },
];
