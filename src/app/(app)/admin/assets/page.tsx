import type { Metadata } from "next";
import { Boxes } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
import { LoanAdminButtons } from "@/features/assets/AssetActions";
import {
  AssetCreateForm,
  AssetStatusSelect,
} from "@/features/assets/AssetCreateForm";
import { getAssets, getLoans } from "@/features/assets/data";
import {
  ASSET_STATUS_LABELS,
  ASSET_STATUS_TONES,
  isOverdue,
  loanStage,
  LOAN_STAGE_LABELS,
  LOAN_STAGE_TONES,
} from "@/features/assets/types";
import { todayYmd } from "@/features/calendar/date";
import { requireSystemAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "자산 관리" };

/**
 * 자산 관리 (스펙 13 · 3.3) — 시스템 관리자 전용
 *
 * 처리할 일(승인 대기·반납 확인 대기)을 맨 위에 따로 뺀다. 전체 이력에 섞어두면
 * 지금 손을 대야 하는 건이 몇 건인지 세어봐야 알 수 있는데, 이 화면에 오는
 * 이유가 정확히 그 처리다.
 */
export default async function AdminAssetsPage() {
  await requireSystemAdmin();
  const today = todayYmd();

  const [{ data: assets, error: assetError }, { data: loans, error: loanError }] =
    await Promise.all([getAssets(), getLoans({ limit: 300 })]);

  const todo = loans.filter((loan) => {
    const stage = loanStage(loan);
    return stage === "requested" || stage === "return_requested";
  });
  const overdue = loans.filter((loan) => isOverdue(loan, today));

  return (
    <>
      <PageHeader
        title="자산 관리"
        meta={
          <>
            <span>자산 {assets.length}대</span>
            <span>대여 이력 {loans.length}건</span>
          </>
        }
      />

      {assetError || loanError ? (
        <Callout tone="danger" title="자산 정보를 불러오지 못했습니다">
          {assetError ?? loanError}
        </Callout>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="처리 대기" value={todo.length} unit="건" />
        <StatCard
          label="대여 중"
          value={assets.filter((a) => a.status === "loaned").length}
          unit="대"
          denominator={assets.length}
          denominatorUnit="대"
        />
        <StatCard
          label="반납 예정일 지남"
          value={overdue.length}
          unit="건"
          thresholds={[{ at: 1, tone: "warning" }]}
          meterValue={overdue.length}
          max={Math.max(loans.length, 1)}
        />
      </div>

      <Card className="mb-4">
        <CardHeader title="자산 등록" />
        <CardBody>
          <AssetCreateForm />
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title="처리 대기"
          description="대여 신청 승인과 반납 확인"
        />
        <CardBody>
          {todo.length === 0 ? (
            <p className="text-label text-muted">처리할 신청이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-line">
              {todo.map((loan) => {
                const stage = loanStage(loan) as "requested" | "return_requested";
                return (
                  <li key={loan.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <Badge tone={LOAN_STAGE_TONES[stage]}>
                      {LOAN_STAGE_LABELS[stage]}
                    </Badge>
                    <span className="text-body-sm font-bold text-ink">
                      {loan.asset_name}
                    </span>
                    <span className="text-label text-muted">
                      {loan.employee_name}
                      {loan.expected_return_date
                        ? ` · ${loan.expected_return_date} 반납 예정`
                        : null}
                    </span>
                    <div className="ml-auto">
                      <LoanAdminButtons
                        loanId={loan.id}
                        stage={stage}
                        expectedReturnDate={loan.expected_return_date}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader title="자산" description="수리중·폐기 표시는 여기서" />
        <CardBody>
          {assets.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="등록된 자산이 없습니다"
              description="위에서 첫 자산을 등록하세요."
              compact
            />
          ) : (
            <ul className="divide-y divide-line">
              {assets.map((asset) => (
                <li key={asset.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <Badge tone={ASSET_STATUS_TONES[asset.status]}>
                    {ASSET_STATUS_LABELS[asset.status]}
                  </Badge>
                  <span className="text-body-sm text-ink">{asset.name}</span>
                  <span className="text-label text-muted">
                    {[asset.asset_type, asset.serial_number].filter(Boolean).join(" · ") ||
                      "—"}
                  </span>
                  {asset.holder_name ? (
                    <span className="text-label text-muted">
                      사용 중 · {asset.holder_name}
                    </span>
                  ) : null}
                  <div className="ml-auto">
                    <AssetStatusSelect assetId={asset.id} status={asset.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="전체 대여 이력" description={`최근 ${loans.length}건`} />
        <CardBody>
          {loans.length === 0 ? (
            <p className="text-label text-muted">대여 이력이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="py-2 text-label font-bold text-muted">자산</th>
                    <th className="py-2 text-label font-bold text-muted">대여자</th>
                    <th className="py-2 text-label font-bold text-muted">상태</th>
                    <th className="py-2 text-label font-bold text-muted">신청</th>
                    <th className="py-2 text-label font-bold text-muted">반납</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.map((loan) => {
                    const stage = loanStage(loan);
                    return (
                      <tr key={loan.id} className="border-b border-line last:border-0">
                        <td className="py-2 text-body-sm text-ink">{loan.asset_name}</td>
                        <td className="py-2 text-label text-muted">
                          {loan.employee_name}
                        </td>
                        <td className="py-2">
                          <Badge tone={LOAN_STAGE_TONES[stage]}>
                            {LOAN_STAGE_LABELS[stage]}
                          </Badge>
                        </td>
                        <td className="py-2 text-label tabular-nums text-muted">
                          {loan.requested_at.slice(0, 10)}
                        </td>
                        <td className="py-2 text-label tabular-nums text-muted">
                          {loan.returned_at?.slice(0, 10) ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
