import "server-only";

import type { GmailMessage } from "./mime";

/**
 * ⚑ Gmail REST 얇은 래퍼 (스펙 13 — 외부 수발신)
 *
 * 토큰 계층 규약: 이 파일은 **accessToken을 주입받을 뿐** 토큰을 만들지도
 * 저장하지도 않는다. refresh token은 서버 전용 테이블에 있고, access token
 * 발급은 상위 서버 코드가 한다 — 여기가 토큰의 출처를 알기 시작하면
 * "본인 토큰으로 본인 메일함" 검증을 우회하는 경로가 생긴다.
 *
 * 오류 규약:
 *   401 → GmailApiError(401)를 **그대로** 던진다. 상위가 refresh 후 재시도할
 *         책임을 진다 — 여기서 재시도하면 만료 토큰으로 두 번 두드릴 뿐이다.
 *   429·5xx → 일시 장애일 확률이 높아 **한 번만** 재시도한다(Retry-After를
 *         읽되 상한 10초). 두 번째도 실패하면 그대로 던진다 — 서버 액션
 *         타임아웃 안에서 무한 재시도는 화면을 멈추게 한다.
 *   그 외 4xx → 재시도해도 같은 답이므로 바로 던진다.
 *
 * users/me 고정: 어느 메일함인지는 토큰이 정한다. userId를 파라미터로
 * 받기 시작하면 "남의 메일함 + 내 토큰" 조합이 코드 모양으로는 가능해
 * 보이는 함정이 생긴다 — Gmail이 403으로 막긴 하지만 애초에 표현이 안
 * 되게 한다.
 */

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** 429·5xx 재시도 대기의 상한 — Retry-After가 이보다 커도 이만큼만 기다린다 */
const RETRY_CAP_MS = 10_000;
const RETRY_DEFAULT_MS = 500;

export class GmailApiError extends Error {
  constructor(
    /** HTTP 상태 — 401이면 상위가 refresh 후 재시도한다 */
    public readonly status: number,
    message: string,
    /** Gmail 오류 응답 본문(있으면) — 로그용. 화면에 그대로 내보내지 말 것 */
    public readonly responseBody?: string,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

type QueryValue = string | number | string[] | undefined;

interface GmailRequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, QueryValue>;
  body?: unknown;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): URL {
  const url = new URL(`${GMAIL_API_BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      // labelIds는 반복 파라미터다 — 콤마로 합치면 Gmail이 라벨 하나로 읽는다
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function retryDelayMs(response: Response): number {
  const header = response.headers.get("retry-after");
  const seconds = header === null ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RETRY_CAP_MS);
  }
  return RETRY_DEFAULT_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(
  accessToken: string,
  path: string,
  options: GmailRequestOptions = {},
): Promise<T> {
  const url = buildUrl(path, options.query);
  const doFetch = () =>
    fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : null,
      // 메일함은 항상 실시간 — Next fetch 캐시에 남의 시점이 끼면 안 된다
      cache: "no-store",
    });

  let response = await doFetch();
  if (response.status === 429 || response.status >= 500) {
    await sleep(retryDelayMs(response));
    response = await doFetch();
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new GmailApiError(
      response.status,
      `Gmail API ${options.method ?? "GET"} ${path} → ${response.status}`,
      bodyText,
    );
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------
// 목록·단건
// ---------------------------------------------------------------------

export interface GmailMessageRef {
  id: string;
  threadId: string;
}

export interface ListMessagesOptions {
  /** INBOX·SENT·TRASH·UNREAD·STARRED 등 — 전부 만족(AND)하는 메일만 */
  labelIds?: string[];
  /** Gmail 검색 문법 그대로 (subject:..., after:... 등) */
  q?: string;
  pageToken?: string;
  maxResults?: number;
}

export interface ListMessagesResponse {
  messages?: GmailMessageRef[];
  nextPageToken?: string;
  /** 대략치다 — 페이지네이터 분모로 쓰되 정확한 총계로 믿지 말 것 */
  resultSizeEstimate?: number;
}

/** 메일 id 목록. 본문·헤더는 없다 — 페이지 분량만 getMessage로 채운다 */
export function listMessages(
  accessToken: string,
  options: ListMessagesOptions = {},
): Promise<ListMessagesResponse> {
  return request<ListMessagesResponse>(accessToken, "/messages", {
    query: {
      labelIds: options.labelIds,
      q: options.q,
      pageToken: options.pageToken,
      maxResults: options.maxResults,
    },
  });
}

/** 한 통 전체(format=full) — mime.ts parseGmailMessage에 그대로 넘긴다 */
export function getMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessage> {
  return request<GmailMessage>(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}`,
    { query: { format: "full" } },
  );
}

// ---------------------------------------------------------------------
// 발송·상태 변경
// ---------------------------------------------------------------------

/**
 * 발송. raw는 mime.ts buildMimeMessage가 만든 base64url 문자열.
 * From을 토큰 주인과 다르게 적어도 Gmail이 본인 주소로 바꿔 보낸다 —
 * 위장 발신은 API 층에서 이미 막혀 있다.
 */
export function sendMessage(
  accessToken: string,
  raw: string,
): Promise<GmailMessageRef & { labelIds?: string[] }> {
  return request(accessToken, "/messages/send", {
    method: "POST",
    body: { raw },
  });
}

export interface ModifyLabels {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

/** 라벨 넣고 빼기 — 읽음(UNREAD 제거)·별표(STARRED 추가) 토글이 이것이다 */
export function modifyMessage(
  accessToken: string,
  messageId: string,
  labels: ModifyLabels,
): Promise<GmailMessage> {
  return request<GmailMessage>(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}/modify`,
    {
      method: "POST",
      body: {
        addLabelIds: labels.addLabelIds ?? [],
        removeLabelIds: labels.removeLabelIds ?? [],
      },
    },
  );
}

/** 휴지통으로 — 영구삭제(delete)는 일부러 안 만든다. 되돌릴 수 없어서다 */
export function trashMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessage> {
  return request<GmailMessage>(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}/trash`,
    { method: "POST" },
  );
}

/** 휴지통에서 복원 */
export function untrashMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessage> {
  return request<GmailMessage>(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}/untrash`,
    { method: "POST" },
  );
}

// ---------------------------------------------------------------------
// 첨부
// ---------------------------------------------------------------------

export interface GmailAttachmentData {
  size: number;
  /** base64url — mime.ts fromBase64Url로 바이트로 되돌린다 */
  data: string;
}

/** 첨부 본문. attachmentId는 parseGmailMessage의 attachments[].id */
export function getAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<GmailAttachmentData> {
  return request<GmailAttachmentData>(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(
      attachmentId,
    )}`,
  );
}
