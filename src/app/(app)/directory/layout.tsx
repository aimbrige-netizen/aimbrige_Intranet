import { PanelPortal } from "@/components/layout/ModulePanel";
import { PANEL_WIDGET_SLOT } from "@/components/layout/panel-slots";
import { MyOrgPanelWidget } from "@/features/directory/MyOrgPanelWidget";
import { getMyOrgContext } from "@/features/directory/data";
import { requireSessionEmployee } from "@/lib/auth/session";

/**
 * 조직도 모듈 레이아웃.
 * 본인의 조직 맥락을 모듈 패널 하단에 상주시킨다 — 트리를 어디까지 펼쳤든
 * "내가 어디 소속이고 누가 내 리포팅 라인인지"는 같은 자리에 있어야 한다.
 */
export default async function DirectoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireSessionEmployee();
  const context = await getMyOrgContext({
    id: me.id,
    department_id: me.department_id,
    team_id: me.team_id,
  });

  return (
    <>
      <PanelPortal slot={PANEL_WIDGET_SLOT}>
        <MyOrgPanelWidget
          me={{
            name: me.name,
            position: me.position,
            profileImageUrl: me.profile_image_url,
          }}
          context={context}
        />
      </PanelPortal>
      {children}
    </>
  );
}
