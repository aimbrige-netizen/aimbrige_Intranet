/**
 * 위키 본문 링크의 스킴 판정 (스펙 14 · 3.2)
 *
 * Markdown.tsx의 Anchor 안에 있던 판정을 밖으로 뺐다. 이 판정이 한 글자만
 * 틀려도 전 직원이 편집하는 문서에서 피싱 링크가 그대로 살아나는데, JSX 안에
 * 묻혀 있으면 컴포넌트를 렌더링하지 않고는 확인할 방법이 없다. 순수 함수로
 * 두면 스크립트에서 직접 찌를 수 있다(scripts/e2e-wiki.ts).
 *
 * 판정은 허용 목록이다. 내부 절대경로와 http(s)만 링크가 되고 나머지는 전부
 * 글자로 남는다 — 위험한 스킴을 하나씩 막는 방식은 새 스킴이 나올 때마다
 * 뚫린다.
 */

export type WikiLinkKind =
  /** 우리 도메인 안 — next/link로 이동 */
  | "internal"
  /** 바깥 사이트 — 새 탭 + rel="noopener noreferrer" */
  | "external"
  /** 링크로 만들지 않고 글자로 남긴다 */
  | "unsafe";

/**
 * "/" 로 시작한다고 다 내부가 아니다. //evil.com 은 프로토콜 상대 URL이라
 * 브라우저가 https://evil.com 으로 읽고, /\evil.com 도 백슬래시를 /로
 * 정규화해서 같은 곳으로 간다. 이걸 내부로 보면 "외부로 나간다"는 신호도
 * rel=noopener도 없이 같은 탭에서 남의 사이트로 이동한다 —
 * 전 직원이 편집하는 위키에서 피싱 링크를 심기 딱 좋은 자리다.
 *
 * javascript:·data: 같은 스킴은 두 조건 어디에도 안 걸려 "unsafe"로 떨어진다.
 * 정규식에 i 플래그가 있어 JaVaScRiPt: 처럼 섞어 써도 마찬가지다.
 */
export function classifyWikiLink(href: string): WikiLinkKind {
  if (/^\/(?![/\\])/.test(href)) return "internal";
  if (/^https?:\/\//i.test(href)) return "external";
  return "unsafe";
}

/**
 * `[라벨](주소)` 의 주소 부분.
 *
 * 괄호가 한 겹 들어간 주소를 허용한다. 처음엔 `[^)\s]+`로 첫 닫는 괄호까지만
 * 잡았는데, 그러면
 *   [API 설명](https://en.wikipedia.org/wiki/API_(computing))
 * 가 `..._(computing` 으로 잘려 404가 되고 남은 `)`는 글자로 튀어나온다.
 * 위키백과 주소는 사내 위키에서 흔하다.
 *
 * 두 갈래가 첫 글자에서 갈리므로(`[^()\s]`는 `(`를 배제, 다른 쪽은 `(`로 시작)
 * 백트래킹이 갈라지지 않는다 — 입력 길이에 선형이다.
 */
const LINK = String.raw`\[[^\]]+\]\((?:[^()\s]|\([^()\s]*\))+\)`;

/** 굵게 · 인라인코드 · 링크를 한 번에 훑는 패턴 (Markdown.tsx의 Inline에서 쓴다) */
export const INLINE_PATTERN = new RegExp(
  String.raw`(\*\*[^*]+\*\*)|(` + "`[^`]+`" + String.raw`)|(${LINK})`,
  "g",
);

/** 링크 토큰 하나에서 라벨과 주소를 꺼낸다 */
export function parseLinkToken(
  token: string,
): { label: string; href: string } | null {
  const m = token.match(
    new RegExp(String.raw`^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)$`),
  );
  return m ? { label: m[1], href: m[2] } : null;
}
