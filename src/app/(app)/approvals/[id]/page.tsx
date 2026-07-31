import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AttachmentPanel } from "@/features/approvals/AttachmentPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { ApprovalActions } from "@/features/approvals/ApprovalActions";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getApprovalDocument } from "@/features/approvals/data";
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_TONES,
  DOCUMENT_TYPE_META,
  type ExpenseItem,
} from "@/features/approvals/types";
import { formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "결재 문서" };

/** form_data를 유형별 라벨과 함께 읽기전용으로 표시 (스펙 3.4) */
const FIELD_LABELS: Record<string, string> = {
  title: "제목",
  content: "내용",
  destination: "출장지",
  startDate: "시작일",
  endDate: "종료일",
  purpose: "출장목적",
  estimatedCost: "예상경비",
  reason: "사유",
  itemName: "품목",
  quantity: "수량",
  total: "총액",
};

const MONEY_FIELDS = new Set(["estimatedCost", "total"]);

export default async function ApprovalDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const me = await requireSessionEmployee();
  const doc = await getApprovalDocument(params.id);
  if (!doc) notFound();

  const meta = DOCUMENT_TYPE_META[doc.document_type];
  const currentStep = doc.steps.find((s) => s.step_order === doc.current_step);

  // 지금 내 차례일 때만 승인/반려 노출
  const canProcess =
    doc.status === "pending" &&
    !!currentStep &&
    currentStep.approver_id === me.id &&
    currentStep.status === "pending";

  const canComplete = doc.status === "approved" && me.isSystemAdmin;
  const canAttach = doc.requester_id === me.id && doc.status === "pending";

  const formEntries = Object.entries(doc.form_data ?? {}).filter(
    ([key]) => key !== "items",
  );
  const expenseItems = (doc.form_data?.items as ExpenseItem[] | undefined) ?? [];

  return (
    <>
      <Link
        href="/approvals"
        className="mb-3 inline-flex items-center gap-1 text-label text-primary hover:underline"
      >
        <ChevronLeft className="size-3.5" />
        결재함
      </Link>

      <PageHeader
        title={doc.title}
        description={`${meta.label} · 기안 ${formatDateTime(doc.created_at)}`}
        action={
          <Badge tone={DOCUMENT_STATUS_TONES[doc.status]}>
            {DOCUMENT_STATUS_LABELS[doc.status]}
          </Badge>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="문서 내용" />
            <CardBody className="p-0">
              <div className="ab-form-grid !rounded-none !border-0">
                <div className="ab-form-label">기안자</div>
                <div className="ab-form-field">
                  {doc.requester?.name ?? "-"}
                  {doc.requester?.position ? ` ${doc.requester.position}` : ""}
                </div>

                {formEntries.map(([key, value]) => (
                  <div key={key} className="contents">
                    <div className="ab-form-label">
                      {FIELD_LABELS[key] ?? key}
                    </div>
                    <div className="ab-form-field whitespace-pre-wrap">
                      {value === null || value === undefined || value === ""
                        ? "-"
                        : MONEY_FIELDS.has(key)
                          ? `${Number(value).toLocaleString("ko-KR")}원`
                          : String(value)}
                    </div>
                  </div>
                ))}
              </div>

              {/* 경비청구서는 항목별 표로 (스펙 3.4) */}
              {expenseItems.length > 0 ? (
                <div className="border-t border-line p-5">
                  <p className="mb-2 text-label font-bold text-muted">
                    청구 항목
                  </p>
                  <table className="ab-table">
                    <thead>
                      <tr>
                        <th>항목명</th>
                        <th className="w-40 text-right">금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenseItems.map((item, index) => (
                        <tr key={index}>
                          <td>{item.name}</td>
                          <td className="text-right tabular-nums">
                            {Number(item.amount).toLocaleString("ko-KR")}원
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td className="font-bold text-ink">합계</td>
                        <td className="text-right font-bold tabular-nums text-primary">
                          {expenseItems
                            .reduce((s, i) => s + Number(i.amount || 0), 0)
                            .toLocaleString("ko-KR")}
                          원
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {/* 첨부는 기안자 본인이 진행중 문서에만 추가할 수 있다 (스펙 3.3) */}
          {doc.attachments.length > 0 || canAttach ? (
            <Card>
              <CardHeader title={`첨부파일 ${doc.attachments.length}건`} />
              <CardBody>
                <AttachmentPanel
                  documentId={doc.id}
                  authUserId={me.auth_user_id}
                  attachments={doc.attachments}
                  canUpload={canAttach}
                />
              </CardBody>
            </Card>
          ) : null}

          {canProcess || canComplete ? (
            <Card>
              <CardBody>
                <ApprovalActions
                  documentId={doc.id}
                  canProcess={canProcess}
                  canComplete={canComplete}
                />
              </CardBody>
            </Card>
          ) : null}
        </div>

        {/* 결재 이력 타임라인 (스펙 3.4) */}
        <Card>
          <CardHeader title="결재 이력" />
          <CardBody>
            <ol className="space-y-4">
              <li className="flex gap-3">
                <span
                  className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                  aria-hidden
                />
                <div>
                  <p className="text-body text-ink">기안</p>
                  <p className="text-caption">
                    {doc.requester?.name ?? "-"} ·{" "}
                    {formatDateTime(doc.created_at)}
                  </p>
                </div>
              </li>

              {doc.steps.map((step) => {
                const isCurrent =
                  doc.status === "pending" && step.step_order === doc.current_step;
                return (
                  <li key={step.id} className="flex gap-3">
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        step.status === "approved"
                          ? "bg-success"
                          : step.status === "rejected"
                            ? "bg-danger"
                            : isCurrent
                              ? "bg-warn"
                              : "bg-line-strong",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="text-body text-ink">
                        {step.step_order === 1 ? "1차 검토" : "최종 승인"}
                        {step.status === "approved"
                          ? " · 승인"
                          : step.status === "rejected"
                            ? " · 반려"
                            : isCurrent
                              ? " · 대기중"
                              : ""}
                      </p>
                      <p className="flex items-center gap-1.5 text-caption">
                        {step.approver ? (
                          <>
                            <Avatar name={step.approver.name} size="small" />
                            {step.approver.name}
                            {step.approver.position
                              ? ` ${step.approver.position}`
                              : ""}
                          </>
                        ) : (
                          "담당자 미지정"
                        )}
                      </p>
                      {step.processed_at ? (
                        <p className="text-caption">
                          {formatDateTime(step.processed_at)}
                        </p>
                      ) : null}
                      {step.comment ? (
                        <p
                          className={cn(
                            "mt-1 whitespace-pre-wrap rounded-card px-2.5 py-1.5 text-label",
                            step.status === "rejected"
                              ? "bg-danger-light text-danger-ink"
                              : "bg-canvas text-ink",
                          )}
                        >
                          {step.comment}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}

              {doc.status === "completed" ? (
                <li className="flex gap-3">
                  <span
                    className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                    aria-hidden
                  />
                  <div>
                    <p className="text-body text-ink">시행완료</p>
                    <p className="text-caption">
                      {formatDateTime(doc.updated_at)}
                    </p>
                  </div>
                </li>
              ) : null}
            </ol>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
