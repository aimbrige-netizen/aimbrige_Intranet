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
     * RLS SELECT 정책이 이 배열을 보므로, 여기 담기는 순간 그 사람에게
     * 개인 일정도 열린다 — 중복·본인은 서버에서 정리한다.
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
      attendee_ids: resolveAttendees(values.attendeeIds, me.id),
      owner_id: me.id,
      team_id: values.visibility === "team" ? me.team_id : null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) return { ok: false, message: error.message };

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
        attendee_ids: resolveAttendees(values.attendeeIds, me.id),
        team_id: values.visibility === "team" ? me.team_id : null,
      },
      { count: "exact" },
    )
    .eq("id", id);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return { ok: false, message: "수정 권한이 없습니다(작성자 본인만 가능)." };
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
