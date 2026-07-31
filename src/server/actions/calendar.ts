"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSessionEmployee, requireSystemAdmin } from "@/lib/auth/session";
import {
  createGoogleEvent,
  deleteGoogleEvent,
  updateGoogleEvent,
} from "@/lib/google-calendar";
import { seoulToDate } from "@/features/calendar/date";

export interface CalendarActionResult {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  message?: string;
  id?: string;
}

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

const eventSchema = z
  .object({
    title: z.string().trim().min(1, "제목을 입력하세요.").max(120),
    description: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    startDate: z.string().trim().min(1, "시작 날짜를 선택하세요."),
    startTime: z.string().trim().optional(),
    endDate: z.string().trim().min(1, "종료 날짜를 선택하세요."),
    endTime: z.string().trim().optional(),
    allDay: z.boolean(),
    visibility: z.enum(["personal", "team", "company"]),
    location: z
      .string()
      .trim()
      .max(120, "장소는 120자까지 입력할 수 있습니다.")
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    /*
     * 참석자는 등록자 본인을 제외한 employees.id 배열이다.
     * 여기 담기는 순간 그 사람에게 개인 일정도 열리고 참석 응답을 받는다 —
     * 중복·본인은 서버에서 정리한다.
     */
    attendeeIds: z
      .array(z.string().uuid())
      .max(50, "참석자는 50명까지 지정할 수 있습니다.")
      .optional(),
  })
  .superRefine((value, ctx) => {
    const start = seoulToDate(value.startDate, value.allDay ? "00:00" : (value.startTime || "00:00"));
    // 종일 일정은 종료일 당일을 포함해야 하므로 다음 날 자정까지로 본다
    const end = value.allDay
      ? seoulToDate(value.endDate, "00:00")
      : seoulToDate(value.endDate, value.endTime || "00:00");

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      ctx.addIssue({
        code: "custom",
        path: ["startDate"],
        message: "날짜 형식이 올바르지 않습니다.",
      });
      return;
    }
    if (!value.allDay && end <= start) {
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "종료 시각은 시작 시각보다 뒤여야 합니다.",
      });
    }
    if (value.allDay && value.endDate < value.startDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "종료일은 시작일보다 뒤여야 합니다.",
      });
    }
  });

/** 폼 값 → DB에 넣을 UTC 시각 */
function resolveRange(values: z.infer<typeof eventSchema>) {
  if (values.allDay) {
    return {
      startAt: seoulToDate(values.startDate, "00:00"),
      // 종료일 당일을 포함하도록 다음 날 자정까지
      endAt: seoulToDate(addOneDay(values.endDate), "00:00"),
    };
  }
  return {
    startAt: seoulToDate(values.startDate, values.startTime || "00:00"),
    endAt: seoulToDate(values.endDate, values.endTime || "00:00"),
  };
}

/** 본인 제외 + 중복 제거. 등록자는 참석자 배열에 넣지 않는다(owner_id가 이미 있다) */
function resolveAttendees(ids: string[] | undefined, ownerId: string): string[] {
  return Array.from(new Set(ids ?? [])).filter((id) => id !== ownerId);
}

function addOneDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * 참석자 명단을 event_attendees에 맞춘다.
 *
 * 통째로 지우고 다시 넣지 않는 이유: 남아 있는 사람의 응답(참석/불참/미정)이
 * 매 수정마다 '미응답'으로 되돌아간다. 장소 한 글자를 고쳤을 뿐인데 열 명에게
 * 다시 답을 받아야 하는 화면이 된다. 빠진 사람만 지우고 새로 들어온 사람만 넣는다.
 *
 * attendee_ids 배열은 호출부에서 같은 값으로 계속 쓴다 — RLS가 아직 배열과
 * 테이블을 둘 다 보는 expand-contract 구간이라, 한쪽만 써 두면 배포 사이에
 * 참석자에게 일정이 안 보인다.
 */
