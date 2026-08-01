/**
 * 위키 트리 조립 (스펙 14 · 3.1)
 *
 * data.ts에서 뺐다. data.ts는 "server-only"를 들고 있어서 서버 컴포넌트 밖에서는
 * import하는 순간 예외가 난다 — 순수 계산인 이 함수를 검증하려고 Supabase 접속을
 * 같이 끌고 올 이유가 없다. data.ts가 그대로 재수출하므로 화면 쪽 import는
 * 바뀌지 않는다.
 */

export interface WikiNode {
  id: string;
  title: string;
  parent_id: string | null;
  updated_at: string;
  updated_by_name: string | null;
  child_count: number;
}

export interface WikiTreeNode extends WikiNode {
  children: WikiTreeNode[];
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
