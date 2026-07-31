import type { Metadata } from "next";
import { Gift } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
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
      <PageHeader
        title="복지포인트"
        meta={<span>{year}년</span>}
        actions={
          balance ? (
            <WelfareRequestButton year={year} available={summary.available} />
          ) : undefined
        }
      />

      {error ? (
        <Callout tone="danger" title="복지포인트를 불러오지 못했습니다">
          {error}
        </Callout>
      ) : !balance ? (
        <EmptyState
          icon={Gift}
          title={`${year}년 복지포인트가 아직 지급되지 않았습니다`}
          description="시스템 관리자가 연초 일괄 지급을 처리하면 여기에 표시됩니다."
        />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
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
              sub={
                summary.pending > 0
                  ? `승인 대기 ${formatPoints(summary.pending)}점 제외`
                  : undefined
              }
            />
          </div>

          {requests.length === 0 ? (
            <EmptyState
              icon={Gift}
              title="사용 내역이 없습니다"
              description="도서·자기계발·건강관리 등에 쓴 금액을 신청하면 여기에 쌓입니다."
            />
          ) : (
            <div className="overflow-hidden rounded-card border border-line">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line bg-subtle text-left">
                    <th className="px-4 py-2 text-label font-bold text-muted">신청일</th>
                    <th className="px-4 py-2 text-label font-bold text-muted">용도</th>
                    <th className="px-4 py-2 text-right text-label font-bold text-muted">
                      금액
                    </th>
                    <th className="px-4 py-2 text-label font-bold text-muted">상태</th>
                    <th className="px-4 py-2 text-right text-label font-bold text-muted">
                      <span className="sr-only">처리</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 text-label tabular-nums text-muted">
                        {request.requested_at.slice(0, 10)}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-body-sm text-ink">{request.purpose}</p>
                        {/* 반려 사유는 신청자가 볼 수 있어야 다음에 다시 낼 수 있다 */}
                        {request.reject_reason ? (
                          <p className="text-label text-muted">
                            사유: {request.reject_reason}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-right text-body-sm tabular-nums text-ink">
                        {formatPoints(request.amount)}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={WELFARE_STATUS_TONES[request.status]}>
                          {WELFARE_STATUS_LABELS[request.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
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
        </>
      )}
    </>
  );
}
