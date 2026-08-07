import type { Metadata } from "next";
import { Boxes } from "lucide-react";
import { SectionHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable, Td, Th } from "@/components/ui/Table";
import { LoanAdminButtons } from "@/features/assets/AssetActions";
import {
  AssetCreateForm,
  AssetStatusSelect,
} from "@/features/assets/AssetCreateForm";
import { getAssets, getLoans } from "@/features/assets/data";
import {
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
      {/*
        콘텐츠 제목 "자산 관리" 20/500 — PageHeader급 밴드 없음(확립 문법).
        종전 메타(자산 n대·이력 n건)는 각 섹션 제목이 분모로 든다.
      */}
      <h1 className="mb-5 text-title-l text-ink">
        자산 관리
      </h1>

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

      {/*
        흰 시트 위 카드 해체(10 스윕): /admin/assets는 자산 모듈 패널 화면이라
        md+에서 본문이 흰 시트다 — Card 테두리가 이중선이 된다. 형제 화면
        /assets와 같이 SectionHeader + md-해체(md 미만은 canvas 위 카드 유지).
      */}
      <section className="mb-5">
        <SectionHeader title="자산 등록" />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <AssetCreateForm />
        </div>
      </section>

      {/*
        관리자 화면은 밀도 우선 — 종전 배지+자유 배치 목록을 07 표로 바꾼다.
        상태가 컬럼이 되면 색 배지 없이도 행 사이 비교가 서고(색 절제),
        처리 버튼은 우측 고정 컬럼으로 정렬된다.
      */}
      <section className="mb-5">
        <SectionHeader
          title={`처리 대기 (총${todo.length}건)`}
          description="대여 신청 승인과 반납 확인"
        />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          {todo.length === 0 ? (
            <p className="text-label text-muted">처리할 신청이 없습니다.</p>
          ) : (
            <DataTable minWidth={620} fixed>
              <thead>
                <tr>
                  <Th className="w-32">구분</Th>
                  <Th>자산</Th>
                  <Th className="w-32">신청자</Th>
                  <Th className="w-40">반납 예정</Th>
                  <Th className="w-44">
                    <span className="sr-only">처리</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {todo.map((loan) => {
                  const stage = loanStage(loan) as "requested" | "return_requested";
                  return (
                    <tr key={loan.id}>
                      {/* 승인 대기/반납 확인 대기는 처리 종류라 배지 상태색을 유지한다 */}
                      <Td>
                        <Badge tone={LOAN_STAGE_TONES[stage]}>
                          {LOAN_STAGE_LABELS[stage]}
                        </Badge>
                      </Td>
                      <Td>
                        <span className="block truncate text-ink">
                          {loan.asset_name}
                        </span>
                      </Td>
                      <Td>
                        <span className="block truncate">{loan.employee_name}</span>
                      </Td>
                      <Td numeric className="text-muted">
                        {loan.expected_return_date ?? "—"}
                      </Td>
                      <Td>
                        <LoanAdminButtons
                          loanId={loan.id}
                          stage={stage}
                          expectedReturnDate={loan.expected_return_date}
                        />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </div>
      </section>

      <section className="mb-5">
        <SectionHeader
          title={`자산 (총${assets.length}대)`}
          description="수리중·폐기 표시는 여기서"
        />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          {assets.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="등록된 자산이 없습니다"
              description="위에서 첫 자산을 등록하세요."
              compact
            />
          ) : (
            <DataTable minWidth={620} fixed>
              <thead>
                <tr>
                  <Th>자산명</Th>
                  <Th className="w-36">종류</Th>
                  <Th className="w-40">사용자</Th>
                  {/* 상태 셀렉트가 현재 상태를 그대로 보여준다 — 배지 중복은 두지 않는다 */}
                  <Th className="w-40">상태</Th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id}>
                    <Td>
                      <span className="block truncate text-ink">{asset.name}</span>
                      {asset.serial_number ? (
                        <span className="block truncate text-nano tabular-nums text-muted">
                          {asset.serial_number}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="block truncate text-muted">
                        {asset.asset_type ?? "—"}
                      </span>
                    </Td>
                    <Td>
                      <span className="block truncate text-muted">
                        {asset.holder_name ?? "—"}
                      </span>
                    </Td>
                    <Td>
                      <AssetStatusSelect assetId={asset.id} status={asset.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
      </section>

      <section>
        <SectionHeader
          title="전체 대여 이력"
          description={`최근 ${loans.length}건`}
        />
        {loans.length === 0 ? (
          <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
            <p className="text-label text-muted">대여 이력이 없습니다.</p>
          </div>
        ) : (
          /* 표는 패딩 없는 면 — /assets의 표 래퍼와 동일 */
          <div className="ab-card overflow-hidden md:rounded-none md:border-0">
            {/* 2026-08-07 UI/UX 감사: 손복사 표 → DataTable(이 파일의 다른 두 표와 같은 컴포넌트) */}
            <DataTable minWidth={560}>
              <thead>
                <tr>
                  <Th>자산</Th>
                  <Th>대여자</Th>
                  <Th>상태</Th>
                  <Th>신청</Th>
                  <Th>반납</Th>
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => {
                  const stage = loanStage(loan);
                  return (
                    <tr key={loan.id}>
                      <Td className="text-body-sm text-ink">{loan.asset_name}</Td>
                      <Td className="text-label text-muted">
                        {loan.employee_name}
                      </Td>
                      <Td>
                        <Badge tone={LOAN_STAGE_TONES[stage]}>
                          {LOAN_STAGE_LABELS[stage]}
                        </Badge>
                      </Td>
                      <Td numeric className="text-label text-muted">
                        {loan.requested_at.slice(0, 10)}
                      </Td>
                      <Td numeric className="text-label text-muted">
                        {loan.returned_at?.slice(0, 10) ?? "—"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </div>
        )}
      </section>
    </>
  );
}