/**
 * 참석자 테이블 동기화.
 *
 * 실패를 삼키면 안 된다. 지금은 attendee_ids 배열과 event_attendees 테이블에
 * 이중으로 쓰는 중인데(expand-contract), 배열은 일정 insert/update와 같은
 * 문장이라 반드시 반영되고 테이블만 빠질 수 있다. 그러면 참석자는 배열 덕에
 * 일정은 보이는데 event_attendees 행이 없어 참석 여부 블록이 아예 안 뜬다.
 * 화면이 "저장됐다"고 말하면서 절반만 저장된 상태가 가장 나쁘다.
 */
async function syncEventAttendees(
  eventId: string,
  attendeeIds: string[],
): Promise<string | null> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("event_attendees")
    .select("employee_id")
    .eq("event_id", eventId);

  if (error) {
    console.error("[calendar] 참석자 조회 실패:", error.message);
    return "참석자 정보를 불러오지 못했습니다.";
  }

  const current = new Set(
    ((data ?? []) as { employee_id: string }[]).map((row) => row.employee_id),
  );
  const next = new Set(attendeeIds);
  const removed = Array.from(current).filter((id) => !next.has(id));
  const added = attendeeIds.filter((id) => !current.has(id));

  if (removed.length > 0) {
    const { error: deleteError } = await supabase
      .from("event_attendees")
      .delete()
      .eq("event_id", eventId)
      .in("employee_id", removed);
    if (deleteError) {
      console.error("[calendar] 참석자 제외 실패:", deleteError.message);
      return "참석자 변경을 저장하지 못했습니다.";
    }
  }

  if (added.length > 0) {
    const { error: insertError } = await supabase
      .from("event_attendees")
      .insert(
        added.map((employeeId) => ({
          event_id: eventId,
          employee_id: employeeId,
        })),
      );
    if (insertError) {
      console.error("[calendar] 참석자 추가 실패:", insertError.message);
      return "참석자를 추가하지 못했습니다.";
    }
  }

  return null;
}

/** 일정 등록 (스펙 3.5) */
export async function createCalendarEvent(
  input: unknown,
): Promise<CalendarActionResult> {
  const me = await requireSessionEmployee();
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  const values = parsed.data;
  const { startAt, endAt } = resolveRange(values);

  // 팀 일정인데 소속 팀이 없으면 아무에게도 안 보이는 일정이 된다
  if (values.visibility === "team" && !me.team_id) {
    return {
      ok: false,
      fieldErrors: {
        visibility: "소속 팀이 없어 팀 일정을 만들 수 없습니다.",
      },
    };
  }

  const supabase = createServerSupabase();
  const attendeeIds = resolveAttendees(values.attendeeIds, me.id);
  const { data, error } = await supabase
    .from("calendar_events")
    .insert({
      title: values.title,
      description: values.description ?? null,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      all_day: values.allDay,
      visibility: values.visibility,
      location: values.location ?? null,
      attendee_ids: attendeeIds,
      owner_id: me.id,
      team_id: values.visibility === "team" ? me.team_id : null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) return { ok: false, message: error.message };

  // 참석자 행은 일정이 생긴 뒤에만 만들 수 있다(FK + 소유자 확인 정책)
  const attendeeError = await syncEventAttendees(data.id, attendeeIds);
  if (attendeeError) {
    // 일정은 이미 저장됐다 — 되돌리지 않고 사실대로 알린다
    return { ok: false, message: `${attendeeError} 일정은 저장됐습니다.` };
  }

  // 구글 동기화는 실패해도 일정 저장을 되돌리지 않는다(스펙 5장)
  const googleId = await createGoogleEvent({
    title: values.title,
    description: values.description ?? null,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    allDay: values.allDay,
    location: values.location ?? null,
  });

  if (googleId) {
    await supabase
      .from("calendar_events")
      .update({ google_calendar_event_id: googleId })
      .eq("id", data.id);
  }

  revalidatePath("/calendar");
  revalidatePath("/");
  return { ok: true, id: data.id };
}

export async function updateCalendarEvent(
  id: string,
  input: unknown,
): Promise<CalendarActionResult> {
  const me = await requireSessionEmployee();
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  const values = parsed.data;
  const { startAt, endAt } = resolveRange(values);

  if (values.visibility === "team" && !me.team_id) {
    return {
      ok: false,
      fieldErrors: { visibility: "소속 팀이 없어 팀 일정을 만들 수 없습니다." },
    };
  }

  const supabase = createServerSupabase();
  const { data: before } = await supabase
    .from("calendar_events")
    .select("google_calendar_event_id")
    .eq("id", id)
    .maybeSingle<{ google_calendar_event_id: string | null }>();

  const attendeeIds = resolveAttendees(values.attendeeIds, me.id);
  const { error, count } = await supabase
    .from("calendar_events")
    .update(
      {
        title: values.title,
        description: values.description ?? null,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        all_day: values.allDay,
        visibility: values.visibility,
        location: values.location ?? null,
        attendee_ids: attendeeIds,
        team_id: values.visibility === "team" ? me.team_id : null,
      },
      { count: "exact" },
    )
    .eq("id", id);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return { ok: false, message: "수정 권한이 없습니다(작성자 본인만 가능)." };
  }

  // 권한이 확인된 뒤에만 명단을 손댄다 — 남의 일정 참석자를 지우면 안 된다
  const attendeeError = await syncEventAttendees(id, attendeeIds);
  if (attendeeError) {
    return { ok: false, message: `${attendeeError} 일정 내용은 저장됐습니다.` };
  }

  if (before?.google_calendar_event_id) {
    await updateGoogleEvent(before.google_calendar_event_id, {
      title: values.title,
      description: values.description ?? null,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      allDay: values.allDay,
      location: values.location ?? null,
    });
  }

  revalidatePath("/calendar");
  revalidatePath("/");
  return { ok: true, id };
}

