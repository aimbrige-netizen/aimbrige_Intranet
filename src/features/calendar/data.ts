import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { addDaysYmd } from "@/features/calendar/date";
import { getDirectory } from "@/features/directory/data";
import type {
  AttendeeOption,
  ResourceBookingBrief,
} from "@/features/calendar/data-client";
import type {
  CalendarAttendee,
  CalendarEventWithOwner,
  CalendarItem,
  EventResponse,
  Holiday,
  Resource,
  ResourceBooking,
  ResourceBookingWithRelations,
} from "@/types/db";

export type CalendarScope = "personal" | "team" | "company";

/**
 * 일정 행에서 읽는 컬럼.
 *
 * attendee_ids는 더 이상 읽지 않는다. 참석자는 event_attendees가 진실이고
 * 배열은 RLS 호환을 위해 쓰기만 유지하는 중이다(expand-contract).
 */
const EVENT_COLUMNS = `id, title, description, start_at, end_at, all_day, visibility,
   location, owner_id, team_id, google_calendar_event_id, created_at, updated_at,
   owner:employees!owner_id(id, name, profile_image_url)`;

/** 내가 참석자인 일정만 뽑을 때 — 조인 조건만 걸고 값은 쓰지 않는다 */
const EVENT_COLUMNS_AS_ATTENDEE = `${EVENT_COLUMNS}, event_attendees!inner(employee_id)`;

