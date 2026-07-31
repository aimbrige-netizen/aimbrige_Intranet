import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { addDaysYmd } from "@/features/calendar/date";
import type { ResourceBookingBrief } from "@/features/calendar/data-client";
import type {
  CalendarEventWithOwner,
  CalendarItem,
  Holiday,
  Resource,
  ResourceBooking,
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

  // 승인된 출장·재택근무 (스펙 04 · 7장 연동)
  const approvalItems = await getApprovalItems({
    fromYmd: toSeoulYmdLocal(from),
    toYmd: toSeoulYmdLocal(to),
    employeeId,
    onlyMine: scope === "personal",
  });

  return [
    ...eventItems,
    ...bookingItems,
    ...leaveItems,
    ...approvalItems,
  ].sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/**
 * 승인된 출장·재택근무를 캘린더 항목으로 변환 (스펙 04 · 7장)
 *
 * approval_documents를 직접 읽지 않고 list_calendar_approvals() RPC를 쓴다.
 * 문서 RLS는 "기안자 + 담당 결재자 + 관리자"라, 동료의 출장이 팀·전사
 * 캘린더에 하나도 안 나왔다. RPC가 표시에 필요한 최소 정보만(이름·기간·유형)
 * 돌려준다 — 사유·예상경비는 노출하지 않는다. 휴가와 같은 패턴.
 */
async function getApprovalItems({
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

  const { data, error } = await supabase.rpc("list_calendar_approvals", {
    p_from: fromYmd,
    p_to: toYmd,
  });

  if (error) {
    // 스펙 04 마이그레이션 전이면 함수가 없다 — 캘린더는 계속 떠야 한다
    console.error("[calendar] 결재 문서 조회 실패:", error.message);
    return [];
  }

  const rows = (data ?? []) as {
    id: string;
    requester_id: string;
    requester_name: string;
    document_type: string;
    start_date: string;
    end_date: string;
  }[];

  return rows
    .filter((r) => (onlyMine ? r.requester_id === employeeId : true))
    .map((r) => {
      const label = r.document_type === "business_trip" ? "출장" : "재택";
      return {
        id: `approval-${r.id}`,
        kind: "approval" as const,
        title: `${r.requester_name} ${label}`.trim(),
        description: null,
        startAt: new Date(`${r.start_date}T00:00:00+09:00`).toISOString(),
        endAt: new Date(
          `${addDaysYmd(r.end_date, 1)}T00:00:00+09:00`,
        ).toISOString(),
        allDay: true,
        ownerId: r.requester_id,
        ownerName: r.requester_name,
        editable: false,
      };
    });
}

function toSeoulYmdLocal(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// 휴가 표시 라벨은 list_calendar_leaves() RPC가 만들어 준다.
// (타인의 휴가 종류를 숨겨야 해서 DB 쪽에서 라벨을 결정한다)

/**
 * 승인된 휴가를 캘린더 항목으로 변환.
 *
 * leave_requests를 직접 읽지 않고 list_calendar_leaves() RPC를 쓴다. 이유:
 *  - RLS는 "본인 + 팀장 + 관리자"라, 일반 직원이 팀·전사 캘린더를 봐도 동료 연차가
 *    하나도 안 보였다. 스펙 02 3.4는 "같은 팀에서 동시에 휴가인 날 시각화"를 요구한다.
 *  - 그렇다고 RLS를 넓히면 leave_category가 함께 노출되는데, 생리휴가·공상휴가는
 *    민감정보다. RPC가 타인의 휴가 종류를 '휴가'로 뭉개서 돌려준다.
 */
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

  const { data, error } = await supabase.rpc("list_calendar_leaves", {
    p_from: fromYmd,
    p_to: toYmd,
  });

  if (error) {
    // 스펙 03 마이그레이션 전이면 함수가 없다 — 캘린더는 계속 떠야 한다
    console.error("[calendar] 휴가 조회 실패:", error.message);
    return [];
  }

  const rows = (data ?? []) as {
    id: string;
    employee_id: string;
    employee_name: string;
    start_date: string;
    end_date: string;
    label: string;
    is_mine: boolean;
  }[];

  return rows
    .filter((r) => (onlyMine ? r.employee_id === employeeId : true))
    .map((r) => ({
      id: `leave-${r.id}`,
      kind: "leave" as const,
      title: `${r.employee_name} ${r.label}`.trim(),
      description: null,
      // 종일 항목으로 취급. occursOn이 종료 경계를 배타적으로 보므로
      // 종료일 당일까지 표시되도록 다음 날 자정을 끝으로 둔다.
      startAt: new Date(`${r.start_date}T00:00:00+09:00`).toISOString(),
      endAt: new Date(
        `${addDaysYmd(r.end_date, 1)}T00:00:00+09:00`,
      ).toISOString(),
      allDay: true,
      ownerId: r.employee_id,
      ownerName: r.employee_name,
      // 휴가는 캘린더에서 직접 수정하지 않는다(근태 화면에서 취소)
      editable: false,
    }));
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

/**
 * 구간 안의 리소스 예약 전체 (스펙 3.6)
 *
 * getCalendarItems는 개인 뷰에서 "본인 예약만" 돌려주기 때문에, 그 결과로는
 * 회의실이 비었는지 알 수 없다. 예약 화면과 예약 모달은 남의 예약까지 봐야
 * 한다 — 그래야 저장 버튼을 누르기 전에 충돌을 알 수 있다.
 * (목적·예약자 이름 외의 정보는 가져오지 않는다)
 */
export async function getResourceBookingsInRange(
  from: Date,
  to: Date,
): Promise<ResourceBookingBrief[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("resource_bookings")
    .select(
      `id, resource_id, booked_by, start_at, end_at, purpose,
       booker:employees!booked_by(id, name)`,
    )
    .lt("start_at", to.toISOString())
    .gt("end_at", from.toISOString())
    .order("start_at");

  if (error) {
    console.error("[calendar] 리소스 예약 조회 실패:", error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as (ResourceBooking & {
    booker: { id: string; name: string } | null;
  })[];

  return rows.map((booking) => ({
    id: booking.id,
    resourceId: booking.resource_id,
    startAt: booking.start_at,
    endAt: booking.end_at,
    purpose: booking.purpose,
    bookerId: booking.booked_by,
    bookerName: booking.booker?.name ?? null,
  }));
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
