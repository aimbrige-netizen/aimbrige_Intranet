import type { Metadata } from "next";
import { AlarmClock, CalendarClock, FolderKanban, Gauge } from "lucide-react";
import { LinkButton } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { SectionHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { METER_FILL, Meter } from "@/components/ui/Progress";
import { StatCard } from "@/components/ui/StatCard";
import { ProjectCard } from "@/features/projects/ProjectCard";
import { ProjectFilters } from "@/features/projects/ProjectFilters";
import { getProjects, getTeams } from "@/features/projects/data";
import { diffDaysYmd, summarizeProjects } from "@/features/projects/format";
import {
  isProjectStatus,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_METER_TONES,
  type ProjectStatus,
} from "@/features/projects/types";
import { todayYmd } from "@/features/calendar/date";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "프로젝트" };

/**
 * 분포 막대에 실어 보내는 상태 순서.
 *
 * 취소는 조각으로 그리지 않는다 — 중립 톤이 기획중과 겹쳐 두 조각이 한 덩어리로
 * 보이기 때문이다. 대신 채워지지 않은 트랙(bg-line)이 정확히 취소분이 되도록
 * 나머지 넷만 쌓는다. 범례는 그 트랙 색을 그대로 쓴다.
 */
const DISTRIBUTION_ORDER = [
  "completed",
  "in_progress",
  "planning",
  "on_hold",
] as const;

/**
 * 범례 색은 Meter의 채움 색과 정확히 같아야 한다.
 * 문자열을 따로 적으면 Progress.tsx의 FILL이 바뀔 때 조용히 어긋나므로
 * 같은 톤 표(METER_FILL)에서 끌어온다. cancelled만 막대에 쌓이지 않는
 * 트랙 색이라 예외다(DISTRIBUTION_ORDER 참고).
 */
const LEGEND_SWATCH: Record<ProjectStatus, string> = {
  completed: METER_FILL[PROJECT_STATUS_METER_TONES.completed],
  in_progress: METER_FILL[PROJECT_STATUS_METER_TONES.in_progress],
  planning: METER_FILL[PROJECT_STATUS_METER_TONES.planning],
  on_hold: METER_FILL[PROJECT_STATUS_METER_TONES.on_hold],
  cancelled: "bg-line",
};

