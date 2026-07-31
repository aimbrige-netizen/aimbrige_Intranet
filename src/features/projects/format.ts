import { WEEKDAY_LABELS, weekdayOf } from "@/features/calendar/date";
import {
  PROJECT_STATUSES,
  type Project,
  type ProjectListRow,
  type ProjectStatus,
} from "./types";

/**
 * 진행률·기간 표기와 목록 요약 계산.
 *
 * 진행률은 어디에도 저장하지 않는다. 완료 마일스톤 수 / 전체 수를 세는 게
 * 전부라 목록에서도 상세에서도 같은 함수 하나를 통과한다 — 두 화면이 다른
 * 숫자를 말하는 경로를 아예 만들지 않으려는 것이다.
 */

/** 마일스톤 목표일이 "슬슬 챙길 구간"으로 보이는 남은 일수 */
export const MILESTONE_SOON_DAYS = 7;

export function diffDaysYmd(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000,
  );
}

export interface ProjectProgress {
  done: number;
  total: number;
  /** 0~1. 마일스톤이 하나도 없으면 0 */
  ratio: number;
  percent: number;
}

export function progressOf(
  milestones: { is_completed: boolean }[],
): ProjectProgress {
  const total = milestones.length;
  const done = milestones.filter((m) => m.is_completed).length;
  const ratio = total > 0 ? done / total : 0;
  return { done, total, ratio, percent: Math.round(ratio * 100) };
}

/** 진행률 막대에 쓸 문구 — 분모 없는 숫자를 만들지 않는다 */
export function progressLabel(progress: ProjectProgress): string {
  return progress.total > 0
    ? `${progress.done}/${progress.total} 마일스톤`
    : "마일스톤 없음";
}

/**
 * 지연 판정 — 종료일이 지났는데 아직 완료가 아닌 것.
 * 취소된 프로젝트는 더 굴리지 않기로 한 것이라 지연으로 세지 않는다.
 */
export function isOverdue(
  project: Pick<Project, "end_date" | "status">,
  today: string,
): boolean {
  if (!project.end_date) return false;
  if (project.status === "completed" || project.status === "cancelled") {
    return false;
  }
  return project.end_date < today;
}

/** 아직 굴러가는 프로젝트인가 (기획중·진행중·보류) */
export function isOpen(status: ProjectStatus): boolean {
  return status !== "completed" && status !== "cancelled";
}

export type DueTone = "overdue" | "soon" | "later" | "done";

export const DUE_TEXT_CLASS: Record<DueTone, string> = {
  // 지연은 danger가 아니라 warn이다 — 일정이 밀린 것이지 규정 위반이 아니다
  overdue: "text-warn-ink",
  soon: "text-info-ink",
  later: "text-muted",
  done: "text-success-ink",
};

export interface DueMeta {
  /** "2026-08-14 (금)" */
  label: string;
  /** "D-14" · "오늘" · "3일 지남" */
  dLabel: string;
  tone: DueTone;
  days: number;
}

export function dueMeta(
  due: string,
  today: string,
  soonDays = MILESTONE_SOON_DAYS,
): DueMeta {
  const days = diffDaysYmd(today, due);
  const label = `${due} (${WEEKDAY_LABELS[weekdayOf(due)]})`;

  if (days < 0) return { label, dLabel: `${-days}일 지남`, tone: "overdue", days };
  if (days === 0) return { label, dLabel: "오늘", tone: "soon", days };
  return {
    label,
    dLabel: `D-${days}`,
    tone: days <= soonDays ? "soon" : "later",
    days,
  };
}

/** "2026-01-05 ~ 2026-06-30" · "2026-01-05 ~ 종료일 미정" · "기간 미정" */
export function periodLabel(
  start: string | null,
  end: string | null,
): string {
  if (start && end) return `${start} ~ ${end}`;
  if (start) return `${start} ~ 종료일 미정`;
  if (end) return `시작일 미정 ~ ${end}`;
  return "기간 미정";
}

/**
 * 기간 안에서 오늘이 어디쯤인지.
 * 시작일·종료일이 둘 다 있어야 그릴 수 있다 — 한쪽만 있으면 분모가 없다.
 */
export function elapsedRatio(
  start: string | null,
  end: string | null,
  today: string,
): { value: number; max: number } | null {
  if (!start || !end) return null;
  const span = diffDaysYmd(start, end);
  if (span <= 0) return null;
  const elapsed = diffDaysYmd(start, today);
  return { value: Math.min(Math.max(elapsed, 0), span), max: span };
}

export interface ProjectSummary {
  total: number;
  byStatus: Record<ProjectStatus, number>;
  /** 아직 굴러가는 것 (기획중·진행중·보류) */
  open: number;
  inProgress: number;
  /** 종료일이 이번 달 안 · 아직 완료가 아닌 것 */
  dueThisMonth: number;
  /** 종료일이 지났는데 완료가 아닌 것 — 목록에서 유일하게 색을 올리는 값(warn) */
  overdue: number;
  /** 굴러가는 프로젝트들의 평균 진행률 (0~100) */
  avgPercent: number;
  /** 평균에 들어간 프로젝트 수 — 분모를 화면에 그대로 노출한다 */
  avgBase: number;
  /** 가장 가까운 종료일 (완료·취소 제외) */
  nextDue: string | null;
}

export function summarizeProjects(
  rows: ProjectListRow[],
  today: string,
): ProjectSummary {
  const byStatus = Object.fromEntries(
    PROJECT_STATUSES.map((status) => [status, 0]),
  ) as Record<ProjectStatus, number>;

  const month = today.slice(0, 7);
  let open = 0;
  let dueThisMonth = 0;
  let overdue = 0;
  let percentSum = 0;
  let avgBase = 0;
  let nextDue: string | null = null;

  for (const row of rows) {
    byStatus[row.status] += 1;
    if (!isOpen(row.status)) continue;

    open += 1;
    percentSum += progressOf(row.milestones).percent;
    avgBase += 1;

    if (!row.end_date) continue;
    if (row.end_date < today) {
      overdue += 1;
      continue;
    }
    if (row.end_date.slice(0, 7) === month) dueThisMonth += 1;
    if (!nextDue || row.end_date < nextDue) nextDue = row.end_date;
  }

  return {
    total: rows.length,
    byStatus,
    open,
    inProgress: byStatus.in_progress,
    dueThisMonth,
    overdue,
    avgPercent: avgBase > 0 ? Math.round(percentSum / avgBase) : 0,
    avgBase,
    nextDue,
  };
}

/** 12.4 MB — 산출물 목록용 */
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
