"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSessionEmployee } from "@/lib/auth/session";

export interface ActionResult {
  ok: boolean;
  message?: string;
}

/**
 * 즐겨찾기 추가 (스펙 3.2 — 사이드바 메뉴 우클릭/… 메뉴에서 추가)
 * favorites 테이블은 RLS로 본인 행만 허용되므로 사용자 세션 클라이언트를 그대로 쓴다.
 */
export async function addFavorite(
  label: string,
  targetPath: string,
): Promise<ActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  if (!targetPath.startsWith("/")) {
    return { ok: false, message: "내부 경로만 즐겨찾기에 추가할 수 있습니다." };
  }

  const { count } = await supabase
    .from("favorites")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", me.id);

  const { error } = await supabase.from("favorites").upsert(
    {
      employee_id: me.id,
      label,
      target_path: targetPath,
      sort_order: count ?? 0,
    },
    { onConflict: "employee_id,target_path" },
  );

  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeFavorite(targetPath: string): Promise<ActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { error } = await supabase
    .from("favorites")
    .delete()
    .eq("employee_id", me.id)
    .eq("target_path", targetPath);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeFavoriteById(id: string): Promise<ActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { error } = await supabase
    .from("favorites")
    .delete()
    .eq("id", id)
    .eq("employee_id", me.id);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}
