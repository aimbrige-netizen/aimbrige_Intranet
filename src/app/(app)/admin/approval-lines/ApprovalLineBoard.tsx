"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, PenLine, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Select } from "@/components/ui/Field";
import { Avatar } from "@/components/ui/Avatar";
import { setFinalApprover, setTeamReview } from "@/server/actions/approvals";
import {
  DOCUMENT_TYPE_META,
  type DocumentType,
} from "@/features/approvals/types";
import { cn } from "@/lib/utils";

export interface ApprovalLineRow {
  documentType: DocumentType;
  approverId: string | null;
  approverName: string | null;
  approverPosition: string | null;
  /** 1차 팀장 검토 사용 여부 */
  useTeamReview: boolean;
}

export interface ApproverOption {
  id: string;
  name: string;
  position: string | null;
}

/**
 * 결재라인 설정.
 *
 * 예전에는 문서유형 한 줄에 "기안자 팀의 팀장 (규칙 고정)"이라는 같은 문장을
 * 유형 수만큼 반복하고 최종 승인자는 이름 텍스트 셀렉트 하나였다.
 * 실제 흐름인 기안 → 1차 검토 → 최종 승인 → 시행완료가 순서로 읽히지 않았다.
 * 지금은 유형마다 4스텝 체인으로 렌더하고, 미지정 스텝은 점선으로 비워 둔다.
 */
export function ApprovalLineBoard({
  rows,
  employees,
  teamsWithoutManager,
}: {
  rows: ApprovalLineRow[];
  employees: ApproverOption[];
  /** 팀장이 지정되지 않은 팀 이름 — 1차 검토를 켜면 그 팀은 건너뛴다 */
  teamsWithoutManager: string[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [savedType, setSavedType] = useState<DocumentType | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const change = (documentType: DocumentType, approverId: string) => {
    setSaving(documentType);
    setMessage(null);
    setSavedType(null);
    startTransition(async () => {
      const result = await setFinalApprover(
        documentType,
        approverId === "" ? null : approverId,
      );
      setSaving(null);
      if (!result.ok) {
        setMessage(result.message ?? "저장하지 못했습니다.");
        return;
      }
      setSavedType(documentType);
      router.refresh();
    });
  };

  const toggleTeamReview = (documentType: DocumentType, enabled: boolean) => {
    setSaving(documentType);
    setMessage(null);
    setSavedType(null);
    startTransition(async () => {
      const result = await setTeamReview(documentType, enabled);
      setSaving(null);
      if (!result.ok) {
        setMessage(result.message ?? "저장하지 못했습니다.");
        return;
      }
      setSavedType(documentType);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader
        title="문서유형별 결재선"
        description="1차 검토는 기안자가 속한 팀의 팀장이 맡습니다. 팀장 배치 전에는 꺼두세요."
        density="compact"
        action={
          message ? (
            <span className="text-label text-danger">{message}</span>
          ) : savedType ? (
            <span className="text-label text-success">
              {DOCUMENT_TYPE_META[savedType].label} 저장됨
            </span>
          ) : null
        }
      />
      <CardBody density="compact" className="!p-0">
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const meta = DOCUMENT_TYPE_META[row.documentType];
            const Icon = meta.icon;
            const busy = saving === row.documentType;

            return (
              <li key={row.documentType} className="px-4 py-3.5">
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  <span className="grid size-7 shrink-0 place-items-center rounded-sm bg-subtle text-muted">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="text-body-sm font-bold text-ink">
                    {meta.label}
                  </span>
                  {row.approverId ? (
                    <Badge tone="success">지정됨</Badge>
                  ) : (
                    <Badge tone="danger">미지정 · 기안 불가</Badge>
                  )}
                  <Badge tone={row.useTeamReview ? "info" : "neutral"}>
                    {row.useTeamReview ? "3단계" : "2단계"}
                  </Badge>

                  <label className="ml-auto flex cursor-pointer items-center gap-2 text-label text-ink">
                    <input
                      type="checkbox"
                      checked={row.useTeamReview}
                      onChange={(e) =>
                        toggleTeamReview(row.documentType, e.target.checked)
                      }
                      disabled={busy}
                      className="size-4 accent-[#ff6f0f]"
                    />
                    1차 팀장 검토
                  </label>
                </div>

                <div className="flex flex-wrap items-stretch gap-1.5">
                  <Step
                    order="1"
                    role="기안"
                    title="기안자"
                    sub="문서를 올린 본인"
                    icon={PenLine}
                  />
                  <Arrow />
                  {row.useTeamReview ? (
                    <>
                      <Step
                        order="2"
                        role="1차 검토"
                        title="기안자 팀의 팀장"
                        sub={
                          teamsWithoutManager.length > 0
                            ? `팀장 미지정 팀은 건너뜀 (${teamsWithoutManager.length}개 팀)`
                            : "팀장이 없으면 건너뜀"
                        }
                        icon={UserCog}
                      />
                      <Arrow />
                    </>
                  ) : null}
                  <div
                    className={cn(
                      "min-w-60 flex-1 rounded-card border px-3 py-2",
                      row.approverId
                        ? "border-line bg-surface"
                        : "border-dashed border-line-strong bg-subtle",
                    )}
                  >
                    <p className="mb-1 flex items-center gap-1.5">
                      <span className="text-nano font-bold text-muted">
                        {row.useTeamReview ? 3 : 2}
                      </span>
                      <span className="text-nano text-muted">최종 승인</span>
                    </p>
                    <div className="flex items-center gap-2">
                      {row.approverName ? (
                        <Avatar name={row.approverName} size="small" />
                      ) : null}
                      <Select
                        aria-label={`${meta.label} 최종 승인자`}
                        value={row.approverId ?? ""}
                        onChange={(e) =>
                          change(row.documentType, e.target.value)
                        }
                        disabled={busy}
                        className="h-8 w-full py-0 text-body-sm"
                      >
                        <option value="">최종 승인자 선택</option>
                        {employees.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.name}
                            {employee.position ? ` (${employee.position})` : ""}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <p className="mt-1 truncate text-nano text-muted">
                      {row.approverName
                        ? `${row.approverName}${row.approverPosition ? ` · ${row.approverPosition}` : ""} 승인 시 시행완료`
                        : "지정 전에는 이 유형을 기안할 수 없습니다"}
                    </p>
                  </div>
                  <Arrow />
                  <Step
                    order={row.useTeamReview ? "4" : "3"}
                    role="완료"
                    title="시행완료"
                    sub={row.approverId ? "승인 즉시 처리" : "지정 후 진행"}
                    icon={Check}
                    muted={!row.approverId}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

function Arrow() {
  return (
    <span className="hidden items-center px-0.5 text-line-strong sm:flex">
      <ArrowRight className="size-4" aria-hidden />
    </span>
  );
}

function Step({
  order,
  role,
  title,
  sub,
  icon: Icon,
  muted,
}: {
  order: string;
  role: string;
  title: string;
  sub: string;
  icon: typeof Check;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-40 rounded-card border border-line px-3 py-2",
        muted ? "bg-subtle" : "bg-surface",
      )}
    >
      <p className="mb-1 flex items-center gap-1.5">
        <span className="text-nano font-bold text-muted">{order}</span>
        <span className="text-nano text-muted">{role}</span>
      </p>
      <p className="flex items-center gap-1.5">
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full",
            muted ? "bg-line text-muted" : "bg-subtle text-muted",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-body-sm text-ink">{title}</span>
          <span className="block truncate text-nano text-muted">{sub}</span>
        </span>
      </p>
    </div>
  );
}
