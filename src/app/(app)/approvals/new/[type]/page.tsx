import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Callout } from "@/components/ui/Callout";
import { ApprovalForm } from "@/features/approvals/ApprovalForm";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getApprovalDocument, getLinePreview } from "@/features/approvals/data";
import {
  DOCUMENT_TYPE_META,
  isDocumentType,
} from "@/features/approvals/types";

export const metadata: Metadata = { title: "기안 작성" };

/**
 * 기안 작성.
 *
 * 세 가지 진입이 같은 폼을 쓴다:
 *   그냥 새로 쓰기         /approvals/new/expense
 *   임시저장 이어 쓰기      /approvals/new/expense?draft={id}
 *   반려 문서 재상신        /approvals/new/expense?from={id}
 *
 * 재상신을 "새 문서 + 프리필"로 만든 이유는 반려된 문서를 그대로 두기 위해서다.
 * 같은 문서를 되살리면 반려 이력이 사라져 왜 한 번 막혔는지 추적할 수 없다.
 */
export default async function NewApprovalFormPage({
  params,
  searchParams,
}: {
  params: { type: string };
  searchParams: { draft?: string; from?: string };
}) {
  const me = await requireSessionEmployee();
  if (!isDocumentType(params.type)) notFound();

  const sourceId = searchParams.draft ?? searchParams.from ?? null;
  const [line, source] = await Promise.all([
    getLinePreview(me.id, params.type),
    sourceId ? getApprovalDocument(sourceId) : Promise.resolve(null),
  ]);

  // 남의 문서나 다른 유형의 문서를 프리필 소스로 쓰지 못하게 막는다
  const usable =
    source &&
    source.requester_id === me.id &&
    source.document_type === params.type
      ? source
      : null;

  const isDraft = !!searchParams.draft && usable?.status === "draft";
  const resubmitFrom =
    !!searchParams.from && usable && usable.status === "rejected"
      ? usable
      : null;

  const meta = DOCUMENT_TYPE_META[params.type];
  const rejectionComment = resubmitFrom?.steps?.find(
    (step) => step.status === "rejected",
  )?.comment;

  return (
    <>
      <PageHeader
        title={meta.label}
        description={meta.description}
        backHref="/approvals"
        backLabel="결재 목록"
        meta={
          <>
            <span>기안자 {me.name}</span>
            <span>·</span>
            <span>{me.department?.name ?? "부서 미지정"}</span>
            {me.position ? (
              <>
                <span>·</span>
                <span>{me.position}</span>
              </>
            ) : null}
            {isDraft ? (
              <>
                <span>·</span>
                <span>임시저장 이어 쓰기</span>
              </>
            ) : null}
          </>
        }
      />

      {resubmitFrom ? (
        <Callout
          tone="warn"
          title="반려된 문서의 내용을 불러왔습니다"
          className="mb-5"
        >
          {rejectionComment
            ? `반려 사유: ${rejectionComment}`
            : "내용을 수정한 뒤 다시 제출하세요. 이전 문서는 반려 상태로 남습니다."}
        </Callout>
      ) : null}

      <ApprovalForm
        documentType={params.type}
        line={line}
        draftId={isDraft ? usable?.id : undefined}
        initial={
          usable
            ? (usable.form_data as Record<string, unknown>)
            : undefined
        }
      />
    </>
  );
}
