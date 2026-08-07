import type { Metadata } from "next";
import { GitBranch, ShieldAlert, UserCheck } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { Callout } from "@/components/ui/Callout";
import {
  ApprovalLineBoard,
  type ApprovalLineRow,
  type ApproverOption,
} from "./ApprovalLineBoard";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { getApprovalLineConfigs } from "@/features/approvals/data";

export const metadata: Metadata = { title: "결재라인 설정" };

export default async function ApprovalLinesPage() {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const [configs, { data: employees }, { data: teams }] = await Promise.all([
    getApprovalLineConfigs(),
    supabase
      .from("employees")
      .select("id, name, position")
      .eq("employment_status", "active")
      .order("name"),
    supabase.from("teams").select("name, manager_id"),
  ]);

  // 1차 검토를 켜도 팀장이 없는 팀은 그 단계를 건너뛴다 — 화면에 미리 알린다
  const teamsWithoutManager = (teams ?? [])
    .filter((t) => !t.manager_id)
    .map((t) => t.name as string);

  const rows: ApprovalLineRow[] = configs.map((config) => ({
    documentType: config.document_type,
    approverId: config.step2_approver_id,
    approverName: config.approver?.name ?? null,
    approverPosition: config.approver?.position ?? null,
    useTeamReview: config.use_team_review,
  }));

  const teamReviewOn = rows.filter((row) => row.useTeamReview).length;

  const total = rows.length;
  const set = rows.filter((row) => row.approverId).length;
  const unset = total - set;
  const approvers = new Set(
    rows.filter((row) => row.approverId).map((row) => row.approverId),
  );

  // 한 사람에게 몰려 있으면 그 사람이 자리를 비울 때 전사 결재가 멈춘다
  const busiest = rows
    .filter((row) => row.approverId)
    .reduce<Record<string, number>>((acc, row) => {
      const key = row.approverName ?? "-";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  const [topName, topCount] = Object.entries(busiest).sort(
    (a, b) => b[1] - a[1],
  )[0] ?? ["-", 0];

  return (
    <>
      {/*
        콘텐츠 제목 "결재라인 설정" 20/500 — PageHeader급 밴드 없음(확립
        문법). 종전 메타(유형 수·단계 구성)는 제목 아래 한 줄로 남긴다 —
        지금 결재가 몇 단계로 도는지는 장식이 아니라 설정 상태다.
      */}
      <div className="mb-5">
        <h1 className="text-title-l text-ink">
          결재라인 설정
        </h1>
        <p className="mt-1.5 text-label text-muted">
          문서유형 {total}종 ·{" "}
          {teamReviewOn === 0
            ? "신청자 → 최종 승인자 (2단계)"
            : teamReviewOn === total
              ? "신청자 → 팀장 → 최종 승인자 (3단계)"
              : `1차 팀장 검토 ${teamReviewOn}/${total}종`}
        </p>
      </div>

      {unset > 0 ? (
        <Callout
          tone="danger"
          title={`최종 승인자가 지정되지 않은 유형이 ${unset}개 있습니다`}
          className="mb-5"
        >
          해당 유형은 임직원이 기안 자체를 할 수 없습니다. 아래에서 최종 승인자를
          지정하면 즉시 기안이 열립니다.
        </Callout>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        {/*
          민트 규율 — 지정 완료는 "기안이 살아 있는 유형 수"라 민트다.
          종전 brand 강조(오렌지 틴트)는 장식이라 걷어냈다(색 절제).
        */}
        <StatCard
          label="결재선 지정 완료"
          value={set}
          unit="건"
          denominator={total}
          denominatorUnit="건"
          tone="positive"
          icon={GitBranch}
          max={total || 1}
          meterValue={set}
          sub={unset > 0 ? `미지정 ${unset}건` : "모든 유형에서 기안 가능"}
        />
        {/* 문제 0건은 경고가 꺼진 상태지 성과가 아니다 — 중립으로 둔다(할일 화면과 같은 판단) */}
        <StatCard
          label="기안 불가 유형"
          value={unset}
          unit="건"
          denominator={total}
          denominatorUnit="건"
          tone={unset > 0 ? "critical" : "neutral"}
          icon={ShieldAlert}
          sub={unset > 0 ? "최종 승인자 미지정" : "이상 없음"}
        />
        <StatCard
          label="최종 승인자"
          value={approvers.size}
          unit="명"
          denominator={total}
          denominatorUnit="건"
          tone="neutral"
          icon={UserCheck}
          state={approvers.size === 0 ? "empty" : "ok"}
          sub={
            approvers.size === 0
              ? "아직 지정된 승인자가 없습니다"
              : `최다 ${topName} ${topCount}건`
          }
        />
      </div>

      <ApprovalLineBoard
        rows={rows}
        employees={(employees ?? []) as ApproverOption[]}
        teamsWithoutManager={teamsWithoutManager}
      />
    </>
  );
}
