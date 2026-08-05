import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { PeriodNavigator } from "@/components/ui/PeriodNavigator";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Meter } from "@/components/ui/Progress";
import { AttendanceView } from "@/features/attendance/AttendanceView";
import {
  getAttendanceWithAbsences,
  getLeaveSummary,
  getMyCorrectionRequests,
  getMyLeaveAdjustments,
  getMyLeaveRequests,
  getMyOvertimeRequests,
  getThisWeekHours,
  type WeeklyDay,
} from "@/features/attendance/data";
import { isAbsentDay } from "@/features/attendance/data-client";
import {
  formatDays,
  formatHours,
  hoursBetween,
} from "@/features/attendance/format";
import { requireSessionEmployee } from "@/lib/auth/session";
import {
  todayYmd,
  toSeoulTime,
  WEEKDAY_LABELS,
  weekdayOf,
} from "@/features/calendar/date";
import {
  parsePeriod,
  periodHref,
  PERIOD_UNIT_LABELS,
  type PeriodSearchParams,
  type PeriodUnit,
} from "@/lib/period";
import { cn, formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "내 근태" };

/** 이 화면이 지원하는 기간 단위 (= 토글 순서) */
const UNITS = ["week", "month"] as const satisfies readonly PeriodUnit[];
/** 개인 근태는 주 단위로 본다 — 주52시간·주휴가 판정의 단위가 주다 */
const DEFAULT_UNIT = "week";

