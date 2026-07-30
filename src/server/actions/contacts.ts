"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSessionEmployee } from "@/lib/auth/session";

export interface ContactActionResult {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  message?: string;
}

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const schema = z.object({
  name: z.string().trim().min(1, "이름을 입력하세요.").max(60),
  company: optionalText,
  role: optionalText,
  phone: optionalText,
  email: optionalText,
  memo: optionalText,
  category: z
    .enum(["vendor", "client", "partner"])
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
});

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

/**
 * 외부 연락처 (스펙 02 · 3.3)
 * 전체 임직원이 등록 가능하고, 수정·삭제는 등록자 본인 또는 관리자만.
 * 권한은 RLS가 강제하므로 사용자 세션 클라이언트를 그대로 쓴다.
 */
export async function createExternalContact(
  input: unknown,
): Promise<ContactActionResult> {
  const me = await requireSessionEmployee();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = createServerSupabase();
  const { error } = await supabase.from("external_contacts").insert({
    ...parsed.data,
    category: parsed.data.category ?? null,
    created_by: me.id,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/directory");
  return { ok: true };
}

export async function updateExternalContact(
  id: string,
  input: unknown,
): Promise<ContactActionResult> {
  await requireSessionEmployee();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = createServerSupabase();
  const { error, count } = await supabase
    .from("external_contacts")
    .update({ ...parsed.data, category: parsed.data.category ?? null }, {
      count: "exact",
    })
    .eq("id", id);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    // RLS에 걸리면 에러 없이 0건이 업데이트된다
    return { ok: false, message: "수정 권한이 없습니다(등록자 본인만 가능)." };
  }

  revalidatePath("/directory");
  return { ok: true };
}

export async function deleteExternalContact(
  id: string,
): Promise<ContactActionResult> {
  await requireSessionEmployee();

  const supabase = createServerSupabase();
  const { error, count } = await supabase
    .from("external_contacts")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return { ok: false, message: "삭제 권한이 없습니다(등록자 본인만 가능)." };
  }

  revalidatePath("/directory");
  return { ok: true };
}
