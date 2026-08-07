import type { Metadata } from "next";
import { CalendarOff, CalendarRange, Flag, Sun } from "lucide-react";
import { SectionHeader } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { PeriodNavigator } from "@/components/ui/PeriodNavigator";
import { Chip } from "@/components/ui/ChipStrip";
import { HolidayManager } from "@/features/calendar/HolidayManager";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { todayYmd, WEEKDAY_LABELS, weekdayOf } from "@/features/calendar/date";
import {
  parsePeriod,
  periodHref,
  type PeriodSearchParams,
} from "@/lib/period";
import type { Holiday, HolidayKind } from "@/types/db";

export const metadata: Metadata = { title: "휴일 관리" };

const KIND_LABELS: Record<HolidayKind, string> = {
  public: "법정공휴일",
  substitute: "대체공휴일",
  temporary: "임시공휴일",
  statutory_leave: "유급휴일",
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * 휴일 관리.
 *
 * 예전에는 기간 필터가 없어 전 연도가 한 표에 무한 누적됐고, 연도를 구분하거나
 * 이동하는 장치가 없었다. 지금은 연도 스테퍼로 한 해씩 끊어 보고,
 * 12개월 그리드로 그 해의 분포를 먼저 보여준 다음 표로 내려간다.
 */
export default async function HolidaysPage({
  searchParams,
}: {
  searchParams: PeriodSearchParams;
}) {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const today = todayYmd();
  const thisYear = Number(today.slice(0, 4));

  /*
   * 기간은 ?period=year & ?cursor=YYYY 로 읽는다 (lib/period 규약).
   * 연도만은 상·하한을 둔다 — 0000년 같은 값이 그대로 날짜 조건이 되면
   * 조회가 실패한다. 범위 밖이면 올해로 떨어뜨린다.
   */
  const requestedYear = searchParams.cursor ?? searchParams.year;
  const inBounds =
    /^\d{4}$/.test(requestedYear ?? "") &&
    Number(requestedYear) >= 2000 &&
    Number(requestedYear) <= 2100;
  const period = parsePeriod(
    { period: "year", cursor: inBounds ? requestedYear : undefined },
    { units: ["year"], today },
  );
  const year = Number(period.cursor);

  const [{ data }, { count: prevCount }] = await Promise.all([
    supabase
      .from("holidays")
      .select("*")
      .gte("date", `${year}-01-01`)
      .lte("date", `${year}-12-31`)
      .order("date", { ascending: true }),
    supabase
      .from("holidays")
      .select("date", { count: "exact", head: true })
      .gte("date", `${year - 1}-01-01`)
      .lte("date", `${year - 1}-12-31`),
  ]);

  const holidays = (data ?? []) as Holiday[];

  const countOf = (...kinds: HolidayKind[]) =>
    holidays.filter((h) => kinds.includes(h.kind)).length;

  const total = holidays.length;
  const nonWorking = holidays.filter((h) => h.is_non_working).length;
  const weekendOverlap = holidays.filter((h) => {
    const weekday = weekdayOf(h.date);
    return weekday === 0 || weekday === 6;
  }).length;
  const publicCount = countOf("public", "substitute");
  const companyCount = countOf("temporary", "statutory_leave");

  const yearHref = (cursor: string | null) =>
    periodHref("/admin/holidays", { unit: "year", cursor }, { defaultUnit: "year" });

  const byMonth = MONTHS.map((month) => ({
    month,
    items: holidays.filter(
      (h) => Number(h.date.slice(5, 7)) === month,
    ),
  }));

  return (
    <>
      {/*
        콘텐츠 제목 "휴일 관리" 20/500 — PageHeader급 밴드 없음(확립 문법).
        전년 대비 일수는 스테퍼 보조 줄로 내린다 — 연도 이동과 같은 자리의
        정보다. "공통 기준" 설명은 요약 카드 sub가 이미 말한다.
      */}
      <h1 className="mb-5 text-title-l text-ink">
        휴일 관리
      </h1>

      <PeriodNavigator
        label={period.label}
        sublabel={`${year === thisYear ? "올해 · " : ""}${year - 1}년 ${prevCount ?? 0}일 → ${year}년 ${total}일`}
        prevHref={yearHref(period.prevCursor)}
        nextHref={yearHref(period.nextCursor)}
        todayHref={yearHref(null)}
        atToday={period.includesToday}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/*
          민트 규율 — 근무일 제외가 이 화면의 작동값(연차·근무일 산정)이라
          민트, 종류별 개수는 분류 셈값이라 중립이다(색 절제).
          종전 brand 강조는 장식이라 걷어냈다.
        */}
        <StatCard
          label="근무일 제외"
          value={nonWorking}
          unit="일"
          denominator={total}
          denominatorUnit="일"
          tone="positive"
          icon={CalendarRange}
          max={total || 1}
          meterValue={nonWorking}
          state={total === 0 ? "empty" : "ok"}
          sub={
            total === 0
              ? `${year}년 휴일이 등록되지 않았습니다`
              : "연차·근무일 산정에서 빠지는 날"
          }
        />
        <StatCard
          label="법정·대체공휴일"
          value={publicCount}
          unit="일"
          denominator={total}
          denominatorUnit="일"
          tone="neutral"
          icon={Flag}
          max={total || 1}
          meterValue={publicCount}
          sub="정부 고시 기준"
        />
        <StatCard
          label="임시·회사 지정"
          value={companyCount}
          unit="일"
          denominator={total}
          denominatorUnit="일"
          tone="neutral"
          icon={Sun}
          max={total || 1}
          meterValue={companyCount}
          sub="창립기념일·임시공휴일 등"
        />
        <StatCard
          label="주말과 겹침"
          value={weekendOverlap}
          unit="일"
          denominator={total}
          denominatorUnit="일"
          tone="neutral"
          icon={CalendarOff}
          sub={`평일 휴무 ${nonWorking - weekendOverlap}일`}
        />
      </div>

      {/* 08 흰 시트: 카드 해체 — 섹션 제목 + 직접 배치, md 미만만 카드 유지 */}
      <section className="mb-5">
        <SectionHeader
          title={`${year}년 분포`}
          description="근무일에서 제외되는 날은 빨강, 캘린더에만 표시되는 날은 회색입니다"
        />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {byMonth.map(({ month, items }) => (
              <div
                key={month}
                className="min-h-24 rounded-card border border-line p-2"
              >
                <p className="mb-1.5 flex items-baseline justify-between gap-1">
                  <span className="text-body-sm font-bold tabular-nums text-ink">
                    {month}월
                  </span>
                  <span className="text-nano tabular-nums text-muted">
                    {items.length > 0 ? `${items.length}일` : ""}
                  </span>
                </p>
                <div className="flex flex-col gap-1">
                  {items.length === 0 ? (
                    <Chip lines={["휴일 없음"]} tone="ghost" />
                  ) : (
                    items.map((holiday) => {
                      const weekday = weekdayOf(holiday.date);
                      return (
                        <Chip
                          key={holiday.date}
                          title={`${holiday.date} ${KIND_LABELS[holiday.kind]}`}
                          tone={holiday.is_non_working ? "danger" : "neutral"}
                          lines={[
                            `${Number(holiday.date.slice(8, 10))}일 (${WEEKDAY_LABELS[weekday]})`,
                            { text: holiday.name, dim: true },
                          ]}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <SectionHeader
          title={`${year}년 휴일 목록 (총${total}일)`}
          description="음력 공휴일·대체공휴일·임시공휴일은 자동 계산이 불가능해 직접 관리합니다"
        />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <HolidayManager holidays={holidays} />
        </div>
      </section>
    </>
  );
}
