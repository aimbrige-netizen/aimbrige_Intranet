"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSessionEmployee } from "@/lib/auth/session";
import type { WidgetKey } from "@/types/db";

const WIDGET_KEYS: WidgetKey[] = [
  "approval_pending",
  "attendance_today",
  "notices",
  "calendar_upcoming",
  "favorites",
];

/**
 * 위젯 표시/숨김 저장 (스펙 3.3)
 * MVP는 순서 변경 없이 표시/숨김만 지원하므로 sort_order는 기본 순서를 그대로 넣는다.
 */
export async function saveWidgetSettings(
  visibility: Record<string, boolean>,
): Promise<{ ok: boolean; message?: string }> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  const rows = WIDGET_KEYS.map((key, index) => ({
    employee_id: me.id,
    widget_key: key,
    is_visible: visibility[key] ?? true,
    sort_order: index,
  }));

  const { error } = await supabase
    .from("dashboard_widgets")
    .upsert(rows, { onConflict: "employee_id,widget_key" });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/");
  return { ok: true };
}
