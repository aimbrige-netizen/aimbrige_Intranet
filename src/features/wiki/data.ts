import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";

/**
 * 위키 조회 (스펙 14)
 *
 * 트리와 검색은 RPC로 받는다. 트리에 본문까지 실어 보내면 문서가 200개일 때
 * 응답이 수 MB가 되는데, 화면에 필요한 건 제목·계층·수정정보뿐이다.
 */

export interface WikiNode {
  id: string;
  title: string;
  parent_id: string | null;
  updated_at: string;
  updated_by_name: string | null;
  child_count: number;
}

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

/**
 * 평면 목록을 트리로 세운다.
 *
 * 상위 문서가 목록에 없는 경우(권한·삭제)는 최상위로 올린다.
 * 그냥 버리면 그 문서와 그 아래가 화면에서 통째로 사라지는데,
 * 사라진 줄도 모르는 게 제일 나쁘다.
 *
 * DB 트리거가 순환을 막고 있지만 여기서도 방문 표시를 둔다 —
 * 트리 렌더링이 무한히 도는 건 화면이 통째로 멈추는 사고다.
 */
export interface WikiTreeNode extends WikiNode {
  children: WikiTreeNode[];
}

export function buildWikiTree(nodes: WikiNode[]): WikiTreeNode[] {
  const byId = new Map<string, WikiTreeNode>(
    nodes.map((node) => [node.id, { ...node, children: [] }]),
  );
  const roots: WikiTreeNode[] = [];

  for (const node of Array.from(byId.values())) {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }

  const seen = new Set<string>();
  const prune = (list: WikiTreeNode[]): WikiTreeNode[] =>
    list.flatMap((node) => {
      if (seen.has(node.id)) return [];
      seen.add(node.id);
      return [{ ...node, children: prune(node.children) }];
    });

  const tree = prune(roots);

  /*
   * A→B, B→A 같은 순환이 있으면 둘 다 서로를 부모로 봐서 roots에 못 들어가고,
   * 결과적으로 트리 어디에도 안 나온다. DB 트리거가 순환을 막고 있지만
   * 화면에서 문서가 조용히 사라지는 건 원인을 찾기 가장 어려운 종류라,
   * 남은 것은 최상위로 끌어올려 최소한 눈에 보이게 한다.
   */
  const orphans = nodes
    .filter((node) => !seen.has(node.id))
    .map((node) => ({ ...node, children: [] }));

  return [...tree, ...orphans];
}
