import type { Metadata } from "next";
import { Gift } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/ui/Card";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
import {
  WelfareCancelButton,
  WelfareRequestButton,
} from "@/features/assets/WelfareActions";
import { getWelfareBalance, getWelfareRequests } from "@/features/assets/data";
import {
  formatPoints,
  welfareSummary,
  WELFARE_STATUS_LABELS,
  WELFARE_STATUS_TONES,
} from "@/features/assets/types";
import { todayYmd } from "@/features/calendar/date";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "복지포인트" };

/**
 * 복지포인트 (스펙 13 · 3.4)
 *
 * 잔여는 저장하지 않고 지급－사용으로 낸다(스펙 설계 결정, 연차와 같은 원칙).
 *
 * 요약 카드를 넷으로 나눈 이유: "잔여"와 "지금 신청할 수 있는 금액"이 다르다.
 * 승인 대기 중인 신청이 있으면 잔여는 그대로인데 실제로 더 쓸 수 있는 건
 * 그만큼 적다. 이걸 안 나누면 같은 금액을 두 번 신청하고 승인 단계에서야
 * 막힌다.
 */
export default async function WelfarePage({
  searchParams,
}: {
  searchParams: { year?: string };
}) {
  const me = await requireSessionEmployee();

  const thisYear = Number(todayYmd().slice(0, 4));
  const parsed = Number(searchParams.year);
  const year =
    Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : thisYear;

  const [{ data: balance, error: balanceError }, { data: requests, error: listError }] =
    await Promise.all([
      getWelfareBalance(me.id, year),
      getWelfareRequests({ employeeId: me.id, year }),
    ]);

  const summary = welfareSummary(balance, requests);
  const error = balanceError ?? listError;

  return (
    <>
      {/*
        콘텐츠 제목 "복지포인트" 20/500 — PageHeader급 밴드 없음(확립 문법).
        종전 메타({year}년)는 섹션 제목들이 연도를 들고 말한다.
        이 화면의 주요 버튼(진한 오렌지)은 신청 버튼 하나다(원칙 1).
      */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title-l text-ink">
          복지포인트
        </h1>
        {balance ? (
          <WelfareRequestButton year={year} available={summary.available} />
        ) : null}
      </div>

      {error ? (
        <Callout tone="danger" title="복지포인트를 불러오지 못했습니다">
          {error}
        </Callout>
      ) : !balance ? (
        /* md+ 흰 시트에서는 빈 상태를 시트에 직접, md 미만은 canvas 위라 카드 면 유지 */
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <EmptyState
            icon={Gift}
            title={`${year}년 복지포인트가 아직 지급되지 않았습니다`}
            description="시스템 관리자가 연초 일괄 지급을 처리하면 여기에 표시됩니다."
          />
        </div>
      ) : (
        <>
          {/*
            민트 규율(14-ehr) — 총계(지급)·경과(사용)는 먹색, "지금 살아 있는
            값"만 민트다. 잔여와 신청 가능 중에서는 대기 신청까지 뺀
            신청 가능이 그 값이다 — 둘 다 칠하면 색이 말을 잃는다(색 절제).
          */}
          <section className="mb-5">
            <SectionHeader title={`${year}년 지급 현황`} />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="지급" value={formatPoints(summary.granted)} unit="점" />
              <StatCard
                label="사용"
                value={formatPoints(summary.used)}
                unit="점"
                denominator={summary.granted}
                denominatorUnit="점"
                meterValue={summary.used}
                max={Math.max(summary.granted, 1)}
              />
              <StatCard label="잔여" value={formatPoints(summary.remaining)} unit="점" />
              <StatCard
                label="신청 가능"
                value={formatPoints(summary.available)}
                unit="점"
                tone="positive"
                sub={
                  summary.pending > 0
                    ? `승인 대기 ${formatPoints(summary.pending)}점 제외`
                    : undefined
                }
              />
            </div>
          </section>

          <section>
            <SectionHeader title={`사용 내역 (총${requests.length}건)`} />
            {requests.length === 0 ? (
              <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
                <EmptyState
                  icon={Gift}
                  title="사용 내역이 없습니다"
                  description="도서·자기계발·건강관리 등에 쓴 금액을 신청하면 여기에 쌓입니다."
                />
              </div>
            ) : (
              /*
                08 흰 시트: md+에서 .ab-card는 흰 면 위 이중 테두리 — 표를
                시트에 직접 놓고 md 미만만 카드 유지(10-modules2).
              */
              <div className="ab-card overflow-hidden md:rounded-none md:border-0">
              <table className="ab-table">
                <thead>
                  <tr>
                    <th>신청일</th>
                    <th>용도</th>
                    <th className="text-right">금액</th>
                    <th>상태</th>
                    <th className="text-right">
                      <span className="sr-only">처리</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td className="text-label tabular-nums text-muted">
                        {request.requested_at.slice(0, 10)}
                      </td>
                      <td>
                        <p className="text-body-sm text-ink">{request.purpose}</p>
                        {/* 반려 사유는 신청자가 볼 수 있어야 다음에 다시 낼 수 있다 */}
                        {request.reject_reason ? (
                          <p className="text-label text-muted">
                            사유: {request.reject_reason}
                          </p>
                        ) : null}
                      </td>
                      <td className="text-right text-body-sm tabular-nums text-ink">
                        {formatPoints(request.amount)}
                      </td>
                      <td>
                        <Badge tone={WELFARE_STATUS_TONES[request.status]}>
                          {WELFARE_STATUS_LABELS[request.status]}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex justify-end">
                          {request.status === "pending" ? (
                            <WelfareCancelButton requestId={request.id} />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
