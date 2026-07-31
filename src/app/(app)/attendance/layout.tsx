import { PanelPortal } from "@/components/layout/ModulePanel";
import { PANEL_WIDGET_SLOT } from "@/components/layout/panel-slots";
import { AttendancePanelWidget } from "@/features/attendance/AttendancePanelWidget";
import {
  getThisWeekHours,
  getTodayAttendance,
} from "@/features/attendance/data";
import { requireSessionEmployee } from "@/lib/auth/session";

/**
 * 근태 모듈 레이아웃.
 *
 * 출퇴근 블록을 모듈 패널 하단에 상주시킨다. 본문이 어떤 화면이든,
 * 얼마나 스크롤했든 오늘의 출퇴근은 항상 같은 자리에 있다.
 */
export default async function AttendanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireSessionEmployee();
  const [record, week] = await Promise.all([
    getTodayAttendance(me.id),
    getThisWeekHours(me.id),
  ]);

  return (
    <>
      <PanelPortal slot={PANEL_WIDGET_SLOT}>
        <AttendancePanelWidget record={record} week={week} />
      </PanelPortal>
      {children}
    </>
  );
}
