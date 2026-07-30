/**
 * 캘린더 날짜 유틸.
 *
 * 서버(UTC일 수 있음)와 브라우저(로컬)가 같은 격자를 그려야 하므로
 * "며칠인지"를 판단하는 기준을 항상 Asia/Seoul로 고정한다.
 * DB에는 timestamptz(UTC)로 저장하고, 표시할 때만 서울 기준으로 환산한다.
 */

export const SEOUL_TZ = "Asia/Seoul";

const ymdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Date → 서울 기준 'yyyy-MM-dd' */
export function toSeoulYmd(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return ymdFormatter.format(date);
}

/** Date → 서울 기준 'HH:mm' */
export function toSeoulTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return timeFormatter.format(date);
}

/**
 * 서울 기준 'yyyy-MM-dd' + 'HH:mm' → UTC Date
 * 한국은 서머타임이 없어 UTC+9 고정이므로 오프셋을 그대로 붙인다.
 */
export function seoulToDate(ymd: string, time = "00:00"): Date {
  return new Date(`${ymd}T${time.length === 5 ? time : "00:00"}:00+09:00`);
}

/** 'yyyy-MM-dd' 문자열에 일수를 더한다 (타임존 영향 없이 순수 날짜 연산) */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 'yyyy-MM' 에 개월을 더한다 */
export function addMonthsYm(ym: string, months: number): string {
  const [y, m] = ym.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 오늘 (서울 기준 yyyy-MM-dd) */
export function todayYmd(): string {
  return ymdFormatter.format(new Date());
}

/** 'yyyy-MM-dd' → 요일 인덱스 (0=일) */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * 월간 격자 — 해당 월이 포함된 주 단위로 일요일 시작 6주(42칸)를 만든다.
 * 항상 42칸이라 월마다 높이가 변하지 않는다.
 */
export function monthGrid(ym: string): string[] {
  const firstDay = `${ym}-01`;
  const start = addDaysYmd(firstDay, -weekdayOf(firstDay));
  return Array.from({ length: 42 }, (_, i) => addDaysYmd(start, i));
}

/** 주간 격자 — 기준일이 속한 주의 일~토 */
export function weekGrid(ymd: string): string[] {
  const start = addDaysYmd(ymd, -weekdayOf(ymd));
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i));
}

/** 격자 범위를 실제 조회용 Date 구간으로 (끝은 배타적) */
export function rangeOf(days: string[]): { from: Date; to: Date } {
  return {
    from: seoulToDate(days[0]),
    to: seoulToDate(addDaysYmd(days[days.length - 1], 1)),
  };
}

/**
 * 일정이 특정 날짜(서울 기준)에 걸치는지.
 * 종료 시각이 자정 정각이면 그 날은 포함하지 않는다(끝 경계 배타).
 */
export function occursOn(
  item: { startAt: string; endAt: string },
  ymd: string,
): boolean {
  const dayStart = seoulToDate(ymd).getTime();
  const dayEnd = seoulToDate(addDaysYmd(ymd, 1)).getTime();
  const start = new Date(item.startAt).getTime();
  const end = new Date(item.endAt).getTime();
  return start < dayEnd && end > dayStart;
}

const MONTH_LABEL = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TZ,
  year: "numeric",
  month: "long",
});

/** '2026년 7월' */
export function monthLabel(ym: string): string {
  return MONTH_LABEL.format(seoulToDate(`${ym}-01`));
}

export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
