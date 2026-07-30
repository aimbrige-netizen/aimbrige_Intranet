"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSessionEmployee } from "@/lib/auth/session";
import { diffFields, writeAuditLog } from "@/lib/audit";

const schema = z.object({
  phone: z
    .string()
    .trim()
    .max(30, "휴대폰번호가 너무 깁니다.")
    .transform((value) => (value === "" ? null : value))
    .nullable(),
  emergency_contact: z
    .string()
    .trim()
    .max(120, "비상연락처가 너무 깁니다.")
    .transform((value) => (value === "" ? null : value))
    .nullable(),
  profile_image_url: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable(),
});

export interface ProfileActionResult {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  message?: string;
}

/**
 * 내 프로필 수정 (스펙 3.7)
 * 본인이 수정 가능한 항목은 프로필 사진 · 휴대폰번호 · 비상연락처 뿐이다.
 * 사용자 세션으로 UPDATE하므로 RLS(본인 행) + DB 트리거(허용 필드 제한)가 모두 적용된다.
 */
export async function updateMyProfile(
  input: unknown,
): Promise<ProfileActionResult> {
  const me = await requireSessionEmployee();

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const values = parsed.data;
  const supabase = createServerSupabase();

  const { error } = await supabase
    .from("employees")
    .update({
      phone: values.phone,
      emergency_contact: values.emergency_contact,
      profile_image_url: values.profile_image_url,
    })
    .eq("id", me.id);

  if (error) return { ok: false, message: error.message };

  const changes = diffFields(
    {
      phone: me.phone,
      emergency_contact: me.emergency_contact,
      profile_image_url: me.profile_image_url,
    } as Record<string, unknown>,
    values as unknown as Record<string, unknown>,
  );

  if (changes) {
    await writeAuditLog({
      actorId: me.id,
      action: "profile_updated",
      targetId: me.id,
      detail: changes,
    });
  }

  revalidatePath("/profile");
  revalidatePath("/", "layout");
  return { ok: true };
}
