import {
  addDaysYmd,
  toSeoulYmd,
  WEEKDAY_LABELS,
  weekdayOf,
} from "@/features/calendar/date";
import type { Todo } from "./types";

/**
 * 마감일 표기와 요약 계산.
 *
 * 톤 규칙: 미완료는 위반이 아니라 "할 일"이다. 그래서 기본은 중립이고,
 * 기한이 지난 것만 warn으로 올린다. danger는 이 화면에서 쓰지 않는다.
 */

/** 날짜 문자열끼리의 일수 차이 (to - from). 타임존 영향 없이 순수 날짜 연산 */
export function diffDaysYmd(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86400000);
}

export type DueTone = "overdue" | "today" | "soon" | "later";

/** 마감 표기에 쓰는 글자색. 지난 것만 warn, 나머지는 중립·정보 */
export const DUE_TEXT_CLASS: Record<DueTone, string> = {
  overdue: "text-warn-ink",
  today: "text-info-ink",
  soon: "text-ink",
  later: "text-muted",
};

export interface DueMeta {
  /** "07-31 (금)" */
  label: string;
  /** "D-3" · "오늘" · "3일 지남" */
  dLabel: string;
  tone: DueTone;
  /** 오늘 기준 남은 일수. 음수면 지난 것 */
  days: number;
}

export function dueMeta(due: string, today: string): DueMeta {
  const days = diffDaysYmd(today, due);
  const label = `${due.slice(5)} (${WEEKDAY_LABELS[weekdayOf(due)]})`;

  if (days < 0) {
    return { label, dLabel: `${-days}일 지남`, tone: "overdue", days };
  }
  if (days === 0) return { label, dLabel: "오늘", tone: "today", days };
  return {
    label,
    dLabel: `D-${days}`,
    tone: days <= 3 ? "soon" : "later",
    days,
  };
}

/** 완료 시각 → 서울 기준 날짜. 완료가 아니면 null */
export function completedYmd(todo: Todo): string | null {
  return todo.completed_at ? toSeoulYmd(todo.completed_at) : null;
}

export interface TodoSummary {
  total: number;
  open: number;
  done: number;
  /** 오늘 마감인 미완료 */
  dueToday: number;
  /** 기한이 지난 미완료 — 이 화면에서 유일하게 warn을 쓰는 값 */
  overdue: number;
  /** 마감일이 없는 미완료 */
  noDue: number;
  /** 이번 주(일~토) 완료 건수 */
  weekDone: number;
  /** 지난주 완료 건수 — 이번 주와 비교하는 값 */
  lastWeekDone: number;
  /** 가장 가까운 미래 마감일 */
  nextDue: string | null;
  /** 가장 오래 지난 마감일 */
  oldestOverdue: string | null;
  weekStart: string;
  weekEnd: string;
}

/** 요약 밴드에 쓰는 값 — 전부 분모나 비교값이 있는 숫자다 */
export function summarizeTodos(rows: Todo[], today: string): TodoSummary {
  const weekStart = addDaysYmd(today, -weekdayOf(today));
  const weekEnd = addDaysYmd(weekStart, 6);
  const lastWeekStart = addDaysYmd(weekStart, -7);
  const lastWeekEnd = addDaysYmd(weekStart, -1);

  let open = 0;
  let done = 0;
  let dueToday = 0;
  let overdue = 0;
  let noDue = 0;
  let weekDone = 0;
  let lastWeekDone = 0;
  let nextDue: string | null = null;
  let oldestOverdue: string | null = null;

  for (const row of rows) {
    if (row.is_completed) {
      done += 1;
      const at = completedYmd(row);
      if (at && at >= weekStart && at <= weekEnd) weekDone += 1;
      if (at && at >= lastWeekStart && at <= lastWeekEnd) lastWeekDone += 1;
      continue;
    }

    open += 1;
    if (!row.due_date) {
      noDue += 1;
      continue;
    }
    if (row.due_date < today) {
      overdue += 1;
      if (!oldestOverdue || row.due_date < oldestOverdue) {
        oldestOverdue = row.due_date;
      }
      continue;
    }
    if (row.due_date === today) dueToday += 1;
    if (!nextDue || row.due_date < nextDue) nextDue = row.due_date;
  }

  return {
    total: rows.length,
    open,
    done,
    dueToday,
    overdue,
    noDue,
    weekDone,
    lastWeekDone,
    nextDue,
    oldestOverdue,
    weekStart,
    weekEnd,
  };
}
