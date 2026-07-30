import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  CalendarBoard,
  type CalendarScope,
  type CalendarView,
} from "@/features/calendar/CalendarBoard";
import { getActiveResources, getCalendarItems } from "@/features/calendar/data";
import {
  addDaysYmd,
  monthGrid,
  rangeOf,
  todayYmd,
  weekGrid,
} from "@/features/calendar/date";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "캘린더" };

const YM_PATTERN = /^\d{4}-\d{2}$/;
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { scope?: string; view?: string; cursor?: string };
}) {
  const me = await requireSessionEmployee();

  const scope: CalendarScope =
    searchParams.scope === "team"
      ? "team"
      : searchParams.scope === "company"
        ? "company"
        : "personal";

  const view: CalendarView =
    searchParams.view === "week"
      ? "week"
      : searchParams.view === "list"
        ? "list"
        : "month";

  const today = todayYmd();

  // 잘못된 cursor가 들어와도 화면이 깨지지 않게 형식을 검증한다
  const cursor =
    view === "month"
      ? YM_PATTERN.test(searchParams.cursor ?? "")
        ? searchParams.cursor!
        : today.slice(0, 7)
      : YMD_PATTERN.test(searchParams.cursor ?? "")
        ? searchParams.cursor!
        : today;

  const days =
    view === "month"
      ? monthGrid(cursor)
      : view === "week"
        ? weekGrid(cursor)
        : // 리스트 뷰는 기준일부터 30일
          Array.from({ length: 30 }, (_, i) => addDaysYmd(cursor, i));

  const { from, to } = rangeOf(days);

  const [items, resources] = await Promise.all([
    getCalendarItems({
      scope,
      from,
      to,
      employeeId: me.id,
      teamId: me.team_id,
    }),
    getActiveResources(),
  ]);

  return (
    <>
      <PageHeader
        title="캘린더"
        description="개인·팀·전사 일정과 회의실·차량·비품 예약을 한 화면에서 확인합니다."
      />

      <CalendarBoard
        items={items}
        resources={resources}
        scope={scope}
        view={view}
        cursor={cursor}
        canCreateTeamEvent={!!me.team_id}
      />
    </>
  );
}
