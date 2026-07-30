import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { addDaysYmd } from "@/features/calendar/date";
import type {
  CalendarEventWithOwner,
  CalendarItem,
  Holiday,
  Resource,
  ResourceBookingWithRelations,
} from "@/types/db";

export type CalendarScope = "personal" | "team" | "company";

/**
 * 캘린더 항목 조회 (스펙 3.4)
 *
 * RLS가 이미 "볼 수 있는 것"을 걸러주므로 여기서는 뷰(개인/팀/전사)에 맞는
 * 추가 필터만 얹는다. 기간은 [from, to) 로 겹치는 항목을 모두 가져온다.
 */
export async function getCalendarItems({
  scope,
  from,
  to,
  employeeId,
  teamId,
}: {
  scope: CalendarScope;
  from: Date;
  to: Date;
  employeeId: string;
  teamId: string | null;
}): Promise<CalendarItem[]> {
  const supabase = createServerSupabase();
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  let eventQuery = supabase
    .from("calendar_events")
    .select(
      `id, title, description, start_at, end_at, all_day, visibility, owner_id,
       team_id, google_calendar_event_id, created_at, updated_at,
       owner:employees!owner_id(id, name, profile_image_url)`,
    )
    // 기간이 겹치는 항목: 시작이 to 이전이고, 끝이 from 이후
    .lt("start_at", toIso)
    .gt("end_at", fromIso)
    .order("start_at");

  if (scope === "personal") {
    eventQuery = eventQuery.eq("owner_id", employeeId);
  } else if (scope === "team") {
    eventQuery = eventQuery.eq("visibility", "team");
    // 팀 미배정자는 팀 일정이 없다. RLS도 막지만 쿼리에서도 명시적으로 비운다.
    eventQuery = teamId
      ? eventQuery.eq("team_id", teamId)
      : eventQuery.eq("team_id", "00000000-0000-0000-0000-000000000000");
  } else {
    eventQuery = eventQuery.eq("visibility", "company");
  }

  // 리소스 예약은 개인 뷰에서 본인 예약만 노출한다(스펙 3.4 개인 뷰 정의)
  let bookingQuery = supabase
    .from("resource_bookings")
    .select(
      `id, resource_id, booked_by, start_at, end_at, purpose, created_at,
       resource:resources!resource_id(id, name, type, location),
       booker:employees!booked_by(id, name)`,
    )
    .lt("start_at", toIso)
    .gt("end_at", fromIso)
    .order("start_at");

  if (scope === "personal") {
    bookingQuery = bookingQuery.eq("booked_by", employeeId);
  }

  const [{ data: events }, { data: bookings }] = await Promise.all([
    eventQuery,
    bookingQuery,
  ]);

  const eventItems: CalendarItem[] = (
    (events ?? []) as unknown as CalendarEventWithOwner[]
  ).map((event) => ({
    id: event.id,
    kind: event.visibility,
    title: event.title,
    description: event.description,
    startAt: event.start_at,
    endAt: event.end_at,
    allDay: event.all_day,
    ownerId: event.owner_id,
    ownerName: event.owner?.name ?? null,
    editable: event.owner_id === employeeId,
  }));

  const bookingItems: CalendarItem[] = (
    (bookings ?? []) as unknown as ResourceBookingWithRelations[]
  ).map((booking) => ({
    id: booking.id,
    kind: "resource_booking",
    title: booking.resource?.name
      ? `${booking.resource.name}${booking.purpose ? ` — ${booking.purpose}` : ""}`
      : (booking.purpose ?? "리소스 예약"),
    description: booking.purpose,
    startAt: booking.start_at,
    endAt: booking.end_at,
    allDay: false,
    ownerId: booking.booked_by,
    ownerName: booking.booker?.name ?? null,
    editable: booking.booked_by === employeeId,
  }));

  // 승인된 연차·휴가 (스펙 03 · 6장 연동)
  // 개인 뷰에서는 본인 것만, 팀·전사 뷰에서는 RLS가 허용하는 범위 전체를 보여준다.
  const leaveItems = await getLeaveItems({
    fromYmd: toSeoulYmdLocal(from),
    toYmd: toSeoulYmdLocal(to),
    employeeId,
    onlyMine: scope === "personal",
  });

  return [...eventItems, ...bookingItems, ...leaveItems].sort((a, b) =>
    a.startAt.localeCompare(b.startAt),
  );
}

