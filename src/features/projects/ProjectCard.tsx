import Link from "next/link";
import { CalendarRange, Users } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Progress";
import { cn } from "@/lib/utils";
import {
  DUE_TEXT_CLASS,
  dueMeta,
  isOpen,
  isOverdue,
  periodLabel,
  progressLabel,
  progressOf,
} from "./format";
import {
  PROJECT_STATUS_BADGE_CLASS,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  type ProjectListRow,
} from "./types";

/** 종료일이 이 안에 들어오면 카드에서 D-표기를 강조한다 */
const DUE_SOON_DAYS = 14;

/**
 * 프로젝트 목록 카드 (스펙 10 · 3.1)
 *
 * 프로젝트명·담당팀·상태 뱃지·진행률 바·기간을 한 장에 담는다.
 * 진행률은 저장된 값이 아니라 완료 마일스톤 수 / 전체 수를 그때그때 센 것이고,
 * 막대 옆에 그 분모를 그대로 노출한다.
 *
 * 훅을 쓰지 않으므로 서버 컴포넌트에서 그대로 렌더된다.
 */
export function ProjectCard({
  project,
  today,
}: {
  project: ProjectListRow;
  today: string;
}) {
  const progress = progressOf(project.milestones ?? []);
  const overdue = isOverdue(project, today);
  const open = isOpen(project.status);
  const due =
    project.end_date && open
      ? dueMeta(project.end_date, today, DUE_SOON_DAYS)
      : null;

  return (
    <Link
      href={`/projects/${project.id}`}
      className={cn(
        "ab-card flex flex-col gap-2 p-4 transition-colors duration-fast ease-standard hover:border-line-strong",
        !open && "bg-subtle",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          tone={PROJECT_STATUS_TONES[project.status]}
          className={PROJECT_STATUS_BADGE_CLASS[project.status]}
        >
          {PROJECT_STATUS_LABELS[project.status]}
        </Badge>
        {/* 지연은 warn이다 — format.ts의 D-표기(DUE_TEXT_CLASS)와 같은 색을 쓴다 */}
        {overdue ? <Badge tone="warn">지연</Badge> : null}
        <span className="ml-auto flex min-w-0 items-center gap-1 text-label text-muted">
          <Users className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{project.team?.name ?? "팀 미지정"}</span>
        </span>
      </div>

      <h3
        className={cn(
          "text-body font-bold leading-snug",
          open ? "text-ink" : "text-muted",
        )}
      >
        {project.name}
      </h3>

      {project.description ? (
        <p className="line-clamp-2 whitespace-pre-line text-caption">
          {project.description}
        </p>
      ) : null}

      <div className="mt-auto space-y-2.5 pt-1">
        {/*
          진행률 게이지는 민트(positive) — 지표 게이지 채움은 민트 잉크라는
          14-ehr 규율(상세 개요 게이지와 같은 축). 상태는 상단 배지가 말한다.
        */}
        <Meter
          value={progress.done}
          max={progress.total || 1}
          tone={progress.total === 0 ? "neutral" : "positive"}
          size="sm"
          label={progressLabel(progress)}
          valueLabel={`${progress.percent}%`}
          aria-label={`${project.name} 진행률 ${progress.done} / ${progress.total}`}
        />

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-label">
          <span className="flex min-w-0 items-center gap-1 text-muted">
            <CalendarRange className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate tabular-nums">
              {periodLabel(project.start_date, project.end_date)}
            </span>
          </span>
          {due ? (
            <span className={cn("shrink-0 font-bold", DUE_TEXT_CLASS[due.tone])}>
              {due.dLabel}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 border-t border-line pt-2 text-label text-muted">
          <Avatar
            name={project.owner?.name ?? "?"}
            src={project.owner?.profile_image_url}
            size="small"
          />
          <span className="truncate">
            {project.owner?.name ?? "담당자 미지정"}
            {project.owner?.position ? ` ${project.owner.position}` : ""}
          </span>
        </div>
      </div>
    </Link>
  );
}
