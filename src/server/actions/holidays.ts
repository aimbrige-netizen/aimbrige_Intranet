"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSystemAdmin } from "@/lib/auth/session";

export interface HolidayActionResult {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  message?: string;
}

const schema = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜를 선택하세요."),
  name: z.string().trim().min(1, "휴일명을 입력하세요.").max(40),
  kind: z.enum(["public", "substitute", "temporary", "statutory_leave"]),
  isNonWorking: z.boolean(),
});

/** 공휴일 등록·수정 (같은 날짜면 덮어쓴다) */
export async function upsertHoliday(
  input: unknown,
): Promise<HolidayActionResult> {
  await requireSystemAdmin();

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const supabase = createServerSupabase();
  const { error } = await supabase.from("holidays").upsert(
    {
      date: parsed.data.date,
      name: parsed.data.name,
      kind: parsed.data.kind,
      is_non_working: parsed.data.isNonWorking,
    },
    { onConflict: "date" },
  );

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/holidays");
  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteHoliday(date: string): Promise<HolidayActionResult> {
  await requireSystemAdmin();

  const supabase = createServerSupabase();
  const { error } = await supabase.from("holidays").delete().eq("date", date);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/holidays");
  revalidatePath("/calendar");
  return { ok: true };
}
