/**
 * Gmail MIME 빌더·파서 검증 (스펙 13 — 외부 수발신)
 *
 *   npm run check:gmail
 *
 * 실제 Gmail 자격증명이 없는 환경이라 API는 못 두드린다. 대신 mime.ts를
 * 순수 함수로 잘라 두었으므로, 실전에서 터지는 자리를 네트워크 없이 찌른다.
 *
 *  (1) 한글 헤더. 제목·표시이름·파일명이 RFC2047을 안 타면 ASCII만 아는
 *      수신 서버에서 물음표 행렬이 된다. 인코딩됐다는 것만이 아니라
 *      **디코더로 되돌려 원문과 같은지(왕복)**까지 본다 — 45바이트 분할이
 *      UTF-8 문자 중간을 자르면 인코딩은 멀쩡해 보여도 왕복이 깨진다.
 *
 *  (2) 첨부 경계. boundary가 본문 base64와 충돌하면 메일이 중간에서 잘리는데,
 *      이건 특정 첨부에서만 터져서 재현이 안 되는 종류의 버그다. "=_" 접두사
 *      규약이 지켜지는지, 종결 경계(--...--)까지 있는지 본다.
 *
 *  (3) 파싱 폴백. Gmail 실물 메일은 text/plain이 없거나(html만), 라벨로만
 *      상태를 말하거나, 표시이름에 쉼표가 있거나 한다 — 다우 화면 계약
 *      (MailListRow)에 붙이기 전에 여기서 걸러야 화면 분기가 안 늘어난다.
 *
 * e2e-community와 같은 check()/보고 규약. DB·세션을 안 만지므로 --yes 없이 돈다.
 */
