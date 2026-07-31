"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Target } from "lucide-react";
import {
  addReviewGoal,
  deleteReviewGoal,
  submitReviewGoals,
  updateReviewGoal,
} from "@/server/actions/reviews";
import type { ReviewGoal } from "@/features/reviews/types";

/**
 * 사이클 목표 작성 (스펙 12 · 3.2 목표설정 단계)
 *
 * 입력줄을 상시 노출한다. 목표는 한 번에 여러 개를 적는 자리라 '추가' 버튼을
 * 누르고 나서 입력창이 나타나는 구조면 항목 수만큼 클릭이 늘어난다.
 *
 * 제출한 뒤에는 편집 UI를 disabled로 두지 않고 아예 렌더하지 않는다.
 * 눌러도 안 되는 버튼은 "왜 안 되지"를 매번 묻게 만든다 — 대신 왜 잠겼는지를
 * 한 줄로 알린다.
 */
export function GoalEditor({
  cycleId,
  goals,
  locked,
  lockReason,
}: {
  cycleId: string;
  goals: ReviewGoal[];
  /** 제출했거나 목표설정 단계가 끝나 더 못 고치는 상태인지 */
  locked: boolean;
  lockReason?: string;
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string; fieldErrors?: Record<string, string> }>, onDone?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        setMessage(null);
        onDone?.();
      } else {
        setMessage(result.message ?? Object.values(result.fieldErrors ?? {})[0] ?? "처리하지 못했습니다.");
      }
    });

  const approvedCount = goals.filter((g) => g.approved_at).length;

  return (
    <div className="space-y-3">
      {message ? (
        <Callout tone="warn" title="처리하지 못했습니다">
          {message}
        </Callout>
      ) : null}

      {locked && lockReason ? (
        <Callout tone="info" title="목표가 확정되었습니다">
          {lockReason}
          {goals.length > 0
            ? ` 승인 ${approvedCount}/${goals.length}건.`
            : null}
        </Callout>
      ) : null}

      {goals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="등록한 목표가 없습니다"
          description={
            locked
              ? "이 사이클에는 목표를 등록하지 않았습니다."
              : "이번 사이클에서 이루려는 것을 한 줄씩 적어 두세요."
          }
          compact
        />
      ) : (
        <ol className="space-y-2">
          {goals.map((goal, index) => (
            <li
              key={goal.id}
              className="rounded-card border border-line bg-surface p-3"
            >
              {editingId === goal.id ? (
                <div className="space-y-2">
                  <Textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={3}
                    aria-label={`목표 ${index + 1} 수정`}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="small"
                      disabled={pending}
                      onClick={() =>
                        run(() => updateReviewGoal(goal.id, editText), () =>
                          setEditingId(null),
                        )
                      }
                    >
                      <Check className="size-3.5" />
                      저장
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setEditingId(null)}
                    >
                      <X className="size-3.5" />
                      취소
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 text-label tabular-nums text-muted">
                    {index + 1}
                  </span>
                  <p className="min-w-0 flex-1 whitespace-pre-wrap text-body-sm text-ink">
                    {goal.content}
                  </p>
                  {goal.approved_at ? (
                    <Badge tone="success">승인</Badge>
                  ) : null}
                  {/*
                    승인된 목표는 수정·삭제 버튼을 숨긴다. 팀장이 승인한 내용과
                    달라지면 승인이 무엇에 대한 승인인지 알 수 없어진다.
                  */}
                  {!locked && !goal.approved_at ? (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="small"
                        variant="ghost"
                        aria-label={`목표 ${index + 1} 수정`}
                        disabled={pending}
                        onClick={() => {
                          setEditingId(goal.id);
                          setEditText(goal.content);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="small"
                        variant="ghost"
                        aria-label={`목표 ${index + 1} 삭제`}
                        disabled={pending}
                        onClick={() => run(() => deleteReviewGoal(goal.id))}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {!locked ? (
        <>
          <div className="flex items-start gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder="이번 사이클 목표를 입력하세요"
              aria-label="새 목표"
              onKeyDown={(e) => {
                // 목표는 여러 줄을 쓸 수 있어야 하므로 Enter는 줄바꿈으로 둔다
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) {
                  e.preventDefault();
                  run(() => addReviewGoal(cycleId, draft), () => setDraft(""));
                }
              }}
            />
            <Button
              className="shrink-0"
              disabled={pending || !draft.trim()}
              onClick={() =>
                run(() => addReviewGoal(cycleId, draft), () => setDraft(""))
              }
            >
              <Plus className="size-4" />
              추가
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <p className="text-label text-muted">
              제출하면 팀장 승인 전까지 수정할 수 없습니다.
            </p>
            <Button
              variant="primary"
              disabled={pending || goals.length === 0}
              onClick={() => run(() => submitReviewGoals(cycleId))}
            >
              <Send className="size-4" />
              목표 제출
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
