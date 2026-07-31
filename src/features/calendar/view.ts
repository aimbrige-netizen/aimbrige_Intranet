import type { CalendarItem, CalendarItemKind } from "@/types/db";

/**
 * 캘린더의 "무엇을 / 어느 기간으로 본다" 축.
 *
 * 예전에는 스코프 탭 3개·뷰 탭 3개·기간 스테퍼·기간 라벨·주요 액션 2개가
 * 콘텐츠 최상단 flex-wrap 한 줄에 전부 얹혀 있었다. 폭이 좁아지면 어느 것이
 * 어디로 접힐지 예측할 수 없었고, 링크 조립 로직도 컴포넌트 안에 흩어져 있었다.
 * 이 파일은 훅을 쓰지 않으므로 서버·클라이언트 양쪽에서 그대로 쓴다.
 */

export type CalendarView = "month" | "week" | "list" | "resources";
export type CalendarScope = "personal" | "team" | "company";

export const SCOPE_LABELS: Record<CalendarScope, string> = {
  personal: "개인",
  team: "팀",
  company: "전사",
};

/** 기간 단위 토글에 노출하는 일정 뷰. 리소스 예약은 모듈 패널이 담당한다 */
export const SCHEDULE_VIEWS: CalendarView[] = ["month", "week", "list"];

export const VIEW_LABELS: Record<CalendarView, string> = {
  month: "월간",
  week: "주간",
  list: "리스트",
  resources: "리소스 예약",
};

export function parseScope(value?: string): CalendarScope {
  return value === "team" ? "team" : value === "company" ? "company" : "personal";
}

export function parseView(value?: string): CalendarView {
  return value === "week"
    ? "week"
    : value === "list"
      ? "list"
      : value === "resources"
        ? "resources"
        : "month";
}

/**
 * 캘린더의 ?view= 는 기간 단위가 아니라 '표시 방식'이다 —
 * 월간·주간뿐 아니라 리스트와 리소스 보드까지 고르고, nav.ts가
 * /calendar?view=resources 를 직접 가리킨다. 그래서 공용 규약(lib/period)이
 * 쓰는 ?period= 로 이름을 바꾸지 않고, 읽을 때만 함께 본다.
 *
 * 근태·결재에서 주간을 보다가 캘린더로 넘어오면 ?period=week&cursor= 가
 * 실려 오는데, view만 보면 그 구간이 통째로 사라진다.
 */
export function calendarViewOf(params: {
  view?: string;
  period?: string;
}): CalendarView {
  if (params.view) return parseView(params.view);
  if (params.period === "week") return "week";
  return "month";
}

const YM_PATTERN = /^\d{4}-\d{2}$/;
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const Y_PATTERN = /^\d{4}$/;

/**
 * 기준점을 이 뷰가 쓰는 정밀도로 맞춘다.
 * 월간은 'YYYY-MM', 나머지는 'YYYY-MM-DD'. 잘못된 값은 오늘로 떨어뜨린다.
 *
 * 다른 화면에서 넘어온 ?cursor= 는 정밀도가 다를 수 있다(월간 화면은 YYYY-MM).
 * 예전에는 형식이 다르면 통째로 버리고 오늘로 돌아갔다 — 3월을 보다가
 * 주간으로 옮기면 이번 주로 튀었다.
 */
export function calendarCursorOf(
  view: CalendarView,
  raw: string | undefined,
  today: string,
): string {
  const base =
    raw && (YMD_PATTERN.test(raw) || YM_PATTERN.test(raw) || Y_PATTERN.test(raw))
      ? raw
      : today;
  const ym = Y_PATTERN.test(base) ? `${base}-01` : base.slice(0, 7);

  if (view === "month") return ym;
  return YMD_PATTERN.test(base) ? base : `${ym}-01`;
}

/** /calendar 링크. 기본값(개인·월간)은 쿼리에서 빼서 주소를 짧게 유지한다 */
export function calendarHref({
  scope,
  view,
  cursor,
}: {
  scope: CalendarScope;
  view: CalendarView;
  cursor?: string | null;
}): string {
  const params = new URLSearchParams();
  if (scope !== "personal") params.set("scope", scope);
  if (view !== "month") params.set("view", view);
  if (cursor) params.set("cursor", cursor);
  const search = params.toString();
  return search ? `/calendar?${search}` : "/calendar";
}

/**
 * 스코프별로 실제 나타날 수 있는 항목 종류.
 * 개인 뷰에 "팀 일정 0"을 그리면 데이터가 없는 것처럼 보이므로,
 * 그 스코프에서 조회되지 않는 종류는 필터 칩에도 두지 않는다.
 */
export function kindsForScope(scope: CalendarScope): CalendarItemKind[] {
  const own: CalendarItemKind =
    scope === "team" ? "team" : scope === "company" ? "company" : "personal";
  // '참석 일정'은 공개범위와 무관하게 나올 수 있다 — 남이 만든 팀 회의에
  // 내가 참석자로 들어가면 팀 뷰에서도 이 종류로 나타난다.
  return [own, "invited", "leave", "approval", "resource_booking"];
}

export type KindCounts = Record<CalendarItemKind, number>;

export function countByKind(items: CalendarItem[]): KindCounts {
  const counts: KindCounts = {
    personal: 0,
    team: 0,
    company: 0,
    invited: 0,
    leave: 0,
    approval: 0,
    resource_booking: 0,
  };
  items.forEach((item) => {
    counts[item.kind] += 1;
  });
  return counts;
}