import {
  buildMimeMessage,
  parseGmailMessage,
  encodeHeaderText,
  decodeRfc2047,
  formatAddress,
  toBase64Url,
  fromBase64Url,
  htmlToText,
  type GmailMessage,
} from "../src/server/gmail/mime";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  ✔ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✖ ${label}${detail ? " — " + detail : ""}`);
  }
};

/** raw(base64url) → RFC2822 원문 */
const rawToText = (raw: string) => fromBase64Url(raw).toString("utf8");

/** 헤더부의 접힌 줄을 펴서 논리 줄 배열로 */
const logicalHeaders = (text: string) =>
  text.split("\r\n\r\n")[0].replace(/\r\n[ \t]/g, " ").split("\r\n");

const headerOf = (text: string, name: string) =>
  logicalHeaders(text)
    .find((line) => line.toLowerCase().startsWith(`${name.toLowerCase()}: `))
    ?.slice(name.length + 2) ?? "";

const b64url = (s: string) => toBase64Url(Buffer.from(s, "utf8"));

// =====================================================================
console.log("\n[1] buildMimeMessage — 헤더 인코딩");
// =====================================================================

const subject = "[공지] 3분기 워크숍 일정 안내";
const built = buildMimeMessage({
  from: { name: "김지훈", email: "jhkim@aimbrige.kr" },
  to: [
    { name: "홍길동", email: "hong@aimbrige.kr" },
    { email: "partner@example.com" },
  ],
  cc: [{ name: "Lee, Sumin", email: "sumin@aimbrige.kr" }],
  subject,
  textBody: "안녕하세요.\n일정은 첨부 파일을 참조해 주세요.\n감사합니다.",
});
const builtText = rawToText(built);

check(
  "raw가 base64url 알파벳만 쓴다 (+·/·= 없음)",
  /^[A-Za-z0-9_-]+$/.test(built),
);

const subjectHeader = headerOf(builtText, "Subject");
check(
  "한글 제목이 =?UTF-8?B?..?= 로 인코딩된다",
  subjectHeader.startsWith("=?UTF-8?B?") && !/[가-힣]/.test(subjectHeader),
  subjectHeader,
);
check(
  "제목 왕복 — 디코드하면 원문 그대로",
  decodeRfc2047(subjectHeader) === subject,
  decodeRfc2047(subjectHeader),
);

// 긴 제목: encoded-word 하나가 75자를 넘으면 안 되고, 나눠도 왕복돼야 한다
const longSubject = "성과 리뷰 일정 공유 — 하반기 조직 개편에 따른 평가 항목 변경 사항과 제출 마감일을 꼭 확인해 주시기 바랍니다";
const longRaw = rawToText(
  buildMimeMessage({
    from: { email: "a@aimbrige.kr" },
    to: [{ email: "b@aimbrige.kr" }],
    subject: longSubject,
    textBody: "",
  }),
);
const longWords = headerOf(longRaw, "Subject").split(/\s+/);
check(
  `긴 한글 제목이 여러 encoded-word로 나뉜다 (${longWords.length}개)`,
  longWords.length >= 2 && longWords.every((w) => w.length <= 75),
  longWords.map((w) => w.length).join(","),
);
check(
  "긴 제목 왕복 — 분할 지점이 UTF-8 문자를 안 자른다",
  decodeRfc2047(headerOf(longRaw, "Subject")) === longSubject,
);

check(
  "ASCII 제목은 인코딩하지 않는다",
  headerOf(
    rawToText(
      buildMimeMessage({
        from: { email: "a@x.kr" },
        to: [{ email: "b@x.kr" }],
        subject: "Weekly sync",
        textBody: "",
      }),
    ),
    "Subject",
  ) === "Weekly sync",
);

const fromHeader = headerOf(builtText, "From");
check(
  "한글 표시이름(From)이 인코딩되고 왕복된다",
  fromHeader.includes("=?UTF-8?B?") &&
    decodeRfc2047(fromHeader) === "김지훈 <jhkim@aimbrige.kr>",
  fromHeader,
);

const toHeader = headerOf(builtText, "To");
check(
  "다중 수신자 — To에 두 주소가 모두 실린다",
  toHeader.includes("hong@aimbrige.kr") &&
    toHeader.includes("partner@example.com"),
  toHeader,
);
const ccParsed = parseGmailMessage({
  id: "x",
  threadId: "x",
  payload: { headers: [{ name: "Cc", value: headerOf(builtText, "Cc") }] },
}).cc;
check(
  '쉼표 든 표시이름("Lee, Sumin")이 두 명으로 갈라지지 않는다',
  ccParsed.length === 1 &&
    ccParsed[0].name === "Lee, Sumin" &&
    ccParsed[0].email === "sumin@aimbrige.kr",
  JSON.stringify(ccParsed),
);

check(
  "필수 헤더 — From·To·Subject·MIME-Version·Content-Type",
  ["From", "To", "Subject", "MIME-Version", "Content-Type"].every(
    (name) => headerOf(builtText, name) !== "",
  ),
);

// =====================================================================
console.log("\n[2] buildMimeMessage — 본문·첨부 경계");
// =====================================================================

const bodyBlock = builtText.split("\r\n\r\n").slice(1).join("\r\n\r\n");
check(
  "본문 base64 디코드 → 한글 원문 그대로",
  Buffer.from(bodyBlock.replace(/\s+/g, ""), "base64")
    .toString("utf8")
    .includes("일정은 첨부 파일을 참조해 주세요."),
);
check(
  "본문 base64가 76자에서 접힌다",
  bodyBlock
    .split("\r\n")
    .every((line) => line.length <= 76),
);

// 첨부 — PDF 바이트 흉내(base64), 한글 파일명
const attachmentBytes = Buffer.from("PDF-1.7 가짜 첨부 내용입니다", "utf8");
const withAttachment = rawToText(
  buildMimeMessage({
    from: { email: "a@aimbrige.kr" },
    to: [{ email: "b@aimbrige.kr" }],
    subject: "첨부 테스트",
    textBody: "본문입니다.",
    attachments: [
      {
        name: "워크숍 일정표.pdf",
        mimeType: "application/pdf",
        contentBase64: attachmentBytes.toString("base64"),
      },
    ],
  }),
);
const boundary =
  withAttachment.match(/boundary="([^"]+)"/)?.[1] ?? "";
check(
  'multipart/mixed + boundary가 "=_"로 시작한다 (base64와 충돌 불가)',
  headerOf(withAttachment, "Content-Type").startsWith("multipart/mixed") &&
    boundary.startsWith("=_"),
  boundary,
);
const segments = withAttachment.split(`--${boundary}`);
check(
  "파트 2개(본문·첨부) + 종결 경계(--…--)로 닫힌다",
  segments.length === 4 && segments[3].startsWith("--"),
  `segments=${segments.length}`,
);
const attachmentPart = segments[2] ?? "";
check(
  "첨부 파트 — Content-Disposition: attachment + 한글 파일명 인코딩·왕복",
  attachmentPart.includes("Content-Disposition: attachment") &&
    !/[가-힣]/.test(attachmentPart.split("\r\n\r\n")[0]) &&
    decodeRfc2047(
      attachmentPart.match(/filename="([^"]+)"/)?.[1] ?? "",
    ) === "워크숍 일정표.pdf",
);
check(
  "첨부 base64 디코드 → 원본 바이트 그대로",
  Buffer.from(
    (attachmentPart.split("\r\n\r\n")[1] ?? "").replace(/\s+/g, ""),
    "base64",
  ).equals(attachmentBytes),
);

// =====================================================================
console.log("\n[3] parseGmailMessage — 헤더·본문·라벨");
// =====================================================================

// 빌더의 인코더로 만든 헤더를 파서가 되읽는 왕복 픽스처.
// 실물 format=full과 같은 모양: multipart/mixed > alternative(plain+html) + 첨부.
const fixture: GmailMessage = {
  id: "18f2c1a9b0aa11",
  threadId: "18f2c1a9b0aa10",
  labelIds: ["INBOX", "UNREAD", "STARRED"],
  snippet: "3분기 워크숍 일정 &#39;안내&#39;",
  internalDate: "1722400000000",
  sizeEstimate: 34567,
  payload: {
    mimeType: "multipart/mixed",
    filename: "",
    headers: [
      {
        name: "From",
        value: formatAddress({ name: "김지훈", email: "jhkim@aimbrige.kr" }),
      },
      {
        name: "To",
        value: [
          formatAddress({ name: "홍길동", email: "hong@aimbrige.kr" }),
          "no-reply@github.com",
        ].join(", "),
      },
      {
        name: "Cc",
        value: formatAddress({ name: "Lee, Sumin", email: "sumin@aimbrige.kr" }),
      },
      { name: "Subject", value: encodeHeaderText(subject) },
    ],
    body: { size: 0 },
    parts: [
      {
        mimeType: "multipart/alternative",
        filename: "",
        body: { size: 0 },
        parts: [
          {
            partId: "0.0",
            mimeType: "text/plain",
            filename: "",
            headers: [
              { name: "Content-Type", value: 'text/plain; charset="UTF-8"' },
            ],
            body: { size: 30, data: b64url("일정은 첨부 참조.") },
          },
          {
            partId: "0.1",
            mimeType: "text/html",
            filename: "",
            body: {
              size: 60,
              data: b64url("<p>일정은 <b>첨부</b> 참조. (html)</p>"),
            },
          },
        ],
      },
      {
        partId: "1",
        mimeType: "application/pdf",
        filename: "워크숍 일정.pdf",
        body: { attachmentId: "ANGjdJ_att1", size: 20480 },
      },
    ],
  },
};
const parsed = parseGmailMessage(fixture);

check(
  "From 왕복 — 이름·주소 분리",
  parsed.from.name === "김지훈" && parsed.from.email === "jhkim@aimbrige.kr",
  JSON.stringify(parsed.from),
);
check(
  "To 2명 — 표시이름 없는 주소는 name이 빈 문자열",
  parsed.to.length === 2 &&
    parsed.to[0].name === "홍길동" &&
    parsed.to[1].name === "" &&
    parsed.to[1].email === "no-reply@github.com",
  JSON.stringify(parsed.to),
);
check("제목 왕복 (빌더 인코딩 → 파서 디코딩)", parsed.subject === subject);
check(
  "text/plain 우선 — html 파트가 있어도 plain을 고른다",
  parsed.bodyText === "일정은 첨부 참조.",
  parsed.bodyText,
);
check(
  "라벨 판정 — UNREAD·STARRED 라벨이 곧 상태",
  parsed.unread && parsed.starred,
);
check(
  "첨부 수집 — attachmentId 있는 파트만, 인라인 텍스트는 제외",
  parsed.attachments.length === 1 &&
    parsed.attachments[0].id === "ANGjdJ_att1" &&
    parsed.attachments[0].name === "워크숍 일정.pdf" &&
    parsed.attachments[0].size === 20480,
  JSON.stringify(parsed.attachments),
);
check(
  "internalDate(epoch ms) → ISO 8601",
  parsed.internalDate === new Date(1722400000000).toISOString(),
  parsed.internalDate,
);
check(
  "snippet 엔티티(&#39;) 디코드",
  parsed.snippet === "3분기 워크숍 일정 '안내'",
  parsed.snippet,
);

// html만 있는 메일 — 뉴스레터·자동발신의 흔한 모양
const htmlOnly = parseGmailMessage({
  id: "x2",
  threadId: "x2",
  labelIds: ["INBOX"],
  payload: {
    mimeType: "text/html",
    filename: "",
    headers: [
      { name: "From", value: "noreply@stripe.com" },
      { name: "Subject", value: "Receipt" },
      { name: "Content-Type", value: 'text/html; charset="UTF-8"' },
    ],
    body: {
      size: 120,
      data: b64url(
        '<div>안녕하세요,<br>2층 <b>회의실</b>이 &quot;예약&quot;됐습니다.' +
          "<script>alert(1)</script><style>.x{color:red}</style></div>",
      ),
    },
  },
});
check(
  "html 폴백 — 태그 제거·<br>→줄바꿈·엔티티 디코드",
  htmlOnly.bodyText === '안녕하세요,\n2층 회의실이 "예약"됐습니다.',
  JSON.stringify(htmlOnly.bodyText),
);
check(
  "html 폴백 — script·style 내용이 본문에 새지 않는다",
  !htmlOnly.bodyText.includes("alert") && !htmlOnly.bodyText.includes("color"),
);
check(
  "라벨 판정 — UNREAD·STARRED 없으면 읽음·별표 없음",
  !htmlOnly.unread && !htmlOnly.starred,
);

// =====================================================================
console.log("\n[4] decodeRfc2047 — 타사 발신 헤더 변형");
// =====================================================================

check(
  "Q 인코딩 (=XX·_공백) 디코드",
  decodeRfc2047("=?UTF-8?Q?=EC=95=88=EB=85=95_Gmail?=") === "안녕 Gmail",
  decodeRfc2047("=?UTF-8?Q?=EC=95=88=EB=85=95_Gmail?="),
);
check(
  "EUC-KR B 인코딩 디코드 (국내 레거시 발신 서버)",
  decodeRfc2047("=?EUC-KR?B?vsiz5w==?=") === "안녕",
  decodeRfc2047("=?EUC-KR?B?vsiz5w==?="),
);
check(
  "인접 encoded-word 사이 공백은 버리고, 일반 텍스트와의 공백은 남긴다",
  decodeRfc2047("=?UTF-8?B?7ZWc6riA?= =?UTF-8?B?7KCc66qp?= (fwd)") ===
    "한글제목 (fwd)",
  decodeRfc2047("=?UTF-8?B?7ZWc6riA?= =?UTF-8?B?7KCc66qp?= (fwd)"),
);
check(
  "깨진 encoded-word는 지우지 않고 원문 그대로 둔다",
  decodeRfc2047("=?UTF-8?X?broken?=") === "=?UTF-8?X?broken?=",
);
check(
  "htmlToText 단독 — 숫자 엔티티(&#x2F;)와 블록 태그 줄바꿈",
  htmlToText("<p>A&#x2F;S 안내</p><p>2행</p>") === "A/S 안내\n2행",
  JSON.stringify(htmlToText("<p>A&#x2F;S 안내</p><p>2행</p>")),
);

// =====================================================================
console.log(`\n결과: ${pass}건 통과 / ${fail}건 실패`);
process.exit(fail ? 1 : 0);
