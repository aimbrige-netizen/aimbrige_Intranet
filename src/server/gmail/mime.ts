/**
 * ⚑ Gmail 외부 메일 MIME 빌더·파서 (스펙 13 — 외부 수발신)
 *
 * 이 파일은 **순수 함수만** 둔다 — 네트워크·DB·세션을 모르고, 입력을 받아
 * 문자열/객체를 돌려줄 뿐이다. 실제 Gmail 자격증명 없이도 검증할 수 있어야
 * 해서다(scripts/check-gmail-mime.ts). 같은 이유로 "server-only"를 붙이지
 * 않는다 — tsx로 도는 검증 스크립트가 import하면 server-only는 즉시 throw
 * 한다(format.ts와 같은 규약). REST 호출은 client.ts가, 토큰 관리는 상위
 * 서버 코드가 맡는다.
 *
 * ── 보내는 쪽 (buildMimeMessage)
 * Gmail API의 messages.send는 RFC2822 원문을 base64url로 감싼 `raw`를
 * 받는다. 헤더는 ASCII만 허용되므로 한글 제목·표시이름·파일명은 RFC2047
 * encoded-word(=?UTF-8?B?..?=)로 싣는다. 본문·첨부는 base64 CTE로 통일한다
 * — 한글 본문을 그대로 실으면 998자 줄 제한과 8bit 협상을 신경 써야 하는데,
 * base64는 그 걱정이 없다.
 *
 * ── 받는 쪽 (parseGmailMessage)
 * format=full 응답의 payload 트리를 화면 뷰모델에 필요한 평평한 모양으로
 * 줄인다. Gmail이 Content-Transfer-Encoding은 이미 풀어서 주므로(body.data는
 * 디코드된 바이트의 base64url) 여기서는 charset 변환과 RFC2047 헤더 디코딩,
 * html→text 폴백만 책임진다.
 */

// ---------------------------------------------------------------------
// 공용 타입
// ---------------------------------------------------------------------

/** 보낼 때 쓰는 주소 — 표시이름은 없어도 된다 */
export interface MailAddressInput {
  name?: string;
  email: string;
}

/** 파싱 결과의 주소 — 표시이름이 없으면 빈 문자열(폴백은 화면 계층 몫) */
export interface MailParty {
  name: string;
  email: string;
}

export interface MimeAttachmentInput {
  name: string;
  /** 모르면 application/octet-stream */
  mimeType?: string;
  /** 표준 base64 — 스토리지에서 읽은 바이트를 그대로 인코딩한 것 */
  contentBase64: string;
}

export interface BuildMimeInput {
  from: MailAddressInput;
  to: MailAddressInput[];
  cc?: MailAddressInput[];
  subject: string;
  textBody: string;
  attachments?: MimeAttachmentInput[];
}

// Gmail Users.messages 리소스(format=full)의 우리가 쓰는 부분집합.
// client.ts의 getMessage가 이 타입으로 돌려준다.
export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailBody {
  attachmentId?: string;
  size?: number;
  /** base64url — Gmail이 CTE는 이미 푼 상태의 바이트 */
  data?: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  /** epoch millis 문자열 */
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailMessagePart;
}

export interface ParsedAttachment {
  /** Gmail attachmentId — client.ts getAttachment에 그대로 넘긴다 */
  id: string;
  name: string;
  size: number;
}

export interface ParsedGmailMessage {
  id: string;
  threadId: string;
  from: MailParty;
  to: MailParty[];
  cc: MailParty[];
  subject: string;
  /** 엔티티(&#39; 등)를 푼 미리보기 문장 */
  snippet: string;
  /** text/plain 우선, 없으면 text/html의 태그 제거 폴백 */
  bodyText: string;
  /** ISO 8601 — internalDate(epoch ms)를 변환. 없으면 빈 문자열 */
  internalDate: string;
  unread: boolean;
  starred: boolean;
  sizeEstimate: number;
  attachments: ParsedAttachment[];
}

// ---------------------------------------------------------------------
// base64url — Gmail의 raw·body.data 규약
// ---------------------------------------------------------------------

