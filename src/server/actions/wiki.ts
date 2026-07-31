"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  requireSessionEmployee,
  requireSystemAdmin,
} from "@/lib/auth/session";

/**
 * 위키 (스펙 14)
 *
 * 저장은 DB 함수(save_wiki_page)가 한다. "이전 내용을 스냅샷으로 남기고 본문을
 * 갱신"은 두 문장인데, 이어 쏘면 사이에서 끊겼을 때 스냅샷 없이 내용만 바뀌거나
 * 스냅샷만 쌓이고 본문은 그대로인 상태가 남는다. 수정 이력이 본체인 모듈에서
 * 그건 기능이 없는 것과 같다.
 */

export interface WikiActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  pageId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pageSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "제목을 입력하세요.")
    .max(200, "200자 이내로 입력하세요."),
  content: z.string().max(200_000, "본문이 너무 깁니다."),
  parentId: z.string().regex(UUID).nullable().optional(),
});

export async function saveWikiPage(input: {
  pageId?: string;
  title: string;
  content: string;
  parentId?: string | null;
}): Promise<WikiActionResult> {
  await requireSessionEmployee();
  const supabase = createServerSupabase();

  if (input.pageId && !UUID.test(input.pageId)) {
    return { ok: false, message: "문서를 찾을 수 없습니다." };
  }

  const parsed = pageSchema.safeParse({
    title: input.title,
    content: input.content,
    parentId: input.parentId || null,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  // 자기 자신을 상위로 고르는 건 DB도 막지만, 화면에서 먼저 걸러 문구를 읽히게 한다
  if (input.pageId && parsed.data.parentId === input.pageId) {
    return { ok: false, fieldErrors: { parentId: "자기 자신을 상위 문서로 둘 수 없습니다." } };
  }

  const { data, error } = await supabase.rpc("save_wiki_page", {
    p_page_id: input.pageId ?? null,
    p_title: parsed.data.title,
    p_content: parsed.data.content,
    p_parent_id: parsed.data.parentId ?? null,
  });

  if (error) {
    // 함수가 raise한 문구는 우리가 쓴 한국어라 그대로 올린다
    const message = /[가-힣]/.test(error.message)
      ? error.message
      : "저장하지 못했습니다.";
    if (!/[가-힣]/.test(error.message)) {
      console.error("[wiki] 저장 실패:", error.message);
    }
    return { ok: false, message };
  }

  const pageId = String(data);
  revalidatePath("/wiki");
  revalidatePath(`/wiki/${pageId}`);
  return { ok: true, pageId };
}

/**
 * 문서 삭제 — 관리자만.
 *
 * 하위 문서는 함께 지우지 않고 최상위로 올라온다(FK on delete set null).
 * cascade면 상위 하나를 지울 때 그 아래가 통째로 사라지는데, 지운 사람도
 * 무엇이 같이 사라졌는지 모른다.
 */
export async function deleteWikiPage(pageId: string): Promise<WikiActionResult> {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  if (!UUID.test(pageId)) return { ok: false, message: "문서를 찾을 수 없습니다." };

  const { data: deleted, error } = await supabase
    .from("wiki_pages")
    .delete()
    .eq("id", pageId)
    .select("id");

  if (error) {
    console.error("[wiki] 삭제 실패:", error.message);
    return { ok: false, message: "삭제하지 못했습니다." };
  }
  if (!deleted || deleted.length === 0) {
    return { ok: false, message: "이미 삭제된 문서입니다." };
  }

  revalidatePath("/wiki");
  redirect("/wiki");
}
