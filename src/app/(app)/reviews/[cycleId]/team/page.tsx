import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { SectionHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { GoalApprovalList } from "@/features/reviews/GoalApprovalList";
import { ReviewForm } from "@/features/reviews/ReviewForm";
import {
  getCycle,
  getReview,
  getReviewGoals,
  getTeamStatus,
} from "@/features/reviews/data";
import {
  CYCLE_STATUS_LABELS,
  CYCLE_STATUS_TONES,
  REVIEW_STAGE_LABELS,
  REVIEW_STAGE_TONES,
  reviewStage,
  type ReviewTeamRow,
} from "@/features/reviews/types";
import { requireSessionEmployee } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "팀원 평가" };

/**
 * 팀원 평가 (스펙 12 · 3.3)
 *
 * 왼쪽에 팀원 목록, 오른쪽에 고른 사람의 목표·자기평가·팀장평가.
 * 목록에 단계 칩을 붙인 이유는, 팀장이 매번 한 명씩 열어보지 않고도
 * "지금 내가 손댈 사람"을 골라낼 수 있어야 하기 때문이다.
 *
 * 자기평가를 한 번도 저장하지 않은 팀원도 목록에 남는다(review_team_status가
 * employees 기준 LEFT JOIN이다) — 안 낸 사람이 목록에서 사라지면 정작
 * 확인이 제일 필요한 사람이 안 보인다.
 */
