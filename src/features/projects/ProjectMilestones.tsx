"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Flag, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { SectionHeader } from "@/components/ui/Card";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import {
  addMilestone,
  removeMilestone,
  setMilestoneCompleted,
  updateMilestone,
  type ProjectActionResult,
} from "@/server/actions/projects";
import { toSeoulYmd } from "@/features/calendar/date";
import { cn } from "@/lib/utils";
import { DUE_TEXT_CLASS, dueMeta, progressOf } from "./format";
import type { ProjectMilestone } from "./types";

/**
 * 마일스톤 탭 (스펙 10 · 3.3)
 *
 * 진행률의 분모가 되는 표라 완료 체크가 곧 진행률 갱신이다. 저장된 진행률
 * 컬럼이 없으므로 체크 → 서버 액션 → 재조회 한 번으로 상단 지표까지 같이 맞는다.
 * 체크 반응은 낙관적으로 먼저 보여주고, 실패하면 되돌린다.
 *
 * is_completed와 completed_at은 DB에서 짝으로 묶여 있어(milestones_completed_consistent)
 * 화면 상태도 둘을 함께 움직인다.
 */
interface Draft {
  id: string | null;
  title: string;
  dueDate: string;
}

const EMPTY_DRAFT: Draft = { id: null, title: "", dueDate: "" };

