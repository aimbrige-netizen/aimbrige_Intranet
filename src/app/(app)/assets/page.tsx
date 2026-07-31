import type { Metadata } from "next";
import { Boxes } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
import { LoanRequestButton } from "@/features/assets/AssetActions";
import { getAssets } from "@/features/assets/data";
import {
  ASSET_STATUS_LABELS,
  ASSET_STATUS_TONES,
  type AssetRow,
} from "@/features/assets/types";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "자산" };

/**
 * 자산 목록 (스펙 13 · 3.1)
 *
 * 종류별로 묶어서 보여준다. 노트북과 모니터와 사무용품이 한 표에 섞여 있으면
 * "지금 빌릴 수 있는 노트북이 있나"를 스캔해야 알 수 있다.
 *
 * 대여자 이름은 list_assets() RPC가 준다 — asset_loans는 본인·관리자만 볼 수
 * 있어서 목록에서 조인하면 남의 대여는 이름이 비어 나온다.
 */
export default async function AssetsPage() {
  await requireSessionEmployee();
  const { data: assets, error } = await getAssets();

  const available = assets.filter((a) => a.status === "available").length;
  const loaned = assets.filter((a) => a.status === "loaned").length;
  const maintenance = assets.filter((a) => a.status === "maintenance").length;

  // 종류가 없는 자산은 "기타"로 묶는다 — 빈 제목의 그룹이 생기지 않게
  const groups = new Map<string, AssetRow[]>();
  for (const asset of assets) {
    const key = asset.asset_type?.trim() || "기타";
    groups.set(key, [...(groups.get(key) ?? []), asset]);
  }

  return (
    <>
      <PageHeader
        title="자산"
        meta={<span>전체 {assets.length}대</span>}
      />

      {error ? (
        <Callout tone="danger" title="자산 목록을 불러오지 못했습니다">
          {error}
        </Callout>
      ) : assets.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="등록된 자산이 없습니다"
          description="시스템 관리자가 자산을 등록하면 여기에 표시됩니다."
        />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard
              label="대여 가능"
              value={available}
              unit="대"
              denominator={assets.length}
              denominatorUnit="대"
            />
            <StatCard
              label="대여 중"
              value={loaned}
              unit="대"
              denominator={assets.length}
              denominatorUnit="대"
            />
            <StatCard
              label="수리 중"
              value={maintenance}
              unit="대"
              denominator={assets.length}
              denominatorUnit="대"
            />
          </div>

          <div className="space-y-5">
            {Array.from(groups.entries()).map(([type, rows]) => (
              <section key={type}>
                <h2 className="mb-2 text-body-sm font-bold text-ink">
                  {type}
                  <span className="ml-2 text-label font-normal text-muted">
                    {rows.length}대
                  </span>
                </h2>
                <div className="overflow-hidden rounded-card border border-line">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-line bg-subtle text-left">
                        <th className="px-4 py-2 text-label font-bold text-muted">
                          자산명
                        </th>
                        <th className="px-4 py-2 text-label font-bold text-muted">
                          상태
                        </th>
                        <th className="px-4 py-2 text-label font-bold text-muted">
                          사용자
                        </th>
                        <th className="px-4 py-2 text-right text-label font-bold text-muted">
                          <span className="sr-only">대여</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((asset) => (
                        <tr key={asset.id} className="border-b border-line last:border-0">
                          <td className="px-4 py-2.5">
                            <p className="text-body-sm text-ink">{asset.name}</p>
                            {asset.serial_number ? (
                              <p className="text-nano tabular-nums text-muted">
                                {asset.serial_number}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge tone={ASSET_STATUS_TONES[asset.status]}>
                              {ASSET_STATUS_LABELS[asset.status]}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-label text-muted">
                            {asset.holder_name ? (
                              <>
                                {asset.holder_name}
                                {asset.expected_return_date
                                  ? ` · ${asset.expected_return_date} 반납 예정`
                                  : null}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex justify-end">
                              {/*
                                대여가능이 아니면 버튼을 아예 안 그린다.
                                눌러도 안 되는 버튼을 남겨두면 왜 안 되는지를
                                매번 묻게 된다 — 상태 뱃지가 이미 답이다.
                              */}
                              {asset.status === "available" ||
                              asset.my_pending_loan_id ? (
                                <LoanRequestButton
                                  assetId={asset.id}
                                  assetName={asset.name}
                                  pendingLoanId={asset.my_pending_loan_id}
                                />
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
