import type {
  AttendanceStatus,
  LeaveCategory,
  LeaveType,
  RequestStatus,
  WorkStatus,
} from "@/types/db";

/** 고정 근무시간 — 스펙 7장대로 09:00~18:00 하드코딩 */
export const WORK_START = "09:00";
export const WORK_END = "18:00";
/** 지각 판정 유예 (09:10 이후 체크인 = 지각) */
export const LATE_THRESHOLD = "09:10";
/** 1일 소정근로시간 — 보상휴가 환산·시간단위 연차 기준 */
export const DAILY_WORK_HOURS = 8;

/** 주 52시간 = 법정 40 + 연장 12. 48시간부터 경고 (스펙 3.2) */
export const WEEKLY_WARN_HOURS = 48;
export const WEEKLY_LIMIT_HOURS = 52;

export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  normal_office: "정상출근",
  field_work: "외근",
  remote: "재택",
  training: "교육",
};

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  normal: "정상",
  late: "지각",
  early_leave: "조퇴",
  absent: "결근",
};

export const ATTENDANCE_STATUS_TONES: Record<
  AttendanceStatus,
  "success" | "warn" | "danger" | "neutral"
> = {
  normal: "success",
  late: "warn",
  early_leave: "warn",
  absent: "danger",
};

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  full_day: "연차(종일)",
  half_day_am: "반차(오전)",
  half_day_pm: "반차(오후)",
  hourly: "시간단위",
};

/**
 * 휴가 종류. annual만 연차 잔여에서 차감된다 (스펙 4장).
 * 각 법정휴가의 정확한 부여일수·조건은 노무사 확인 후 반영 예정.
 */
export const LEAVE_CATEGORY_LABELS: Record<LeaveCategory, string> = {
  annual: "연차",
  industrial_accident: "공상휴가",
  family_care: "가족돌봄휴가",
  maternity: "출산휴가",
  menstrual: "생리휴가",
  congratulation_condolence: "경조휴가",
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "반려",
  cancelled: "취소",
};

export const REQUEST_STATUS_TONES: Record<
  RequestStatus,
  "warn" | "success" | "danger" | "neutral"
> = {
  pending: "warn",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

/** 반차는 0.5일, 시간단위는 시간/8일 (스펙 3.3) */
export function daysForLeaveType(
  leaveType: LeaveType,
  hours: number | null,
): number | null {
  if (leaveType === "half_day_am" || leaveType === "half_day_pm") return 0.5;
  if (leaveType === "hourly") {
    if (!hours || hours <= 0) return null;
    return Math.round((hours / DAILY_WORK_HOURS) * 100) / 100;
  }
  return null; // full_day는 날짜 범위로 계산
}