export function ProjectMilestones({
  projectId,
  milestones,
  today,
  canEdit,
}: {
  projectId: string;
  milestones: ProjectMilestone[];
  today: string;
  canEdit: boolean;
}) {
  const router = useRouter();

  const [rows, setRows] = useState<ProjectMilestone[]>(milestones);
  useEffect(() => setRows(milestones), [milestones]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const progress = progressOf(rows);

  const messageOf = (result: ProjectActionResult) =>
    result.message ??
    Object.values(result.fieldErrors ?? {})[0] ??
    "처리하지 못했습니다.";

  const openDraft = (next: Draft) => {
    setFieldErrors({});
    setError(null);
    setDraft(next);
  };

  const toggle = (milestone: ProjectMilestone) => {
    const next = !milestone.is_completed;
    setRows((prev) =>
      prev.map((row) =>
        row.id === milestone.id
          ? {
              ...row,
              is_completed: next,
              completed_at: next ? new Date().toISOString() : null,
            }
          : row,
      ),
    );

    startTransition(async () => {
      const result = await setMilestoneCompleted(milestone.id, projectId, next);
      if (!result.ok) {
        setError(messageOf(result));
        setRows((prev) =>
          prev.map((row) => (row.id === milestone.id ? milestone : row)),
        );
        return;
      }
      setError(null);
      router.refresh();
    });
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;

    const payload = { title: draft.title, dueDate: draft.dueDate };

    startTransition(async () => {
      const result = draft.id
        ? await updateMilestone(draft.id, projectId, payload)
        : await addMilestone(projectId, payload);

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setError(result.fieldErrors ? null : messageOf(result));
        return;
      }
      setFieldErrors({});
      setError(null);
      setDraft(null);
      router.refresh();
    });
  };

  const remove = (milestone: ProjectMilestone) => {
    if (!window.confirm(`"${milestone.title}" 마일스톤을 삭제하시겠습니까?`)) {
      return;
    }
    startTransition(async () => {
      const result = await removeMilestone(milestone.id, projectId);
      if (!result.ok) {
        setError(messageOf(result));
        return;
      }
      setError(null);
      router.refresh();
    });
  };

  return (
    <>
      {error ? (
        <Callout tone="danger" title="처리하지 못했습니다" className="mb-4">
          {error}
        </Callout>
      ) : null}

      {/*
        08 흰 시트: md+에서 .ab-card는 흰 면 위 이중 테두리 — 섹션 제목 +
        표 직접 배치로 해체하고 md 미만만 카드 유지(10-modules2).
      */}
      <section>
        <SectionHeader
          title="마일스톤"
          description={
            progress.total > 0
              ? `${progress.done}/${progress.total} 완료 · 진행률 ${progress.percent}%`
              : "마일스톤을 등록하면 진행률이 계산됩니다"
          }
          action={
            canEdit ? (
              <Button size="small" onClick={() => openDraft(EMPTY_DRAFT)}>
                <Plus className="size-4" />
                마일스톤 추가
              </Button>
            ) : null
          }
        />
        <div className="ab-card md:rounded-none md:border-0">
          <div className="overflow-x-auto">
            <table className="ab-table ab-table--compact min-w-[560px]">
              <thead>
                <tr>
                  <th className="w-10">완료</th>
                  <th>마일스톤</th>
                  <th className="w-44">목표일</th>
                  <th className="w-36">완료일</th>
                  {canEdit ? <th className="w-20"></th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <TableEmptyRow
                    colSpan={canEdit ? 5 : 4}
                    icon={Flag}
                    title="등록된 마일스톤이 없습니다"
                    description="완료한 마일스톤 수 / 전체 수가 곧 이 프로젝트의 진행률입니다."
                    action={
                      canEdit ? (
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => openDraft(EMPTY_DRAFT)}
                        >
                          첫 마일스톤 추가
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  rows.map((milestone) => {
                    const due = milestone.due_date
                      ? dueMeta(milestone.due_date, today)
                      : null;

                    return (
                      <tr key={milestone.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={milestone.is_completed}
                            onChange={() => toggle(milestone)}
                            disabled={!canEdit || pending}
                            aria-label={`${milestone.title} 완료 여부`}
                            className="size-4 shrink-0 accent-primary disabled:opacity-50"
                          />
                        </td>
                        <td>
                          <span
                            className={cn(
                              "text-body-sm",
                              milestone.is_completed
                                ? "text-muted line-through"
                                : "text-ink",
                            )}
                          >
                            {milestone.title}
                          </span>
                        </td>
                        <td className="whitespace-nowrap tabular-nums">
                          {due ? (
                            <span className="flex items-baseline gap-2">
                              <span className="text-ink">{due.label}</span>
                              {/* 완료한 항목의 지난 목표일은 더 이상 챙길 일이 아니다 */}
                              {milestone.is_completed ? null : (
                                <span
                                  className={cn(
                                    "text-label font-bold",
                                    DUE_TEXT_CLASS[due.tone],
                                  )}
                                >
                                  {due.dLabel}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted">목표일 없음</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap tabular-nums text-caption">
                          {milestone.completed_at
                            ? toSeoulYmd(milestone.completed_at)
                            : "-"}
                        </td>
                        {canEdit ? (
                          <td>
                            <span className="flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() =>
                                  openDraft({
                                    id: milestone.id,
                                    title: milestone.title,
                                    dueDate: milestone.due_date ?? "",
                                  })
                                }
                                disabled={pending}
                                aria-label={`${milestone.title} 수정`}
                                title="수정"
                                className="rounded-sm p-1.5 text-muted transition-colors duration-fast ease-standard hover:bg-subtle hover:text-ink disabled:opacity-40"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => remove(milestone)}
                                disabled={pending}
                                aria-label={`${milestone.title} 삭제`}
                                title="삭제"
                                className="rounded-sm p-1.5 text-muted transition-colors duration-fast ease-standard hover:bg-danger-light hover:text-danger disabled:opacity-40"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </span>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? "마일스톤 수정" : "마일스톤 추가"}
        description="제목만 있어도 등록됩니다. 목표일은 나중에 정해도 됩니다."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setDraft(null)}
              disabled={pending}
            >
              취소
            </Button>
            <Button type="submit" form="milestone-form" disabled={pending}>
              {draft?.id ? "저장" : "추가"}
            </Button>
          </>
        }
      >
        <form id="milestone-form" onSubmit={save} className="space-y-4">
          <Field
            label="제목"
            required
            htmlFor="milestone-title"
            error={fieldErrors.title}
          >
            <Input
              id="milestone-title"
              value={draft?.title ?? ""}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, title: e.target.value } : d))
              }
              placeholder="예) 1차 오픈"
              maxLength={120}
              invalid={!!fieldErrors.title}
              disabled={pending}
            />
          </Field>
          <Field
            label="목표일"
            htmlFor="milestone-due"
            error={fieldErrors.dueDate}
            hint="목표일이 있는 마일스톤은 캘린더에도 함께 표시됩니다."
          >
            <Input
              id="milestone-due"
              type="date"
              value={draft?.dueDate ?? ""}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, dueDate: e.target.value } : d))
              }
              invalid={!!fieldErrors.dueDate}
              disabled={pending}
            />
          </Field>
        </form>
      </Modal>
    </>
  );
}
