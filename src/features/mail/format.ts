/**
 * Gmail 링크 만들기 (스펙 11)
 *
 * 서버·클라이언트 양쪽에서 쓴다(상단바는 클라이언트 컴포넌트, 위젯은 서버).
 * 그래서 "server-only"를 붙이지 않는다.
 *
 * ── /mail/u/0 을 쓰지 않는 이유
 * `u/0`은 "브라우저에서 첫 번째로 로그인한 구글 계정"이다. 회사 계정을
 * 두 번째로 로그인한 사람(개인 지메일을 먼저 쓰던 사람)은 이 링크를 누르면
 * 남의 메일함... 정확히는 자기 개인 메일함이 열린다. 회사 메일을 보려고
 * 누른 건데 개인 메일이 열리면 링크가 고장 난 것처럼 보인다.
 *
 * `u/{이메일}`을 쓰면 구글이 그 주소로 로그인된 세션을 골라준다. 해당 계정으로
 * 로그인돼 있지 않으면 계정 선택 화면이 뜬다 — 엉뚱한 메일함이 열리는 것보다 낫다.
 */

const GMAIL_BASE = "https://mail.google.com/mail";

/** 받은편지함 (상단바 메일 아이콘) */
export function gmailInboxUrl(email: string): string {
  return `${GMAIL_BASE}/u/${encodeURIComponent(email)}/#inbox`;
}

/**
 * 개별 메일.
 *
 * Gmail 웹의 해시 라우트는 메시지 ID를 16진수로 받는데, API가 주는 id가
 * 이미 16진수 문자열이라 그대로 넣으면 된다.
 */
export function gmailMessageUrl(email: string, messageId: string): string {
  return `${GMAIL_BASE}/u/${encodeURIComponent(email)}/#inbox/${messageId}`;
}

/**
 * `"홍길동" <hong@aimbrige.kr>` → `홍길동`
 * 표시이름이 없으면 주소의 로컬파트(`hong`)를 쓴다. 위젯 한 줄에 들어가야 해서
 * 전체 주소를 그대로 두면 제목이 밀린다.
 */
export function senderName(from: string): string {
  const trimmed = from.trim();

  const angled = trimmed.match(/^(.*?)\s*<([^>]+)>$/);
  if (angled) {
    const label = angled[1].replace(/^"(.*)"$/, "$1").trim();
    if (label) return label;
    return localPart(angled[2]);
  }

  return trimmed.includes("@") ? localPart(trimmed) : trimmed;
}

function localPart(address: string): string {
  const at = address.indexOf("@");
  return at > 0 ? address.slice(0, at) : address;
}
