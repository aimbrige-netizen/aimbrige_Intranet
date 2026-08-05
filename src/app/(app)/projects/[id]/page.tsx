import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  AlarmClock,
  CalendarRange,
  Flag,
  NotebookPen,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { SectionHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Meter } from "@/components/ui/Progress";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StatCard } from "@/components/ui/StatCard";
import { ProjectAdminBar } from "@/features/projects/ProjectAdminBar";
import { ProjectMilestones } from "@/features/projects/ProjectMilestones";
import { ProjectResultPanel } from "@/features/projects/ProjectResultPanel";
import {
  getOwnerOptions,
  getProject,
  getProjectWorkLogs,
  getTeams,
} from "@/features/projects/data";
import {
  diffDaysYmd,
  dueMeta,
  elapsedRatio,
  isOverdue,
  periodLabel,
  progressLabel,
  progressOf,
} from "@/features/projects/format";
import {
  parseProjectTab,
  PROJECT_STATUS_BADGE_CLASS,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  PROJECT_TABS,
  PROJECT_TAB_LABELS,
  type ProjectWorkLog,
} from "@/features/projects/types";
import { addDaysYmd, todayYmd } from "@/features/calendar/date";
import { requireSessionEmployee } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "프로젝트" };

/** "최근에도 굴러가고 있나"를 보는 창 — 2주면 주 단위 리듬 두 번이 들어온다 */
const WORKLOG_RECENT_DAYS = 14;

/**
 * 프로젝트 상세 (스펙 10 · 3.3)
 *
 * 상단 기본 정보 + 진행률, 그 아래 세 섹션(마일스톤 · 업무일지 · 결과/산출물).
 * 섹션 전환은 본문 안 세그먼티드 컨트롤이 받는다 — 모듈 내부 이동이 아니라
 * 한 문서의 섹션 전환이라 결재 상세의 신청 내역 탭과 같은 성격이고,
 * 상태는 searchParams가 유지해 새로고침·공유에도 살아 있다.
 *
 * 수정 권한은 담당자 또는 시스템 관리자다. 권한이 없으면 조작 UI를 아예
 * 그리지 않는다 — disabled로 남기면 "언젠가 눌릴 버튼"으로 읽힌다.
 */
