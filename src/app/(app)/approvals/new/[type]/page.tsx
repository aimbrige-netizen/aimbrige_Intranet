import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { ApprovalForm } from "@/features/approvals/ApprovalForm";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getLinePreview } from "@/features/approvals/data";
import {
  DOCUMENT_TYPE_META,
  isDocumentType,
} from "@/features/approvals/types";

export const metadata: Metadata = { title: "기안 작성" };

export default async function NewApprovalFormPage({
  params,
}: {
  params: { type: string };
}) {
  const me = await requireSessionEmployee();
  if (!isDocumentType(params.type)) notFound();

  const line = await getLinePreview(me.id, params.type);
  const meta = DOCUMENT_TYPE_META[params.type];

  return (
    <>
      <PageHeader
        title={meta.label}
        description={meta.description}
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
          </>
        }
      />

      <ApprovalForm documentType={params.type} line={line} />
    </>
  );
}