export function toBase64Url(input: Buffer | string): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function fromBase64Url(data: string): Buffer {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

// ---------------------------------------------------------------------
// RFC2047 encoded-word — 헤더의 한글
// ---------------------------------------------------------------------

/** 헤더에 그대로 실어도 되는 문자만인가 (인쇄 가능한 ASCII) */
function isPrintableAscii(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text);
}

/**
 * encoded-word 하나는 75자 이하여야 한다(RFC2047 §2).
 * "=?UTF-8?B?" 10자 + "?=" 2자를 빼면 base64 63자 = 원문 45바이트가 상한.
 * UTF-8 문자를 중간에서 자르면 양쪽 다 깨진 바이트가 되므로 코드포인트
 * 단위로 채운다(for...of는 서로게이트 쌍을 쪼개지 않는다).
 */
const ENCODED_WORD_MAX_BYTES = 45;

function encodedWords(text: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  let bytes = 0;
  for (const ch of text) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > ENCODED_WORD_MAX_BYTES && chunk) {
      chunks.push(chunk);
      chunk = "";
      bytes = 0;
    }
    chunk += ch;
    bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(
    (part) => `=?UTF-8?B?${Buffer.from(part, "utf8").toString("base64")}?=`,
  );
}

/**
 * 제목 등 unstructured 헤더 값. ASCII면 그대로, 아니면 encoded-word로.
 * 긴 한글은 여러 word로 나눠 폴딩(CRLF + 공백)한다 — 디코더는 인접한
 * encoded-word 사이의 공백을 버리므로(RFC2047 §6.2) 왕복해도 원문 그대로다.
 */
export function encodeHeaderText(text: string): string {
  if (isPrintableAscii(text)) return text;
  return encodedWords(text).join("\r\n ");
}

/** RFC2231 언어 태그(`utf-8*ko`)가 붙어 있어도 TextDecoder가 받게 정리 */
function normalizeCharset(charset: string): string {
  return charset.split("*")[0].trim().toLowerCase();
}

/** Q 인코딩: `_`는 공백, `=XX`는 그 바이트, 나머지는 리터럴 */
function qDecode(data: string): Buffer {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 1) {
    const ch = data[i];
    if (ch === "_") {
      out.push(0x20);
    } else if (ch === "=" && i + 2 < data.length + 1) {
      const hex = data.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16));
        i += 2;
      } else {
        out.push(ch.charCodeAt(0));
      }
    } else {
      out.push(ch.charCodeAt(0));
    }
  }
  return Buffer.from(out);
}

