import {
  addDaysYmd,
  addMonthsYm,
  monthLabel,
  todayYmd,
  weekdayOf,
} from "@/features/calendar/date";

/**
 * 기간 파라미터의 URL 규약.
 *
 * 같은 PeriodNavigator를 쓰는 화면들이 기간을 저마다 다른 이름으로 실어 날랐다 —
 * 근태·결재는 ?view=&cursor=, 감사 로그는 ?from=&to=, 게시판은 ?range=,
 * 홈은 ?week=, 휴일 관리는 ?year=. 스테퍼가 href 기반이라 컴포넌트는 이름을
 * 모르고, 화면마다 파싱과 링크 조립을 새로 짰다. 결과적으로 화면을 옮기면
 * 보고 있던 구간이 사라지고, 같은 버그를 다섯 군데에서 따로 고쳐야 했다.
 * q/sort/dir/page는 이미 한 이름으로 통일돼 있는데 기간만 남아 있었다.
 *
 * 규약:
 *   ?period=week|month|quarter|year|all|custom   기간 단위
 *   ?cursor=YYYY-MM-DD | YYYY-MM | YYYY          기준점 (단위에 맞는 정밀도)
 *   ?from=&to=                                   period=custom 일 때만
 *
 * ?view= 는 기간 단위가 아니라 '표시 방식'에 남겨 둔다. 캘린더가 그 이유다 —
 * 거기서 view는 월간/주간뿐 아니라 리스트·리소스 보드까지 고르는 축이고,
 * nav.ts가 /calendar?view=resources 를 직접 가리킨다. 두 축을 한 이름에
 * 겹쳐 두면 "리소스 예약"이 기간 단위가 되어 버린다.
 *
 * 파싱은 관대하게, 출력은 하나로 한다. 예전 이름(view·week·year·range)은
 * 읽기만 계속 지원해 북마크와 외부 링크가 죽지 않게 하고, 새로 만드는 주소는
 * 항상 period/cursor 로만 쓴다.
 *
 * 훅을 쓰지 않으므로 서버 컴포넌트에서 그대로 쓴다.
 */

export type PeriodUnit =
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "all"
  | "custom";

/** SegmentedControl 라벨 등에 쓰는 단위 이름 */
export const PERIOD_UNIT_LABELS: Record<PeriodUnit, string> = {
  week: "주간",
  month: "월간",
  quarter: "분기",
  year: "연간",
  all: "전체",
  custom: "직접 지정",
};

/** searchParams에서 기간을 읽을 때 쓰는 모양. 예전 이름도 함께 받는다 */
export interface PeriodSearchParams {
  period?: string;
  cursor?: string;
  from?: string;
  to?: string;
  /** 규약 이전 이름 — 읽기 전용 (근태·결재·캘린더) */
  view?: string;
  /** 규약 이전 이름 — 읽기 전용 (홈 대시보드) */
  week?: string;
  /** 규약 이전 이름 — 읽기 전용 (휴일 관리) */
  year?: string;
  /** 규약 이전 이름 — 읽기 전용 (게시판) */
  range?: string;
}

/**
 * 구간의 끝. 'all'(전체 기간)을 지원하는 화면에서만 null이 될 수 있다.
 * 이걸 늘 `string | null`로 두면 주간/월간만 쓰는 화면 네 곳이 전부
 * 쓰지도 않는 null을 캐스팅으로 털어내야 한다.
 */
type PeriodBound<U extends PeriodUnit> = "all" extends U ? string | null : string;

/**
 * 확정된 조회 구간. 화면은 이 값만 보고 그린다.
 * unit은 그 화면이 넘긴 목록으로 좁혀져 나온다 — SegmentedControl의 value가
 * 옵션 목록과 같은 타입이어야 하기 때문이다.
 */
