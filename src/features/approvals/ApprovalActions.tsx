"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleCheckBig, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Textarea } from "@/components/ui/Field";
import {
  completeApprovalDocument,
  processApprovalStep,
} from "@/server/actions/approvals";

/**
 * 문서 상세의 결재 처리 버튼 (스펙 3.4)
 * 현재 단계 담당자에게만 승인/반려가, 관리자에게만 시행완료가 보인다.
 */
export function ApprovalActions({
  documentId,
  canProcess,
  canComplete,
}: {
  documentId: string;
  canProcess: boolean;
  canComplete: boolean;
}) {
  const router = useRouter();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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

  if (!canProcess && !canComplete) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canProcess ? (
          <>
            <Button onClick={approve} disabled={pending}>
              <Check className="size-4" />
              {pending ? "처리 중…" : "승인"}
            </Button>
            <Button
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
          <Button variant="secondary" onClick={complete} disabled={pending}>
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