function decodeBytes(bytes: Buffer, charset: string): string {
  try {
    return new TextDecoder(normalizeCharset(charset)).decode(bytes);
  } catch {
    // 모르는 charset이면 UTF-8로 최선을 다한다 — 던져서 화면을 죽이지 않는다
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * 헤더 값의 encoded-word를 전부 푼다. B·Q 인코딩, 임의 charset(TextDecoder가
 * 아는 한) 지원. 형식이 깨진 word는 건드리지 않고 그대로 둔다 — 억지로
 * 지우는 것보다 원문이 보이는 쪽이 디버깅에 낫다.
 */
export function decodeRfc2047(value: string): string {
  // 인접한 encoded-word 사이의 접는 공백은 버린다 (RFC2047 §6.2)
  const joined = value.replace(/(\?=)[ \t\r\n]+(=\?)/g, "$1$2");
  return joined.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (match, charset: string, encoding: string, data: string) => {
      try {
        const bytes = /b/i.test(encoding)
          ? Buffer.from(data.replace(/\s+/g, ""), "base64")
          : qDecode(data);
        return decodeBytes(bytes, charset);
      } catch {
        return match;
      }
    },
  );
}

// ---------------------------------------------------------------------
// 주소 만들기·읽기
// ---------------------------------------------------------------------

/**
 * `홍길동 <hong@aimbrige.kr>` 형태로. 표시이름이 ASCII라도 쉼표·괄호 같은
 * special이 섞이면 따옴표로 감싼다 — `Lee, Sumin`을 안 감싸면 수신자가
 * 두 명으로 갈라진다.
 */
export function formatAddress(address: MailAddressInput): string {
  const email = address.email.trim();
  const name = address.name?.trim() ?? "";
  if (!name) return email;
  if (isPrintableAscii(name)) {
    if (/[^A-Za-z0-9 ._-]/.test(name)) {
      return `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
    }
    return `${name} <${email}>`;
  }
  return `${encodeHeaderText(name)} <${email}>`;
}

/** 여러 명은 쉼표 + 폴딩으로 잇는다 — 주소가 많아도 한 줄이 안 넘친다 */
export function formatAddressList(addresses: MailAddressInput[]): string {
  return addresses.map(formatAddress).join(",\r\n ");
}

function parseOneAddress(raw: string): MailParty {
  const angled = raw.match(/^([\s\S]*?)<([^>]*)>\s*$/);
  if (angled) {
    let name = angled[1].trim();
    const quoted = name.match(/^"([\s\S]*)"$/);
    if (quoted) name = quoted[1].replace(/\\(["\\])/g, "$1");
    return { name: decodeRfc2047(name).trim(), email: angled[2].trim() };
  }
  return { name: "", email: raw.trim() };
}

/**
 * To/Cc 헤더 값 → 주소 배열. 쉼표로 가르되 따옴표 안의 쉼표(표시이름)는
 * 구분자가 아니다 — check-mail-format.ts가 지키는 것과 같은 함정.
 */
export function parseAddressList(value: string): MailParty[] {
  const chunks: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '"' && value[i - 1] !== "\\") inQuote = !inQuote;
    if (ch === "," && !inQuote) {
      chunks.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  chunks.push(current);
  return chunks
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== "")
    .map(parseOneAddress);
}

// ---------------------------------------------------------------------
// 보내기 — RFC2822 조립
// ---------------------------------------------------------------------

/** base64 본문을 76자에서 접는다 (RFC2045 §6.8) */
function foldBase64(b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join("\r\n");
}

/**
 * 파트 경계. "=_"로 시작하면 base64 본문과 절대 충돌하지 않는다 —
 * "_"가 base64 알파벳 밖의 문자라, 인코딩된 데이터 어디에도 "=_" 연쇄가
 * 나올 수 없다(패딩 "="의 다음은 "=" 아니면 줄끝뿐).
 */
function makeBoundary(): string {
  const entropy = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `=_aim_${Date.now().toString(36)}_${entropy}`;
}

/** Content-Type/Disposition의 파일명 파라미터 — 한글이면 encoded-word */
function quoteParam(value: string): string {
  if (isPrintableAscii(value)) {
    return `"${value.replace(/(["\\])/g, "\\$1")}"`;
  }
  // 폴딩 없이 공백으로만 잇는다 — 따옴표 안에서 줄을 접으면 깨진다
  return `"${encodedWords(value).join(" ")}"`;
}

