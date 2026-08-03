/**
 * ⚑ Gmail → 메일 화면 뷰모델 **순수 어댑터** (외부 수발신 · 담당 C)
 *
 * 이 파일은 mime.ts와 같은 규약으로 **순수 함수만** 둔다 — 네트워크·DB·
 * 세션을 모르고, ParsedGmailMessage(담당 B의 파서 출력)를 기존 화면 계약
 * (data.ts MailListItem → page.tsx toRow → MailListRow)으로 줄일 뿐이다.
 * 실제 Gmail 자격증명이 없는 환경이라 API를 못 두드리므로, 어댑트 로직을
 * 여기로 잘라 내야 scripts/check-gmail-view.ts가 네트워크 없이 검증할 수 있다.
 *
 * 그래서 "server-only"를 붙이지 않고(tsx 검증 스크립트가 import하면 즉시
 * throw — mime.ts 머리말과 같은 사정), import도 전부 type-only다 —
 * data.ts는 "server-only"지만 타입 import는 컴파일에서 지워져 런타임에
 * 로드되지 않는다. 값 import를 추가하는 순간 검증 스크립트가 죽으니 금지.
 *
 * REST 호출·토큰은 gmail-source.ts(server-only)가 이 함수들을 조립해 쓴다.
 */

import type {
  MailboxFolder,
  MailListFilter,
  MailListItem,
} from "./data";
import type { MailParty, ParsedGmailMessage } from "../../server/gmail/mime";

// ---------------------------------------------------------------------
// 메일함 매핑 — 화면 폴더 ↔ Gmail 시스템 라벨
// ---------------------------------------------------------------------

/**
 * 담당 스펙의 box 매핑: inbox=INBOX, sent=SENT, drafts=DRAFT(1차 읽기만),
 * trash=TRASH. 수신확인함(receipts)은 화면 계층에서 sent로 눌러 내려온다
 * (page.tsx의 기존 규칙 그대로 — Gmail에는 수신확인 개념이 없다).
 */
export const GMAIL_LABEL_OF_FOLDER: Record<MailboxFolder, string> = {
  inbox: "INBOX",
  sent: "SENT",
  drafts: "DRAFT",
  trash: "TRASH",
};

export interface GmailSearch {
  /** 전부 만족(AND)해야 하는 라벨 — client.ts listMessages의 labelIds */
  labelIds: string[];
  /** Gmail 검색 문법 q — 조건이 없으면 undefined(파라미터 자체를 뺀다) */
  q?: string;
}

/**
 * 빠른검색 3종 + 제목 검색 → Gmail 검색 조건.
 *
 * unread/starred는 q("is:unread")가 아니라 **라벨 AND**로 건다 — 시스템
 * 라벨이 정확히 같은 뜻이고, q 문자열 조립보다 이스케이프 사고 여지가 없다.
 * 오늘(sinceYmd)은 라벨이 없어 q의 after:를 쓴다. after:YYYY/MM/DD는
 * Gmail이 메일함 주인의 시간대로 해석한다 — 회사 계정 시간대(서울) 전제라
 * 내부 소스의 "서울 00:00 이후"와 같은 눈금이다.
 *
 * 제목 검색어는 따옴표·중괄호·괄호를 벗긴다 — Gmail 검색 문법의 구분자라
 * 남겨두면 검색어가 연산자로 오작동한다(data.ts keywordOf와 같은 목적).
 */
