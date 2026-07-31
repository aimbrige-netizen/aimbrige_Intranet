import { PanelPortal } from "@/components/layout/ModulePanel";
import { PANEL_WIDGET_SLOT } from "@/components/layout/panel-slots";
import { ApprovalPanelWidget } from "@/features/approvals/ApprovalPanelWidget";
import {
  bucketByAging,
  countMyPendingDocuments,
  getMyPendingApprovals,
} from "@/features/approvals/data";
import { requireSessionEmployee } from "@/lib/auth/session";

/**
 * 전자결재 모듈 레이아웃.
 *
 * 결재 대기 현황을 모듈 패널 하단에 상주시킨다. 기안 작성 중이든
 * 문서 상세를 보고 있든 "내 차례 몇 건"은 항상 같은 자리에 있다.
 */
export default async function ApprovalsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireSessionEmployee();
  const [pending, myPendingCount] = await Promise.all([
    getMyPendingApprovals(me.id),
    countMyPendingDocuments(me.id),
  ]);

  const oldest = pending[0];

  return (
    <>
      <PanelPortal slot={PANEL_WIDGET_SLOT}>
        <ApprovalPanelWidget
          showInbox={me.isManager || pending.length > 0}
          pendingCount={pending.length}
          buckets={bucketByAging(pending)}
          oldest={
            oldest
              ? {
                  id: oldest.document.id,
                  title: oldest.document.title,
                  createdAt: oldest.document.created_at,
                }
              : null
          }
          myPendingCount={myPendingCount}
        />
      </PanelPortal>
      {children}
    </>
  );
}
