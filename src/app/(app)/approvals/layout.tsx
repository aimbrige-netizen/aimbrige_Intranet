import { ApprovalPanelSections } from "@/features/approvals/ApprovalPanelSections";
import {
  countMyPendingDocuments,
  getMyDocumentStats,
  getMyPendingApprovals,
} from "@/features/approvals/data";
import { requireSessionEmployee } from "@/lib/auth/session";

/**
 * 전자결재 모듈 레이아웃.
 *
 * 패널 "결재하기" 섹션의 카운트 행(내 차례 · 진행중 · 임시저장)을 여기서
 * 채운다(15-approval-home.md — 다우 결재 홈은 본문 지표 밴드 없이 카운트를
 * 전부 패널에 둔다). 기안 작성 중이든 문서 상세를 보고 있든 이 숫자는
 * 항상 같은 자리에 있다.
 *
 * 임시저장 수는 기존 집계(getMyDocumentStats — my_approval_activity RPC,
 * 기간 없음 = 전체)에서 온다. 집계를 못 불러오면 0으로 지어내지 않고
 * 수를 접는다(null).
 */
export default async function ApprovalsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireSessionEmployee();
  const [pending, myPendingCount, stats] = await Promise.all([
    getMyPendingApprovals(me.id),
    countMyPendingDocuments(me.id),
    getMyDocumentStats(me.id),
  ]);

  return (
    <>
      <ApprovalPanelSections
        showInbox={me.isManager || pending.length > 0}
        myTurn={pending.length}
        inProgress={myPendingCount}
        drafts={stats.unavailable ? null : stats.byStatus.draft}
      />
      {children}
    </>
  );
}
