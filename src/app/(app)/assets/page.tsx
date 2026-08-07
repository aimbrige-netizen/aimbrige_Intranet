import type { Metadata } from "next";
import { Boxes } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/ui/Card";
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
      {/*
        콘텐츠 제목 "자산" 20/500 — PageHeader급 밴드 없음(확립 문법).
        줄높이 30px은 06 heading-l 실측. 종전 메타(전체 n대)는 걷어낸다 —
        전체 대수는 요약 카드 분모와 종류별 섹션 제목이 이미 들고 말한다.
      */}
      <h1 className="mb-5 text-title-l text-ink">
        자산
      </h1>

      {error ? (
        <Callout tone="danger" title="자산 목록을 불러오지 못했습니다">
          {error}
        </Callout>
      ) : assets.length === 0 ? (
        /* md+ 흰 시트에서는 빈 상태를 시트에 직접, md 미만은 canvas 위라 카드 면 유지 */
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <EmptyState
            icon={Boxes}
            title="등록된 자산이 없습니다"
            description="시스템 관리자가 자산을 등록하면 여기에 표시됩니다."
          />
        </div>
      ) : (
        <>
          {/*
            민트 규율(14-ehr) — 총계·경과 상태는 먹색, "지금 살아 있는 값"만
            민트다. 이 화면에서 그 값은 대여 가능 대수 하나뿐이다. 대여 중·
            수리 중은 위반이 아니라 경과 상태라 중립으로 둔다(색 절제).
          */}
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard
              label="대여 가능"
              value={available}
              unit="대"
              denominator={assets.length}
              denominatorUnit="대"
              tone="positive"
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
            {/*
              08 흰 시트: md+에서 .ab-card는 흰 면 위 이중 테두리 —
              섹션 제목 아래 표를 시트에 직접 놓고 md 미만만 카드 유지
              (10-modules2 "섹션 제목 + 표 반복" 문법).
            */}
            {Array.from(groups.entries()).map(([type, rows]) => (
              <section key={type}>
                {/* 섹션 제목 14/600 공통 단 — 분모는 제목이 든다(07·16 문법) */}
                <SectionHeader title={`${type} (총${rows.length}대)`} />
                <div className="ab-card overflow-hidden md:rounded-none md:border-0">
                  <table className="ab-table">
                    <thead>
                      <tr>
                        <th>자산명</th>
                        <th>상태</th>
                        <th>사용자</th>
                        <th className="text-right">
                          <span className="sr-only">대여</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((asset) => (
                        <tr key={asset.id}>
                          <td>
                            <p className="text-body-sm text-ink">{asset.name}</p>
                            {asset.serial_number ? (
                              <p className="text-nano tabular-nums text-muted">
                                {asset.serial_number}
                              </p>
                            ) : null}
                          </td>
                          <td>
                            <Badge tone={ASSET_STATUS_TONES[asset.status]}>
                              {ASSET_STATUS_LABELS[asset.status]}
                            </Badge>
                          </td>
                          <td className="text-label text-muted">
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
                          <td>
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
