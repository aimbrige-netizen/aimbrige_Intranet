"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Callout } from "@/components/ui/Callout";
import {
  createReviewCycle,
  setReviewCycleStatus,
} from "@/server/actions/reviews";
import {
  CYCLE_STATUS_LABELS,
  type CycleStatus,
} from "@/features/reviews/types";

/**
 * 새 사이클 만들기 (스펙 12 · 3.4)
 *
 * 기간을 필수로 두지 않는다. 반기 평가는 "언제부터 언제까지"가 나중에 정해지는
 * 경우가 흔하고, 날짜를 강제하면 임의의 날짜를 넣어두고 잊어버린다.
 * 다만 기간이 없으면 자기평가 참고자료(해당 기간 업무일지)를 기간으로 못 잘라서
 * 최근 것만 보이게 되므로, 그 사실을 힌트로 알린다.
 */
export function CycleCreateForm() {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const result = await createReviewCycle({ name, startDate, endDate });
      if (result.ok) {
        setName("");
        setStartDate("");
        setEndDate("");
        setErrors({});
        setMessage(null);
      } else {
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message ?? null);
      }
    });

  return (
    <div className="space-y-3">
      {message ? (
        <Callout tone="warn" title="사이클을 만들지 못했습니다">
          {message}
        </Callout>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_160px_auto] md:items-end">
        <Field label="사이클 이름" required htmlFor="cycle-name" error={errors.name}>
          <Input
            id="cycle-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="2026 상반기 평가"
            invalid={Boolean(errors.name)}
          />
        </Field>
        <Field label="시작일" htmlFor="cycle-start" error={errors.startDate}>
          <Input
            id="cycle-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            invalid={Boolean(errors.startDate)}
          />
        </Field>
        <Field
          label="종료일"
          htmlFor="cycle-end"
          error={errors.endDate}
          hint="비워두면 참고자료가 기간으로 걸러지지 않습니다."
        >
          <Input
            id="cycle-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            invalid={Boolean(errors.endDate)}
          />
        </Field>
        <Button disabled={pending || !name.trim()} onClick={submit}>
          <CalendarPlus className="size-4" />
          사이클 시작
        </Button>
      </div>
    </div>
  );
}

/**
 * 단계 전환 (스펙 3.4 "목표설정→진행중→완료")
 *
 * 되돌리기도 허용한다. 관리자가 실수로 '완료'를 눌렀을 때 되돌릴 방법이 없으면
 * 그 사이클의 자기평가·팀장평가가 전부 막힌 채로 끝난다.
 */
const NEXT_STATUS: Record<CycleStatus, CycleStatus | null> = {
  goal_setting: "in_progress",
  in_progress: "completed",
  completed: null,
};

const PREV_STATUS: Record<CycleStatus, CycleStatus | null> = {
  goal_setting: null,
  in_progress: "goal_setting",
  completed: "in_progress",
};

export function CycleStatusControl({
  cycleId,
  status,
}: {
  cycleId: string;
  status: CycleStatus;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const next = NEXT_STATUS[status];
  const prev = PREV_STATUS[status];

  const move = (to: CycleStatus) =>
    startTransition(async () => {
      const result = await setReviewCycleStatus(cycleId, to);
      setMessage(result.ok ? null : (result.message ?? "변경하지 못했습니다."));
    });

  return (
    <div className="flex items-center gap-2">
      {/*
        저장 실패는 위반이 아니라 "안 됐다"는 사실이라 warn으로 둔다.
        빨강은 실제 파괴적 동작에만 쓴다(디자인 시스템 원칙 4).
      */}
      {message ? <span className="text-label text-warn-ink">{message}</span> : null}
      {prev ? (
        <Button
          size="small"
          variant="ghost"
          disabled={pending}
          onClick={() => move(prev)}
        >
          {CYCLE_STATUS_LABELS[prev]}(으)로
        </Button>
      ) : null}
      {next ? (
        <Button
          size="small"
          variant="secondary"
          disabled={pending}
          onClick={() => move(next)}
        >
          {CYCLE_STATUS_LABELS[next]}(으)로
          <ChevronRight className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
