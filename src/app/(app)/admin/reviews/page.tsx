import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { Meter } from "@/components/ui/Progress";
import {
  CycleCreateForm,
  CycleStatusControl,
} from "@/features/reviews/CycleAdmin";
import { getCycleProgress, getCycles } from "@/features/reviews/data";
import {
  CYCLE_STATUS_LABELS,
  CYCLE_STATUS_TONES,
} from "@/features/reviews/types";
import { requireSystemAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "평가 사이클 관리" };

/**
 * 평가 사이클 관리 (스펙 12 · 3.4) — 시스템 관리자 전용
 *
 * 진행 현황을 "완료 n명"이 아니라 "n/전체 m명"으로 보여준다. 분모가 없으면
 * 12명 완료가 잘 되고 있는 건지 절반도 안 된 건지 알 수 없다 —
 * 관리자가 이 화면을 보는 이유가 정확히 그 판단이다.
 *
 * 사이클 시작 알림(스펙 5장, Resend)은 아직 붙이지 않았다. 메일 발송 키가
 * 없어서 지금 넣으면 조용히 실패하는 코드만 남는다.
 */
export default async function AdminReviewsPage() {
  await requireSystemAdmin();

  const { data: cycles, error } = await getCycles();

  // 사이클마다 집계 RPC를 한 번씩 부른다. 사이클 수는 반기마다 2개꼴이라
  // 목록 길이가 문제될 규모가 아니다(상한 100).
  const progressList = await Promise.all(
    cycles.map((cycle) => getCycleProgress(cycle.id)),
  );

  return (
    <>
      <PageHeader
        title="평가 사이클 관리"
        meta={<span>{cycles.length}개 사이클</span>}
      />

      <Card className="mb-4">
        <CardHeader
          title="새 사이클 시작"
          description="시작하면 전 직원이 목표설정 단계로 들어옵니다."
        />
        <CardBody>
          <CycleCreateForm />
        </CardBody>
      </Card>

      {/*
        알림 발송은 스펙 5장에 있지만 Resend 키가 없어 아직 못 붙인다.
        "보냈다"고 표시하지 않고 없다는 사실을 그대로 알린다 —
        보낸 줄 알고 아무도 확인 안 하는 상황이 제일 나쁘다.
      */}
      <Callout tone="info" title="사이클 알림은 아직 자동 발송되지 않습니다">
        메일 발송(Resend) 연동 전이라, 사이클을 시작하면 임직원에게 직접
        공지해야 합니다. 인트라넷에서는 목록에 바로 나타납니다.
      </Callout>

      {error ? (
        <Callout tone="danger" title="사이클을 불러오지 못했습니다">
          {error}
        </Callout>
      ) : cycles.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="사이클이 없습니다"
          description="위에서 첫 사이클을 시작하세요."
        />
      ) : (
        <ul className="mt-4 space-y-3">
          {cycles.map((cycle, index) => {
            const progress = progressList[index].data;
            const total = progress?.total_employees ?? 0;

            return (
              <li
                key={cycle.id}
                className="rounded-card border border-line bg-surface p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href={`/reviews/${cycle.id}`}
                    className="text-body-sm font-bold text-ink hover:underline"
                  >
                    {cycle.name}
                  </Link>
                  <Badge tone={CYCLE_STATUS_TONES[cycle.status]}>
                    {CYCLE_STATUS_LABELS[cycle.status]}
                  </Badge>
                  <span className="text-label text-muted">
                    {periodLabel(cycle.start_date, cycle.end_date)}
                  </span>
                  <div className="ml-auto">
                    <CycleStatusControl cycleId={cycle.id} status={cycle.status} />
                  </div>
                </div>

                {progress ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <ProgressRow
                      label="목표 제출"
                      value={progress.goals_submitted}
                      total={total}
                    />
                    <ProgressRow
                      label="자기평가 제출"
                      value={progress.self_submitted}
                      total={total}
                    />
                    <ProgressRow
                      label="팀장평가 제출"
                      value={progress.manager_submitted}
                      total={total}
                    />
                  </div>
                ) : (
                  <p className="mt-3 text-label text-muted">
                    진행 현황을 불러오지 못했습니다.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function ProgressRow({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-label text-muted">{label}</span>
        <span className="text-body-sm font-bold tabular-nums text-ink">
          {value}
          <span className="text-label font-normal text-muted">/{total}명</span>
        </span>
      </div>
      {/* 재직자가 0명이면 분모가 0이라 비율을 그릴 수 없다 */}
      <Meter
        value={value}
        max={Math.max(total, 1)}
        tone="informative"
        className="mt-1"
      />
    </div>
  );
}

function periodLabel(start: string | null, end: string | null): string {
  if (!start && !end) return "기간 미정";
  return `${start ?? "미정"} ~ ${end ?? "미정"}`;
}
