"use client";

import { useState, useTransition } from "react";
import { Check, PackageCheck, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import {
  approveAssetLoan,
  cancelAssetLoan,
  confirmAssetReturn,
  rejectAssetLoan,
  requestAssetLoan,
  requestAssetReturn,
} from "@/server/actions/assets";

/**
 * 자산 대여 관련 버튼들 (스펙 13 · 3.1~3.3)
 *
 * 실패 문구를 버튼 옆에 인라인으로 둔다. 목록에서 여러 자산을 다루는 화면이라
 * 상단에 배너로 띄우면 "어느 줄에서 난 오류인지"를 알 수 없다.
 */
function useAction() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      setMessage(result.ok ? null : (result.message ?? "처리하지 못했습니다."));
    });

  const error = message ? (
    <span className="text-label text-warn-ink">{message}</span>
  ) : null;

  return { run, pending, error };
}

/**
 * 대여 신청 — 반납 예정일을 함께 받는다.
 *
 * 예정일 없이 빌려주면 "언제 돌려받을지"가 아무 데도 안 남아서, 관리자가
 * 연체를 판단할 근거가 사라진다. 그래서 모달로 한 번 받는다.
 */
export function LoanRequestButton({
  assetId,
  assetName,
  pendingLoanId,
}: {
  assetId: string;
  assetName: string;
  /** 이미 내가 신청해둔 건 — 있으면 '신청 취소'로 바뀐다 */
  pendingLoanId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const { run, pending, error } = useAction();

  if (pendingLoanId) {
    return (
      <div className="flex items-center gap-2">
        {error}
        <span className="text-label text-muted">신청함</span>
        <Button
          size="small"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("대여 신청을 취소할까요?")) return;
            run(() => cancelAssetLoan(pendingLoanId));
          }}
        >
          취소
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error}
      <Button size="small" variant="secondary" onClick={() => setOpen(true)}>
        대여 신청
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={`${assetName} 대여 신청`}>
        <div className="space-y-3">
          <div className="space-y-1">
            <label
              className="block text-label font-bold text-ink"
              htmlFor="loan-return-date"
            >
              반납 예정일
            </label>
            <Input
              id="loan-return-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <p className="text-label text-muted">
              관리자가 승인할 때 조정될 수 있습니다.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              닫기
            </Button>
            <Button
              disabled={pending || !date}
              onClick={() =>
                run(async () => {
                  const result = await requestAssetLoan(assetId, date);
                  if (result.ok) setOpen(false);
                  return result;
                })
              }
            >
              신청
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** 내 대여 현황의 "반납 처리" (스펙 3.2) */
export function ReturnRequestButton({
  loanId,
  alreadyRequested,
}: {
  loanId: string;
  alreadyRequested: boolean;
}) {
  const { run, pending, error } = useAction();

  if (alreadyRequested) {
    return <span className="text-label text-muted">관리자 확인 대기</span>;
  }

  return (
    <div className="flex items-center gap-2">
      {error}
      <Button
        size="small"
        variant="secondary"
        disabled={pending}
        onClick={() => run(() => requestAssetReturn(loanId))}
      >
        <Undo2 className="size-3.5" />
        반납 처리
      </Button>
    </div>
  );
}

/** 관리자의 승인·반려·반납확인 (스펙 3.3) */
export function LoanAdminButtons({
  loanId,
  stage,
  expectedReturnDate,
}: {
  loanId: string;
  stage: "requested" | "loaned" | "return_requested";
  expectedReturnDate: string | null;
}) {
  const { run, pending, error } = useAction();

  return (
    <div className="flex items-center justify-end gap-2">
      {error}
      {stage === "requested" ? (
        <>
          <Button
            size="small"
            disabled={pending}
            onClick={() =>
              run(() => approveAssetLoan(loanId, expectedReturnDate ?? undefined))
            }
          >
            <Check className="size-3.5" />
            승인
          </Button>
          <Button
            size="small"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => rejectAssetLoan(loanId))}
          >
            <X className="size-3.5" />
            반려
          </Button>
        </>
      ) : (
        <Button
          size="small"
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => confirmAssetReturn(loanId))}
        >
          <PackageCheck className="size-3.5" />
          반납 확인
        </Button>
      )}
    </div>
  );
}