type EventRow = Omit<CalendarEventWithOwner, "attendee_ids">;

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

  // 기간이 겹치는 항목: 시작이 to 이전이고, 끝이 from 이후
  const inRange = (columns: string) =>
    supabase
      .from("calendar_events")
      .select(columns)
      .lt("start_at", toIso)
      .gt("end_at", fromIso)
      .order("start_at");

  /**
   * 뷰에 해당하는 일정 행.
   *
   * 개인 뷰는 "내가 만든 일정 + 내가 참석자로 지정된 일정"이다. 참석자가 배열이던
   * 시절에는 or(owner_id.eq, attendee_ids.cs)로 한 번에 걸렸지만, 참석자가 다른
   * 테이블로 옮겨간 지금 PostgREST의 or()는 두 테이블을 함께 걸지 못한다.
   * 참석 일정 id를 먼저 뽑아 in()에 넣는 방법도 있으나, 참석 이력이 쌓이면
   * id 목록이 URL 길이 제한에 걸린다 — 조인으로 한 번 더 조회해 합친다.
   */
  const loadEvents = async (): Promise<EventRow[]> => {
    if (scope === "personal") {
      const [owned, invited] = await Promise.all([
        inRange(EVENT_COLUMNS).eq("owner_id", employeeId),
        inRange(EVENT_COLUMNS_AS_ATTENDEE).eq(
          "event_attendees.employee_id",
          employeeId,
        ),
      ]);

      // 실패하면 데이터가 없는 것과 화면이 구분되지 않는다 — 서버 로그에는 남긴다
      if (owned.error) {
        console.error("[calendar] 내 일정 조회 실패:", owned.error.message);
      }
      if (invited.error) {
        console.error("[calendar] 참석 일정 조회 실패:", invited.error.message);
      }

      // 두 결과가 겹칠 수 있다(등록자가 자기 자신을 참석자 행으로 갖는 경우)
      const merged = new Map<string, EventRow>();
      [...(owned.data ?? []), ...(invited.data ?? [])].forEach((row) => {
        const event = row as unknown as EventRow;
        merged.set(event.id, event);
      });
      return Array.from(merged.values());
    }

    // 팀 미배정자는 팀 일정이 없다. RLS도 막지만 쿼리를 아예 보내지 않는다.
    if (scope === "team" && !teamId) return [];

    const scoped =
      scope === "team"
        ? inRange(EVENT_COLUMNS).eq("visibility", "team").eq("team_id", teamId)
        : inRange(EVENT_COLUMNS).eq("visibility", "company");

    const { data, error } = await scoped;
    if (error) console.error("[calendar] 일정 조회 실패:", error.message);
    return (data ?? []) as unknown as EventRow[];
  };

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

  const [eventRows, { data: bookings, error: bookingError }] =
    await Promise.all([loadEvents(), bookingQuery]);

  if (bookingError) {
    console.error("[calendar] 리소스 예약 조회 실패:", bookingError.message);
  }

  const attendeeMap = await getAttendeeMap(
    eventRows.map((event) => event.id),
    employeeId,
  );

  const eventItems: CalendarItem[] = eventRows.map((event) => {
    const attendees = attendeeMap.get(event.id) ?? [];
    const me = attendees.find((attendee) => attendee.isMe) ?? null;
    return {
      id: event.id,
      /*
       * 참석자로 지정된 남의 일정은 공개범위가 아니라 '참석 일정'으로 둔다.
       * 읽는 사람에게 중요한 건 "이건 전사 공지인가"가 아니라 "내가 가야 하는가"고,
       * 공개범위 그대로 두면 남의 개인 일정이 내 '개인 일정' 칩으로 섞여
       * 수정할 수 있는 것처럼 보인다(실제로는 등록자만 수정 가능).
       */
      kind:
        event.owner_id !== employeeId && me
          ? ("invited" as const)
          : event.visibility,
      title: event.title,
      description: event.description,
      startAt: event.start_at,
      endAt: event.end_at,
      allDay: event.all_day,
      ownerId: event.owner_id,
      ownerName: event.owner?.name ?? null,
      location: event.location ?? null,
      attendees,
      // 등록자는 참석자 행이 없다 — 응답할 대상이 아니라 자리를 만든 사람이다
      myResponse: me?.response ?? null,
      editable: event.owner_id === employeeId,
    };
  });

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
    location: booking.resource?.location ?? null,
    attendees: [],
    myResponse: null,
    editable: booking.booked_by === employeeId,
  }));

  /*
   * 날짜 RPC들은 [p_from, p_to] 를 포함 구간으로 본다. rangeOf()의 to는 마지막
   * 날 '다음' 자정(배타)이라 그대로 넘기면 격자에 없는 하루가 더 딸려 온다 —
   * 그 항목은 어느 셀에도 그려지지 않으면서 요약 밴드와 종류 칩의 건수만
   * 늘린다. 마일스톤처럼 하루짜리 항목이면 통째로 유령이 된다.
   */
  const fromYmd = toSeoulYmdLocal(from);
  const toYmd = addDaysYmd(toSeoulYmdLocal(to), -1);

  // 승인된 연차·휴가 (스펙 03 · 6장 연동)
  // 개인 뷰에서는 본인 것만, 팀·전사 뷰에서는 RLS가 허용하는 범위 전체를 보여준다.
  const leaveItems = await getLeaveItems({
    fromYmd,
    toYmd,
    employeeId,
    onlyMine: scope === "personal",
  });

  // 승인된 출장·재택근무 (스펙 04 · 7장 연동)
  const approvalItems = await getApprovalItems({
    fromYmd,
    toYmd,
    employeeId,
    onlyMine: scope === "personal",
  });

  // 프로젝트 마일스톤 목표일 (스펙 10 · 5장 연동)
  const milestoneItems = await getMilestoneItems({
    fromYmd,
    toYmd,
    onlyMine: scope === "personal",
  });

  return [
    ...eventItems,
    ...bookingItems,
    ...leaveItems,
    ...approvalItems,
    ...milestoneItems,
  ].sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/**
 * 일정 id → 참석자(이름 + 응답).
 *
 * event_attendees가 참석자의 진실이다. 배열이던 시절에는 조인이 걸리지 않아
 * id를 모아 employees를 따로 읽었지만, 이제 한 번의 조인으로 이름과 응답을
 * 함께 가져온다. 퇴사자도 명단에는 남아야 하므로 employment_status로 거르지 않는다.
 */
async function getAttendeeMap(
  eventIds: string[],
  employeeId: string,
): Promise<Map<string, CalendarAttendee[]>> {
  const unique = Array.from(new Set(eventIds.filter(Boolean)));
  if (unique.length === 0) return new Map();

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("event_attendees")
    .select(
      `event_id, employee_id, response,
       employee:employees!employee_id(id, name, profile_image_url)`,
    )
    .in("event_id", unique);

  if (error) {
    console.error("[calendar] 참석자 조회 실패:", error.message);
    return new Map();
  }

  const rows = (data ?? []) as unknown as {
    event_id: string;
    employee_id: string;
    response: EventResponse;
    employee: {
      id: string;
      name: string;
      profile_image_url: string | null;
    } | null;
  }[];

  const map = new Map<string, CalendarAttendee[]>();
  rows.forEach((row) => {
    const list = map.get(row.event_id) ?? [];
    list.push({
      id: row.employee_id,
      // 조인이 비는 건 계정이 지워진 경우다. 자리는 남겨야 인원 수가 맞는다
      name: row.employee?.name ?? "알 수 없음",
      profileImageUrl: row.employee?.profile_image_url ?? null,
      response: row.response,
      isMe: row.employee_id === employeeId,
    });
    map.set(row.event_id, list);
  });

  /*
   * 표시 순서를 고정한다. DB는 순서를 보장하지 않아 새로고침마다 명단이
   * 뒤집혔고, "아까 있던 사람이 사라졌나" 하고 다시 세게 된다.
   * 나를 맨 앞에 두는 이유는 응답해야 하는 사람이 나이기 때문이다.
   */
  map.forEach((list) =>
    list.sort((a, b) => {
      if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
      return a.name.localeCompare(b.name, "ko");
    }),
  );

  return map;
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
        location: null,
        attendees: [],
        myResponse: null,
        editable: false,
      };
    });
}