/**
 * 내 근태 — daou-survey/14-ehr-attend.md(ehr 근태 홈 실측) 재구축.
 *
 * ehr 구성 그대로 위에서부터: 상단 우측 액션(신청 이력·목록 다운로드, 툴바는
 * AttendanceView) → 주간누적 게이지 블록(475px급·40h/52h 눈금) + 우측 지표
 * 4종(라벨/값 수직 나열) → 주간 캘린더 블록(radius 16 표) → 기록·신청 표.
 *
 * 종전 지표 밴드(StatCard 4칸)와 DayStrip은 이 게이지+지표+캘린더 구성이
 * 대체한다. 데이터 조회(attendance/data.ts)는 무변경 — 표시 계층만 바꿨다.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: PeriodSearchParams;
}) {
  const me = await requireSessionEmployee();
  const today = todayYmd();

  // 기간은 ?period=week|month & ?cursor= 로 읽는다 (lib/period 규약)
  const period = parsePeriod(searchParams, {
    units: UNITS,
    defaultUnit: DEFAULT_UNIT,
    today,
  });
  const view = period.unit;
  const cursor = period.cursor;

  // 주간이면 기준점이 곧 그 주의 시작일이다 (parsePeriod가 일요일로 맞춰 준다)
  const weekStart = view === "week" ? period.cursor : null;
  const rangeFrom = period.from;
  const rangeTo = period.to;

  const [summary, records, leaves, overtimes, corrections, week, adjustments] =
    await Promise.all([
      getLeaveSummary(me.id, me.hire_date),
      getAttendanceWithAbsences(me.id, rangeFrom, rangeTo, me.hire_date),
      getMyLeaveRequests(me.id),
      getMyOvertimeRequests(me.id),
      getMyCorrectionRequests(me.id),
      getThisWeekHours(me.id, weekStart ?? undefined),
      getMyLeaveAdjustments(me.id),
    ]);

  // ── ehr 지표 파생값 — 전부 이미 받은 데이터의 재계산(조회 무변경) ──
  /** 기간 누적 근로시간 — '총 근로시간' 지표 */
  const periodHours = records.reduce((sum, row) => {
    if (isAbsentDay(row)) return sum;
    return sum + (hoursBetween(row.check_in_at, row.check_out_at) ?? 0);
  }, 0);
  /** 잔여 근무일 n일 /n일 — ehr "3일/5일" 표기 */
  const remainingWorkDays = Math.max(
    0,
    week.plannedWorkDayCount - week.workedDayCount,
  );
  /** 잔여 근로시간 — 주 40h 목표 대비 (기존 주간 요약 파생값 재활용) */
  const remainingHours = Math.max(0, week.targetHours - week.hours);
  /** 안내문("…더 필요해요")은 지나간 주에는 말이 안 된다 */
  const weekIsCurrent = today >= week.weekStart && today <= week.weekEnd;
  /**
   * 게이지·잔여 지표는 주 단위 개념이다 — 월 보기에서 이번 주 값을 그대로
   * 두면 '총 근로시간'(선택한 달)과 서로 다른 기간이 라벨 없이 한 줄에 섞인다.
   */
  const isWeekView = view === "week";
  /** '잔여' 두 칸은 진행 중인 주에서만 말이 된다 — 안내문과 같은 판정 */
  const showRemaining = isWeekView && weekIsCurrent;

  const linkTo = (unit: PeriodUnit, next: string | null) =>
    periodHref(
      "/attendance",
      { unit, cursor: next },
      { defaultUnit: DEFAULT_UNIT },
    );

  const periodLabel = period.label;
  const inPeriod = period.includesToday;

  /*
   * 주간누적 게이지 + 지표 + 주간 캘린더 — AttendanceView의 툴바 아래,
   * 표들 위에 끼워 넣는다(ehr 순서). 서버에서 그려 slot으로 넘긴다.
   *
   * 24시간 타임라인(14-ehr 구성 5)은 이번 범위에서 뺐다 — 우리 기록은
   * 출퇴근 시각·승인 초과근무뿐이라 상태 밴드(휴게·야간·업무미포함 등)를
   * 그릴 데이터가 없다. 없는 상태를 범례에서 다 빼면 밴드 자체가 빈
   * 껍데기가 되므로 통째로 제외한다(14-ehr "빈 껍데기 금지").
   */
  const overview = (
    <>
      {/*
        섹션 aria-label — 아래 표 섹션들(근태 기록·신청 내역)은 SectionHeader가
        h2를 그리는데, 정작 첫 화면인 이 요약 블록만 헤딩·랜드마크 탐색에서
        통째로 건너뛰어졌다. 게이지 타이틀도 같은 이유로 h2다(시각 단 유지).
      */}
      <section
        aria-label="근태 요약"
        className="mb-6 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-10"
      >
        {/*
          주간누적 게이지 블록 — 14-ehr 구성 2 (475px 폭 실측). 주 보기 전용:
          월 보기에서 이번 주 게이지를 그대로 두면 "이번주 …이 더 필요해요"가
          조회 중인 달과 무관하게 떠서 기간이 섞인다.
        */}
        {isWeekView ? (
          <div className="w-full lg:max-w-[475px]">
            <div className="flex flex-wrap items-baseline gap-x-2.5">
              {/*
                18px/500 — ehr 섹션 제목 단이다(gw의 20/500·14/600과 다른 단,
                14-ehr L17). 행간 27px은 06 heading-m의 18/27 그대로.
              */}
              <h2 className="text-[18px] font-medium leading-[27px] text-ink">
                주간누적
              </h2>
              {/*
                값 "n시간 n분"도 같은 18/500. ehr 실측은 민트 원색이지만
                18px은 작은 글자 단이라 잉크로 내린다 — 원색은 흰 배경 대비
                1.9:1(tailwind.config 용처 원칙), 아래 MetricItem과 같은 판정.
              */}
              <span className="text-[18px] font-medium leading-[27px] tabular-nums text-accent-ink">
                {koreanHours(week.hours)}
              </span>
            </div>
            {weekIsCurrent ? (
              <p className="mt-0.5 text-label text-muted">
                {remainingHours > 0
                  ? `이번주 ${koreanHours(remainingHours)}이 더 필요해요.`
                  : `이번주 목표 ${week.targetHours}시간을 채웠어요.`}
              </p>
            ) : null}
            {/*
              게이지 h-2(8px)·트랙 line(#eaecef) — ehr 475×8 radius 8 실측.
              8px 막대의 radius 8은 완전 라운드와 동치라 Meter의 rounded-pill
              트랙을 그대로 쓴다. 채움은 positive(accent-ink 민트 잉크) —
              민트 원색은 트랙 대비 1.9:1이라 막대에서도 잉크 단으로 내린다.

              눈금선은 스펙의 40h·52h 둘뿐이다(14-ehr L26 — 48h 눈금은 원본에
              없다). Meter는 thresholds 항목마다 눈금선을 그리므로 48h를
              항목으로 주면 라벨 없는 선이 하나 더 생긴다 — 48h 경고는 눈금
              없이 채움 톤으로만 반영한다(40h 임계의 tone에 실어 보내는 방식,
              48h≤값<52h 구간 warning 채움은 종전과 동일).
            */}
            <Meter
              className="mt-3"
              value={week.hours}
              max={week.limitHours}
              tone="positive"
              size="md"
              thresholds={[
                {
                  at: week.targetHours,
                  tone: week.hours >= week.warnHours ? "warning" : "positive",
                },
                { at: week.limitHours, tone: "critical" },
              ]}
              aria-label={`주간누적 ${formatHours(week.hours)} / ${week.limitHours}h`}
            />
            {/* 40h·52h 눈금 — ehr 12px #9b9c9e 단(text-micro·muted) */}
            <div
              className="relative mt-1 h-4 text-micro text-muted"
              aria-hidden
            >
              <span
                className="absolute -translate-x-1/2 tabular-nums"
                style={{
                  left: `${(week.targetHours / week.limitHours) * 100}%`,
                }}
              >
                {week.targetHours}h
              </span>
              <span className="absolute right-0 tabular-nums">
                {week.limitHours}h
              </span>
            </div>
          </div>
        ) : null}

        {/*
          우측 지표 — 14-ehr 구성 3: 잔여 근무일·잔여 근로시간·총 근로시간·
          휴가. StatCard(카드 면·미터)가 아니라 라벨 14 muted 위 + 값 아래의
          수직 나열이다. 값 색은 04 규칙 그대로 "활성·잔여 = 민트, 총계 =
          먹색" — 18px은 작은 글자라 민트 잉크(accent-ink)로 간다.

          '잔여' 두 칸은 진행 중인 주에서만 — 지나간 주·월 보기에서 "잔여
          근무일 1일"은 이미 끝난 기간을 앞으로 채울 것처럼 오독된다. 총
          근로시간(선택 기간)·휴가(연차연도)는 기간이 라벨 의미에 이미
          들어 있어 항상 보인다.
        */}
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          {showRemaining ? (
            <>
              <MetricItem
                label="잔여 근무일"
                value={`${remainingWorkDays}일`}
                denominator={`${week.plannedWorkDayCount}일`}
                accent
              />
              <MetricItem
                label="잔여 근로시간"
                value={formatHours(remainingHours)}
                denominator={`${week.targetHours}h`}
                accent
              />
            </>
          ) : null}
          <MetricItem
            label="총 근로시간"
            value={formatHours(periodHours)}
          />
          <MetricItem
            label="휴가"
            value={`${formatDays(summary.remaining)}일`}
            denominator={`${formatDays(summary.accrued + summary.adjustment)}일`}
            accent
          />
        </dl>
      </section>

      {isWeekView ? (
        <section aria-label="주간 캘린더" className="mb-6">
          <WeekCalendar days={week.days} today={today} />
        </section>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        title="내 근태"
        meta={
          <>
            <span>{me.department?.name ?? "부서 미지정"}</span>
            <span>·</span>
            <span>입사 {formatDate(me.hire_date)}</span>
            {summary.yearStart ? (
              <>
                <span>·</span>
                <span>
                  연차연도 {summary.yearStart} ~ {summary.yearEnd}
                </span>
              </>
            ) : null}
          </>
        }
        toolbar={
          <PeriodNavigator
            label={periodLabel}
            sublabel={period.sublabel}
            prevHref={linkTo(view, period.prevCursor)}
            nextHref={linkTo(view, period.nextCursor)}
            todayHref={linkTo(view, null)}
            atToday={inPeriod}
            className="mb-0"
            right={
              <SegmentedControl
                options={UNITS.map((unit) => ({
                  value: unit,
                  label: PERIOD_UNIT_LABELS[unit],
                  // 지난 기간을 보는 중이면 단위를 바꿔도 그 지점에 머문다
                  href: linkTo(unit, inPeriod ? null : cursor),
                }))}
                value={view}
                ariaLabel="기간 단위"
              />
            }
          />
        }
      />

      <AttendanceView
        records={records}
        leaves={leaves}
        overtimes={overtimes}
        corrections={corrections}
        adjustments={adjustments}
        remainingDays={summary.remaining}
        periodLabel={periodLabel}
        overview={overview}
      />
    </>
  );
}

/** 9.5 → "9시간 30분" — ehr 게이지 값·안내문의 표기(14-ehr "n시간 n분") */
function koreanHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 60) return `${h + 1}시간 0분`;
  return `${h}시간 ${m}분`;
}

