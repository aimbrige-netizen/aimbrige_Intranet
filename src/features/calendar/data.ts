import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type {
  CalendarEventWithOwner,
  CalendarItem,
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

  return [...eventItems, ...bookingItems].sort((a, b) =>
    a.startAt.localeCompare(b.startAt),
  );
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
