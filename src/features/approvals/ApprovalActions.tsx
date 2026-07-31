"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleCheckBig, RotateCcw, Undo2, X } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Textarea } from "@/components/ui/Field";
import {
  completeApprovalDocument,
  processApprovalStep,
  withdrawApprovalDocument,
} from "@/server/actions/approvals";

/**
 * 문서 상세의 결재 처리 버튼 (스펙 3.4)
 * 현재 단계 담당자에게만 승인/반려가, 관리자에게만 시행완료가 보인다.
 *
 * 상단 고정 액션 바 안에 들어가므로 버튼은 small 규격이다.
 * 예전에는 본문 세 번째 카드 안에 medium 버튼으로 들어 있어서,
 * 문서 내용과 첨부를 지나 스크롤해야 처리 버튼에 닿았다.
 */
export function ApprovalActions({
  documentId,
  documentType,
  canProcess,
  canComplete,
  canWithdraw,
  canResubmit,
}: {
  documentId: string;
  documentType: string;
  canProcess: boolean;
  canComplete: boolean;
  /** 기안자 본인 + 진행중 + 아직 아무도 승인하지 않음 */
  canWithdraw?: boolean;
  /** 기안자 본인 + 반려됨 */
  canResubmit?: boolean;
}) {
  const router = useRouter();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * 상신 회수 — 임시저장으로 되돌린다.
   * 한 단계라도 승인된 뒤에는 DB가 막는다(그 승인 기록이 사라지면 안 되므로).
   */
  const withdraw = () => {
    if (
      !window.confirm(
        "이 문서를 회수할까요? 임시저장으로 돌아가며 수정 후 다시 올릴 수 있습니다.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await withdrawApprovalDocument(documentId);
      if (!result.ok) {
        window.alert(result.message ?? "회수하지 못했습니다.");
        return;
      }
      router.push(`/approvals/new/${documentType}?draft=${documentId}`);
    });
  };

  const approve = () => {
    setError(null);
    startTransition(async () => {
      const result = await processApprovalStep(documentId, true);
      if (!result.ok) {
        window.alert(result.message ?? "승인하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  const reject = () => {
    setError(null);
    startTransition(async () => {
      const result = await processApprovalStep(documentId, false, comment);
      if (!result.ok) {
        setError(
          result.fieldErrors?.comment ?? result.message ?? "반려하지 못했습니다.",
        );
        return;
      }
      setRejectOpen(false);
      setComment("");
      router.refresh();
    });
  };

  const complete = () => {
    if (!window.confirm("시행완료로 처리하시겠습니까? 되돌릴 수 없습니다.")) return;
    startTransition(async () => {
      const result = await completeApprovalDocument(documentId);
      if (!result.ok) {
        window.alert(result.message ?? "처리하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  if (!canProcess && !canComplete && !canWithdraw && !canResubmit) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canResubmit ? (
          <LinkButton
            size="small"
            href={`/approvals/new/${documentType}?source=${documentId}`}
          >
            <RotateCcw className="size-4" />
            수정해서 재상신
          </LinkButton>
        ) : null}

        {canWithdraw ? (
          <Button
            size="small"
            variant="secondary"
            onClick={withdraw}
            disabled={pending}
          >
            <Undo2 className="size-4" />
            상신 회수
          </Button>
        ) : null}

        {canProcess ? (
          <>
            <Button size="small" onClick={approve} disabled={pending}>
              <Check className="size-4" />
              {pending ? "처리 중…" : "승인"}
            </Button>
            <Button
              size="small"
              variant="secondary"
              onClick={() => {
                setRejectOpen(true);
                setComment("");
                setError(null);
              }}
              disabled={pending}
            >
              <X className="size-4" />
              반려
            </Button>
          </>
        ) : null}

        {canComplete ? (
          <Button
            size="small"
            variant="secondary"
            onClick={complete}
            disabled={pending}
          >
            <CircleCheckBig className="size-4" />
            시행완료 처리
          </Button>
        ) : null}
      </div>

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="문서 반려"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setRejectOpen(false)}
              disabled={pending}
            >
              취소
            </Button>
            <Button variant="danger" onClick={reject} disabled={pending}>
              {pending ? "처리 중…" : "반려"}
            </Button>
          </>
        }
      >
        <Field
          label="반려 사유"
          required
          htmlFor="reject-comment"
          error={error}
          hint="기안자에게 그대로 표시됩니다."
        >
          <Textarea
            id="reject-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={pending}
            invalid={!!error}
          />
        </Field>
      </Modal>
    </>
  );
}
