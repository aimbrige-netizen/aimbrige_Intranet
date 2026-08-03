/**
 * Gmail → 뷰모델 어댑터 검증 (외부 수발신 · 담당 C)
 *
 *   npx tsx scripts/check-gmail-view.ts
 *
 * 실제 Gmail 자격증명이 없는 환경이라 API는 못 두드린다(check-gmail-mime과
 * 같은 사정). 어댑트 로직을 gmail-view.ts(순수·server-only 없음)로 잘라
 * 두었으므로, 화면 계약이 깨지는 자리를 네트워크 없이 찌른다.
 *
 *  (1) 메일함·필터 매핑 — box↔라벨, 빠른검색 3종이 라벨/q 어느 쪽으로
 *      가는지, 검색어의 Gmail 연산자 문자가 벗겨지는지.
 *  (2) 목록 어댑트 — 안읽음 강조·별표·첨부·수신자 요약의 근거 필드가
 *      MailListItem 계약(내부 소스와 같은 모양)대로 채워지는지. 특히
 *      readCount/recipientCount가 null(틀린 수신확인 방지)인지.
 *  (3) 이메일 형식 검증 — 외부 주소 칩(컴포저)과 서버 액션이 같은 눈금을
 *      쓰므로 경계 사례를 여기서 못박는다.
 *
 * check-gmail-mime과 같은 check()/보고 규약. DB·세션을 안 만지므로 --yes 없이 돈다.
 */
import {
  GMAIL_LABEL_OF_FOLDER,
  gmailSearchOf,
  isEmailAddress,
  partyLabel,
  toGmailListItem,
} from "../src/features/mail/gmail-view";
import { parseGmailMessage, type GmailMessage } from "../src/server/gmail/mime";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

console.log("[1] 메일함·필터 매핑");
{
  check(
    "box 매핑: inbox=INBOX · sent=SENT · drafts=DRAFT · trash=TRASH",
    GMAIL_LABEL_OF_FOLDER.inbox === "INBOX" &&
      GMAIL_LABEL_OF_FOLDER.sent === "SENT" &&
      GMAIL_LABEL_OF_FOLDER.drafts === "DRAFT" &&
      GMAIL_LABEL_OF_FOLDER.trash === "TRASH",
  );

  const plain = gmailSearchOf("inbox", {});
  check(
    "조건 없음 — INBOX 라벨만, q 없음(파라미터 생략)",
    plain.labelIds.length === 1 && plain.labelIds[0] === "INBOX" && plain.q === undefined,
    JSON.stringify(plain),
  );

  const unread = gmailSearchOf("inbox", { unread: true, starred: true });
  check(
    "안읽음·별표 — q가 아니라 라벨 AND(UNREAD·STARRED)",
    unread.labelIds.includes("UNREAD") &&
      unread.labelIds.includes("STARRED") &&
      unread.q === undefined,
    JSON.stringify(unread),
  );

  const today = gmailSearchOf("inbox", { sinceYmd: "2026-08-03" });
  check(
    "오늘 온 메일 — after:YYYY/MM/DD",
    today.q === "after:2026/08/03",
    today.q ?? "(없음)",
  );

  const keyword = gmailSearchOf("sent", { q: '주간보고 "긴급" (재발송)' });
  check(
    "제목 검색 — 연산자 문자(따옴표·괄호) 제거 후 subject:\"…\"",
    keyword.q === 'subject:"주간보고 긴급 재발송"',
    keyword.q ?? "(없음)",
  );
}

console.log("[2] 목록 어댑트 — ParsedGmailMessage → MailListItem");
{
  // mime.ts 파서를 통과한 실물 모양의 메시지 — 한글 발신자·첨부·안읽음
  const message: GmailMessage = {
    id: "18f0a1b2c3d4e5f6",
    threadId: "18f0a1b2c3d4e5f6",
    labelIds: ["INBOX", "UNREAD", "STARRED"],
    snippet: "8월  첫째 주   보고입니다 &#39;초안&#39;",
    internalDate: "1754200000000",
    sizeEstimate: 34567,
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "=?UTF-8?B?7ZmN6ri464+Z?= <hong@partner.co.kr>" },
        { name: "To", value: '"Lee, Sumin" <sumin@aimbrige.kr>, kim@aimbrige.kr' },
        { name: "Cc", value: "park@aimbrige.kr" },
        { name: "Subject", value: "=?UTF-8?B?7KO86rCEIOuztOqzoA==?=" },
      ],
      parts: [
        {
          mimeType: "text/plain",
          headers: [{ name: "Content-Type", value: 'text/plain; charset="UTF-8"' }],
          body: { data: Buffer.from("본문", "utf8").toString("base64url"), size: 6 },
        },
        {
          mimeType: "application/pdf",
          filename: "보고서.pdf",
          body: { attachmentId: "att-1", size: 1024 },
        },
      ],
    },
  };
  const parsed = parseGmailMessage(message);
  const item = toGmailListItem(parsed, "inbox");

  check("messageId — Gmail id 그대로", item.messageId === "18f0a1b2c3d4e5f6");
  check("제목 — RFC2047 디코드", item.subject === "주간 보고", item.subject);
  check("발신자 — 표시이름", item.senderName === "홍길동", String(item.senderName));
  check("안읽음 — UNREAD 라벨 → isRead=false", item.isRead === false);
  check("별표 — STARRED 라벨", item.starred === true);
  check("첨부 수 — filename+attachmentId 파트만", item.attachmentCount === 1);
  check("크기 — sizeEstimate", item.sizeBytes === 34567);
  check(
    "미리보기 — 엔티티 해제 + 공백 정리(내부 previewOf 눈금)",
    item.preview === "8월 첫째 주 보고입니다 '초안'",
    item.preview,
  );
  check(
    "수신자 요약 이름 — to 먼저, 표시이름 없으면 로컬파트",
    item.recipientNames.join("|") === "Lee, Sumin|kim|park",
    item.recipientNames.join("|"),
  );
  check(
    "수신확인 없음 — readCount·recipientCount는 null(틀린 읽음 n/m 방지)",
    item.readCount === null && item.recipientCount === null,
  );
  check("정렬 시각 — internalDate ISO", item.at === new Date(1754200000000).toISOString());
  check("받은함 — trashSource 없음", item.trashSource === null);

  const sentItem = toGmailListItem(parsed, "sent");
  check(
    "보낸함 — senderName null(수신자 요약이 상대방) · isRead 고정 true",
    sentItem.senderName === null && sentItem.isRead === true,
  );
  const trashItem = toGmailListItem(parsed, "trash");
  check("휴지통 — trashSource=recipient", trashItem.trashSource === "recipient");

  const nameless = partyLabel({ name: "", email: "no-reply@vendor.io" });
  check("표시이름 폴백 — 로컬파트", nameless === "no-reply", nameless);
}

console.log("[3] 외부 주소 형식 검증 (컴포저 칩·서버 액션 공용)");
{
  check("정상 주소", isEmailAddress("hong@partner.co.kr"));
  check("앞뒤 공백 허용(trim)", isEmailAddress("  kim@aimbrige.kr  "));
  check("@ 없음 거부", !isEmailAddress("hong.partner.co.kr"));
  check("도메인 점 없음 거부", !isEmailAddress("hong@localhost"));
  check("공백 포함 거부", !isEmailAddress("hong gil@partner.co.kr"));
  check("빈 문자열 거부", !isEmailAddress(""));
}

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`);
if (fail > 0) process.exit(1);
