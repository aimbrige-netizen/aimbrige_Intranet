import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FolderKanban, NotebookPen, Target, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { LinkButton } from "@/components/ui/Button";
import { GoalEditor } from "@/features/reviews/GoalEditor";
import { ReviewForm } from "@/features/reviews/ReviewForm";
import {
  getCycle,
  getReview,
  getReviewGoals,
  getReviewReference,
} from "@/features/reviews/data";
import {
  CYCLE_STATUS_LABELS,
  CYCLE_STATUS_TONES,
  REVIEW_STAGE_LABELS,
  REVIEW_STAGE_TONES,
  reviewStage,
} from "@/features/reviews/types";
import { GOAL_STATUS_LABELS, type GoalStatus } from "@/features/goals/types";
import { PROJECT_STATUS_LABELS } from "@/features/projects/types";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "평가 작성" };

/**
 * 평가 작성 (스펙 12 · 3.2)
 *
 * 사이클 단계에 따라 화면이 통째로 바뀐다.
 *   goal_setting  목표 등록·제출
 *   in_progress   자기평가 + 참고자료 사이드패널
 *   completed     읽기전용 (내가 낸 것 + 팀장평가)
 *
 * 두 단계를 한 화면에 같이 두지 않는 이유는, 목표설정 기간에 자기평가 칸이
 * 비어 있는 채로 떠 있으면 "지금 저걸 써야 하나"를 매번 판단하게 되기 때문이다.
 * 지금 할 일 하나만 보여준다.
 */
export default async function ReviewCyclePage({
  params,
}: {
  params: { cycleId: string };
}) {
  const me = await requireSessionEmployee();

  const { data: cycle, error: cycleError } = await getCycle(params.cycleId);
  if (cycleError) {
    return (
      <>
        <PageHeader title="평가 작성" />
        <Callout tone="danger" title="사이클을 불러오지 못했습니다">
          {cycleError}
        </Callout>
      </>
    );
  }
  if (!cycle) notFound();

  const [{ data: review }, { data: goals, error: goalError }] = await Promise.all([
    getReview(cycle.id, me.id),
    getReviewGoals(cycle.id, me.id),
  ]);

  const stage = reviewStage(review, cycle.status);
  const isGoalPhase = cycle.status === "goal_setting";

  // 참고자료는 자기평가를 쓸 때만 필요하다 — 목표설정 단계에서 부르면 낭비다
  const reference = isGoalPhase
    ? null
    : await getReviewReference(me.id, cycle.start_date, cycle.end_date);

  return (
    <>
      <PageHeader
        title={cycle.name}
        meta={
          <>
            <span>{periodLabel(cycle.start_date, cycle.end_date)}</span>
            <Badge tone={CYCLE_STATUS_TONES[cycle.status]}>
              {CYCLE_STATUS_LABELS[cycle.status]}
            </Badge>
            <Badge tone={REVIEW_STAGE_TONES[stage]}>
              {REVIEW_STAGE_LABELS[stage]}
            </Badge>
          </>
        }
        actions={
          me.isManager || me.isSystemAdmin ? (
            <LinkButton
              href={`/reviews/${cycle.id}/team`}
              size="small"
              variant="secondary"
            >
              <Users className="size-4" />
              팀원 평가
            </LinkButton>
          ) : undefined
        }
        backHref="/reviews"
      />

      {goalError ? (
        <Callout tone="danger" title="목표를 불러오지 못했습니다">
          {goalError}
        </Callout>
      ) : null}

      {isGoalPhase ? (
        <Card>
          <CardHeader
            title="이번 사이클 목표"
            description="등록한 목표는 제출 후 팀장이 승인합니다."
          />
          <CardBody>
            <GoalEditor
              cycleId={cycle.id}
              goals={goals}
              locked={Boolean(review?.goals_submitted_at)}
              lockReason={
                review?.goals_submitted_at
                  ? `${review.goals_submitted_at.slice(0, 10)}에 제출했습니다.`
                  : undefined
              }
            />
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <Card>
              <CardHeader
                title="목표별 자기평가"
                description={
                  goals.length > 0
                    ? `등록한 목표 ${goals.length}건을 기준으로 작성하세요.`
                    : "이번 사이클에 등록한 목표가 없습니다."
                }
              />
              <CardBody>
                {goals.length > 0 ? (
                  <ol className="mb-4 space-y-1.5 rounded-card border border-line bg-subtle p-3">
                    {goals.map((goal, index) => (
                      <li key={goal.id} className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 text-label tabular-nums text-muted">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 whitespace-pre-wrap text-body-sm text-ink">
                          {goal.content}
                        </span>
                        {goal.approved_at ? <Badge tone="success">승인</Badge> : null}
                      </li>
                    ))}
                  </ol>
                ) : null}

                {/*
                  완료된 사이클에서는 입력 폼을 아예 렌더하지 않는다.
                  서버 액션도 막지만, 다 쓴 다음에 "완료된 사이클입니다"를
                  보게 되면 그 글은 그냥 날아간다.
                */}
                {cycle.status === "completed" && !review?.self_submitted_at ? (
                  <Callout tone="neutral" title="제출 기간이 끝났습니다">
                    이 사이클은 완료되어 자기평가를 제출할 수 없습니다.
                  </Callout>
                ) : (
                  <ReviewForm
                    cycleId={cycle.id}
                    initialText={review?.self_review ?? null}
                    submittedAt={review?.self_submitted_at ?? null}
                    label="자기평가"
                    placeholder="목표별 달성 여부와 그렇게 판단한 근거를 적어 주세요."
                  />
                )}
              </CardBody>
            </Card>

            {/* 팀장평가는 제출된 뒤에만 보인다 — 작성 중인 남의 글을 미리 보여줄 이유가 없다 */}
            {review?.manager_submitted_at ? (
              <Card>
                <CardHeader
                  title="팀장평가"
                  description={`${review.manager_submitted_at.slice(0, 10)} 제출`}
                />
                <CardBody>
                  <p className="whitespace-pre-wrap text-body-sm text-ink">
                    {review.manager_review}
                  </p>
                </CardBody>
              </Card>
            ) : null}
          </div>

          {reference ? <ReferencePanel reference={reference} /> : null}
        </div>
      )}
    </>
  );
}