export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  const me = await requireSessionEmployee();
  const { project, error } = await getProject(params.id);

  if (error) {
    return (
      <>
        <h1 className="mb-5 text-[20px] font-medium leading-[30px] text-ink">
          프로젝트
        </h1>
        <Callout tone="danger" title="프로젝트를 불러오지 못했습니다">
          {error}
        </Callout>
      </>
    );
  }
  if (!project) notFound();

  const today = todayYmd();
  const tab = parseProjectTab(searchParams.tab);
  const canEdit = project.owner_id === me.id || me.isSystemAdmin;

  const [worklog, teams, owners] = await Promise.all([
    getProjectWorkLogs(project.id),
    canEdit ? getTeams() : Promise.resolve([]),
    canEdit ? getOwnerOptions() : Promise.resolve([]),
  ]);

  const progress = progressOf(project.milestones);
  const openMilestones = project.milestones.filter((m) => !m.is_completed);
  const overdueMilestones = openMilestones.filter(
    (m) => m.due_date && m.due_date < today,
  ).length;
  const nextMilestoneDue =
    openMilestones
      .map((m) => m.due_date)
      .filter((due): due is string => !!due && due >= today)
      .sort()[0] ?? null;

  const span = elapsedRatio(project.start_date, project.end_date, today);
  const overdue = isOverdue(project, today);
  const endMeta = project.end_date ? dueMeta(project.end_date, today, 14) : null;

  const writers = new Set(worklog.logs.map((log) => log.employee_id));
  const lastLogDate = worklog.logs[0]?.log_date ?? null;
  const recentSince = addDaysYmd(today, -(WORKLOG_RECENT_DAYS - 1));
  const recentLogs = worklog.logs.filter(
    (log) => log.log_date >= recentSince,
  ).length;

  const tabHref = (value: string) =>
    value === "milestones"
      ? `/projects/${project.id}`
      : `/projects/${project.id}?tab=${value}`;

  return (
    <>
      {/*
        콘텐츠 제목(프로젝트명) 20/500 — PageHeader급 밴드 없음(확립 문법,
        결재 홈 축). 상태 배지·소속·기간은 밴드 장식이 아니라 이 문서의
        메타라 제목 아래 한 줄로 남긴다(게시글 상세와 같은 단).
      */}
      <div className="mb-5">
        <h1 className="text-[20px] font-medium leading-[30px] text-ink">
          {project.name}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted">
          <Badge
            tone={PROJECT_STATUS_TONES[project.status]}
            className={PROJECT_STATUS_BADGE_CLASS[project.status]}
          >
            {PROJECT_STATUS_LABELS[project.status]}
          </Badge>
          {/* 지연은 warn — 목록 카드·D-표기와 같은 색이다 */}
          {overdue ? <Badge tone="warn">지연</Badge> : null}
          <span>{project.team?.name ?? "팀 미지정"}</span>
          <span>·</span>
          <span>{project.owner?.name ?? "담당자 미지정"}</span>
          <span>·</span>
          <span className="tabular-nums">
            {periodLabel(project.start_date, project.end_date)}
          </span>
        </div>
      </div>

      {canEdit ? (
        <ProjectAdminBar
          project={project}
          teams={teams}
          owners={owners}
          canTransferOwner={me.isSystemAdmin}
        />
      ) : null}

      {/*
        요약 밴드 — 숫자마다 분모가 붙는다.
        색 절제(목록 화면과 같은 판단 축): 색을 갖는 값은 목표일 지남(warn)과
        마일스톤 완료(민트 지표 규율 — 완료 건수는 달성 축) 둘뿐이다.
      */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="마일스톤 완료"
          value={progress.done}
          unit="개"
          denominator={progress.total}
          denominatorUnit="개"
          tone="positive"
          icon={Flag}
          max={progress.total || 1}
          meterValue={progress.done}
          state={progress.total === 0 ? "empty" : "ok"}
          sub={
            progress.total === 0
              ? "마일스톤을 등록하면 진행률이 계산됩니다"
              : `진행률 ${progress.percent}% · 남은 ${openMilestones.length}개`
          }
        />
        {/* 이 화면에서 경고색을 올리는 값은 여기 하나다 */}
        <StatCard
          label="목표일 지난 마일스톤"
          value={overdueMilestones}
          unit="개"
          denominator={openMilestones.length}
          denominatorUnit="개"
          tone={overdueMilestones > 0 ? "warning" : "neutral"}
          icon={AlarmClock}
          max={openMilestones.length || 1}
          meterValue={overdueMilestones}
          sub={
            nextMilestoneDue
              ? `다음 목표일 ${nextMilestoneDue.slice(5)} (D-${diffDaysYmd(today, nextMilestoneDue)})`
              : "예정된 목표일 없음"
          }
        />
        <StatCard
          label="기간 경과"
          value={span ? span.value : 0}
          unit="일"
          denominator={span ? span.max : undefined}
          denominatorUnit="일"
          tone="neutral"
          icon={CalendarRange}
          max={span?.max}
          meterValue={span?.value}
          state={span ? "ok" : "empty"}
          sub={
            span
              ? `${periodLabel(project.start_date, project.end_date)}${endMeta ? ` · ${endMeta.dLabel}` : ""}`
              : "시작일과 종료일을 정하면 계산됩니다"
          }
        />
        {/*
          "업무일지 12건"만으로는 이 프로젝트가 지금도 굴러가는지 알 수 없다.
          쌓인 전체를 분모로 두고 최근 2주치를 값으로 올려, 기록이 최근 것인지
          예전에 몰려 있는지가 카드 하나에서 끝나게 한다.
        */}
        <StatCard
          label={`최근 업무일지 (${WORKLOG_RECENT_DAYS}일)`}
          value={recentLogs}
          unit="건"
          denominator={worklog.logs.length}
          denominatorUnit="건"
          tone="neutral"
          icon={NotebookPen}
          max={worklog.logs.length || 1}
          meterValue={recentLogs}
          state={worklog.logs.length === 0 ? "empty" : "ok"}
          sub={
            worklog.logs.length === 0
              ? `산출물 ${project.files.length}건`
              : `작성자 ${writers.size}명 · 최근 ${lastLogDate} · 산출물 ${project.files.length}건`
          }
        />
      </div>

      {/* 기본 정보 — 진행률 막대가 분모를 그대로 노출한다 */}
      {/*
        08 흰 시트: md+에서 .ab-card는 흰 면 위 이중 테두리 —
        섹션 제목 + 직접 배치로 해체하고 md 미만만 카드 유지(10-modules2).
      */}
      <section className="mb-5">
        <SectionHeader
          title="프로젝트 개요"
          description={`등록 ${formatDate(project.created_at)} · 최종 변경 ${formatDate(project.updated_at)}`}
        />
        <div className="ab-card px-4 py-3 md:rounded-none md:border-0 md:p-0">
          {/*
            진행률 게이지는 민트(positive) — 지표 게이지 채움은 민트 잉크라는
            14-ehr 규율(근태 주간누적과 같은 축). 완료/진행중을 게이지 색으로
            가르지 않는다 — 상태는 상단 배지가 이미 말한다.
          */}
          <Meter
            value={progress.done}
            max={progress.total || 1}
            tone={progress.total === 0 ? "neutral" : "positive"}
            size="lg"
            label={progressLabel(progress)}
            valueLabel={`${progress.percent}%`}
            aria-label={`진행률 ${progress.done} / ${progress.total}`}
          />

          {project.description ? (
            <p className="mt-4 whitespace-pre-wrap text-body text-ink">
              {project.description}
            </p>
          ) : null}

          <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-line pt-3 sm:grid-cols-2">
            <MetaRow label="담당팀" value={project.team?.name ?? "팀 미지정"} />
            <MetaRow
              label="담당자"
              value={
                project.owner ? (
                  <span className="flex items-center gap-1.5">
                    <Avatar
                      name={project.owner.name}
                      src={project.owner.profile_image_url}
                      size="small"
                    />
                    <span>
                      {project.owner.name}
                      {project.owner.position
                        ? ` ${project.owner.position}`
                        : ""}
                    </span>
                  </span>
                ) : (
                  "담당자 미지정"
                )
              }
            />
            <MetaRow
              label="기간"
              value={periodLabel(project.start_date, project.end_date)}
              numeric
            />
            <MetaRow
              label="마일스톤"
              value={
                progress.total === 0
                  ? "등록된 마일스톤 없음"
                  : `${progress.done} / ${progress.total}개 완료`
              }
              numeric
            />
          </dl>
        </div>
      </section>

      <div className="mb-4">
        <SegmentedControl
          options={PROJECT_TABS.map((value) => ({
            value,
            label: PROJECT_TAB_LABELS[value],
            href: tabHref(value),
            badge:
              value === "milestones"
                ? progress.total || undefined
                : value === "worklog"
                  ? worklog.logs.length || undefined
                  : project.files.length || undefined,
          }))}
          value={tab}
          ariaLabel="프로젝트 상세 섹션"
        />
      </div>

      {tab === "milestones" ? (
        <ProjectMilestones
          projectId={project.id}
          milestones={project.milestones}
          today={today}
          canEdit={canEdit}
        />
      ) : tab === "worklog" ? (
        <WorklogSection logs={worklog.logs} error={worklog.error} />
      ) : (
        <ProjectResultPanel
          projectId={project.id}
          authUserId={me.auth_user_id}
          resultSummary={project.result_summary}
          files={project.files}
          canEdit={canEdit}
          isCompleted={project.status === "completed"}
        />
      )}
    </>
  );
}