export default async function ReviewTeamPage({
  params,
  searchParams,
}: {
  params: { cycleId: string };
  searchParams: { member?: string };
}) {
  const me = await requireSessionEmployee();
  if (!me.isManager && !me.isSystemAdmin) {
    // 미들웨어 뒤 2차 방어선 — RLS도 막지만 화면 자체를 열지 않는다
    notFound();
  }

  const { data: cycle, error: cycleError } = await getCycle(params.cycleId);
  if (cycleError) {
    return (
      <>
        <div className="mb-5">
          <BackLink href="/reviews" />
          <h1 className="text-[20px] font-medium leading-[30px] text-ink">
            팀원 평가
          </h1>
        </div>
        <Callout tone="danger" title="사이클을 불러오지 못했습니다">
          {cycleError}
        </Callout>
      </>
    );
  }
  if (!cycle) notFound();

  const { data: team, error: teamError } = await getTeamStatus(cycle.id);

  /*
   * 지정한 팀원이 목록에 없으면(권한 밖이거나 퇴사) 첫 번째로 되돌린다.
   * 그대로 두면 아무것도 안 뜨는 화면이 되는데, 그게 "권한이 없어서"인지
   * "아직 안 골라서"인지 구분되지 않는다.
   */
  const selected =
    team.find((row) => row.employee_id === searchParams.member) ?? team[0] ?? null;

  const [{ data: review }, { data: goals }] = selected
    ? await Promise.all([
        getReview(cycle.id, selected.employee_id),
        getReviewGoals(cycle.id, selected.employee_id),
      ])
    : [{ data: null }, { data: [] }];

  return (
    <>
      {/*
        콘텐츠 제목 "팀원 평가" 20/500 — PageHeader급 밴드 없음(확립 문법,
        결재 홈 축). 사이클명·단계 배지·인원은 이 화면의 메타라 제목 아래
        한 줄로 남긴다(평가 작성 화면과 같은 단).
      */}
      <div className="mb-5">
        <BackLink href={`/reviews/${cycle.id}`} />
        <h1 className="text-[20px] font-medium leading-[30px] text-ink">
          팀원 평가
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted">
          <span>{cycle.name}</span>
          <Badge tone={CYCLE_STATUS_TONES[cycle.status]}>
            {CYCLE_STATUS_LABELS[cycle.status]}
          </Badge>
          <span>팀원 {team.length}명</span>
        </div>
      </div>

      {teamError ? (
        <Callout tone="danger" title="팀원 목록을 불러오지 못했습니다">
          {teamError}
        </Callout>
      ) : team.length === 0 ? (
        /* 08 흰 시트: 빈 상태는 시트에 직접, md 미만만 카드 유지(07 문법) */
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <EmptyState
            icon={Users}
            title="담당 팀원이 없습니다"
            description="조직도에서 팀장·부서장으로 지정되면 팀원이 여기에 표시됩니다."
          />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <nav aria-label="팀원 목록">
            <ul className="space-y-1">
              {team.map((row) => (
                <li key={row.employee_id}>
                  <MemberLink
                    cycleId={cycle.id}
                    row={row}
                    cycleStatus={cycle.status}
                    active={row.employee_id === selected?.employee_id}
                  />
                </li>
              ))}
            </ul>
          </nav>

          {selected ? (
            /*
              08 흰 시트: md+에서 .ab-card는 흰 면 위 이중 테두리 — 섹션 제목
              + 직접 배치로 해체하고 md 미만만 카드 유지(10-modules2).
              좌측 팀원 목록의 항목 카드는 유지 — 선택 상태(테두리 색)가
              항목 테두리에 실려 있어 걷으면 "지금 누구인가"가 사라진다.
            */
            <div className="space-y-5">
              <section>
                <SectionHeader
                  title="이번 사이클 목표"
                  description={
                    selected.goals_submitted_at
                      ? `${selected.goals_submitted_at.slice(0, 10)} 제출 · 승인 ${selected.approved_goal_count}/${selected.goal_count}건`
                      : "아직 제출하지 않았습니다."
                  }
                />
                <div className="ab-card px-5 py-4 md:rounded-none md:border-0 md:p-0">
                  <GoalApprovalList goals={goals} />
                </div>
              </section>

              <section>
                <SectionHeader
                  title="자기평가"
                  description={
                    review?.self_submitted_at
                      ? `${review.self_submitted_at.slice(0, 10)} 제출`
                      : "아직 제출하지 않았습니다."
                  }
                />
                <div className="ab-card px-5 py-4 md:rounded-none md:border-0 md:p-0">
                  {/*
                    제출 전 초안은 보여주지 않는다. 쓰다 만 글을 팀장이 먼저 읽으면
                    본인이 정리해서 낼 기회를 잃는다.
                  */}
                  {review?.self_submitted_at ? (
                    <p className="whitespace-pre-wrap text-body-sm text-ink">
                      {review.self_review}
                    </p>
                  ) : (
                    <p className="text-label text-muted">
                      제출 후에 내용을 볼 수 있습니다.
                    </p>
                  )}
                </div>
              </section>

              <section>
                <SectionHeader
                  title="팀장평가"
                  description={`${selected.name} 평가 · 제출하면 이 팀원의 사이클이 완료됩니다.`}
                />
                <div className="ab-card px-5 py-4 md:rounded-none md:border-0 md:p-0">
                  {/* 완료된 사이클은 쓰다가 버려지지 않게 폼 자체를 내린다 */}
                  {cycle.status === "completed" &&
                  !review?.manager_submitted_at ? (
                    <Callout tone="neutral" title="제출 기간이 끝났습니다">
                      이 사이클은 완료되어 팀장평가를 제출할 수 없습니다.
                    </Callout>
                  ) : (
                    <ReviewForm
                      cycleId={cycle.id}
                      targetEmployeeId={selected.employee_id}
                      initialText={review?.manager_review ?? null}
                      submittedAt={review?.manager_submitted_at ?? null}
                      label={`${selected.name} 팀장평가`}
                      placeholder="목표 달성 정도와 판단 근거를 적어 주세요."
                    />
                  )}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

/** 종전 PageHeader backHref 문법 그대로 — 제목 위 한 줄 뒤로가기 */
function BackLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="mb-2 inline-flex items-center gap-1 text-label text-muted transition-colors duration-fast ease-standard hover:text-ink"
    >
      <ChevronLeft className="size-3.5" aria-hidden />
      목록으로
    </Link>
  );
}

function MemberLink({
  cycleId,
  row,
  cycleStatus,
  active,
}: {
  cycleId: string;
  row: ReviewTeamRow;
  cycleStatus: "goal_setting" | "in_progress" | "completed";
  active: boolean;
}) {
  const stage = reviewStage(row, cycleStatus);

  return (
    <Link
      href={`/reviews/${cycleId}/team?member=${encodeURIComponent(row.employee_id)}`}
      aria-current={active ? "true" : undefined}
      className={cn(
        "block rounded-card border px-3 py-2 transition-colors duration-fast ease-standard",
        active
          ? "border-primary bg-primary-light"
          : "border-line bg-surface hover:bg-canvas",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-body-sm font-bold",
            active ? "text-primary" : "text-ink",
          )}
        >
          {row.name}
        </span>
        <Badge tone={REVIEW_STAGE_TONES[stage]}>{REVIEW_STAGE_LABELS[stage]}</Badge>
      </div>
      <p className="truncate text-label text-muted">
        {[row.position, row.team_name].filter(Boolean).join(" · ") || "소속 미지정"}
      </p>
    </Link>
  );
}
