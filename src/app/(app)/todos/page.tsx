import type { Metadata } from "next";
import { AlarmClock, CalendarClock, CheckCircle2, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Callout } from "@/components/ui/Callout";
import { StatCard } from "@/components/ui/StatCard";
import { DayStrip, type StripDay } from "@/components/ui/ChipStrip";
import { TodoList } from "@/features/todos/TodoList";
import { getMyTodos } from "@/features/todos/data";
import {
  completedYmd,
  diffDaysYmd,
  summarizeTodos,
  type TodoSummary,
} from "@/features/todos/format";
import type { Todo } from "@/features/todos/types";
import {
  addDaysYmd,
  todayYmd,
  WEEKDAY_LABELS,
  weekdayOf,
} from "@/features/calendar/date";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "내 할일" };

/**
 * 내 할일 (스펙 09 · 3.2)
 *
 * 기간 스테퍼가 없는 화면이다 — 할일은 구간이 아니라 롤링으로 쌓이고,
 * "지난주 할일"을 다시 여는 조작은 의미가 없다. 대신 건수를 단 필터칩과
 * 이번 주 마감 스트립이 그 자리를 대신한다.
 */
export default async function TodosPage() {
  const me = await requireSessionEmployee();
  const today = todayYmd();

  const { rows, error } = await getMyTodos(me.id);
  const summary = summarizeTodos(rows, today);

  const todayLabel = `${today} (${WEEKDAY_LABELS[weekdayOf(today)]})`;

  if (error) {
    return (
      <>
        <PageHeader title="내 할일" meta={<span>오늘 {todayLabel}</span>} />
        <Callout tone="danger" title="할일을 불러오지 못했습니다">
          {error}
        </Callout>
      </>
    );
  }

  const weekDelta = summary.weekDone - summary.lastWeekDone;

  return (
    <>
      <PageHeader
        title="내 할일"
        meta={
          <>
            <span>오늘 {todayLabel}</span>
            <span>·</span>
            <span>
              미완료 {summary.open}건 / 전체 {summary.total}건
            </span>
          </>
        }
      />

      {/* 요약 밴드 — 맨숫자를 두지 않는다. 전부 분모나 비교값이 붙는다 */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="미완료"
          value={summary.open}
          unit="건"
          denominator={summary.total}
          denominatorUnit="건"
          tone="informative"
          icon={ListChecks}
          max={summary.total || 1}
          meterValue={summary.open}
          sub={`완료 ${summary.done}건 · 마감일 없음 ${summary.noDue}건`}
        />
        <StatCard
          label="오늘 마감"
          value={summary.dueToday}
          unit="건"
          denominator={summary.open}
          denominatorUnit="건"
          tone="neutral"
          icon={CalendarClock}
          max={summary.open || 1}
          meterValue={summary.dueToday}
          sub={
            summary.nextDue
              ? `가장 가까운 마감 ${summary.nextDue.slice(5)} (D-${diffDaysYmd(today, summary.nextDue)})`
              : "예정된 마감 없음"
          }
        />
        {/*
          이 화면에서 색을 올리는 값은 여기 하나뿐이다.
          미완료는 할 일이지 위반이 아니라서 중립·정보 톤으로 둔다.
        */}
        <StatCard
          label="기한 지남"
          value={summary.overdue}
          unit="건"
          denominator={summary.open}
          denominatorUnit="건"
          tone={summary.overdue > 0 ? "warning" : "neutral"}
          icon={AlarmClock}
          max={summary.open || 1}
          meterValue={summary.overdue}
          sub={
            summary.oldestOverdue
              ? `가장 오래된 것 ${-diffDaysYmd(today, summary.oldestOverdue)}일 지남`
              : "지난 마감 없음"
          }
        />
        <StatCard
          label="이번 주 완료"
          value={summary.weekDone}
          unit="건"
          denominator={summary.done}
          denominatorUnit="건"
          tone="positive"
          icon={CheckCircle2}
          max={summary.done || 1}
          meterValue={summary.weekDone}
          delta={
            summary.weekDone || summary.lastWeekDone
              ? {
                  label: `${weekDelta >= 0 ? "+" : ""}${weekDelta}`,
                  direction:
                    weekDelta > 0 ? "up" : weekDelta < 0 ? "down" : "flat",
                }
              : undefined
          }
          sub={`지난주 ${summary.lastWeekDone}건`}
        />
      </div>

      {/* 목록만으로는 이번 주에 무엇이 몰려 있는지 보이지 않는다 */}
      {rows.length > 0 ? (
        <Card className="mb-5">
          <CardHeader
            title="이번 주"
            description={`${summary.weekStart} ~ ${summary.weekEnd} · 마감과 완료`}
            density="compact"
          />
          <CardBody density="compact">
            <DayStrip
              days={weekStripDays(rows, summary, today)}
              emptyLabel="마감 없음"
            />
          </CardBody>
        </Card>
      ) : null}

      <TodoList todos={rows} today={today} />
    </>
  );
}

/** 이번 주 7칸 — 각 날짜의 미완료 마감 건수와 그날 완료한 건수 */
function weekStripDays(
  rows: Todo[],
  summary: TodoSummary,
  today: string,
): StripDay[] {
  const dueCounts = new Map<string, number>();
  const doneCounts = new Map<string, number>();

  for (const row of rows) {
    if (row.is_completed) {
      const at = completedYmd(row);
      if (at) doneCounts.set(at, (doneCounts.get(at) ?? 0) + 1);
      continue;
    }
    if (row.due_date) {
      dueCounts.set(row.due_date, (dueCounts.get(row.due_date) ?? 0) + 1);
    }
  }

  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysYmd(summary.weekStart, i);
    const dueCount = dueCounts.get(date) ?? 0;
    const doneCount = doneCounts.get(date) ?? 0;
    const chips: NonNullable<StripDay["chips"]> = [];

    if (dueCount > 0) {
      chips.push({
        lines: [`마감 ${dueCount}건`],
        // 지난 날짜에 남아 있는 마감만 경고다. 앞으로 올 마감은 예정일 뿐이다
        tone: date < today ? "warn" : date === today ? "info" : "neutral",
      });
    }
    if (doneCount > 0) {
      chips.push({ lines: [`완료 ${doneCount}건`], tone: "success" });
    }

    return { date, chips, selected: date === today };
  });
}
