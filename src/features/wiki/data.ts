import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type { WikiNode } from "@/features/wiki/tree";

/**
 * 위키 조회 (스펙 14)
 *
 * 트리와 검색은 RPC로 받는다. 트리에 본문까지 실어 보내면 문서가 200개일 때
 * 응답이 수 MB가 되는데, 화면에 필요한 건 제목·계층·수정정보뿐이다.
 *
 * 트리 조립(buildWikiTree)은 DB가 필요 없는 순수 계산이라 tree.ts에 있다.
 * 화면은 계속 여기서 가져다 쓰도록 그대로 재수출한다.
 */

export type { WikiNode, WikiTreeNode } from "@/features/wiki/tree";
export { buildWikiTree } from "@/features/wiki/tree";

export interface WikiPage {
  id: string;
  title: string;
  content: string;
  parent_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WikiSearchHit {
  id: string;
  title: string;
  parent_id: string | null;
  updated_at: string;
  updated_by_name: string | null;
  snippet: string;
}

export interface WikiRevision {
  id: string;
  page_id: string;
  title: string;
  content: string;
  edited_by: string | null;
  edited_at: string;
  editor_name: string;
}

export interface LoadResult<T> {
  data: T;
  error: string | null;
}

export async function getWikiTree(): Promise<LoadResult<WikiNode[]>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("list_wiki_pages");

  if (error) {
    console.error("[wiki] 목록 조회 실패:", error.message);
    return { data: [], error: error.message };
  }
  return { data: (data ?? []) as WikiNode[], error: null };
}

export async function searchWiki(
  query: string,
): Promise<LoadResult<WikiSearchHit[]>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("search_wiki", { p_query: query });

  if (error) {
    console.error("[wiki] 검색 실패:", error.message);
    return { data: [], error: error.message };
  }
  return { data: (data ?? []) as WikiSearchHit[], error: null };
}

export async function getWikiPage(
  pageId: string,
): Promise<LoadResult<(WikiPage & { updated_by_name: string | null }) | null>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("wiki_pages")
    .select(
      "id, title, content, parent_id, created_by, updated_by, created_at, updated_at, employees:updated_by(name)",
    )
    .eq("id", pageId)
    .maybeSingle();

  if (error) {
    console.error("[wiki] 문서 조회 실패:", error.message);
    return { data: null, error: error.message };
  }
  if (!data) return { data: null, error: null };

  const row = data as unknown as WikiPage & { employees: { name: string } | null };
  return {
    data: { ...row, updated_by_name: row.employees?.name ?? null },
    error: null,
  };
}

export async function getWikiRevisions(
  pageId: string,
): Promise<LoadResult<WikiRevision[]>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("wiki_page_revisions")
    .select("id, page_id, title, content, edited_by, edited_at, employees:edited_by(name)")
    .eq("page_id", pageId)
    .order("edited_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[wiki] 수정 이력 조회 실패:", error.message);
    return { data: [], error: error.message };
  }

  const rows = (data ?? []) as unknown as (WikiRevision & {
    employees: { name: string } | null;
  })[];

  return {
    data: rows.map((row) => ({
      ...row,
      // 퇴사자가 남긴 이력도 이력이다 — 이름만 없어질 뿐 기록은 남는다
      editor_name: row.employees?.name ?? "(퇴사자)",
    })),
    error: null,
  };
}