export interface ResolvedPeriod<U extends PeriodUnit = PeriodUnit> {
  unit: U;
  /** URL에 실리는 기준점. unit이 'all'이면 빈 문자열 */
  cursor: string;
  /** 시작일 'YYYY-MM-DD'. 'all'을 쓰지 않는 화면에서는 항상 값이 있다 */
  from: PeriodBound<U>;
  /** 종료일(포함) 'YYYY-MM-DD' */
  to: PeriodBound<U>;
  /** 스테퍼 가운데 큰 글씨 — "2026년 7월", "2026-07-26 ~ 2026-08-01" */
  label: string;
  /** 그 아래 작은 글씨 — 라벨이 이름이면 실제 구간, 라벨이 구간이면 단위 이름 */
  sublabel: string;
  /** 오늘이 이 구간 안에 있는가 ([오늘] 버튼 비활성화 판정) */
  includesToday: boolean;
  /** 이전/다음 기간의 cursor. 'all'·'custom'은 이동 대상이 없어 null */
  prevCursor: string | null;
  nextCursor: string | null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-\d{2}$/;
const Y = /^\d{4}$/;

/**
 * searchParams → 확정된 구간.
 *
 * units는 그 화면이 지원하는 단위 목록(= 토글에 그리는 순서)이고,
 * defaultUnit이 URL에 아무것도 없을 때의 값이다. 둘을 나눠 두는 이유는
 * 내 근태(기본 주간)와 근태 관리(기본 월간)가 토글 순서는 같아야 하기 때문이다.
 * 목록 밖의 값이 URL로 들어와도 기본값으로 떨어뜨려 화면이 깨지지 않게 한다
 * (lib/sort의 parseSortKey와 같은 태도).
 */
export function parsePeriod<U extends PeriodUnit>(
  params: PeriodSearchParams,
  options: { units: readonly U[]; defaultUnit?: U; today?: string },
): ResolvedPeriod<U> {
  const today = options.today ?? todayYmd();
  const unit = pickUnit(
    params,
    options.units,
    options.defaultUnit ?? options.units[0],
  );

  /*
   * 아래 세 갈래는 전부 ResolvedPeriod<U>를 만든다. from/to의 널 허용 여부가
   * U에 달려 있어(PeriodBound) 제네릭 안에서는 조건부 타입이 확정되지 않으므로,
   * 조립은 평범한 값으로 하고 반환 지점에서 한 번만 맞춰 준다.
   */
  const resolve = (value: PeriodShape): ResolvedPeriod<U> =>
    value as unknown as ResolvedPeriod<U>;

  if (unit === "all") {
    return resolve({
      unit,
      cursor: "",
      from: null,
      to: null,
      label: "전체 기간",
      sublabel: "모든 기록",
      includesToday: true,
      prevCursor: null,
      nextCursor: null,
    });
  }

  if (unit === "custom") {
    const rawFrom = YMD.test(params.from ?? "") ? params.from! : null;
    const rawTo = YMD.test(params.to ?? "") ? params.to! : null;
    // 한쪽만 들어와도 구간은 확정돼야 한다 — 나머지 끝은 오늘로 닫는다
    let from = rawFrom ?? rawTo ?? today;
    let to = rawTo ?? rawFrom ?? today;
    if (from > to) [from, to] = [to, from];
    return resolve({
      unit,
      cursor: from,
      from,
      to,
      label: `${from} ~ ${to}`,
      sublabel: "직접 지정",
      includesToday: from <= today && today <= to,
      prevCursor: null,
      nextCursor: null,
    });
  }

  const cursor = coerceCursor(rawCursor(params, unit), unit, today);
  const { from, to } = rangeOfCursor(cursor, unit);

  return resolve({
    unit,
    cursor,
    from,
    to,
    label: labelOf(cursor, unit, from, to),
    sublabel: unit === "week" ? "주간" : `${from} ~ ${to}`,
    includesToday: from <= today && today <= to,
    prevCursor: stepCursor(cursor, unit, -1),
    nextCursor: stepCursor(cursor, unit, 1),
  });
}

/** 제네릭을 벗긴 조립용 모양 — parsePeriod 내부에서만 쓴다 */
interface PeriodShape {
  unit: PeriodUnit;
  cursor: string;
  from: string | null;
  to: string | null;
  label: string;
  sublabel: string;
  includesToday: boolean;
  prevCursor: string | null;
  nextCursor: string | null;
}

/**
 * 아래 헬퍼들이 실제로 읽는 부분만 추린 모양.
 * ResolvedPeriod<U>를 그대로 받으면 U가 조건부 타입(PeriodBound) 안에 있어
 * 불변(invariant)이 되고, ResolvedPeriod<'week'|'month'>를
 * ResolvedPeriod<PeriodUnit> 자리에 넘길 수 없다.
 */
export interface PeriodBounds {
  unit: PeriodUnit;
  cursor: string;
  from: string | null;
  to: string | null;
}

/** 조회 계층에 넘기는 모양 — from/to가 없는 'all'은 빈 객체가 된다 */
export function periodRangeArgs(period: PeriodBounds): {
  from?: string;
  to?: string;
} {
  return {
    from: period.from ?? undefined,
    to: period.to ?? undefined,
  };
}

/** 링크 한 개를 만들 때 넘기는 상태 */
export interface PeriodLink {
  unit: PeriodUnit;
  /** null이면 기준점을 싣지 않는다 — "오늘이 든 기간"으로 열린다 */
  cursor?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface PeriodHrefOptions {
  /** 이 단위일 때는 ?period= 를 생략해 주소를 짧게 유지한다 */
  defaultUnit?: PeriodUnit;
  /** 함께 유지할 다른 파라미터 (q·status·sort·page…). null·undefined·""는 뺀다 */
  extra?: Record<string, string | number | null | undefined>;
}

/** 기간 + 나머지 조건이 실린 주소 */
export function periodHref(
  pathname: string,
  link: PeriodLink,
  options: PeriodHrefOptions = {},
): string {
  const params = new URLSearchParams();
  writePeriod(params, link, options.defaultUnit);
  writeExtra(params, options.extra);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * 이미 만들어진 주소에 지금 보고 있는 구간을 얹는다.
 * 화면을 옮겨도 구간이 따라가게 하는 용도 (내 근태 → 근태 관리 등).
 *
 * 목적지 화면의 units에 지금 unit이 들어 있을 때만 쓴다. 없으면 파서가 조용히
 * 기본 단위로 떨어뜨려 주소와 화면이 어긋난다. 레일·모듈 패널 링크에는 쓰지
 * 않는다 — 목적지가 무엇일지 모르기 때문이다(lib/nav.ts의 href 규약 참조).
 */
export function carryPeriod(
  href: string,
  period: PeriodBounds,
  options: { defaultUnit?: PeriodUnit } = {},
): string {
  const [pathname, existing] = href.split("?");
  const params = new URLSearchParams(existing ?? "");
  // 목적지에 남아 있던 기간 파라미터는 지금 구간으로 덮어쓴다
  ["period", "cursor", "from", "to", "view", "week", "year", "range"].forEach(
    (key) => params.delete(key),
  );
  writePeriod(params, periodLinkOf(period), options.defaultUnit);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** GET 폼이 기간을 잃지 않도록 넣는 hidden 필드 목록 */
export function periodFields(
  link: PeriodLink,
  defaultUnit?: PeriodUnit,
): { name: string; value: string }[] {
  const params = new URLSearchParams();
  writePeriod(params, link, defaultUnit);
  return Array.from(params.entries()).map(([name, value]) => ({
    name,
    value,
  }));
}

/** 확정된 구간을 다시 링크 상태로 */
export function periodLinkOf(period: PeriodBounds): PeriodLink {
  return {
    unit: period.unit,
    cursor: period.cursor || null,
    from: period.from,
    to: period.to,
  };
}

/* ── 내부 ────────────────────────────────────────────────────────── */

function pickUnit<U extends PeriodUnit>(
  params: PeriodSearchParams,
  units: readonly U[],
  fallback: U,
): U {
  const allowed = (value: string | undefined): U | null =>
    value && (units as readonly string[]).includes(value)
      ? (value as U)
      : null;

  const named =
    allowed(params.period) ?? allowed(params.view) ?? allowed(params.range);
  if (named) return named;

  // 예전 이름은 값이 아니라 키 자체가 단위를 뜻했다
  const week = allowed("week");
  if (params.week !== undefined && week) return week;
  const year = allowed("year");
  if (params.year !== undefined && year) return year;
  const custom = allowed("custom");
  if ((params.from || params.to) && custom) return custom;

  return fallback;
}

/** cursor 후보 — 규약 이름이 없으면 예전 이름에서 꺼낸다 */
function rawCursor(
  params: PeriodSearchParams,
  unit: PeriodUnit,
): string | undefined {
  if (params.cursor) return params.cursor;
  if (unit === "week" && params.week) return params.week;
  if (unit === "year" && params.year) return params.year;
  return undefined;
}

/**
 * 어떤 정밀도로 들어와도 그 단위의 기준점으로 맞춘다.
 * 단위를 바꿀 때(월간 → 주간) 보던 지점을 잃지 않기 위한 것이다.
 */
function coerceCursor(
  raw: string | undefined,
  unit: PeriodUnit,
  today: string,
): string {
  const base =
    raw && (YMD.test(raw) || YM.test(raw) || Y.test(raw)) ? raw : today;

  if (unit === "year") return base.slice(0, 4);

  const ym = Y.test(base) ? `${base}-01` : base.slice(0, 7);

  if (unit === "month") return ym;

  if (unit === "quarter") {
    const year = ym.slice(0, 4);
    const month = Number(ym.slice(5, 7));
    const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
    return `${year}-${String(startMonth).padStart(2, "0")}`;
  }

  // 주간 — 기준점은 언제나 그 주의 일요일이다
  const ymd = YMD.test(base) ? base : `${ym}-01`;
  return addDaysYmd(ymd, -weekdayOf(ymd));
}

function rangeOfCursor(
  cursor: string,
  unit: PeriodUnit,
): { from: string; to: string } {
  if (unit === "week") {
    return { from: cursor, to: addDaysYmd(cursor, 6) };
  }
  if (unit === "quarter") {
    return { from: `${cursor}-01`, to: lastDayOfMonth(addMonthsYm(cursor, 2)) };
  }
  if (unit === "year") {
    return { from: `${cursor}-01-01`, to: `${cursor}-12-31` };
  }
  return { from: `${cursor}-01`, to: lastDayOfMonth(cursor) };
}

function labelOf(
  cursor: string,
  unit: PeriodUnit,
  from: string,
  to: string,
): string {
  if (unit === "month") return monthLabel(cursor);
  if (unit === "year") return `${cursor}년`;
  if (unit === "quarter") {
    const quarter = Math.floor((Number(cursor.slice(5, 7)) - 1) / 3) + 1;
    return `${cursor.slice(0, 4)}년 ${quarter}분기`;
  }
  return `${from} ~ ${to}`;
}

function stepCursor(cursor: string, unit: PeriodUnit, delta: number): string {
  if (unit === "week") return addDaysYmd(cursor, delta * 7);
  if (unit === "quarter") return addMonthsYm(cursor, delta * 3);
  if (unit === "year") return String(Number(cursor) + delta);
  return addMonthsYm(cursor, delta);
}

function lastDayOfMonth(ym: string): string {
  return addDaysYmd(`${addMonthsYm(ym, 1)}-01`, -1);
}

function writePeriod(
  params: URLSearchParams,
  link: PeriodLink,
  defaultUnit?: PeriodUnit,
): void {
  if (link.unit !== defaultUnit) params.set("period", link.unit);

  if (link.unit === "custom") {
    if (link.from) params.set("from", link.from);
    if (link.to) params.set("to", link.to);
    return;
  }
  if (link.unit === "all") return;
  if (link.cursor) params.set("cursor", link.cursor);
}

function writeExtra(
  params: URLSearchParams,
  extra?: Record<string, string | number | null | undefined>,
): void {
  if (!extra) return;
  Object.entries(extra).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    params.set(key, String(value));
  });
}
