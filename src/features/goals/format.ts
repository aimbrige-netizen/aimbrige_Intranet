import { toSeoulYmd, WEEKDAY_LABELS, weekdayOf } from "@/features/calendar/date";
import type { Goal } from "./types";

/**
 * 목표일 표기와 요약 계산.
 *
 * 진행중 목표의 목표일이 다가오는 것은 위반이 아니다. 지난 것만 warn으로
 * 올리고 나머지는 정보·중립으로 둔다(할일 화면과 같은 규칙).
 */

/** 임박으로 볼 남은 일수 — 2주 안이면 "슬슬 챙겨야 하는" 구간 */
export const GOAL_SOON_DAYS = 14;

export function diffDaysYmd(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000,
  );
}

export type TargetTone = "overdue" | "soon" | "later";

export const TARGET_TEXT_CLASS: Record<TargetTone, string> = {
  overdue: "text-warn-ink",
  soon: "text-info-ink",
  later: "text-muted",
};

export interface TargetMeta {
  /** "2026-08-14 (금)" */
  label: string;
  /** "D-14" · "오늘" · "3일 지남" */
  dLabel: string;
  tone: TargetTone;
  days: number;
}

export function targetMeta(target: string, today: string): TargetMeta {
  const days = diffDaysYmd(today, target);
  const label = `${target} (${WEEKDAY_LABELS[weekdayOf(target)]})`;

  if (days < 0) {
    return { label, dLabel: `${-days}일 지남`, tone: "overdue", days };
  }
  if (days === 0) return { label, dLabel: "오늘", tone: "soon", days };
  return {
    label,
    dLabel: `D-${days}`,
    tone: days <= GOAL_SOON_DAYS ? "soon" : "later",
    days,
  };
}

/**
 * 목표일까지의 경과 비율.
 * 등록일부터 목표일까지를 100으로 두고 오늘이 어디쯤인지 보여준다.
 * 진행률(%)은 스펙에서 미루기로 한 항목이라, 대신 "시간이 얼마나 남았나"를 그린다.
 */
export function elapsedRatio(
  goal: Goal,
  today: string,
): { value: number; max: number } | null {
  if (!goal.target_date) return null;
  const start = toSeoulYmd(goal.created_at);
  const span = diffDaysYmd(start, goal.target_date);
  if (span <= 0) return null;
  const elapsed = diffDaysYmd(start, today);
  return { value: Math.min(Math.max(elapsed, 0), span), max: span };
}

export interface GoalSummary {
  total: number;
  active: number;
  completed: number;
  dropped: number;
  /** 진행중 + 목표일이 2주 안 (지난 것은 제외) */
  dueSoon: number;
  /** 진행중인데 목표일이 지난 것 — 이 화면에서 유일하게 색을 올리는 값 */
  overdue: number;
  /** 진행중 중 가장 가까운 목표일 */
  nextTarget: string | null;
  /** 목표일을 정하지 않은 진행중 */
  noTarget: number;
  /** 달성률 = 완료 / 전체 (0~1) */
  rate: number;
}

export function summarizeGoals(rows: Goal[], today: string): GoalSummary {
  let active = 0;
  let completed = 0;
  let dropped = 0;
  let dueSoon = 0;
  let overdue = 0;
  let noTarget = 0;
  let nextTarget: string | null = null;

  for (const row of rows) {
    if (row.status === "completed") {
      completed += 1;
      continue;
    }
    if (row.status === "dropped") {
      dropped += 1;
      continue;
    }

    active += 1;
    if (!row.target_date) {
      noTarget += 1;
      continue;
    }
    const days = diffDaysYmd(today, row.target_date);
    if (days < 0) {
      overdue += 1;
      continue;
    }
    if (days <= GOAL_SOON_DAYS) dueSoon += 1;
    if (!nextTarget || row.target_date < nextTarget) {
      nextTarget = row.target_date;
    }
  }

  return {
    total: rows.length,
    active,
    completed,
    dropped,
    dueSoon,
    overdue,
    nextTarget,
    noTarget,
    rate: rows.length > 0 ? completed / rows.length : 0,
  };
}
