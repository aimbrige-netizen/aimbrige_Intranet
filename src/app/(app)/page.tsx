import {
  CalendarCheck,
  Clock3,
  FileCheck,
  Megaphone,
  ShieldAlert,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { toSeoulTime } from "@/features/calendar/date";
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
      getApprovalPending(me.id),
      getAttendanceToday(me.id, me.hire_date),
      getNotices(me.id),
      getCalendarUpcoming(),
      getFavorites(me.id),
      getWidgetSettings(me.id),
    ]);

  const nodes: Record<WidgetKey, React.ReactNode> = {
    approval_pending: (
      <ApprovalPendingWidget documents={approval.connected ? approval.data : []} />
    ),
    attendance_today: (
      <AttendanceTodayWidget
        record={attendance.connected ? attendance.data.record : null}
        remainingLeave={attendance.connected ? attendance.data.remainingLeave : 0}
      />
    ),
    notices: <NoticesWidget notices={notices.connected ? notices.data : []} />,
    calendar_upcoming: (
      <CalendarUpcomingWidget events={calendar.connected ? calendar.data : []} />
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
          className="mb-4 flex items-center gap-2 rounded-card border border-warn/40 bg-warn-light px-4 py-3 text-body text-ink"
        >
          <ShieldAlert className="size-4 shrink-0 text-warn-ink" aria-hidden />
          시스템 관리자만 접근할 수 있는 화면입니다.
        </div>
      ) : null}

      {/* 오늘 한눈에 — 위젯 안에 흩어진 수치를 상단에 모아 먼저 보이게 한다 */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="잔여 연차"
          value={attendance.connected ? attendance.data.remainingLeave : 0}
          unit="일"
          tone="brand"
          icon={CalendarCheck}
          emphasis
        />
        <StatCard
          label="오늘 출근"
          value={
            attendance.connected && attendance.data.record?.check_in_at
              ? toSeoulTime(attendance.data.record.check_in_at)
              : "--:--"
          }
          tone={
            attendance.connected && attendance.data.record?.check_in_at
              ? "positive"
              : "neutral"
          }
          icon={Clock3}
          sub={
            attendance.connected && attendance.data.record?.check_out_at
              ? `퇴근 ${toSeoulTime(attendance.data.record.check_out_at)}`
              : attendance.connected && attendance.data.record?.check_in_at
                ? "근무 중"
                : "미체크"
          }
        />
        <StatCard
          label="결재 대기"
          value={approval.connected ? approval.data.length : 0}
          unit="건"
          // 대기 문서는 "문제"가 아니라 할 일이다 — 빨강 대신 informative
          tone={
            approval.connected && approval.data.length > 0
              ? "informative"
              : "neutral"
          }
          icon={FileCheck}
          sub={
            approval.connected && approval.data.length > 0
              ? "내 차례인 문서"
              : "처리할 문서 없음"
          }
        />
        <StatCard
          label="미열람 공지"
          value={notices.connected ? notices.data.length : 0}
          unit="건"
          tone={
            notices.connected && notices.data.length > 0
              ? "informative"
              : "neutral"
          }
          icon={Megaphone}
          sub={
            notices.connected && notices.data.length > 0
              ? "확인이 필요합니다"
              : "모두 확인함"
          }
        />
      </div>

      <DashboardGrid slots={slots} initialVisibility={visibility} />
    </>
  );
}
