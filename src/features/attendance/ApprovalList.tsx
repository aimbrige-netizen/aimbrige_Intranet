"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Inbox, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Field, Textarea } from "@/components/ui/Field";
import { AvatarWithName } from "@/components/ui/Avatar";
import { approveRequest, rejectRequest } from "@/server/actions/attendance";
import { REQUEST_STATUS_LABELS, REQUEST_STATUS_TONES } from "./constants";
import { formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { ApprovalItem, ApprovalKind } from "@/types/db";

/** 승인함 (스펙 3.6) */
export function ApprovalList({ items }: { items: ApprovalItem[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [rejecting, setRejecting] = useState<ApprovalItem | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pendingItems = items.filter((i) => i.status === "pending");
  const historyItems = items.filter((i) => i.status !== "pending");
  const shown = tab === "pending" ? pendingItems : historyItems;

  const approve = (item: ApprovalItem) => {
    setError(null);
    startTransition(async () => {
      const result = await approveRequest(item.kind as ApprovalKind, item.id);
      if (!result.ok) {
        window.alert(result.message ?? "승인하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  const submitReject = () => {
    if (!rejecting) return;
    setError(null);
    startTransition(async () => {
      const result = await rejectRequest(
        rejecting.kind as ApprovalKind,
        rejecting.id,
        reason,
      );
      if (!result.ok) {
        setError(
          result.fieldErrors?.rejectionReason ??
            result.message ??
            "반려하지 못했습니다.",
        );
        return;
      }
      setRejecting(null);
      setReason("");
      router.refresh();
    });
  };

  return (
    <>
      <div className="mb-4 inline-flex rounded-card border border-line bg-subtle p-1">
        {(
          [
            ["pending", `대기 ${pendingItems.length}`],
            ["history", `처리 이력 ${historyItems.length}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-sm px-3 py-1.5 text-body-sm transition-colors",
              tab === key
                ? "bg-surface font-bold text-ink"
                : "text-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/*
        08·10 흰 시트 스윕: md+에서 카드 테두리는 흰 면 위 이중선 —
        섹션 제목 + 표 직접 배치, md 미만(회청 canvas)은 카드 면 유지.
      */}
      <section>
        <SectionHeader
          title={tab === "pending" ? "승인 대기" : "처리 이력"}
          description={
            tab === "pending"
              ? "본인이 팀장·부서장으로 지정된 팀원의 신청입니다. 본인 신청은 스스로 승인할 수 없습니다."
              : undefined
          }
        />
        <div className="ab-card md:rounded-none md:border-0">
          {shown.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={
                tab === "pending"
                  ? "승인 대기 중인 신청이 없습니다"
                  : "처리한 이력이 없습니다"
              }
              description={
                tab === "pending"
                  ? "팀원이 연차·초과근무·근태수정을 신청하면 여기에 표시됩니다."
                  : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="ab-table min-w-[860px]">
                <thead>
                  <tr>
                    <th>신청자</th>
                    <th>유형</th>
                    <th>날짜</th>
                    <th>내용</th>
                    <th>사유</th>
                    <th>신청일시</th>
                    <th className="w-40">
                      {tab === "pending" ? "처리" : "상태"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((item) => (
                    <tr key={`${item.kind}-${item.id}`}>
                      <td>
                        <AvatarWithName name={item.employeeName} size="small" />
                      </td>
                      <td>{item.typeLabel}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {item.dateLabel}
                      </td>
                      <td>{item.detailLabel}</td>
                      <td className="max-w-56 truncate text-caption" title={item.reason ?? ""}>
                        {item.status === "rejected" && item.rejectionReason
                          ? `반려: ${item.rejectionReason}`
                          : (item.reason ?? "-")}
                      </td>
                      <td className="whitespace-nowrap text-caption">
                        {formatDateTime(item.createdAt)}
                      </td>
                      <td>
                        {item.status === "pending" ? (
                          <span className="flex gap-1.5">
                            <Button
                              size="small"
                              onClick={() => approve(item)}
                              disabled={pending}
                            >
                              <Check className="size-3" />
                              승인
                            </Button>
                            <Button
                              size="small"
                              variant="secondary"
                              onClick={() => {
                                setRejecting(item);
                                setReason("");
                                setError(null);
                              }}
                              disabled={pending}
                            >
                              <X className="size-3" />
                              반려
                            </Button>
                          </span>
                        ) : (
                          <Badge tone={REQUEST_STATUS_TONES[item.status]}>
                            {REQUEST_STATUS_LABELS[item.status]}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="신청 반려"
        description={
          rejecting
            ? `${rejecting.employeeName} · ${rejecting.typeLabel} (${rejecting.dateLabel})`
            : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setRejecting(null)}
              disabled={pending}
            >
              취소
            </Button>
            <Button variant="danger" onClick={submitReject} disabled={pending}>
              {pending ? "처리 중…" : "반려"}
            </Button>
          </>
        }
      >
        <Field
          label="반려 사유"
          required
          htmlFor="reject-reason"
          error={error}
          hint="신청자에게 그대로 표시됩니다."
        >
          <Textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
            invalid={!!error}
          />
        </Field>
      </Modal>
    </>
  );
}