/**
 * 프로젝트 목록 (스펙 10 · 3.1)
 *
 * 기간 스테퍼가 없다 — 프로젝트는 구간이 아니라 상태로 산다(목표 화면과 같은 이유).
 * 그 자리를 건수 붙은 필터칩과 상태 분포 막대가 대신한다.
 *
 * 진행률은 어디에도 저장하지 않는다. 요약 밴드의 평균 진행률도, 카드의 막대도
 * 완료 마일스톤 수 / 전체 수를 그때그때 센 값이다.
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; team?: string };
}) {
  const me = await requireSessionEmployee();
  const today = todayYmd();

  const q = searchParams.q?.trim() || undefined;
  const [{ rows, error }, teams] = await Promise.all([
    getProjects({ q }),
    getTeams(),
  ]);

  if (error) {
    return (
      <>
        <h1 className="mb-5 text-title-l text-ink">
          프로젝트
        </h1>
        <Callout tone="danger" title="프로젝트를 불러오지 못했습니다">
          {error}
        </Callout>
      </>
    );
  }

  const summary = summarizeProjects(rows, today);

  // 팀 칩의 건수 — 팀 미지정은 빈 문자열 키로 모은다
  const teamCounts = new Map<string, number>();
  for (const row of rows) {
    const key = row.team_id ?? "";
    teamCounts.set(key, (teamCounts.get(key) ?? 0) + 1);
  }

  const status = isProjectStatus(searchParams.status)
    ? searchParams.status
    : undefined;
  const team = searchParams.team?.trim() || undefined;

  const shown = rows.filter((row) => {
    if (status && row.status !== status) return false;
    if (team === "none") return row.team_id === null;
    if (team) return row.team_id === team;
    return true;
  });

  const filtered = !!status || !!team || !!q;
  const canCreate = me.isManager;
  const nextDueDays = summary.nextDue
    ? diffDaysYmd(today, summary.nextDue)
    : null;

  return (
    <>
      {/*
        콘텐츠 제목 "프로젝트" 20/500 — PageHeader급 밴드 없음(확립 문법,
        결재 홈 축). 줄높이 30px은 06 heading-l 실측. 종전 메타(소속·오늘
        날짜·건수)는 걷어낸다 — 건수는 아래 요약 밴드·분포 섹션·필터칩이
        분모까지 들고 말한다.
      */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title-l text-ink">
          프로젝트
        </h1>
        {canCreate ? (
          <LinkButton href="/projects/new">
            <FolderKanban className="size-4" />
            새 프로젝트
          </LinkButton>
        ) : null}
      </div>

      {/*
        요약 밴드 — 숫자마다 분모가 붙는다.
        색 절제(할일·목표 화면과 같은 판단 축): 색을 갖는 값은 지연(warn)과
        평균 진행률(민트 지표 규율) 둘뿐이다 — 진행중은 굴러가는 일이지
        성패 판정이 아니라서 중립이다.
      */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="진행중"
          value={summary.inProgress}
          unit="건"
          denominator={summary.total}
          denominatorUnit="건"
          tone="neutral"
          icon={FolderKanban}
          max={summary.total || 1}
          meterValue={summary.inProgress}
          sub={`기획중 ${summary.byStatus.planning}건 · 보류 ${summary.byStatus.on_hold}건`}
        />
        <StatCard
          label="이번 달 마감"
          value={summary.dueThisMonth}
          unit="건"
          denominator={summary.open}
          denominatorUnit="건"
          tone="neutral"
          icon={CalendarClock}
          max={summary.open || 1}
          meterValue={summary.dueThisMonth}
          sub={
            summary.nextDue
              ? `가장 가까운 종료일 ${summary.nextDue.slice(5)} (D-${nextDueDays})`
              : "예정된 종료일 없음"
          }
        />
        {/*
          이 화면에서 경고색을 올리는 값은 여기 하나다 — 보류·취소는 위반이
          아니다. 지연도 danger가 아니라 warning이다. 종료일이 밀린 건 챙길
          일이지 규정 위반이 아니고, 할일·목표·마일스톤의 '기한 지남'이 전부
          warning이라 같은 뜻에 두 색을 쓰면 어느 쪽이 더 급한지 잘못 읽힌다.
        */}
        <StatCard
          label="지연"
          value={summary.overdue}
          unit="건"
          denominator={summary.open}
          denominatorUnit="건"
          tone={summary.overdue > 0 ? "warning" : "neutral"}
          icon={AlarmClock}
          max={summary.open || 1}
          meterValue={summary.overdue}
          sub={
            summary.overdue > 0
              ? "종료일을 다시 잡거나 완료·보류로 정리하세요"
              : "종료일을 넘긴 프로젝트 없음"
          }
        />
        <StatCard
          label="평균 진행률"
          value={summary.avgPercent}
          unit="%"
          tone="positive"
          icon={Gauge}
          max={100}
          meterValue={summary.avgPercent}
          scale
          scaleMaxLabel="100%"
          state={summary.avgBase === 0 ? "empty" : "ok"}
          sub={
            summary.avgBase === 0
              ? "굴러가는 프로젝트가 생기면 계산됩니다"
              : `진행 중인 ${summary.avgBase}건의 마일스톤 완료 비율`
          }
        />
      </div>

      {/* 카드 목록만으로는 다섯 상태의 비중이 보이지 않는다 */}
      {/*
        08 흰 시트: md+에서 .ab-card는 흰 면 위 이중 테두리 —
        섹션 제목 + 직접 배치로 해체하고 md 미만만 카드 유지(10-modules2).
      */}
      {summary.total > 0 ? (
        <section className="mb-5">
          <SectionHeader
            title="상태 분포"
            description={`전체 ${summary.total}건`}
          />
          <div className="ab-card px-4 py-3 md:rounded-none md:border-0 md:p-0">
            <Meter
              max={summary.total}
              segments={DISTRIBUTION_ORDER.map((value) => ({
                value: summary.byStatus[value],
                tone: PROJECT_STATUS_METER_TONES[value],
                label: PROJECT_STATUS_LABELS[value],
              }))}
              valueLabel={`완료 ${summary.byStatus.completed} / ${summary.total}건`}
              size="lg"
            />
            {/* 범례 순서는 막대에 쌓인 순서와 같아야 한다 (취소는 빈 트랙) */}
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
              {[...DISTRIBUTION_ORDER, "cancelled" as const].map((value) => (
                <Legend
                  key={value}
                  swatch={LEGEND_SWATCH[value]}
                  label={PROJECT_STATUS_LABELS[value]}
                  count={summary.byStatus[value]}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <ProjectFilters
        params={{ q, status, team }}
        teams={teams}
        statusCounts={summary.byStatus}
        teamCounts={teamCounts}
        total={summary.total}
        shown={shown.length}
      />

      {shown.length === 0 ? (
        /*
          빈 상태도 흰 시트 직접 배치. 아래 프로젝트 카드 그리드는 유지 —
          흰 시트 위 흰 카드끼리는 테두리가 유일한 경계다.
        */
        <div className="ab-card md:rounded-none md:border-0">
          <EmptyState
            icon={FolderKanban}
            title={
              filtered
                ? "조건에 맞는 프로젝트가 없습니다"
                : "아직 등록된 프로젝트가 없습니다"
            }
            description={
              filtered
                ? "다른 상태·팀의 프로젝트는 위 필터에서 확인할 수 있습니다."
                : "프로젝트를 등록하면 마일스톤 진행률과 업무일지가 여기에 모입니다."
            }
            action={
              filtered ? (
                <LinkButton href="/projects" size="small" variant="secondary">
                  전체 보기
                </LinkButton>
              ) : canCreate ? (
                <LinkButton href="/projects/new" size="small">
                  새 프로젝트
                </LinkButton>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((project) => (
            <ProjectCard key={project.id} project={project} today={today} />
          ))}
        </div>
      )}
    </>
  );
}

function Legend({
  swatch,
  label,
  count,
}: {
  swatch: string;
  label: string;
  count: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-label text-muted">
      <span className={`size-2 rounded-sm ${swatch}`} aria-hidden />
      {label}
      <span className="tabular-nums text-ink">{count}</span>
    </span>
  );
}