export async function deleteCalendarEvent(
  id: string,
): Promise<CalendarActionResult> {
  await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { data: before } = await supabase
    .from("calendar_events")
    .select("google_calendar_event_id")
    .eq("id", id)
    .maybeSingle<{ google_calendar_event_id: string | null }>();

  const { error, count } = await supabase
    .from("calendar_events")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return { ok: false, message: "삭제 권한이 없습니다(작성자 본인만 가능)." };
  }

  if (before?.google_calendar_event_id) {
    await deleteGoogleEvent(before.google_calendar_event_id);
  }

  revalidatePath("/calendar");
  revalidatePath("/");
  return { ok: true };
}

/*
 * 참석 응답.
 *
 * 화면에서 되돌릴 수 있는 값은 세 가지뿐이다 — 'pending'은 "아직 답하지 않았다"는
 * 초기 상태지 사람이 고르는 답이 아니다. 답을 무르는 버튼을 두면 명단에
 * "답을 취소한 사람"과 "아직 안 본 사람"이 같은 칸에 섞인다.
 */
const respondSchema = z.object({
  eventId: z.string().uuid("일정을 찾을 수 없습니다."),
  response: z.enum(["accepted", "declined", "tentative"]),
});

export async function respondToEvent(
  eventId: string,
  response: string,
): Promise<CalendarActionResult> {
  await requireSessionEmployee();

  const parsed = respondSchema.safeParse({ eventId, response });
  if (!parsed.success) {
    return { ok: false, message: "알 수 없는 응답입니다." };
  }

  /*
   * UPDATE가 아니라 RPC로 간다. 정책으로 UPDATE를 열면 response뿐 아니라
   * event_id·employee_id까지 바꿀 수 있어 남의 행을 자기 것으로 만들 수 있다.
   * 함수는 "본인 행의 response만" 바꾼다.
   */
  const supabase = createServerSupabase();
  const { error } = await supabase.rpc("respond_to_event", {
    p_event_id: parsed.data.eventId,
    p_response: parsed.data.response,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/calendar");
  revalidatePath("/");
  return { ok: true, id: eventId };
}

// ---------------------------------------------------------------------
// 리소스 예약 (스펙 3.6)
// ---------------------------------------------------------------------

const bookingSchema = z
  .object({
    resourceId: z.string().trim().min(1, "리소스를 선택하세요."),
    date: z.string().trim().min(1, "날짜를 선택하세요."),
    startTime: z.string().trim().min(1, "시작 시각을 선택하세요."),
    endTime: z.string().trim().min(1, "종료 시각을 선택하세요."),
    purpose: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.endTime <= value.startTime) {
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "종료 시각은 시작 시각보다 뒤여야 합니다.",
      });
    }
  });

