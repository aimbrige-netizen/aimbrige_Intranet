"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Target } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Meter } from "@/components/ui/Progress";
import { Modal } from "@/components/ui/Modal";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { FilterChip, TableToolbar } from "@/components/ui/TableToolbar";
import {
  createGoal,
  deleteGoal,
  setGoalStatus,
  updateGoal,
  type GoalActionResult,
} from "@/server/actions/goals";
import { toSeoulYmd } from "@/features/calendar/date";
import { cn } from "@/lib/utils";
import { elapsedRatio, TARGET_TEXT_CLASS, targetMeta } from "./format";
import {
  GOAL_FILTER_LABELS,
  GOAL_STATUS_LABELS,
  GOAL_STATUS_TONES,
  GOAL_STATUSES,
  type Goal,
  type GoalFilter,
  type GoalStatus,
} from "./types";

/**
 * 목표 카드 목록 (스펙 09 · 3.3)
 *
 * OptionCardGrid를 쓰지 않는다 — 저건 "하나를 고르는" 자리이고 여기 카드들은
 * 동시에 존재하는 기록이다. 상태 변경은 카드 안 세그먼티드 컨트롤이 받는다.
 * 별도 상세 라우트를 만들면 목표 하나 완료 처리하는 데 왕복 두 번이 든다.
 *
 * canEdit=false는 팀장이 팀원 목표를 조회 중이라는 뜻이다. 이때는 추가·수정·
 * 상태 변경 컨트롤을 아예 렌더하지 않는다 — 서버 액션이 employee_id=me.id로
 * 막고 있어 눌러도 남의 목표는 바뀌지 않지만, 눌러도 아무 일이 없는 버튼을
 * 띄워 두는 쪽이 더 나쁘다.
 */
interface Draft {
  id: string | null;
  title: string;
  description: string;
  targetDate: string;
}

const EMPTY_DRAFT: Draft = {
  id: null,
  title: "",
  description: "",
  targetDate: "",
};

