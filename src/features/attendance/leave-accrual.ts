/**
 * 연차 발생 계산 (근로기준법 제60조 기준)
 *
 * 스펙 03 · 5장. 외부 의존 없는 순수 함수로 분리해 두었다.
 * 노무사 확인 후 로직을 조정할 때 이 파일만 고치면 되도록 한 곳에 모았다.
 *
 * ── 설계상 스펙과 다르게 간 부분 (의도적) ────────────────────────────
 * 스펙 5장은 "매일 자정 스케줄 작업으로 accrued_days에 +1씩 누적"을 제시했지만,
 * 누적 증가 방식은 스케줄이 하루 밀리면 그날 발생분이 영구히 누락되고, 두 번 돌면
 * 이중 가산된다. 그래서 **입사일과 기준일만으로 총 발생일수를 결정적으로 계산**하고
 * 그 값을 그대로 덮어쓰는 방식으로 바꿨다.
 *   - 스케줄이 며칠 밀려도 다음 실행에서 정확한 값으로 자동 복구된다(self-healing)
 *   - 같은 날 여러 번 실행해도 결과가 같다(idempotent)
 *   - 스케줄 없이 화면 진입 시 재계산해도 되므로 cron 장애가 데이터를 망치지 않는다
 *
 * ── ⚠️ 미사용 연차 소멸을 반영하지 않았다 (정책 결정 필요) ───────────
 * 스펙 4장의 `leave_balances`는 (발생 누적 - 사용 누적 + 조정) 한 줄 모델이라,
 * 여기서도 발생분을 평생 누적한다. 실무에서는 연차가 발생 후 1년 내 미사용 시
 * 소멸하거나 수당으로 정산되므로, 근속이 길어지면 잔여일수가 실제보다 부풀려진다.
 *   예) 3년 근속자 → 이 계산으로는 누적 57일
 * 소멸·이월·수당정산 중 무엇을 적용할지는 회사 정책 + 노무사 판단이 필요해
 * 지금은 스펙대로 누적 모델을 쓰고, 아래 accrualForLeaveYear()로 연도별 발생분을
 * 따로 뽑을 수 있게 해 두었다. 정책이 정해지면 이 함수를 기준으로 전환하면 된다.
 *
 * ── 반영하지 않은 예외 (노무사 확인 필요) ────────────────────────────
 * - 출근율 80% 미만인 해의 연차 미발생
 * - 육아휴직·병휴직 등 특수 휴직 기간의 근속 산정
 * - 1년 미만 구간의 "월 개근" 요건 (지금은 개근했다고 가정)
 * - 회계연도 기준 전환 (지금은 입사일 기준)
 */

/** 1년 미만 구간에서 월 단위로 받을 수 있는 최대 일수 */
export const MAX_FIRST_YEAR_DAYS = 11;
/** 근속 가산 상한 */
export const MAX_ANNUAL_DAYS = 25;
/** 1년 이상 기본 발생일수 */
export const BASE_ANNUAL_DAYS = 15;

/**
 * 근속 N년차에 발생하는 연차 일수.
 *   1년 → 15, 2년 → 15, 3년 → 16, 5년 → 17 … 21년 이상 → 25(상한)
 * 근로기준법: 3년 이상 계속 근로 시 2년마다 1일 가산, 총 25일 한도.
 */
export function annualDaysForYear(yearsOfService: number): number {
  if (yearsOfService < 1) return 0;
  const added = Math.floor((yearsOfService - 1) / 2);
  return Math.min(BASE_ANNUAL_DAYS + added, MAX_ANNUAL_DAYS);
}

/** 'yyyy-MM-dd' → {y, m, d} (문자열 연산만 사용해 타임존 영향을 받지 않는다) */
function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

/** 해당 연·월의 마지막 날 */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * 입사일로부터 기준일까지 지난 "만 개월" 수.
 * 말일 입사 보정: 1/31 입사자의 2월 기념일은 2/28(29)로 본다.
 */
export function monthsOfService(hireDate: string, asOf: string): number {
  const h = parseYmd(hireDate);
  const a = parseYmd(asOf);

  let months = (a.y - h.y) * 12 + (a.m - h.m);
  // 이번 달 기념일이 아직 오지 않았으면 한 달 덜 지난 것
  const anniversaryDay = Math.min(h.d, lastDayOfMonth(a.y, a.m));
  if (a.d < anniversaryDay) months -= 1;

  return Math.max(0, months);
}

/** 입사일로부터 기준일까지의 만 근속연수 */
export function yearsOfService(hireDate: string, asOf: string): number {
  return Math.floor(monthsOfService(hireDate, asOf) / 12);
}

/**
 * 기준일까지 누적 발생한 총 연차 일수.
 *
 * 구성:
 *   1) 입사 1년 미만 구간 — 매월 개근 시 1일 (최대 11일)
 *   2) 입사 1주년 이후 — 매 근속 기념일에 annualDaysForYear(N)일을 한 번에 발생
 *
 * 1년 미만 구간에서 받은 11일은 회수하지 않는다(근로기준법 개정 취지에 따라
 * 1년차에 받은 월 단위 연차와 2년차 15일은 별도로 본다).
 */