export async function createResourceBooking(
  input: unknown,
): Promise<CalendarActionResult> {
  const me = await requireSessionEmployee();
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  const values = parsed.data;
  const startAt = seoulToDate(values.date, values.startTime);
  const endAt = seoulToDate(values.date, values.endTime);

  const supabase = createServerSupabase();

  // 비활성 리소스는 예약할 수 없다 (스펙 3.6 "활성 항목만 노출").
  // UI 필터만으로는 오래된 화면·직접 호출을 막지 못한다.
  const { data: resource } = await supabase
    .from("resources")
    .select("is_active")
    .eq("id", values.resourceId)
    .maybeSingle<{ is_active: boolean }>();

  if (!resource) {
    return { ok: false, fieldErrors: { resourceId: "리소스를 찾을 수 없습니다." } };
  }
  if (!resource.is_active) {
    return {
      ok: false,
      fieldErrors: { resourceId: "비활성화된 리소스는 예약할 수 없습니다." },
    };
  }

  const { data, error } = await supabase
    .from("resource_bookings")
    .insert({
      resource_id: values.resourceId,
      booked_by: me.id,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      purpose: values.purpose ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    // EXCLUDE 제약 위반 = 시간대 중복. 동시 요청도 여기서 걸린다.
    if (error.code === "23P01") {
      return {
        ok: false,
        fieldErrors: { startTime: "이미 예약된 시간입니다." },
      };
    }
    return { ok: false, message: error.message };
  }

  revalidatePath("/calendar");
  return { ok: true, id: data.id };
}

export async function deleteResourceBooking(
  id: string,
): Promise<CalendarActionResult> {
  await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { error, count } = await supabase
    .from("resource_bookings")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return { ok: false, message: "삭제 권한이 없습니다(예약자 본인만 가능)." };
  }

  revalidatePath("/calendar");
  return { ok: true };
}

// ---------------------------------------------------------------------
// 리소스 관리 (스펙 3.7) — 시스템 관리자 전용
// ---------------------------------------------------------------------

const resourceSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력하세요.").max(60),
  type: z.enum(["meeting_room", "vehicle", "equipment"]),
  capacity: z
    .union([z.number(), z.string()])
    .transform((v) => {
      const n = typeof v === "string" ? Number(v.trim()) : v;
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    })
    .nullable()
    .optional(),
  location: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  isActive: z.boolean(),
});

export async function createResource(
  input: unknown,
): Promise<CalendarActionResult> {
  await requireSystemAdmin();
  const parsed = resourceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("resources")
    .insert({
      name: parsed.data.name,
      type: parsed.data.type,
      capacity: parsed.data.capacity ?? null,
      location: parsed.data.location ?? null,
      is_active: parsed.data.isActive,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/resources");
  revalidatePath("/calendar");
  return { ok: true, id: data.id };
}

export async function updateResource(
  id: string,
  input: unknown,
): Promise<CalendarActionResult> {
  await requireSystemAdmin();
  const parsed = resourceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("resources")
    .update({
      name: parsed.data.name,
      type: parsed.data.type,
      capacity: parsed.data.capacity ?? null,
      location: parsed.data.location ?? null,
      is_active: parsed.data.isActive,
    })
    .eq("id", id);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/resources");
  revalidatePath("/calendar");
  return { ok: true, id };
}