/**
 * 참고자료 사이드패널 (스펙 3.2 · 5장)
 *
 * 읽기전용이다. 여기서 업무일지를 고칠 수 있게 하면 평가를 쓰다가 과거 기록을
 * 유리하게 손보는 길이 열린다 — 참고자료의 값은 손대지 않은 기록이라는 데 있다.
 */
function ReferencePanel({
  reference,
}: {
  reference: Awaited<ReturnType<typeof getReviewReference>>;
}) {
  return (
    <aside className="space-y-4">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <NotebookPen className="size-4 text-muted" aria-hidden />
              업무일지
            </span>
          }
          description={
            reference.workLogsTruncated
              ? `최근 ${reference.workLogs.length}건만 표시`
              : `${reference.workLogs.length}건`
          }
          density="compact"
        />
        <CardBody density="compact">
          {reference.workLogs.length === 0 ? (
            <p className="text-label text-muted">이 기간에 기록이 없습니다.</p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {reference.workLogs.map((log) => (
                <li key={log.id}>
                  <p className="text-nano tabular-nums text-muted">{log.log_date}</p>
                  <p className="whitespace-pre-wrap text-label text-ink">
                    {log.content}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Target className="size-4 text-muted" aria-hidden />
              상시 목표
            </span>
          }
          description={`${reference.goals.length}건`}
          density="compact"
        />
        <CardBody density="compact">
          {reference.goals.length === 0 ? (
            <p className="text-label text-muted">등록한 목표가 없습니다.</p>
          ) : (
            <ul className="space-y-1.5">
              {reference.goals.map((goal) => (
                <li key={goal.id} className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 truncate text-label text-ink">
                    {goal.title}
                  </span>
                  <span className="shrink-0 text-nano text-muted">
                    {GOAL_STATUS_LABELS[goal.status as GoalStatus] ?? goal.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <FolderKanban className="size-4 text-muted" aria-hidden />
              담당 프로젝트
            </span>
          }
          description={`${reference.projects.length}건`}
          density="compact"
        />
        <CardBody density="compact">
          {reference.projects.length === 0 ? (
            <p className="text-label text-muted">담당한 프로젝트가 없습니다.</p>
          ) : (
            <ul className="space-y-1.5">
              {reference.projects.map((project) => (
                <li key={project.id} className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 truncate text-label text-ink">
                    {project.name}
                  </span>
                  <span className="shrink-0 text-nano text-muted">
                    {PROJECT_STATUS_LABELS[
                      project.status as keyof typeof PROJECT_STATUS_LABELS
                    ] ?? project.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </aside>
  );
}

function periodLabel(start: string | null, end: string | null): string {
  if (!start && !end) return "기간 미정";
  return `${start ?? "미정"} ~ ${end ?? "미정"}`;
}