export function computeAccruedDays(
  hireDate: string | null | undefined,
  asOf: string,
): number {
  if (!hireDate) return 0;
  if (hireDate > asOf) return 0; // 입사 전

  const months = monthsOfService(hireDate, asOf);
  const years = Math.floor(months / 12);

  // 1) 1년 미만 월 단위 발생 (최대 11일)
  const firstYearDays = Math.min(months, MAX_FIRST_YEAR_DAYS);

  // 2) 근속 1년, 2년, … 마다 발생한 연차의 합
  let anniversaryDays = 0;
  for (let year = 1; year <= years; year += 1) {
    anniversaryDays += annualDaysForYear(year);
  }

  return firstYearDays + anniversaryDays;
}

/**
 * 현재 연차연도의 시작·종료일 (입사기념일 ~ 다음 기념일 전날).
 *
 * 화면이 "이번 연차연도" 기준으로 잔여를 보여주려면 이 구간이 필요하다.
 * computeAccruedDays는 입사 이후 발생분을 전부 더하기 때문에,
 * 2년 6개월 근속자에게 "잔여 41일"처럼 실무와 동떨어진 숫자가 나온다.
 * (법적으로 총 발생은 41일이 맞지만, 각 연차는 발생일로부터 1년 내 사용해야 하고
 *  미사용분은 정산·소멸된다 — 근로기준법 제60조⑦)
 */
export function leaveYearWindow(
  hireDate: string | null | undefined,
  asOf: string,
): { start: string; end: string; yearIndex: number } | null {
  if (!hireDate || hireDate > asOf) return null;

  const years = yearsOfService(hireDate, asOf);
  const start = addYears(hireDate, years);
  // 종료일은 다음 기념일 전날 (포함 구간)
  const end = addDaysYmdLocal(addYears(hireDate, years + 1), -1);
  return { start, end, yearIndex: years };
}

/** 연 단위 가산. 2/29 입사자는 평년에 2/28로 당긴다 */
function addYears(ymd: string, delta: number): string {
  const { y, m, d } = parseYmd(ymd);
  const year = y + delta;
  const day = Math.min(d, lastDayOfMonth(year, m));
  return `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDaysYmdLocal(ymd: string, delta: number): string {
  const { y, m, d } = parseYmd(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/**
 * 현재 연차연도(입사기념일 ~ 다음 기념일)에 발생한 연차만.
 *
 * 잔여 표시의 기준값. 소멸 정책이 확정되면 DB 차감 로직도 여기에 맞춘다.
 */
export function accrualForLeaveYear(
  hireDate: string | null | undefined,
  asOf: string,
): { yearIndex: number; days: number } {
  if (!hireDate || hireDate > asOf) return { yearIndex: 0, days: 0 };

  const months = monthsOfService(hireDate, asOf);
  const years = Math.floor(months / 12);

  // 아직 1년이 안 된 구간은 이번 연도에 월 단위로 받은 일수
  if (years < 1) {
    return { yearIndex: 0, days: Math.min(months, MAX_FIRST_YEAR_DAYS) };
  }
  return { yearIndex: years, days: annualDaysForYear(years) };
}

/**
 * 다음 연차 발생 시점과 일수 — 화면에 "다음 발생 예정" 안내로 쓴다.
 */
export function nextAccrual(
  hireDate: string | null | undefined,
  asOf: string,
): { date: string; days: number } | null {
  if (!hireDate) return null;

  const months = monthsOfService(hireDate, asOf);
  const h = parseYmd(hireDate);

  // 1년 미만이고 아직 11일을 다 못 받았으면 다음 월 기념일
  if (months < 12 && months < MAX_FIRST_YEAR_DAYS) {
    const next = months + 1;
    const y = h.y + Math.floor((h.m - 1 + next) / 12);
    const m = ((h.m - 1 + next) % 12) + 1;
    const d = Math.min(h.d, lastDayOfMonth(y, m));
    return { date: fmt(y, m, d), days: 1 };
  }

  // 그 외에는 다음 입사 기념일
  const nextYear = Math.floor(months / 12) + 1;
  const y = h.y + nextYear;
  const d = Math.min(h.d, lastDayOfMonth(y, h.m));
  return { date: fmt(y, h.m, d), days: annualDaysForYear(nextYear) };
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * 연차 신청 일수 계산.
 * 주말·공휴일은 차감하지 않는다(근무일이 아니므로).
 */
export function countLeaveDays(
  startDate: string,
  endDate: string,
  nonWorkingDates: Set<string>,
): number {
  if (endDate < startDate) return 0;

  let days = 0;
  let cursor = startDate;
  // 방어적 상한 — 잘못된 입력으로 무한 루프에 빠지지 않게
  for (let guard = 0; guard < 400 && cursor <= endDate; guard += 1) {
    const { y, m, d } = parseYmd(cursor);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    if (!isWeekend && !nonWorkingDates.has(cursor)) days += 1;

    const next = new Date(Date.UTC(y, m - 1, d));
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
  }
  return days;
}