export function gmailSearchOf(
  folder: MailboxFolder,
  filter: MailListFilter,
): GmailSearch {
  const labelIds = [GMAIL_LABEL_OF_FOLDER[folder]];
  if (filter.unread) labelIds.push("UNREAD");
  if (filter.starred) labelIds.push("STARRED");

  const terms: string[] = [];
  if (filter.sinceYmd) terms.push(`after:${filter.sinceYmd.replace(/-/g, "/")}`);
  const keyword = (filter.q ?? "").replace(/["(){}]/g, "").trim();
  if (keyword) terms.push(`subject:"${keyword}"`);

  return { labelIds, q: terms.length > 0 ? terms.join(" ") : undefined };
}

// ---------------------------------------------------------------------
// ParsedGmailMessage → MailListItem
// ---------------------------------------------------------------------

/**
 * 주소의 표시명 — 표시이름이 없으면 로컬파트(hong@… → hong).
 * format.ts senderName과 같은 폴백 규칙인데, 입력이 원문 헤더 문자열이
 * 아니라 파싱된 MailParty라 여기서 따로 든다.
 */
export function partyLabel(party: MailParty): string {
  if (party.name.trim() !== "") return party.name.trim();
  const at = party.email.indexOf("@");
  return at > 0 ? party.email.slice(0, at) : party.email;
}

/**
 * Gmail 한 통 → 기존 목록 뷰모델(MailListItem).
 *
 * 화면 분기를 없애는 핵심 어댑트 — page.tsx의 toRow는 이 모양만 알면
 * 내부 DB 메일과 똑같이 그린다. 채우는 규칙:
 *
 *   · senderName/recipientNames — 받은함 계열은 발신자, 보낸함 계열은
 *     수신자 요약("홍길동 외 2")을 화면이 만든다(toRow와 같은 분업).
 *   · isRead — 나가는 함(sent/drafts)은 항상 true(안읽음 강조 없음),
 *     받은함·휴지통은 UNREAD 라벨의 반대.
 *   · readCount/recipientCount — null 고정. Gmail은 수신확인이 없어서
 *     여기 수를 채우면 "읽음 0/2" 같은 **틀린 수신확인**이 그려진다.
 *   · trashSource — 휴지통 행은 "recipient"로 둔다. MailList는 Gmail 행
 *     (isInternalMailId=false)을 gmail-mail.ts 액션으로 분기하며, Gmail
 *     영구삭제는 제공하지 않는다(client.ts가 일부러 안 노출한 결정).
 *   · sizeBytes — sizeEstimate(대략치). 목록의 "3.6KB" 표기는 원래도
 *     본문+첨부 합의 근사라 눈금이 같다.
 */
export function toGmailListItem(
  parsed: ParsedGmailMessage,
  folder: MailboxFolder,
): MailListItem {
  const outgoing = folder === "sent" || folder === "drafts";
  return {
    messageId: parsed.id,
    subject: parsed.subject,
    preview: parsed.snippet.replace(/\s+/g, " ").trim().slice(0, 120),
    senderId: null,
    senderName: outgoing ? null : partyLabel(parsed.from),
    at: parsed.internalDate || new Date(0).toISOString(),
    isRead: outgoing ? true : !parsed.unread,
    starred: parsed.starred,
    kind: null,
    readCount: null,
    recipientCount: null,
    recipientNames: [...parsed.to, ...parsed.cc].map(partyLabel),
    attachmentCount: parsed.attachments.length,
    sizeBytes: parsed.sizeEstimate,
    trashSource: folder === "trash" ? "recipient" : null,
  };
}

// ---------------------------------------------------------------------
// 행 단위 소스 판별 — 내부 메일(uuid) vs Gmail id
// ---------------------------------------------------------------------

/**
 * 내부 메일 id는 uuid, Gmail id는 16진수 문자열이다 — [id]/page.tsx·
 * compose/page.tsx의 서버 측 판별과 같은 눈금을 클라이언트 화면(MailList·
 * MailRead)의 액션 분기(내부 actions/mail.ts vs gmail-mail.ts)가 함께 쓴다.
 * 순수 상수/함수라 이 파일의 "값 import 금지(type-only)" 규약을 깨지 않는다.
 */
export const INTERNAL_MAIL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isInternalMailId(id: string): boolean {
  return INTERNAL_MAIL_ID_PATTERN.test(id);
}

// ---------------------------------------------------------------------
// 외부 주소 입력(겸용 필드) 공용 검증
// ---------------------------------------------------------------------

/**
 * 자유 이메일 입력 칩의 형식 검증 — MailComposer(클라이언트)와
 * gmail-mail.ts 액션(서버)이 같은 눈금을 쓴다. RFC 전체를 흉내내지
 * 않는다 — "공백 없음 + @ + 도메인에 점"이면 칩으로 받고, 최종 판정은
 * Gmail 발송이 한다(틀린 주소는 반송으로 돌아온다).
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(text: string): boolean {
  return EMAIL_PATTERN.test(text.trim());
}
