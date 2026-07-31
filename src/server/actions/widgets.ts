"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSessionEmployee } from "@/lib/auth/session";
import { WIDGET_KEYS } from "@/types/db";

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

  if (error) {
    /*
     * 원문을 그대로 올리면 화면에
     *   new row for relation "dashboard_widgets" violates check constraint ...
     * 이 뜬다. 임직원이 읽고 할 수 있는 게 없는 문장이다.
     * 원인 추적에 필요한 건 서버 로그에 남기고 화면에는 상태만 알린다.
     */
    console.error("[widgets] 설정 저장 실패", error.message);
    return {
      ok: false,
      message: "위젯 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  revalidatePath("/");
  return { ok: true };
}
