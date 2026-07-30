import type { Metadata } from "next";
import Link from "next/link";
import { FileCheck, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { AvatarWithName } from "@/components/ui/Avatar";
import { requireSessionEmployee } from "@/lib/auth/session";
import {
  getMyDocuments,
  getMyPendingApprovals,
} from "@/features/approvals/data";
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_TONES,
  DOCUMENT_TYPE_META,
  type DocumentStatus,
} from "@/features/approvals/types";
import { formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "전자결재" };

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "전체" },
  { value: "pending", label: "진행중" },
  { value: "rejected", label: "반려" },
  { value: "approved", label: "승인" },
  { value: "completed", label: "시행완료" },
];

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: { tab?: string; status?: string };
}) {
  const me = await requireSessionEmployee();
  const tab = searchParams.tab === "inbox" && me.isManager ? "inbox" : "mine";
  const status = STATUS_FILTERS.some((f) => f.value === searchParams.status)
    ? (searchParams.status ?? "")
    : "";

  const [myDocs, pending] = await Promise.all([
    tab === "mine" ? getMyDocuments(me.id, status || undefined) : Promise.resolve([]),
    getMyPendingApprovals(me.id),
  ]);

  const linkFor = (params: Record<string, string>) => {
    const search = new URLSearchParams(params);
    const q = search.toString();
    return q ? `/approvals?${q}` : "/approvals";
  };

  return (
    <>
      <PageHeader
        title="전자결재"
        description="특별처리·출장·경비·비품구매·재택근무 문서를 기안하고 결재합니다."
        action={
          <Link href="/approvals/new">
            <Button>
              <Plus className="size-4" />새 기안
            </Button>
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          <Link
            href={linkFor({})}
            className={cn(
              "rounded-md px-3 py-1.5 text-body transition-colors",
              tab === "mine"
                ? "bg-primary text-white"
                : "text-muted hover:bg-canvas hover:text-ink",
            )}
          >
            내가 올린 문서
          </Link>
          {/* 승인 탭은 팀장·관리자에게만 (스펙 3.1) */}
          {me.isManager ? (
            <Link
              href={linkFor({ tab: "inbox" })}
              className={cn(
                "rounded-md px-3 py-1.5 text-body transition-colors",
                tab === "inbox"
                  ? "bg-primary text-white"
                  : "text-muted hover:bg-canvas hover:text-ink",
              )}
            >
              내가 승인할 문서
              {pending.length > 0 ? (
                <span className="ml-1.5 rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">
                  {pending.length}
                </span>
              ) : null}
            </Link>
          ) : null}
        </div>

        {tab === "mine" ? (
          <div className="ml-auto flex flex-wrap gap-1">
            {STATUS_FILTERS.map((filter) => (
              <Link
                key={filter.value}
                href={linkFor(filter.value ? { status: filter.value } : {})}
                className={cn(
                  "rounded-md px-2.5 py-1 text-label transition-colors",
                  status === filter.value
                    ? "bg-primary-light font-medium text-primary"
                    : "text-muted hover:bg-canvas",
                )}
              >
                {filter.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        <CardBody className="p-0">
          {tab === "mine" ? (
            myDocs.length === 0 ? (
              <EmptyState
                icon={FileCheck}
                title="기안한 문서가 없습니다"
                description="우측 상단 '새 기안'으로 문서를 작성할 수 있습니다."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="ab-table min-w-[760px]">
                  <thead>
                    <tr>
                      <th>문서유형</th>
                      <th>제목</th>
                      <th>상태</th>
                      <th>현재 단계</th>
                      <th>기안일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myDocs.map((doc) => (
                      <tr key={doc.id}>
                        <td className="whitespace-nowrap">
                          {DOCUMENT_TYPE_META[doc.document_type].label}
                        </td>
                        <td>
                          <Link
                            href={`/approvals/${doc.id}`}
                            className="text-primary hover:underline"
                          >
                            {doc.title}
                          </Link>
                        </td>
                        <td>
                          <Badge
                            tone={
                              DOCUMENT_STATUS_TONES[doc.status as DocumentStatus]
                            }
                          >
                            {DOCUMENT_STATUS_LABELS[doc.status as DocumentStatus]}
                          </Badge>
                        </td>
                        <td className="text-caption">
                          {doc.status === "pending"
                            ? doc.current_step === 1
                              ? "1차 검토"
                              : "최종 승인"
                            : "-"}
                        </td>
                        <td className="whitespace-nowrap text-muted">
                          {formatDateTime(doc.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : pending.length === 0 ? (
            <EmptyState
              icon={FileCheck}
              title="승인할 문서가 없습니다"
              description="본인 차례인 결재 문서가 생기면 여기에 표시됩니다."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="ab-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>기안자</th>
                    <th>문서유형</th>
                    <th>제목</th>
                    <th>내 단계</th>
                    <th>기안일</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((row) => (
                    <tr key={row.document.id}>
                      <td>
                        <AvatarWithName
                          name={row.document.requester?.name ?? "-"}
                          size="sm"
                        />
                      </td>
                      <td className="whitespace-nowrap">
                        {DOCUMENT_TYPE_META[row.document.document_type].label}
                      </td>
                      <td>
                        <Link
                          href={`/approvals/${row.document.id}`}
                          className="text-primary hover:underline"
                        >
                          {row.document.title}
                        </Link>
                      </td>
                      <td className="text-caption">
                        {row.stepOrder === 1 ? "1차 검토" : "최종 승인"}
                      </td>
                      <td className="whitespace-nowrap text-muted">
                        {formatDateTime(row.document.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
