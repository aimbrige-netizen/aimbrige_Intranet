import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { StatCard } from "@/components/ui/StatCard";
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
      <PageHeader
        title="복지포인트 관리"
        meta={
          <>
            <span>{year}년</span>
            <span>지급 대상 {overview.employees}명</span>
          </>
        }
      />

      {error ? (
        <Callout tone="danger" title="복지포인트 정보를 불러오지 못했습니다">
          {error}
        </Callout>
      ) : null}

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
          description="재직 중인 임직원 전원에게 같은 금액을 반영합니다."
        />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <WelfareGrantForm year={year} />
        </div>
      </section>

      <section className="mb-5">
        <SectionHeader
          title="승인 대기"
          description={`${pending.length}건`}
        />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          {pending.length === 0 ? (
            <p className="text-label text-muted">처리할 신청이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="text-body-sm font-bold text-ink">
                    {request.employee_name}
                  </span>
                  <span className="text-body-sm tabular-nums text-ink">
                    {formatPoints(request.amount)}점
                  </span>
                  <span className="min-w-0 flex-1 truncate text-label text-muted">
                    {request.purpose}
                  </span>
                  <span className="text-label tabular-nums text-muted">
                    {request.requested_at.slice(0, 10)}
                  </span>
                  <WelfareAdminButtons requestId={request.id} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <SectionHeader
          title="전체 신청 내역"
          description={`${year}년 ${requests.length}건`}
        />
        {requests.length === 0 ? (
          <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
            <p className="text-label text-muted">신청 내역이 없습니다.</p>
          </div>
        ) : (
          /* 표는 패딩 없는 면 — /assets의 표 래퍼와 동일 */
          <div className="ab-card overflow-hidden md:rounded-none md:border-0">
            <div className="overflow-x-auto">
              <table className="ab-table min-w-[560px]">
                <thead>
                  <tr>
                    <th>신청자</th>
                    <th>용도</th>
                    <th className="text-right">금액</th>
                    <th>상태</th>
                    <th>신청일</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td className="text-body-sm text-ink">
                        {request.employee_name}
                      </td>
                      <td className="text-label text-muted">{request.purpose}</td>
                      <td className="text-right text-body-sm tabular-nums text-ink">
                        {formatPoints(request.amount)}
                      </td>
                      <td>
                        <Badge tone={WELFARE_STATUS_TONES[request.status]}>
                          {WELFARE_STATUS_LABELS[request.status]}
                        </Badge>
                      </td>
                      <td className="text-label tabular-nums text-muted">
                        {request.requested_at.slice(0, 10)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
