import type { Metadata } from "next";
import { CalendarOff, CalendarRange, Flag, Sun } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { PeriodNavigator } from "@/components/ui/PeriodNavigator";
import { Chip } from "@/components/ui/ChipStrip";
import { HolidayManager } from "@/features/calendar/HolidayManager";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { todayYmd, WEEKDAY_LABELS, weekdayOf } from "@/features/calendar/date";
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
  searchParams: { year?: string };
}) {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const thisYear = Number(todayYmd().slice(0, 4));
  const parsed = Number(searchParams.year);
  const year =
    Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100
      ? parsed
      : thisYear;

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

  const byMonth = MONTHS.map((month) => ({
    month,
    items: holidays.filter(
      (h) => Number(h.date.slice(5, 7)) === month,
    ),
  }));

  return (
    <>
      <PageHeader
        title="휴일 관리"
        meta={
          <>
            <span>
              {year - 1}년 {prevCount ?? 0}일 → {year}년 {total}일
            </span>
            <span>·</span>
            <span>캘린더 빨간날과 근무일 산정의 공통 기준</span>
          </>
        }
        toolbar={
          <PeriodNavigator
            label={`${year}년`}
            sublabel={year === thisYear ? "올해" : undefined}
            prevHref={`/admin/holidays?year=${year - 1}`}
            nextHref={`/admin/holidays?year=${year + 1}`}
            todayHref="/admin/holidays"
            atToday={year === thisYear}
            className="mb-0"
          />
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="근무일 제외"
          value={nonWorking}
          unit="일"
          denominator={total}
          denominatorUnit="일"
          tone="brand"
          icon={CalendarRange}
          emphasis
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
          tone="informative"
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

      <Card className="mb-5">
        <CardHeader
          title={`${year}년 분포`}
          description="근무일에서 제외되는 날은 빨강, 캘린더에만 표시되는 날은 회색입니다"
          density="compact"
        />
        <CardBody density="compact">
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
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`${year}년 휴일 목록`}
          description="음력 공휴일·대체공휴일·임시공휴일은 자동 계산이 불가능해 직접 관리합니다"
          density="compact"
        />
        <CardBody density="compact">
          <HolidayManager holidays={holidays} />
        </CardBody>
      </Card>
    </>
  );
}