/**
 * 프로젝트 마일스톤을 캘린더 항목으로 변환 (스펙 10 · 5장)
 *
 * project_milestones를 직접 읽지 않고 list_calendar_milestones() RPC를 쓴다.
 * 휴가·결재와 같은 이유는 아니다 — 마일스톤의 RLS는 전체 SELECT라 조회 자체는
 * 된다. RPC를 쓰는 건 (1) 프로젝트명 조인과 '취소된 프로젝트 제외' 규칙이
 * 화면마다 복제되지 않게 하고, (2) 담당자가 나인지(is_mine) 판정을 DB 한 곳에
 * 두기 위해서다.
 *
 * 마일스톤은 목표'일' 하나뿐이라 종일 항목으로 만든다. 목표일이 없는
 * 마일스톤은 RPC가 애초에 돌려주지 않는다 — 날짜가 없으면 캘린더에 놓일
 * 자리가 없다.
 */
async function getMilestoneItems({
  fromYmd,
  toYmd,
  onlyMine,
}: {
  fromYmd: string;
  toYmd: string;
  onlyMine: boolean;
}): Promise<CalendarItem[]> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase.rpc("list_calendar_milestones", {
    p_from: fromYmd,
    p_to: toYmd,
  });

  if (error) {
    // 스펙 10 마이그레이션 전이면 함수가 없다 — 캘린더는 계속 떠야 한다
    console.error("[calendar] 마일스톤 조회 실패:", error.message);
    return [];
  }

  const rows = (data ?? []) as {
    id: string;
    project_id: string;
    project_name: string;
    title: string;
    due_date: string;
    is_completed: boolean;
    is_mine: boolean;
  }[];

  return rows
    .filter((r) => (onlyMine ? r.is_mine : true))
    .map((r) => ({
      id: `milestone-${r.id}`,
      kind: "milestone" as const,
      // 마일스톤 제목만으로는 어느 프로젝트인지 알 수 없다("1차 오픈"이 여럿이다)
      title: `${r.project_name} · ${r.title}`,
      description: null,
      // 종일 항목. occursOn이 종료 경계를 배타적으로 보므로 다음 날 자정을 끝으로 둔다
      startAt: new Date(`${r.due_date}T00:00:00+09:00`).toISOString(),
      endAt: new Date(
        `${addDaysYmd(r.due_date, 1)}T00:00:00+09:00`,
      ).toISOString(),
      allDay: true,
      // 마일스톤의 주체는 사람이 아니라 프로젝트다
      ownerId: null,
      ownerName: r.project_name,
      location: null,
      attendees: [],
      myResponse: null,
      // 달성 체크는 프로젝트 상세에서 한다 — 캘린더는 표시만 한다
      editable: false,
      completed: r.is_completed,
      sourceHref: `/projects/${r.project_id}`,
    }));
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
      location: null,
      attendees: [],
      myResponse: null,
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

/**
 * 참석자로 고를 수 있는 임직원 (재직자만).
 *
 * 조직도와 같은 목록을 봐야 하므로 getDirectory()를 그대로 쓴다. 여기서
 * employees를 다시 조회하면 "재직자만" 같은 규칙이 두 곳으로 갈라진다.
 * 등록자는 자동으로 참석하므로 목록에서 뺀다.
 */
export async function getAttendeeOptions(
  excludeId: string,
): Promise<AttendeeOption[]> {
  const { employees, departments, teams } = await getDirectory();
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  return employees
    .filter((employee) => employee.id !== excludeId)
    .map((employee) => ({
      id: employee.id,
      name: employee.name,
      position: employee.position,
      org:
        [
          employee.department_id
            ? departmentName.get(employee.department_id)
            : null,
          employee.team_id ? teamName.get(employee.team_id) : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      profileImageUrl: employee.profile_image_url,
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
