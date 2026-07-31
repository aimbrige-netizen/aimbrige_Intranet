import { addDaysYmd, todayYmd, weekdayOf } from "@/features/calendar/date";
import { formatDate } from "@/lib/utils";

/**
 * 게시판 목록의 조회 범위.
 * 게시판을 열면 최신순 전체가 그대로 쏟아져서 "이번 주에 뭐가 올라왔나"를
 * 잘라볼 수단이 없었다. 헤더 세그먼트가 이 값을 바꾼다.
 */
export type BoardRange = "week" | "month" | "all";

export const BOARD_RANGES: BoardRange[] = ["week", "month", "all"];

export const BOARD_RANGE_LABELS: Record<BoardRange, string> = {
  week: "이번 주",
  month: "이번 달",
  all: "전체",
};

export function parseRange(value?: string): BoardRange {
  return value === "week" || value === "month" ? value : "all";
}

/** 범위의 시작일(서울 기준 YYYY-MM-DD). "all"이면 제한 없음 */
export function rangeSince(
  range: BoardRange,
  today = todayYmd(),
): string | undefined {
  if (range === "week") return addDaysYmd(today, -weekdayOf(today));
  if (range === "month") return `${today.slice(0, 7)}-01`;
  return undefined;
}

/**
 * "3시간 전" — 헤더의 최근 갱신 표기.
 * 일주일을 넘기면 상대 표현이 오히려 읽기 어려워서 날짜로 떨어뜨린다.
 */
export function relativeTime(
  value: string | null | undefined,
  now = Date.now(),
): string {
  if (!value) return "-";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "-";

  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;

  return formatDate(value);
}

/** 0으로 나누지 않는 백분율 */
export function percent(value: number, total: number): number {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

/** 12.4 MB — 첨부 목록용 */
export function formatFileSize(bytes: number | null | undefined): string | null {
  if (!bytes || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 ? Math.round(size) : Math.round(size * 10) / 10} ${units[unit]}`;
}
