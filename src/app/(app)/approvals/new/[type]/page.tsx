import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
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

  return (
    <>
      <Link
        href="/approvals/new"
        className="mb-3 inline-flex items-center gap-1 text-label text-primary hover:underline"
      >
        <ChevronLeft className="size-3.5" />
        유형 선택
      </Link>

      <PageHeader
        title={DOCUMENT_TYPE_META[params.type].label}
        description={`기안자 ${me.name}${me.position ? ` · ${me.position}` : ""}`}
      />

      <ApprovalForm documentType={params.type} line={line} />
    </>
  );
}
