import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireSessionEmployee } from "@/lib/auth/session";
import {
  DashboardGrid,
  type WidgetSlot,
} from "@/features/dashboard/DashboardGrid";
import {
  ApprovalPendingWidget,
  AttendanceTodayWidget,
  CalendarUpcomingWidget,
  FavoritesWidget,
  NoticesWidget,
} from "@/features/dashboard/widgets";
import {
  defaultWidgetOrder,
  getApprovalPending,
  getAttendanceToday,
  getCalendarUpcoming,
  getFavorites,
  getNotices,
  getWidgetSettings,
} from "@/features/dashboard/widget-data";
import { todayInSeoul } from "@/lib/utils";
import type { WidgetKey } from "@/types/db";

const WIDGET_LABELS: Record<WidgetKey, string> = {
  approval_pending: "결재 대기",
  attendance_today: "오늘의 근태",
  notices: "공지사항",
  calendar_upcoming: "다가오는 일정",
  favorites: "즐겨찾기",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { denied?: string };
}) {
  const me = await requireSessionEmployee();

  const [approval, attendance, notices, calendar, favorites, settings] =
    await Promise.all([
      getApprovalPending(),
      getAttendanceToday(),
      getNotices(),
      getCalendarUpcoming(),
      getFavorites(me.id),
      getWidgetSettings(me.id),
    ]);

  const nodes: Record<WidgetKey, React.ReactNode> = {
    approval_pending: (
      <ApprovalPendingWidget
        pendingSpec={approval.connected ? "" : approval.pendingSpec}
      />
    ),
    attendance_today: (
      <AttendanceTodayWidget
        pendingSpec={attendance.connected ? "" : attendance.pendingSpec}
      />
    ),
    notices: (
      <NoticesWidget pendingSpec={notices.connected ? "" : notices.pendingSpec} />
    ),
    calendar_upcoming: (
      <CalendarUpcomingWidget
        pendingSpec={calendar.connected ? "" : calendar.pendingSpec}
      />
    ),
    favorites: <FavoritesWidget favorites={favorites} />,
  };

  const slots: WidgetSlot[] = defaultWidgetOrder(me.roleName).map((key) => ({
    key,
    label: WIDGET_LABELS[key],
    node: nodes[key],
  }));

  const visibility = Object.fromEntries(
    slots.map((slot) => [slot.key, settings[slot.key] ?? true]),
  );

  return (
    <>
      <PageHeader
        title={`안녕하세요, ${me.name}님`}
        description={`${todayInSeoul()} · ${[me.department?.name, me.team?.name, me.position].filter(Boolean).join(" · ") || me.email}`}
      />

      {searchParams.denied === "admin_only" ? (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-body text-ink"
        >
          <ShieldAlert className="size-4 shrink-0 text-warn" aria-hidden />
          시스템 관리자만 접근할 수 있는 화면입니다.
        </div>
      ) : null}

      <DashboardGrid slots={slots} initialVisibility={visibility} />
    </>
  );
}