function toSeoulYmdLocal(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

const LEAVE_TYPE_SHORT: Record<string, string> = {
  full_day: "연차",
  half_day_am: "오전반차",
  half_day_pm: "오후반차",
  hourly: "시간연차",
};

const LEAVE_CATEGORY_SHORT: Record<string, string> = {
  annual: "연차",
  industrial_accident: "공상",
  family_care: "가족돌봄",
  maternity: "출산",
  menstrual: "생리",
  congratulation_condolence: "경조",
};

/** 승인된 휴가를 캘린더 항목으로 변환 */
async function getLeaveItems({
  fromYmd,
  toYmd,
  employeeId,
  onlyMine,
}: {
  fromYmd: string;
  toYmd: string;
  employeeId: string;
  onlyMine: boolean;
}): Promise<CalendarItem[]> {
  const supabase = createServerSupabase();

  let query = supabase
    .from("leave_requests")
    .select(
      `id, employee_id, leave_type, leave_category, start_date, end_date,
       employee:employees!employee_id(id, name)`,
    )
    .eq("status", "approved")
    .lte("start_date", toYmd)
    .gte("end_date", fromYmd);

  if (onlyMine) query = query.eq("employee_id", employeeId);

  const { data, error } = await query;
  if (error) {
    // 스펙 03 마이그레이션 전이면 테이블이 없다 — 캘린더는 계속 떠야 한다
    console.error("[calendar] 휴가 조회 실패:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      employee_id: string;
      leave_type: string;
      leave_category: string;
      start_date: string;
      end_date: string;
      employee: { name: string } | null;
    };
    const name = r.employee?.name ?? "";
    const kindLabel =
      r.leave_category === "annual"
        ? LEAVE_TYPE_SHORT[r.leave_type]
        : LEAVE_CATEGORY_SHORT[r.leave_category];

    return {
      id: `leave-${r.id}`,
      kind: "leave" as const,
      title: `${name} ${kindLabel}`.trim(),
      description: null,
      // 종일 항목으로 취급. occursOn이 종료 경계를 배타적으로 보므로
      // 종료일 당일까지 표시되도록 다음 날 자정을 끝으로 둔다.
      startAt: new Date(`${r.start_date}T00:00:00+09:00`).toISOString(),
      endAt: new Date(`${addDaysYmd(r.end_date, 1)}T00:00:00+09:00`).toISOString(),
      allDay: true,
      ownerId: r.employee_id,
      ownerName: name,
      // 휴가는 캘린더에서 직접 수정하지 않는다(근태 화면에서 취소)
      editable: false,
    };
  });
}

/**
 * 표시 구간의 공휴일. 키는 'yyyy-MM-dd'.
 * 캘린더 표시와 스펙 03의 근무일 산정이 같은 소스를 쓰도록 여기서만 조회한다.
 */
export async function getHolidayMap(
  fromYmd: string,
  toYmd: string,
): Promise<Record<string, Holiday>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("holidays")
    .select("*")
    .gte("date", fromYmd)
    .lte("date", toYmd);

  if (error) {
    // 공휴일 테이블이 아직 없거나 조회 실패해도 캘린더 자체는 떠야 한다
    console.error("[calendar] 공휴일 조회 실패:", error.message);
    return {};
  }

  const map: Record<string, Holiday> = {};
  (data ?? []).forEach((row) => {
    map[(row as Holiday).date] = row as Holiday;
  });
  return map;
}

/** 예약 가능한 활성 리소스 (스펙 3.6) */
export async function getActiveResources(): Promise<Resource[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("resources")
    .select("*")
    .eq("is_active", true)
    .order("type")
    .order("name");
  return (data ?? []) as Resource[];
}

/** 리소스 관리 화면용 — 비활성 포함 전체 (스펙 3.7) */
export async function getAllResources(): Promise<Resource[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("resources")
    .select("*")
    .order("is_active", { ascending: false })
    .order("type")
    .order("name");
  return (data ?? []) as Resource[];
}