export function GoalBoard({
  goals,
  today,
  canEdit,
  ownerLabel,
}: {
  goals: Goal[];
  today: string;
  /** 본인 목표를 보고 있으면 true. 팀원 것을 조회 중이면 false */
  canEdit: boolean;
  /** 빈 상태 문구에 쓸 주어 ("아직" / "김대현님은 아직") */
  ownerLabel: string;
}) {
  const router = useRouter();

  const [rows, setRows] = useState<Goal[]>(goals);
  useEffect(() => setRows(goals), [goals]);

  const [filter, setFilter] = useState<GoalFilter>("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const counts: Record<GoalFilter, number> = {
    all: rows.length,
    active: rows.filter((g) => g.status === "active").length,
    completed: rows.filter((g) => g.status === "completed").length,
    dropped: rows.filter((g) => g.status === "dropped").length,
  };

  const shown = filter === "all" ? rows : rows.filter((g) => g.status === filter);

  const messageOf = (result: GoalActionResult) =>
    result.message ??
    Object.values(result.fieldErrors ?? {})[0] ??
    "처리하지 못했습니다.";

  const openDraft = (next: Draft) => {
    setFieldErrors({});
    setError(null);
    setDraft(next);
  };

  const changeStatus = (goal: Goal, status: GoalStatus) => {
    if (goal.status === status) return;
    // 상태와 closed_at은 화면에서도 짝으로 움직인다 (goals_closed_consistent)
    setRows((prev) =>
      prev.map((g) =>
        g.id === goal.id
          ? {
              ...g,
              status,
              closed_at: status === "active" ? null : new Date().toISOString(),
            }
          : g,
      ),
    );
    startTransition(async () => {
      const result = await setGoalStatus(goal.id, status);
      setError(result.ok ? null : messageOf(result));
      router.refresh();
    });
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;

    const payload = {
      title: draft.title,
      description: draft.description,
      targetDate: draft.targetDate,
    };

    startTransition(async () => {
      const result = draft.id
        ? await updateGoal(draft.id, payload)
        : await createGoal(payload);

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

  const remove = () => {
    if (!draft?.id) return;
    if (!window.confirm(`"${draft.title}" 목표를 삭제하시겠습니까?`)) return;
    const id = draft.id;
    startTransition(async () => {
      const result = await deleteGoal(id);
      if (!result.ok) {
        setError(messageOf(result));
        return;
      }
      setError(null);
      setDraft(null);
      router.refresh();
    });
  };

  return (
    <>
      <TableToolbar
        filters={
          <>
            {(["all", ...GOAL_STATUSES] as GoalFilter[]).map((key) => (
              <FilterChip
                key={key}
                active={filter === key}
                count={counts[key]}
                onClick={() => setFilter(key)}
              >
                {GOAL_FILTER_LABELS[key]}
              </FilterChip>
            ))}
          </>
        }
        count={`${shown.length}건 표시`}
        actions={
          canEdit ? (
            // 이 화면의 오렌지 면은 이 '목표 추가' 하나다
            <Button size="small" onClick={() => openDraft(EMPTY_DRAFT)}>
              <Plus className="size-4" />
              목표 추가
            </Button>
          ) : undefined
        }
      />

      {error ? (
        <Callout tone="danger" title="처리하지 못했습니다" className="mb-4">
          {error}
        </Callout>
      ) : null}

      {shown.length === 0 ? (
        /*
          08 흰 시트: md+에서 빈 상태를 카드에 담으면 흰 면 위 이중 테두리 —
          시트에 직접 놓는다(10-modules2). md 미만은 canvas 위 카드 유지.
          (아래 목표 카드 그리드는 유지 — 흰 시트 위 흰 카드끼리는 테두리가
          유일한 경계라 걷으면 칸이 사라진다)
        */
        <div className="ab-card md:rounded-none md:border-0">
          <EmptyState
            icon={Target}
            title={
              rows.length === 0
                ? `${ownerLabel} 등록한 목표가 없습니다`
                : `${GOAL_FILTER_LABELS[filter]} 목표가 없습니다`
            }
            description={
              rows.length > 0
                ? "다른 상태의 목표는 위 필터에서 확인할 수 있습니다."
                : canEdit
                  ? "분기 평가와는 별개로, 언제든 개인 목표를 올려 두고 상태만 바꿔가며 관리합니다."
                  : "팀원의 목표는 조회만 할 수 있습니다."
            }
            action={
              rows.length > 0 ? (
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => setFilter("all")}
                >
                  전체 보기
                </Button>
              ) : canEdit ? (
                /*
                 * 위 툴바에 이미 같은 동작의 오렌지 버튼이 있다. 여기까지
                 * primary로 두면 완전 빈 화면에 진한 오렌지 면이 둘이 된다
                 * (디자인 시스템 0장 원칙1).
                 */
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => openDraft(EMPTY_DRAFT)}
                >
                  목표 추가
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              today={today}
              pending={pending}
              canEdit={canEdit}
              onEdit={() =>
                openDraft({
                  id: goal.id,
                  title: goal.title,
                  description: goal.description ?? "",
                  targetDate: goal.target_date ?? "",
                })
              }
              onStatus={(status) => changeStatus(goal, status)}
            />
          ))}
        </div>
      )}

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? "목표 수정" : "목표 추가"}
        description="제목만 있어도 등록됩니다. 목표일은 나중에 정해도 됩니다."
        footer={
          <>
            {draft?.id ? (
              <Button
                variant="danger"
                onClick={remove}
                disabled={pending}
                className="mr-auto"
              >
                삭제
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => setDraft(null)}
              disabled={pending}
            >
              취소
            </Button>
            <Button type="submit" form="goal-form" disabled={pending}>
              {draft?.id ? "저장" : "등록"}
            </Button>
          </>
        }
      >
        <form id="goal-form" onSubmit={save} className="space-y-4">
          <Field label="제목" required htmlFor="goal-title" error={fieldErrors.title}>
            <Input
              id="goal-title"
              value={draft?.title ?? ""}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, title: e.target.value } : d))
              }
              placeholder="예) 사내 온보딩 문서 정리"
              maxLength={120}
              invalid={!!fieldErrors.title}
              disabled={pending}
            />
          </Field>
          <Field
            label="설명"
            htmlFor="goal-description"
            error={fieldErrors.description}
            hint="무엇을 어디까지 하면 달성인지 적어 두면 나중에 판단하기 쉽습니다."
          >
            <Textarea
              id="goal-description"
              value={draft?.description ?? ""}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, description: e.target.value } : d))
              }
              maxLength={2000}
              invalid={!!fieldErrors.description}
              disabled={pending}
            />
          </Field>
          <Field
            label="목표일"
            htmlFor="goal-target"
            error={fieldErrors.targetDate}
            hint="비워 두면 기한 없는 목표로 남습니다."
          >
            <Input
              id="goal-target"
              type="date"
              value={draft?.targetDate ?? ""}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, targetDate: e.target.value } : d))
              }
              invalid={!!fieldErrors.targetDate}
              disabled={pending}
            />
          </Field>
        </form>
      </Modal>
    </>
  );
}

