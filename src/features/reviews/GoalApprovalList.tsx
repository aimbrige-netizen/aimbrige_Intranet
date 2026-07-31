"use client";

import { useState, useTransition } from "react";
import { Check, RotateCcw, Target } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { setReviewGoalApproval } from "@/server/actions/reviews";
import type { ReviewGoal } from "@/features/reviews/types";

/**
 * 팀원 목표 승인 (스펙 12 · 3.2 "팀장 승인 대기")
 *
 * 승인 취소를 남겨둔다. 승인은 한 번 누르면 그 목표가 잠기는데(본인이 더 이상
 * 수정 못 함), 잘못 누른 것을 되돌릴 방법이 없으면 사이클이 끝날 때까지
 * 틀린 목표가 확정된 채로 남는다.
 */
export function GoalApprovalList({ goals }: { goals: ReviewGoal[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (goals.length === 0) {
    return (
      <EmptyState
        icon={Target}
        title="등록된 목표가 없습니다"
        description="이 팀원은 아직 이번 사이클 목표를 등록하지 않았습니다."
        compact
      />
    );
  }

  const toggle = (goalId: string, approve: boolean) =>
    startTransition(async () => {
      const result = await setReviewGoalApproval(goalId, approve);
      setMessage(result.ok ? null : (result.message ?? "처리하지 못했습니다."));
    });

  return (
    <div className="space-y-2">
      {message ? (
        <Callout tone="warn" title="처리하지 못했습니다">
          {message}
        </Callout>
      ) : null}

      <ol className="space-y-2">
        {goals.map((goal, index) => (
          <li
            key={goal.id}
            className="flex items-start gap-3 rounded-card border border-line bg-surface p-3"
          >
            <span className="mt-0.5 shrink-0 text-label tabular-nums text-muted">
              {index + 1}
            </span>
            <p className="min-w-0 flex-1 whitespace-pre-wrap text-body-sm text-ink">
              {goal.content}
            </p>
            {goal.approved_at ? (
              <>
                <Badge tone="success">승인</Badge>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => toggle(goal.id, false)}
                >
                  <RotateCcw className="size-3.5" />
                  승인 취소
                </Button>
              </>
            ) : (
              <Button
                size="small"
                variant="secondary"
                disabled={pending}
                onClick={() => toggle(goal.id, true)}
              >
                <Check className="size-3.5" />
                승인
              </Button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
