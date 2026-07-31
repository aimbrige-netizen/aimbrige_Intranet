import type { WikiNode } from "@/features/wiki/data";
import type { ParentOption } from "@/features/wiki/WikiEditor";

/**
 * 상위 문서 select의 선택지 (스펙 14 · 3.3)
 *
 * 두 가지를 한다.
 *
 * 1) 경로를 붙인다. "회의록"이라는 제목이 팀마다 있으면 목록에 같은 글자가
 *    여러 줄 뜨는데, 그중 어느 것을 고르는지 알 수가 없다.
 *
 * 2) 편집 중인 문서와 그 하위를 뺀다. 자기 아래로 들어가는 순환은 DB 트리거가
 *    막지만, 고를 수는 있는데 저장할 때 오류가 뜨는 건 고르기 전에 막는 것보다
 *    나쁘다 — 사용자는 왜 안 되는지 모른 채 다른 방법을 찾게 된다.
 */
export function buildParentOptions(
  nodes: WikiNode[],
  excludeId?: string,
): ParentOption[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  /** 순환 데이터가 있어도 멈추도록 깊이 상한을 둔다 */
  const pathOf = (node: WikiNode): string => {
    const parts = [node.title];
    let current = node.parent_id ? byId.get(node.parent_id) : undefined;
    let depth = 0;
    while (current && depth < 20) {
      parts.unshift(current.title);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
      depth += 1;
    }
    return parts.join(" › ");
  };

  const isDescendant = (node: WikiNode): boolean => {
    if (!excludeId) return false;
    let current: WikiNode | undefined = node;
    let depth = 0;
    while (current && depth < 20) {
      if (current.id === excludeId) return true;
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
      depth += 1;
    }
    return false;
  };

  return nodes
    .filter((node) => !isDescendant(node))
    .map((node) => ({ id: node.id, path: pathOf(node) }))
    .sort((a, b) => a.path.localeCompare(b.path, "ko"));
}
