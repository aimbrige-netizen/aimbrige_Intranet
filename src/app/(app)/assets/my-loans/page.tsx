import type { Metadata } from "next";
import { PackageOpen } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/ui/Card";
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
      {/*
        콘텐츠 제목 "내 대여 현황" 20/500 — PageHeader급 밴드 없음(확립 문법).
        종전 헤더 메타(대여 중 n대·지남 n대)는 섹션 제목 줄로 내린다 —
        분모·상태 요약은 표 바로 위에서 말하는 것이 07 문법이다.
      */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title-l text-ink">
          내 대여 현황
        </h1>
        <LinkButton href="/assets" size="small" variant="secondary">
          자산 목록
        </LinkButton>
      </div>

      {error ? (
        <Callout tone="danger" title="대여 내역을 불러오지 못했습니다">
          {error}
        </Callout>
      ) : loans.length === 0 ? (
        /* md+ 흰 시트에서는 빈 상태를 시트에 직접, md 미만은 canvas 위라 카드 면 유지 */
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
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
        </div>
      ) : (
        <section>
          <SectionHeader
            title={`전체 내역 (총${loans.length}건)`}
            description={
              overdue > 0
                ? `대여 중 ${active}대 · 반납 예정일 지남 ${overdue}대`
                : `대여 중 ${active}대`
            }
          />
          {/*
            08 흰 시트: md+에서 .ab-card는 흰 면 위 이중 테두리 — 표를 시트에
            직접 놓고 md 미만만 카드 유지(10-modules2).
          */}
          <div className="ab-card overflow-hidden md:rounded-none md:border-0">
            <table className="ab-table">
            <thead>
              <tr>
                <th>자산</th>
                <th>상태</th>
                <th>신청일</th>
                <th>반납 예정</th>
                <th className="text-right">
                  <span className="sr-only">처리</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((loan) => {
                const stage = loanStage(loan);
                const late = isOverdue(loan, today);
                return (
                  <tr key={loan.id}>
                    <td>
                      <p className="text-body-sm text-ink">{loan.asset_name}</p>
                      {loan.asset_type ? (
                        <p className="text-nano text-muted">{loan.asset_type}</p>
                      ) : null}
                    </td>
                    <td>
                      <Badge tone={LOAN_STAGE_TONES[stage]}>
                        {LOAN_STAGE_LABELS[stage]}
                      </Badge>
                    </td>
                    <td className="text-label tabular-nums text-muted">
                      {loan.requested_at.slice(0, 10)}
                    </td>
                    <td className="text-label tabular-nums">
                      {/*
                        연체는 빨강이 아니라 warn이다. 반납이 늦은 건 챙길 일이지
                        규정 위반으로 몰 일이 아니다(디자인 시스템 원칙 4).
                      */}
                      <span className={late ? "font-bold text-warn-ink" : "text-muted"}>
                        {loan.expected_return_date ?? "—"}
                        {late ? " 지남" : null}
                      </span>
                    </td>
                    <td>
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
        </section>
      )}
    </>
  );
}
