import type { Metadata } from "next";
import { PackageOpen } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";
import { ReturnRequestButton } from "@/features/assets/AssetActions";
import { getLoans } from "@/features/assets/data";
import {
  isOverdue,
  loanStage,
  LOAN_STAGE_LABELS,
  LOAN_STAGE_TONES,
} from "@/features/assets/types";
import { todayYmd } from "@/features/calendar/date";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "내 대여 현황" };

/**
 * 내 대여 현황 (스펙 13 · 3.2)
 *
 * 끝난 건까지 다 보여준다. 진행 중인 것만 남기면 "예전에 이 노트북 내가
 * 썼었나"를 확인할 데가 없다 — 대여 이력은 그 확인이 본체다.
 * 대신 아직 손이 필요한 건(연체·반납 대기)을 위로 올린다.
 */
export default async function MyLoansPage() {
  const me = await requireSessionEmployee();
  const today = todayYmd();

  const { data: loans, error } = await getLoans({ employeeId: me.id });

  const rank = (stage: string) =>
    stage === "loaned" || stage === "return_requested" || stage === "requested" ? 0 : 1;

  const sorted = [...loans].sort((a, b) => {
    const diff = rank(loanStage(a)) - rank(loanStage(b));
    if (diff !== 0) return diff;
    return b.requested_at.localeCompare(a.requested_at);
  });

  const active = loans.filter((l) => {
    const stage = loanStage(l);
    return stage === "loaned" || stage === "return_requested";
  }).length;
  const overdue = loans.filter((l) => isOverdue(l, today)).length;

  return (
    <>
      <PageHeader
        title="내 대여 현황"
        meta={
          <>
            <span>대여 중 {active}대</span>
            {overdue > 0 ? <span>반납 예정일 지남 {overdue}대</span> : null}
          </>
        }
        actions={
          <LinkButton href="/assets" size="small" variant="secondary">
            자산 목록
          </LinkButton>
        }
      />

      {error ? (
        <Callout tone="danger" title="대여 내역을 불러오지 못했습니다">
          {error}
        </Callout>
      ) : loans.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title="대여 내역이 없습니다"
          description="자산 목록에서 필요한 장비를 신청할 수 있습니다."
          action={
            <LinkButton href="/assets" size="small" variant="secondary">
              자산 목록 열기
            </LinkButton>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-card border border-line">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line bg-subtle text-left">
                <th className="px-4 py-2 text-label font-bold text-muted">자산</th>
                <th className="px-4 py-2 text-label font-bold text-muted">상태</th>
                <th className="px-4 py-2 text-label font-bold text-muted">신청일</th>
                <th className="px-4 py-2 text-label font-bold text-muted">반납 예정</th>
                <th className="px-4 py-2 text-right text-label font-bold text-muted">
                  <span className="sr-only">처리</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((loan) => {
                const stage = loanStage(loan);
                const late = isOverdue(loan, today);
                return (
                  <tr key={loan.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      <p className="text-body-sm text-ink">{loan.asset_name}</p>
                      {loan.asset_type ? (
                        <p className="text-nano text-muted">{loan.asset_type}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={LOAN_STAGE_TONES[stage]}>
                        {LOAN_STAGE_LABELS[stage]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-label tabular-nums text-muted">
                      {loan.requested_at.slice(0, 10)}
                    </td>
                    <td className="px-4 py-2.5 text-label tabular-nums">
                      {/*
                        연체는 빨강이 아니라 warn이다. 반납이 늦은 건 챙길 일이지
                        규정 위반으로 몰 일이 아니다(디자인 시스템 원칙 4).
                      */}
                      <span className={late ? "font-bold text-warn-ink" : "text-muted"}>
                        {loan.expected_return_date ?? "—"}
                        {late ? " 지남" : null}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end">
                        {stage === "loaned" || stage === "return_requested" ? (
                          <ReturnRequestButton
                            loanId={loan.id}
                            alreadyRequested={stage === "return_requested"}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
