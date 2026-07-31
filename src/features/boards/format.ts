import { formatDate } from "@/lib/utils";
import type { PeriodUnit } from "@/lib/period";

/**
 * 게시판 목록의 조회 범위.
 * 게시판을 열면 최신순 전체가 그대로 쏟아져서 "이번 주에 뭐가 올라왔나"를
 * 잘라볼 수단이 없었다. 헤더 세그먼트가 이 값을 바꾼다.
 *
 * URL 이름은 공용 규약(lib/period)의 ?period= 를 쓴다. 예전 이름 ?range= 는
 * parsePeriod가 읽기 전용으로 계속 받아 북마크가 죽지 않는다.
 * 게시판은 "최근 N" 롤링 윈도우라 ?cursor= 를 싣지 않는다 — 그래서 칩 라벨이
 * "이번 주"·"이번 달"로 남고 언제나 참이다(단위 이름 "주간"과 뜻이 다르다).
 */
export type BoardRange = Extract<PeriodUnit, "week" | "month" | "all">;

export const BOARD_RANGES = [
  "week",
  "month",
  "all",
] as const satisfies readonly BoardRange[];

/** URL에 period가 없을 때의 값 */
export const BOARD_DEFAULT_RANGE: BoardRange = "all";

export const BOARD_RANGE_LABELS: Record<BoardRange, string> = {
  week: "이번 주",
  month: "이번 달",
  all: "전체",
};

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

/**
 * 본문 한 조각 — 그냥 글자이거나, 눌러서 열 수 있는 주소이거나.
 * 에디터는 평문 textarea라 본문에 URL이 있어도 글자로만 남는다.
 * 리치텍스트를 들이는 대신 렌더 시점에 주소만 끊어낸다.
 */
export type TextSegment =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string; href: string };

/** 문장 끝에 붙어 온 문장부호는 주소가 아니다 */
function trimTrailingPunctuation(raw: string): string {
  let url = raw;
  while (url.length > 1) {
    const last = url[url.length - 1];
    if (".,;:!?\"'".includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    // 괄호는 주소 안에 들어 있을 수 있다 — 짝이 맞지 않을 때만 떼어낸다
    if (last === ")" || last === "]") {
      const open = last === ")" ? "(" : "[";
      const opens = url.split(open).length - 1;
      const closes = url.split(last).length - 1;
      if (closes > opens) {
        url = url.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return url;
}

/**
 * 본문을 글자와 링크로 쪼갠다. 줄바꿈은 건드리지 않는다
 * (렌더 쪽에서 whitespace-pre-wrap이 그대로 유지한다).
 * http/https와 www.만 링크로 본다 — javascript: 같은 스킴은 통과시키지 않는다.
 */
export function splitLinks(text: string): TextSegment[] {
  const pattern = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const url = trimTrailingPunctuation(match[0]);
    const start = match.index;

    if (start > cursor) {
      segments.push({ kind: "text", value: text.slice(cursor, start) });
    }
    segments.push({
      kind: "link",
      value: url,
      href: /^https?:\/\//i.test(url) ? url : `https://${url}`,
    });

    cursor = start + url.length;
    pattern.lastIndex = cursor;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", value: text.slice(cursor) });
  }
  return segments;
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
