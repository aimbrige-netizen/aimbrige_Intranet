import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";

/**
 * 역할 필터는 이름 → id 변환이 필요해 목록 질의보다 먼저 푼다.
 * 목록 화면과 내보내기 액션이 같은 변환을 써야 두 모수가 어긋나지 않는다.
 */
export async function resolveRoleFilterId(
  role: string | undefined,
): Promise<string | null> {
  if (!role) return null;

  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("roles")
    .select("id")
    .eq("name", role)
    .maybeSingle<{ id: string }>();

  // 존재하지 않는 역할 필터면 결과가 비도록 둔다
  return data?.id ?? "00000000-0000-0000-0000-000000000000";
}
