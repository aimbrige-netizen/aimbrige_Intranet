import type { Metadata } from "next";
import { Suspense } from "react";
import { Callout } from "@/components/ui/Callout";
import { requireSessionEmployee } from "@/lib/auth/session";
import {
  DashboardGrid,
  type WidgetColumn,
  type WidgetSlot,
} from "@/features/dashboard/DashboardGrid";
import {
  ApprovalPendingWidget,
  CalendarUpcomingWidget,
  FavoritesWidget,
  NoticesWidget,
  WeekAttendanceWidget,
} from "@/features/dashboard/widgets";
import { ProfileWidget } from "@/features/dashboard/ProfileWidget";
import { QuickMenuWidget } from "@/features/dashboard/QuickMenu";
import {
  defaultWidgetOrder,
  getApprovalWorkload,
  getCalendarUpcoming,
  getFavorites,
  getNotices,
  getWidgetSettings,
  getWorkSnapshot,
} from "@/features/dashboard/widget-data";
import {
  MailWidget,
  MailWidgetSkeleton,
} from "@/features/mail/MailWidget";
import { addDaysYmd, todayYmd, toSeoulYmd } from "@/features/calendar/date";
import type { WidgetKey } from "@/types/db";

export const metadata: Metadata = { title: "대시보드" };

/** 다가오는 일정 조회 범위 — 오늘부터 며칠 */
const UPCOMING_DAYS = 7;

const WIDGET_LABELS: Record<WidgetKey, string> = {
  approval_pending: "결재 대기",
  attendance_today: "주간 근태",
  notices: "공지사항",
  calendar_upcoming: "다가오는 일정",
  favorites: "즐겨찾기",
  mail: "메일",
};

/**
 * 각 위젯이 놓이는 열 — 다우오피스 홈 실측(02-dashboard.md) 배치를 우리
 * 모듈로 치환한 것.
 *
 *   좌(298px): 프로필 카드(고정) → 즐겨찾기   ← 원본: 프로필 / 메일함 바로가기
 *   중:        Quick Menu(고정) → 결재 대기 → 다가오는 일정
 *              ← 원본: Quick Menu / 결재 대기 문서 / 캘린더
 *   우:        메일 → 공지사항 → 주간 근태     ← 원본: 메일 리스트 / …
 */
const WIDGET_COLUMNS: Record<WidgetKey, WidgetColumn> = {
  favorites: "side",
  approval_pending: "main",
  calendar_upcoming: "main",
  mail: "aux",
  notices: "aux",
  attendance_today: "aux",
};

/**
 * 홈 대시보드 — 다우오피스 홈의 3열 매스너리 구조.
 *
 * 예전 구성(기간 스테퍼 → 지표 밴드 4칸 → 균일 그리드)은 원본에 없는
 * 골격이었다. 지표 밴드가 담던 값은 자리를 옮겼다:
 *   내 차례 결재 n/진행중 m → 프로필 카드 큰 지표 + 카운트 행
 *   잔여 연차·다음 발생    → 프로필 카드 카운트 행
 *   주간 누적·근무일       → 주간 근태 위젯(우측 열)과 내 근태 화면
 * 기간 되짚기(주 단위 스테퍼)는 내 근태 화면의 몫이다 — 원본 홈에도 없다.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { denied?: string };
}) {
  const me = await requireSessionEmployee();
  const today = todayYmd();

  const upcomingFrom = today;
  const upcomingTo = addDaysYmd(today, UPCOMING_DAYS - 1);

  const [approval, snapshot, notices, events, favorites, settings] =
    await Promise.all([
      getApprovalWorkload(me.id),
      getWorkSnapshot(me.id, me.hire_date),
      getNotices(me.id),
      getCalendarUpcoming(me.id, upcomingFrom, upcomingTo),
      getFavorites(me.id),
      getWidgetSettings(me.id),
    ]);

  const { leave, week } = snapshot;
  const todayEvents = events.filter(
    (event) => toSeoulYmd(event.startsAt) === today,
  ).length;

  const nodes: Record<WidgetKey, React.ReactNode> = {
    approval_pending: <ApprovalPendingWidget items={approval.items} />,
    attendance_today: (
      <WeekAttendanceWidget week={week} today={today} title="이번 주 근태" />
    ),
    notices: <NoticesWidget notices={notices} />,
    calendar_upcoming: (
      <CalendarUpcomingWidget
        events={events}
        rangeLabel={`${upcomingFrom.slice(5)} ~ ${upcomingTo.slice(5)}`}
      />
    ),
    favorites: <FavoritesWidget favorites={favorites} />,
    /*
      메일만 Suspense로 감싼다. 다른 위젯의 데이터는 위에서 Promise.all로 이미
      다 받아둔 상태고, 이건 지금부터 구글에 다녀와야 한다. 여기서 await하면
      구글 응답이 늦는 만큼 대시보드 전체가 늦게 뜬다.
    */
    mail: (
      <Suspense fallback={<MailWidgetSkeleton />}>
        <MailWidget email={me.email} canConfigure={me.isSystemAdmin} />
      </Suspense>
    ),
  };

  const slots: WidgetSlot[] = defaultWidgetOrder(me.roleName).map((key) => ({
    key,
    label: WIDGET_LABELS[key],
    node: nodes[key],
    column: WIDGET_COLUMNS[key],
  }));

  const visibility = Object.fromEntries(
    slots.map((slot) => [slot.key, settings[slot.key] ?? true]),
  );

  return (
    <>
      {searchParams.denied === "admin_only" ? (
        <Callout tone="warn" className="mb-4">
          시스템 관리자만 접근할 수 있는 화면입니다.
        </Callout>
      ) : null}

      <DashboardGrid
        slots={slots}
        initialVisibility={visibility}
        sideLead={
          <ProfileWidget
            name={me.name}
            position={me.position}
            departmentName={me.team?.name ?? me.department?.name ?? null}
            profileImageUrl={me.profile_image_url}
            myTurnApprovals={approval.myTurn}
            todayEvents={todayEvents}
            inProgressApprovals={approval.inProgress}
            unreadNotices={notices.length}
            leaveRemaining={leave.remaining}
            leaveNext={leave.next}
          />
        }
        mainLead={<QuickMenuWidget email={me.email} />}
      />
    </>
  );
}
