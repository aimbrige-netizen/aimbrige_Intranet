import type { Metadata } from "next";
import { SectionHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable, Td, Th } from "@/components/ui/Table";
import {
  WelfareAdminButtons,
  WelfareGrantForm,
} from "@/features/assets/WelfareActions";
import { getWelfareOverview, getWelfareRequests } from "@/features/assets/data";
import {
  formatPoints,
  WELFARE_STATUS_LABELS,
  WELFARE_STATUS_TONES,
} from "@/features/assets/types";
import { todayYmd } from "@/features/calendar/date";
import { requireSystemAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "복지포인트 관리" };

/**
 * 복지포인트 관리 (스펙 13 · 3.5) — 시스템 관리자 전용
 *
 * 승인은 서버가 DB 함수로 처리한다. 상태 변경과 잔액 차감이 한 트랜잭션이어야
 * 하고(스펙 4장), 잔액이 모자라면 승인 자체가 실패한다 — 실패 문구에 잔여와
 * 신청액이 함께 들어 있어서 관리자가 바로 판단할 수 있다.
 */
export default async function AdminWelfarePage({
  searchParams,
}: {
  searchParams: { year?: string };
}) {
  await requireSystemAdmin();

  const thisYear = Number(todayYmd().slice(0, 4));
  const parsed = Number(searchParams.year);
  const year =
    Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : thisYear;

  const [{ data: overview, error: overviewError }, { data: requests, error: listError }] =
    await Promise.all([
      getWelfareOverview(year),
      getWelfareRequests({ year }),
    ]);

  const pending = requests.filter((r) => r.status === "pending");
  const error = overviewError ?? listError;

  return (
    <>
      {/*
        콘텐츠 제목 "복지포인트 관리" 20/500 — PageHeader급 밴드 없음(확립 문법).
        종전 메타({year}년·지급 대상 n명)는 섹션 제목·설명이 나눠 든다.
      */}
      <h1 className="mb-5 text-title-l text-ink">
        복지포인트 관리
      </h1>

      {error ? (
        <Callout tone="danger" title="복지포인트 정보를 불러오지 못했습니다">
          {error}
        </Callout>
      ) : null}

      {/*
        민트 규율(14-ehr) — 총계(사용)는 먹색, "지금 살아 있는 값"인
        전사 잔여만 민트다. 승인 대기는 할 일이지 위반이 아니라 중립.
      */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="승인 대기" value={pending.length} unit="건" />
        <StatCard
          label="전사 사용"
          value={formatPoints(overview.used)}
          unit="점"
          denominator={overview.granted}
          denominatorUnit="점"
          meterValue={overview.used}
          max={Math.max(overview.granted, 1)}
        />
        <StatCard
          label="전사 잔여"
          value={formatPoints(overview.granted - overview.used)}
          unit="점"
          tone="positive"
        />
      </div>

      {/*
        흰 시트 위 카드 해체(10 스윕): /admin/welfare는 복지 모듈 패널 화면이라
        md+에서 본문이 흰 시트다 — Card 테두리가 이중선이 된다. 형제 화면
        /welfare와 같이 SectionHeader + md-해체(md 미만은 canvas 위 카드 유지).
      */}
      <section className="mb-5">
        <SectionHeader
          title="연초 일괄 지급"
          description={`${year}년 · 재직 중인 임직원 ${overview.employees}명 전원에게 같은 금액을 반영합니다.`}
        />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <WelfareGrantForm year={year} />
        </div>
      </section>

      {/*
        관리자 화면은 밀도 우선 — 종전 자유 배치 목록을 07 표로 바꾼다.
        금액이 컬럼으로 서야 대기 건들 사이 비교가 된다.
      */}
      <section className="mb-5">
        <SectionHeader
          title={`승인 대기 (총${pending.length}건)`}
          description="승인하면 잔액 차감까지 한 트랜잭션으로 처리됩니다."
        />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          {pending.length === 0 ? (
            <p className="text-label text-muted">처리할 신청이 없습니다.</p>
          ) : (
            <DataTable minWidth={620} fixed>
              <thead>
                <tr>
                  <Th className="w-28">신청자</Th>
                  <Th>용도</Th>
                  <Th align="right" className="w-28">
                    금액
                  </Th>
                  <Th className="w-28">신청일</Th>
                  <Th className="w-40">
                    <span className="sr-only">처리</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {pending.map((request) => (
                  <tr key={request.id}>
                    <Td>
                      <span className="block truncate text-ink">
                        {request.employee_name}
                      </span>
                    </Td>
                    <Td>
                      <span className="block truncate text-muted">
                        {request.purpose}
                      </span>
                    </Td>
                    <Td align="right" numeric className="text-ink">
                      {formatPoints(request.amount)}
                    </Td>
                    <Td numeric className="text-muted">
                      {request.requested_at.slice(0, 10)}
                    </Td>
                    <Td>
                      <WelfareAdminButtons requestId={request.id} />
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
          title={`전체 신청 내역 (총${requests.length}건)`}
          description={`${year}년`}
        />
        {requests.length === 0 ? (
          <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
            <p className="text-label text-muted">신청 내역이 없습니다.</p>
          </div>
        ) : (
          /* 표는 패딩 없는 면 — /assets의 표 래퍼와 동일 */
          <div className="ab-card overflow-hidden md:rounded-none md:border-0">
            {/* 2026-08-07 UI/UX 감사: 손복사 표 → DataTable(이 파일 위쪽 지급 이력 표와 같은 컴포넌트) */}
            <DataTable minWidth={560}>
              <thead>
                <tr>
                  <Th>신청자</Th>
                  <Th>용도</Th>
                  <Th align="right">금액</Th>
                  <Th>상태</Th>
                  <Th>신청일</Th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <Td className="text-body-sm text-ink">
                      {request.employee_name}
                    </Td>
                    <Td className="text-label text-muted">{request.purpose}</Td>
                    <Td align="right" numeric className="text-body-sm text-ink">
                      {formatPoints(request.amount)}
                    </Td>
                    <Td>
                      <Badge tone={WELFARE_STATUS_TONES[request.status]}>
                        {WELFARE_STATUS_LABELS[request.status]}
                      </Badge>
                    </Td>
                    <Td numeric className="text-label text-muted">
                      {request.requested_at.slice(0, 10)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
      </section>
    </>
  );
}
