"use client";

import { useState, useTransition } from "react";
import { ExternalLink, FileSignature } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getContractFileUrl } from "@/server/actions/ess";

/**
 * 내 계약서 목록 (13-ess.md #econtract).
 *
 * 다우 원본은 테넌트 미설정으로 빈 화면이라, 목록 문법은 급여명세 표 축을
 * 그대로 쓴다 — 계약서명 · 상태(작성중/서명완료/만료) · 체결일 · 파일.
 * 전자서명(모두싸인) 연동은 대기 상태고, 그 사정은 빈 상태 문구가 말한다.
 *
 * 파일 경로는 화면까지 오지 않는다 — hasFile 여부만 받고, 열람 시점에
 * 서버 액션(getContractFileUrl)이 RLS 재판정 + 5분 서명 URL 발급을 한다.
 */

export type ContractStatusModel = "draft" | "signed" | "expired";

export const CONTRACT_STATUS_LABELS: Record<ContractStatusModel, string> = {
  draft: "작성중",
  signed: "서명완료",
  expired: "만료",
};

/*
 * 만료는 오류가 아니라 수명이 다한 기록이라 neutral —
 * 빨강은 실제 거절·위반에만 쓴다(Badge 원칙).
 */
export const CONTRACT_STATUS_TONES: Record<
  ContractStatusModel,
  "neutral" | "success"
> = {
  draft: "neutral",
  signed: "success",
  expired: "neutral",
};

export interface ContractRowModel {
  id: string;
  title: string;
  status: ContractStatusModel;
  /** 체결일(YYYY-MM-DD). 작성중이면 null */
  signedAt: string | null;
  hasFile: boolean;
}

/**
 * 파일 열람 버튼 — 클릭 시 서명 URL을 받아 새 탭으로 연다.
 * /admin/contracts 목록도 같은 버튼을 쓴다(열람 권한 판정은 서버 몫이라 동일).
 */
export function ContractOpenButton({ contractId }: { contractId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = () =>
    startTransition(async () => {
      const result = await getContractFileUrl(contractId);
      if (!result.ok || !result.url) {
        setMessage(result.message ?? "파일을 열지 못했습니다.");
        return;
      }
      setMessage(null);
      // 팝업이 막히면 현재 탭으로라도 연다 — 서명 URL은 5분짜리 일회성이다
      const opened = window.open(result.url, "_blank", "noopener");
      if (!opened) window.location.assign(result.url);
    });

  return (
    <span className="inline-flex items-center gap-2">
      {message ? (
        <span className="text-label text-warn-ink">{message}</span>
      ) : null}
      <Button size="small" variant="secondary" disabled={pending} onClick={open}>
        <ExternalLink className="size-3.5" aria-hidden />
        열람
      </Button>
    </span>
  );
}

export function ContractList({ rows }: { rows: ContractRowModel[] }) {
  if (rows.length === 0) {
    return (
      <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
        <EmptyState
          icon={FileSignature}
          title="등록된 계약서가 없습니다"
          description="전자서명 연동(모두싸인)은 준비 중입니다. 계약이 등록되면 여기에서 열람할 수 있습니다."
        />
      </div>
    );
  }

  return (
    <div className="ab-card overflow-hidden md:rounded-none md:border-0">
      <div className="overflow-x-auto">
        <table className="ab-table min-w-[560px]">
          <thead>
            <tr>
              <th>계약서명</th>
              <th>상태</th>
              <th>체결일</th>
              <th className="text-right">파일</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="max-w-[320px] truncate text-body-sm text-ink">
                  {row.title}
                </td>
                <td>
                  <Badge tone={CONTRACT_STATUS_TONES[row.status]}>
                    {CONTRACT_STATUS_LABELS[row.status]}
                  </Badge>
                </td>
                <td className="whitespace-nowrap text-label tabular-nums text-muted">
                  {row.signedAt ?? "-"}
                </td>
                <td className="text-right">
                  {row.hasFile ? (
                    <ContractOpenButton contractId={row.id} />
                  ) : (
                    <span className="text-label text-muted">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
