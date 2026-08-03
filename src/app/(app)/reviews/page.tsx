import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";
import { getCycles, getMyReviews } from "@/features/reviews/data";
import {
  CYCLE_STATUS_LABELS,
  CYCLE_STATUS_TONES,
  REVIEW_STAGE_LABELS,
  REVIEW_STAGE_TONES,
  reviewStage,
} from "@/features/reviews/types";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "내 평가" };

/**
 * 내 평가 이력 (스펙 12 · 3.1)
 *
 * 목록의 값은 사이클 상태가 아니라 "내가 지금 뭘 해야 하는가"다.
 * 사이클이 진행중이어도 내가 자기평가를 냈으면 나는 기다리는 쪽이고,
 * 안 냈으면 지금 손을 대야 한다 — 그 차이를 상태 칩으로 구분한다.
 */
export default async function ReviewsPage() {
  const me = await requireSessionEmployee();

  const [{ data: cycles, error: cycleError }, { data: reviews, error: reviewError }] =
    await Promise.all([getCycles(), getMyReviews(me.id)]);

  const byCycle = new Map(reviews.map((r) => [r.cycle_id, r]));
  const error = cycleError ?? reviewError;

  return (
    <>
      <PageHeader
        title="내 평가"
        meta={
          <span>
            {cycles.length}개 사이클
            {cycles.length > 0
              ? ` · 진행중 ${cycles.filter((c) => c.status !== "completed").length}개`
              : null}
          </span>
        }
        actions={
          /*
            사이클이 하나도 없으면 팀원 평가로 갈 곳 자체가 없다.
            눌러도 안 되는 버튼을 두는 대신 렌더하지 않는다.
          */
          (me.isManager || me.isSystemAdmin) && cycles.length > 0 ? (
            <LinkButton href={teamHref(cycles)} size="small" variant="secondary">
              <Users className="size-4" />
              팀원 평가
            </LinkButton>
          ) : undefined
        }
      />

      {error ? (
        <Callout tone="danger" title="평가 정보를 불러오지 못했습니다">
          {error}
        </Callout>
      ) : cycles.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="평가 사이클이 없습니다"
          description="시스템 관리자가 사이클을 시작하면 여기에 표시됩니다."
        />
      ) : (
        <ul className="space-y-2">
          {cycles.map((cycle) => {
            const review = byCycle.get(cycle.id) ?? null;
            const stage = reviewStage(review, cycle.status);
            return (
              <li key={cycle.id}>
                <Link
                  href={`/reviews/${cycle.id}`}
                  className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 transition-colors duration-fast ease-standard hover:bg-canvas md:border-0 md:bg-transparent md:hover:bg-subtle"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm font-bold text-ink">
                      {cycle.name}
                    </p>
                    <p className="text-label text-muted">
                      {periodLabel(cycle.start_date, cycle.end_date)}
                    </p>
                  </div>
                  <Badge tone={REVIEW_STAGE_TONES[stage]}>
                    {REVIEW_STAGE_LABELS[stage]}
                  </Badge>
                  <Badge tone={CYCLE_STATUS_TONES[cycle.status]}>
                    {CYCLE_STATUS_LABELS[cycle.status]}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** 팀원 평가는 사이클 하나를 골라 들어간다 — 진행중인 것을 먼저 준다 */
function teamHref(cycles: { id: string; status: string }[]): string {
  const active = cycles.find((c) => c.status !== "completed") ?? cycles[0];
  return active ? `/reviews/${active.id}/team` : "/reviews";
}

function periodLabel(start: string | null, end: string | null): string {
  if (!start && !end) return "기간 미정";
  return `${start ?? "미정"} ~ ${end ?? "미정"}`;
}
