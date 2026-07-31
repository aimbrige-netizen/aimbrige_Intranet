"use client";

import { useState, useTransition } from "react";
import { Check, CirclePlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Callout } from "@/components/ui/Callout";
import {
  approveWelfareRequest,
  cancelWelfareRequest,
  grantWelfarePoints,
  rejectWelfareRequest,
  requestWelfarePoints,
} from "@/server/actions/assets";
import { formatPoints } from "@/features/assets/types";

/**
 * 복지포인트 사용 신청 (스펙 13 · 3.4)
 *
 * 사용 가능 금액을 버튼 옆이 아니라 입력창 힌트로 보여준다. 금액을 적는
 * 순간에 눈에 들어와야 의미가 있다 — 다 적고 제출한 뒤에 "초과입니다"를
 * 보게 되면 얼마를 줄여야 하는지 다시 계산해야 한다.
 */
export function WelfareRequestButton({
  year,
  available,
}: {
  year: number;
  available: number;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const result = await requestWelfarePoints({
        amount: Number(amount),
        purpose,
        year,
      });
      if (result.ok) {
        setOpen(false);
        setAmount("");
        setPurpose("");
        setErrors({});
        setMessage(null);
      } else {
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message ?? null);
      }
    });

  /*
   * 쓸 수 있는 포인트가 없으면 버튼을 아예 안 그린다.
   * 요약 카드의 "신청 가능 0점"이 이미 이유를 말하고 있어서,
   * 회색 버튼을 남겨두면 눌러보고 왜 안 되는지 다시 찾게 된다.
   */
  if (available <= 0) return null;

  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        <CirclePlus className="size-4" />
        사용 신청
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="복지포인트 사용 신청"
        description={`${year}년 · 사용 가능 ${formatPoints(available)}점`}
      >
        <div className="space-y-3">
          {message ? (
            <Callout tone="warn" title="신청하지 못했습니다">
              {message}
            </Callout>
          ) : null}

          <Field
            label="금액"
            required
            htmlFor="welfare-amount"
            error={errors.amount}
            hint={`사용 가능 ${formatPoints(available)}점`}
          >
            <Input
              id="welfare-amount"
              type="number"
              min={1}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              invalid={Boolean(errors.amount)}
            />
          </Field>

          <Field label="사용 용도" required htmlFor="welfare-purpose" error={errors.purpose}>
            <Textarea
              id="welfare-purpose"
              rows={3}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="예) 도서 구입 — 리팩터링 2판"
              invalid={Boolean(errors.purpose)}
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              닫기
            </Button>
            <Button disabled={pending || !amount || !purpose.trim()} onClick={submit}>
              신청
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function WelfareCancelButton({ requestId }: { requestId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      {message ? <span className="text-label text-warn-ink">{message}</span> : null}
      <Button
        size="small"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await cancelWelfareRequest(requestId);
            setMessage(result.ok ? null : (result.message ?? "취소하지 못했습니다."));
          })
        }
      >
        취소
      </Button>
    </div>
  );
}

/** 관리자 승인·반려 (스펙 3.5) */
export function WelfareAdminButtons({ requestId }: { requestId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      setMessage(result.ok ? null : (result.message ?? "처리하지 못했습니다."));
    });

  return (
    <div className="flex items-center justify-end gap-2">
      {/*
        잔액 부족 같은 실패는 문장 자체가 정보다("잔여 30000, 신청 50000").
        말줄임 없이 그대로 보여준다.
      */}
      {message ? <span className="text-label text-warn-ink">{message}</span> : null}
      <Button size="small" disabled={pending} onClick={() => run(() => approveWelfareRequest(requestId))}>
        <Check className="size-3.5" />
        승인
      </Button>
      <Button
        size="small"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => rejectWelfareRequest(requestId))}
      >
        <X className="size-3.5" />
        반려
      </Button>
    </div>
  );
}

/**
 * 연초 일괄 지급 (스펙 3.5)
 *
 * "몇 명에게 지급됐는지"를 결과로 되돌려 보여준다. 이 버튼은 눌러도 화면이
 * 거의 안 변해서(잔액 테이블은 다른 화면에 있다) 성공했는지 알 수 없고,
 * 그러면 한 번 더 누르게 된다.
 */
export function WelfareGrantForm({ year }: { year: number }) {
  const [points, setPoints] = useState("");
  const [targetYear, setTargetYear] = useState(String(year));
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const result = await grantWelfarePoints(Number(targetYear), Number(points));
      if (result.ok) {
        setMessage(null);
        setDone(`${targetYear}년 ${formatPoints(Number(points))}점을 ${result.granted}명에게 반영했습니다.`);
      } else {
        setDone(null);
        setMessage(
          result.message ?? Object.values(result.fieldErrors ?? {})[0] ?? "지급하지 못했습니다.",
        );
      }
    });

  return (
    <div className="space-y-3">
      {message ? (
        <Callout tone="warn" title="지급하지 못했습니다">
          {message}
        </Callout>
      ) : null}
      {done ? (
        <Callout tone="success" title="반영했습니다">
          {done}
        </Callout>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)_auto] sm:items-end">
        <Field label="연도" htmlFor="grant-year">
          <Input
            id="grant-year"
            type="number"
            min={2000}
            max={2100}
            value={targetYear}
            onChange={(e) => setTargetYear(e.target.value)}
          />
        </Field>
        <Field
          label="1인당 지급 포인트"
          required
          htmlFor="grant-points"
          hint="다시 실행하면 더해지지 않고 이 금액으로 맞춰집니다."
        >
          <Input
            id="grant-points"
            type="number"
            min={0}
            step={1}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
        </Field>
        <Button disabled={pending || !points} onClick={submit}>
          재직자 일괄 지급
        </Button>
      </div>
    </div>
  );
}