/**
 * 우측 지표 한 칸 — 라벨 14px muted 위, 값 아래(14-ehr 배치).
 * 분모는 값 옆 작은 muted("3일 /5일" — ehr 표기).
 */
function MetricItem({
  label,
  value,
  denominator,
  accent,
}: {
  label: string;
  value: string;
  denominator?: string;
  /** 활성·잔여 값 = 민트 잉크. 총계는 먹색(04 규칙) */
  accent?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-body text-muted">{label}</dt>
      <dd
        className={cn(
          "mt-1 text-[18px] font-medium leading-[27px] tabular-nums",
          accent ? "text-accent-ink" : "text-ink",
        )}
      >
        {value}
        {denominator ? (
          <span className="ml-1 text-label font-normal text-muted">
            /{denominator}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * 주간 캘린더 블록 — 14-ehr 구성 4.
 *
 * 기존 DayStrip(칩 나열)을 ehr 실측 그대로 "요일+날짜 헤더 + 행(근무시작/
 * 근무종료/총 근로시간)" 표로 재배열했다. 블록 카드는 ehr 단: radius 16
 * (rounded-2xl) · border 1px #eaecef — gw 카드(12px)와 다른 단이다(14-ehr L18).
 *
 * ehr의 '상세 근로시간·승인요청내역' 행은 우리 데이터로 표현 가능한 범위만
 * (휴가·승인 초과근무) '비고' 행 하나로 접었다 — 없는 항목의 빈 행 금지.
 */
function WeekCalendar({ days, today }: { days: WeeklyDay[]; today: string }) {
  const rowLabel =
    "w-28 whitespace-nowrap px-4 py-2.5 text-left text-label font-normal text-muted";
  const cell = "px-2 py-2.5 text-center tabular-nums";
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full min-w-[680px] table-fixed border-collapse text-body">
        <thead>
          <tr className="border-b border-line">
            <th className={rowLabel} scope="col" aria-label="항목" />
            {days.map((day) => {
              const weekday = weekdayOf(day.date);
              const isToday = day.date === today;
              return (
                <th
                  key={day.date}
                  scope="col"
                  className="px-2 py-2.5 text-center font-normal"
                >
                  {/*
                    요일+날짜, 휴일 표기(14-ehr "월3…일9, 휴일 표기").
                    일요일·공휴일 빨강, 토요일 파랑(한국 캘린더 기본).
                    오늘은 활성이므로 primary 시안 — 용처 원칙(활성=시안).
                  */}
                  <span
                    className={cn(
                      "tabular-nums",
                      isToday
                        ? "font-medium text-primary"
                        : day.holidayName || weekday === 0
                          ? "text-danger"
                          : weekday === 6
                            ? "text-info"
                            : "text-ink",
                    )}
                  >
                    {WEEKDAY_LABELS[weekday]} {Number(day.date.slice(8, 10))}
                  </span>
                  {day.holidayName ? (
                    <span className="block truncate text-nano text-danger">
                      {day.holidayName}
                    </span>
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className={rowLabel}>
              근무시작
            </th>
            {days.map((day) => (
              <td
                key={day.date}
                className={cn(cell, !day.checkIn && "text-muted")}
              >
                {day.checkIn ? toSeoulTime(day.checkIn) : "-"}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className={rowLabel}>
              근무종료
            </th>
            {days.map((day) => (
              <td
                key={day.date}
                className={cn(cell, !day.checkOut && "text-muted")}
              >
                {day.checkOut ? toSeoulTime(day.checkOut) : "-"}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className={rowLabel}>
              총 근로시간
            </th>
            {days.map((day) => (
              <td
                key={day.date}
                className={cn(cell, day.workedHours <= 0 && "text-muted")}
              >
                {day.workedHours > 0
                  ? formatHours(day.workedHours)
                  : day.checkIn
                    ? "근무 중"
                    : "-"}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className={rowLabel}>
              비고
            </th>
            {days.map((day) => {
              const notes = [
                day.onLeave ? "휴가" : null,
                day.overtimeHours > 0
                  ? `초과 ${formatHours(day.overtimeHours)}`
                  : null,
              ].filter(Boolean);
              return (
                <td
                  key={day.date}
                  className={cn(
                    cell,
                    "text-label",
                    notes.length === 0 && "text-muted",
                  )}
                >
                  {notes.length > 0 ? notes.join(" · ") : "-"}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