function MetaRow({
  label,
  value,
  numeric,
}: {
  label: string;
  value: React.ReactNode;
  numeric?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-label text-muted">{label}</dt>
      <dd
        className={`min-w-0 truncate text-label text-ink${numeric ? " tabular-nums" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * 업무일지 탭 — 이 프로젝트로 태깅된 기록을 시간순으로 모아 보여준다(읽기전용).
 *
 * work_logs의 RLS가 본인 것 + 팀장이 보는 팀원 것 + 관리자 전체만 통과시키므로,
 * 여기 보이는 건 "보는 사람이 볼 권한이 있는" 기록이다.
 */
function WorklogSection({
  logs,
  error,
}: {
  logs: ProjectWorkLog[];
  error: string | null;
}) {
  if (error) {
    return (
      <Callout tone="danger" title="업무일지를 불러오지 못했습니다">
        {error}
      </Callout>
    );
  }

  return (
    <section>
      <SectionHeader
        title="업무일지"
        description={`${logs.length}건 · 최근 기록부터`}
      />
      <div className="ab-card md:rounded-none md:border-0">
        {logs.length === 0 ? (
          <div className="px-4">
            <EmptyState
              icon={NotebookPen}
              title="이 프로젝트로 태깅된 업무일지가 없습니다"
              description="업무일지를 쓸 때 프로젝트 칸에서 이 프로젝트를 고르면 여기에 시간순으로 쌓입니다."
              action={
                <LinkButton href="/worklog" size="small" variant="secondary">
                  업무일지 쓰기
                </LinkButton>
              }
              compact
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="ab-table ab-table--compact min-w-[560px]">
              <thead>
                <tr>
                  <th className="w-28">날짜</th>
                  <th className="w-40">작성자</th>
                  <th>내용</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap tabular-nums">
                      {log.log_date}
                    </td>
                    <td className="whitespace-nowrap">
                      {log.employee?.name ?? "-"}
                      {log.employee?.position ? (
                        <span className="ml-1 text-caption">
                          {log.employee.position}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-pre-wrap text-body-sm text-ink">
                      {log.content}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