function GoalCard({
  goal,
  today,
  pending,
  canEdit,
  onEdit,
  onStatus,
}: {
  goal: Goal;
  today: string;
  pending: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onStatus: (status: GoalStatus) => void;
}) {
  const active = goal.status === "active";
  const meta = goal.target_date ? targetMeta(goal.target_date, today) : null;
  const ratio = active ? elapsedRatio(goal, today) : null;

  return (
    <Card className={cn("flex flex-col", !active && "bg-subtle")}>
      <CardBody density="compact" className="flex flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <Badge tone={GOAL_STATUS_TONES[goal.status]}>
            {GOAL_STATUS_LABELS[goal.status]}
          </Badge>
          {canEdit ? (
            <button
              type="button"
              onClick={onEdit}
              disabled={pending}
              aria-label={`${goal.title} 수정`}
              title="수정"
              className="rounded-sm p-1 text-muted transition-colors duration-fast ease-standard hover:bg-line hover:text-ink disabled:opacity-30"
            >
              <Pencil className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        <h3
          className={cn(
            "text-body font-bold leading-snug",
            active ? "text-ink" : "text-muted",
          )}
        >
          {goal.title}
        </h3>

        {goal.description ? (
          <p className="line-clamp-3 whitespace-pre-line text-caption">
            {goal.description}
          </p>
        ) : null}

        <div className="mt-auto space-y-2.5 pt-1">
          {/*
            진행률(%)은 스펙에서 미룬 항목이라, 대신 등록일→목표일 사이에서
            오늘이 어디쯤인지를 그린다. 숫자 하나만 있는 카드를 만들지 않는다.
          */}
          {active && meta && ratio ? (
            <Meter
              value={meta.days < 0 ? ratio.max : ratio.value}
              max={ratio.max}
              tone={meta.tone === "overdue" ? "warning" : "informative"}
              size="sm"
              label={`목표일 ${meta.label}`}
              valueLabel={meta.dLabel}
            />
          ) : (
            <p className="flex items-baseline justify-between gap-2 text-label">
              <span className="text-muted">
                {meta ? `목표일 ${meta.label}` : "목표일 없음"}
              </span>
              {active && meta ? (
                <span className={cn("font-bold", TARGET_TEXT_CLASS[meta.tone])}>
                  {meta.dLabel}
                </span>
              ) : goal.closed_at ? (
                <span className="tabular-nums text-muted">
                  {/* closed_at은 UTC라 그냥 자르면 밤에 닫은 목표가 전날이 된다 */}
                  {GOAL_STATUS_LABELS[goal.status]} {toSeoulYmd(goal.closed_at)}
                </span>
              ) : null}
            </p>
          )}

          {/*
            상태 변경은 낙관적으로 먼저 반영된다. pending 동안 옵션을 disabled로
            만들면 누를 때마다 컨트롤 전체가 회색으로 깜빡인다.
          */}
          {canEdit ? (
            <SegmentedControl
              size="small"
              value={goal.status}
              onChange={onStatus}
              ariaLabel={`${goal.title} 상태`}
              options={GOAL_STATUSES.map((status) => ({
                value: status,
                label: GOAL_STATUS_LABELS[status],
              }))}
            />
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
