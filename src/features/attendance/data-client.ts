import type { AttendanceRecord } from "@/types/db";

/**
 * 서버·클라이언트가 함께 쓰는 타입과 가드.
 * data.ts는 "server-only"라 클라이언트 컴포넌트에서 import할 수 없어 분리했다.
 */

/** 근무일인데 출퇴근 기록이 없는 날 (결근) */
export interface AbsentDay {
  absent: true;
  work_date: string;
}

export type AttendanceRow = AttendanceRecord | AbsentDay;

export function isAbsentDay(row: AttendanceRow): row is AbsentDay {
  return (row as AbsentDay).absent === true;
}
