/**
 * 근태 화면 공통 포맷.
 *
 * 8.5를 "8.5h"로 찍으면 사람은 30분인지 50분인지 한 번 더 계산해야 한다.
 * 시간은 항상 "8h 30m" 형태로 쓴다.
 */

/** 8.5 → "8h 30m", 8 → "8h", 0 → "0h" */
export function formatHours(hours: number): string {
  const sign = hours < 0 ? "-" : "";
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  if (m === 60) return `${sign}${h + 1}h`;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h ${String(m).padStart(2, "0")}m`;
}

/** 소수 연차 일수 — 0.5 → "0.5", 3 → "3" */
export function formatDays(days: number): string {
  return Number.isInteger(days) ? String(days) : String(Math.round(days * 100) / 100);
}

/** 체크인·체크아웃 사이 시간(시간 단위). 둘 중 하나라도 없으면 null */
export function hoursBetween(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
): number | null {
  if (!checkIn || !checkOut) return null;
  return (
    (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 3_600_000
  );
}

/** "2026-07-27 ~ 2026-08-02" */
export function formatRange(from: string, to: string): string {
  return `${from} ~ ${to}`;
}