function attachmentSection(
  boundary: string,
  file: MimeAttachmentInput,
): string {
  const filename = quoteParam(file.name);
  const mimeType = file.mimeType?.trim() || "application/octet-stream";
  return [
    `--${boundary}`,
    `Content-Type: ${mimeType}; name=${filename}`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename=${filename}`,
    "",
    foldBase64(file.contentBase64.replace(/\s+/g, "")),
  ].join("\r\n");
}

/**
 * RFC2822 원문을 만들어 base64url로 돌려준다 — Gmail messages.send의
 * `raw`에 그대로 넣는 값이다.
 *
 * Date·Message-ID는 싣지 않는다 — Gmail이 발송 시각으로 채워 주고,
 * 여기서 시계를 읽지 않아야 함수가 검증하기 쉬운 모양으로 남는다.
 */
export function buildMimeMessage(input: BuildMimeInput): string {
  const attachments = input.attachments ?? [];
  const headers: string[] = [
    `From: ${formatAddress(input.from)}`,
    `To: ${formatAddressList(input.to)}`,
  ];
  if (input.cc && input.cc.length > 0) {
    headers.push(`Cc: ${formatAddressList(input.cc)}`);
  }
  headers.push(`Subject: ${encodeHeaderText(input.subject)}`);
  headers.push("MIME-Version: 1.0");

  const bodyBase64 = foldBase64(
    Buffer.from(input.textBody, "utf8").toString("base64"),
  );

  let message: string;
  if (attachments.length === 0) {
    headers.push(
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
    );
    message = `${headers.join("\r\n")}\r\n\r\n${bodyBase64}\r\n`;
  } else {
    const boundary = makeBoundary();
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const sections = [
      [
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        bodyBase64,
      ].join("\r\n"),
      ...attachments.map((file) => attachmentSection(boundary, file)),
    ];
    message = `${headers.join("\r\n")}\r\n\r\n${sections.join(
      "\r\n",
    )}\r\n--${boundary}--\r\n`;
  }
  return toBase64Url(message);
}

// ---------------------------------------------------------------------
// 받기 — payload 트리 → 평평한 뷰모델 입력
// ---------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** &#39;·&quot; 같은 엔티티를 푼다 — snippet과 html 폴백 양쪽에서 쓴다 */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, body: string) => {
      if (body.startsWith("#")) {
        const code =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    },
  );
}

/**
 * text/plain이 없는 메일의 폴백 — 본문을 "읽을 수 있는 텍스트"로 줄인다.
 * 렌더링이 아니라 미리보기·검색용이므로 서식은 버리고 줄바꿈만 남긴다.
 */
export function htmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const withBreaks = withoutBlocks
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(withBreaks)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function flattenParts(
  part: GmailMessagePart | undefined,
  out: GmailMessagePart[] = [],
): GmailMessagePart[] {
  if (!part) return out;
  out.push(part);
  for (const child of part.parts ?? []) flattenParts(child, out);
  return out;
}

function headerValue(part: GmailMessagePart | undefined, name: string): string {
  const lower = name.toLowerCase();
  return (
    (part?.headers ?? []).find((h) => h.name.toLowerCase() === lower)?.value ??
    ""
  );
}

/** body.data(base64url)를 파트의 charset으로 문자열화 */
function decodeTextPart(part: GmailMessagePart): string {
  const data = part.body?.data;
  if (!data) return "";
  const contentType = headerValue(part, "Content-Type");
  const charset =
    contentType.match(/charset="?([^";\s]+)"?/i)?.[1] ?? "utf-8";
  return decodeBytes(fromBase64Url(data), charset);
}

function extractBodyText(payload: GmailMessagePart | undefined): string {
  const parts = flattenParts(payload);
  const inlineText = (mime: string) =>
    parts.find(
      (part) =>
        (part.mimeType ?? "").toLowerCase().startsWith(mime) &&
        !part.filename &&
        Boolean(part.body?.data),
    );
  const plain = inlineText("text/plain");
  if (plain) return decodeTextPart(plain);
  const html = inlineText("text/html");
  if (html) return htmlToText(decodeTextPart(html));
  return "";
}

/**
 * format=full 응답 → 화면 어댑터가 먹는 평평한 모양.
 *
 * 상태는 전부 labelIds에서 읽는다 — Gmail에는 read_at 같은 컬럼이 없고
 * UNREAD/STARRED 라벨의 유무가 곧 상태다. modifyMessage로 라벨을
 * 넣고 빼는 것이 읽음·별표 토글이 된다.
 */
export function parseGmailMessage(message: GmailMessage): ParsedGmailMessage {
  const payload = message.payload;
  const labels = message.labelIds ?? [];

  const fromList = parseAddressList(headerValue(payload, "From"));
  const attachments: ParsedAttachment[] = [];
  for (const part of flattenParts(payload)) {
    const attachmentId = part.body?.attachmentId;
    if (!part.filename || !attachmentId) continue;
    attachments.push({
      id: attachmentId,
      // Gmail이 보통 디코드해 주지만, 인코딩된 채로 오는 발신자도 있다
      name: decodeRfc2047(part.filename),
      size: part.body?.size ?? 0,
    });
  }

  return {
    id: message.id,
    threadId: message.threadId,
    from: fromList[0] ?? { name: "", email: "" },
    to: parseAddressList(headerValue(payload, "To")),
    cc: parseAddressList(headerValue(payload, "Cc")),
    subject: decodeRfc2047(headerValue(payload, "Subject")),
    snippet: decodeEntities(message.snippet ?? ""),
    bodyText: extractBodyText(payload),
    internalDate: message.internalDate
      ? new Date(Number(message.internalDate)).toISOString()
      : "",
    unread: labels.includes("UNREAD"),
    starred: labels.includes("STARRED"),
    sizeEstimate: message.sizeEstimate ?? 0,
    attachments,
  };
}
