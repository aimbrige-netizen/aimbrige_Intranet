import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  disconnectGmail,
  getAccessToken,
  invalidateAccessToken,
} from "@/server/gmail/tokens";
import {
  GmailApiError,
  getMessage,
  listMessages,
  modifyMessage,
  sendMessage,
  trashMessage,
  untrashMessage,
} from "@/server/gmail/client";
import {
  buildMimeMessage,
  parseGmailMessage,
  type ParsedGmailMessage,
} from "@/server/gmail/mime";
import {
  MAIL_PAGE_SIZE,
  getUnreadMailCount,
  type MailListFilter,
  type MailPage,
  type MailboxFolder,
} from "@/features/mail/data";
import { gmailSearchOf, toGmailListItem } from "@/features/mail/gmail-view";

/**
 * ⚑ Gmail 메일함 소스 (외부 수발신 · 담당 C — A·B 계층의 봉합점)
 *
 * /mail 화면의 "연동되면 Gmail" 소스다. 조립만 한다:
 *
 *   담당 A tokens.ts   — access token 발급(getAccessToken) · 연동 저장소
 *   담당 B client.ts   — REST 래퍼(토큰 주입식) · mime.ts — 파서/빌더(순수)
 *   gmail-view.ts      — 뷰모델 어댑트(순수 — check-gmail-view.ts가 검증)
 *
 * ── 보안 규약 (본인 토큰으로 본인 메일함)
 * 모든 함수의 employeeId는 **requireSessionEmployee()가 준 본인 id**여야
 * 한다 — 호출부(서버 액션·서버 컴포넌트)가 세션 대조를 먼저 하고 넘긴다.
 * 다른 출처의 employeeId를 넘기는 코드는 그 자체로 반려 대상이다.
 * client.ts가 users/me 고정이라 토큰만 맞으면 남의 메일함은 애초에 표현이
 * 안 되지만, "누구의 토큰을 뽑는가"가 이 파일의 경계다.
 *
 * ── 소프트 실패 규약 (data.ts와 동일)
 * 조회는 던지지 않는다 — 빈 페이지/null/0으로 돌려주고 console.error만
 * 남긴다. 미연동·미설정(.env의 OAuth 클라이언트 없음) 환경에서 내부 메일
 * 화면이 그대로 살아 있어야 하기 때문이다. 발송·상태 변경은 사용자에게
 * 보여줄 문장을 {ok:false, message}로 돌려준다(actions/mail.ts 규약).
 */

/* ------------------------------------------------------------------ */
/* 연동 상태                                                            */
/* ------------------------------------------------------------------ */

/**
 * 내 Gmail 연동 여부 — 마이그레이션 29의 definer 함수(boolean만 노출).
 * 소스 분기(페이지·패널·위젯)가 전부 이 한 점을 본다.
 */
export async function hasGmailConnection(): Promise<boolean> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("has_gmail_connection");
  if (error) {
    // 마이그레이션 29 미적용 환경 — 함수가 없으면 미연동으로 본다(소프트)
    console.error("[gmail-source] 연동 여부 조회 실패:", error.message);
    return false;
  }
  return data === true;
}

/**
 * 연동된 Google 계정 이메일 — 패널 표시·발송 From용.
 *
 * gmail_connections는 RLS 정책 0개(service role 전용)라 admin 클라이언트로
 * 읽되, **google_email 한 컬럼만** select한다. refresh_token을 select 목록에
 * 추가하는 순간 토큰 계층 규약 위반이다 — 토큰이 필요한 코드는 이 파일이
 * 아니라 tokens.ts의 getAccessToken을 거쳐야 한다.
 */
export async function getGmailConnectionEmail(
  employeeId: string,
): Promise<string | null> {
  try {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("gmail_connections")
      .select("google_email")
      .eq("employee_id", employeeId)
      .maybeSingle<{ google_email: string }>();
    if (error) {
      console.error("[gmail-source] 연동 이메일 조회 실패:", error.message);
      return null;
    }
    return data?.google_email ?? null;
  } catch (error) {
    // service role 키가 없는 환경(로컬 미설정)에서도 화면은 살아야 한다
    console.error("[gmail-source] 연동 이메일 조회 예외:", error);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 호출 골격 — 토큰 획득 + 401 refresh 1회 재시도                        */
/* ------------------------------------------------------------------ */

type GmailCallResult<T> = { ok: true; data: T } | { ok: false; message: string };

function callFailure(context: string, error: unknown): { ok: false; message: string } {
  if (error instanceof GmailApiError) {
    // responseBody는 로그에만 — 화면으로 내보내지 않는다(client.ts 규약)
    console.error(`[gmail-source] ${context} 실패:`, error.message, error.responseBody);
    return { ok: false, message: `Gmail 요청이 실패했습니다 (${error.status}).` };
  }
  console.error(`[gmail-source] ${context} 예외:`, error);
  return { ok: false, message: "Gmail과 통신하지 못했습니다." };
}

/**
 * gmail 스코프 없이 발급된 토큰의 403 판별 — Google 동의 화면(세분화된
 * 권한)에서 사용자가 메일 권한만 거부해도 refresh token은 내려와 연동이
 * 저장될 수 있다. 그 연동을 놔두면 /mail 전체가 빈 Gmail 메일함에 가려지고
 * 403은 401/invalid_grant 어느 회복 경로에도 안 걸린다 — 아래 gmailCall이
 * 이 판정으로 죽은 연동을 해제해 내부 메일로 복귀시킨다.
 * (rate limit 계열 403 본문(rateLimitExceeded 등)에는 "insufficient"가
 * 없어 오탐하지 않는다.)
 */
function isInsufficientScope(error: unknown): boolean {
  return (
    error instanceof GmailApiError &&
    error.status === 403 &&
    /insufficient/i.test(error.responseBody ?? "")
  );
}

/** 실패 뒤처리 — insufficient scope면 연동 해제(내부 메일 복귀), 그 외는 일반 실패 */
async function settleFailure(
  employeeId: string,
  context: string,
  error: unknown,
): Promise<{ ok: false; message: string }> {
  if (isInsufficientScope(error)) {
    console.error(`[gmail-source] ${context}: gmail 스코프 없는 연동 — 자동 해제`);
    await disconnectGmail(employeeId);
    return {
      ok: false,
      message:
        "Gmail 권한이 허용되지 않아 연동을 해제했습니다. 메일 권한을 허용한 상태로 다시 연동해 주세요.",
    };
  }
  return callFailure(context, error);
}

/**
 * 모든 Gmail 호출의 관문. access token은 tokens.ts 캐시에서 얻고, 401이면
 * (Google이 토큰을 먼저 폐기한 경우) 캐시를 무효화한 뒤 **같은 진입점**
 * (getAccessToken)으로 재발급받아 **한 번만** 재시도한다 — client.ts 오류
 * 규약("401은 상위가 refresh 후 재시도")의 그 상위가 여기다. 재발급을
 * getAccessToken으로 통일해서 새 토큰 캐싱과 invalid_grant 자동 해제가
 * 별도 경로 없이 한 곳(tokens.ts)에서 일어난다.
 */
async function gmailCall<T>(
  employeeId: string,
  context: string,
  run: (accessToken: string) => Promise<T>,
): Promise<GmailCallResult<T>> {
  const token = await getAccessToken(employeeId);
  if (!token.ok) return { ok: false, message: token.message };

  try {
    return { ok: true, data: await run(token.accessToken) };
  } catch (error) {
    if (error instanceof GmailApiError && error.status === 401) {
      // 죽은 토큰을 캐시에서 지워야 재발급이 캐시 히트로 무력화되지 않는다
      invalidateAccessToken(employeeId);
      const reissued = await getAccessToken(employeeId);
      if (!reissued.ok) return { ok: false, message: reissued.message };
      try {
        return { ok: true, data: await run(reissued.accessToken) };
      } catch (retryError) {
        return settleFailure(employeeId, context, retryError);
      }
    }
    return settleFailure(employeeId, context, error);
  }
}

/* ------------------------------------------------------------------ */
/* 목록 — 기존 MailPage 뷰모델로                                        */
/* ------------------------------------------------------------------ */

const EMPTY_PAGE: MailPage = { items: [], total: 0 };

/**
 * Gmail 메일함 목록 → 기존 MailPage(MailListItem[]) 뷰모델.
 * page.tsx의 toRow가 내부 DB 소스와 똑같이 받아 그린다 — 화면 분기 없음.
 *
 * Gmail 페이지네이션은 offset이 아니라 pageToken이라, 요청 페이지까지
 * id 목록을 토큰으로 걸어간다(페이지당 목록 호출 1회 — 상세는 마지막
 * 페이지 분량만 병렬로 채운다). total은 resultSizeEstimate — 대략치라
 * 페이지네이터 분모로만 쓴다(client.ts 주석과 같은 경고).
 */
export async function getGmailMailbox(
  employeeId: string,
  folder: MailboxFolder,
  filter: MailListFilter = {},
): Promise<MailPage> {
  const pageSize = filter.pageSize ?? MAIL_PAGE_SIZE;
  const page = Math.max(1, filter.page ?? 1);
  const search = gmailSearchOf(folder, filter);

  let pageToken: string | undefined;
  let ids: string[] = [];
  let total = 0;

  for (let step = 1; step <= page; step += 1) {
    const listed = await gmailCall(employeeId, "목록 조회", (token) =>
      listMessages(token, {
        labelIds: search.labelIds,
        q: search.q,
        maxResults: pageSize,
        pageToken,
      }),
    );
    if (!listed.ok) return EMPTY_PAGE;

    total = listed.data.resultSizeEstimate ?? 0;
    ids = (listed.data.messages ?? []).map((ref) => ref.id);
    pageToken = listed.data.nextPageToken;

    // 요청 페이지에 못 미쳐 토큰이 끊기면 그 페이지는 비어 있다(총계는 유지)
    if (step < page && !pageToken) return { items: [], total };
  }

  if (ids.length === 0) return { items: [], total };

  /*
   * 상세(format=full)를 병렬로 — 직렬이면 왕복이 페이지 크기만큼 늘어난다.
   * 개별 실패는 그 행만 떨군다(allSettled) — 한 통이 안 읽힌다고 목록
   * 전체가 비면 소프트 실패 규약에 어긋난다.
   */
  const details = await gmailCall(employeeId, "상세 조회", (token) =>
    Promise.allSettled(ids.map((id) => getMessage(token, id))),
  );
  if (!details.ok) return EMPTY_PAGE;

  const items = details.data.flatMap((result) => {
    if (result.status !== "fulfilled") {
      console.error("[gmail-source] 메일 상세 실패:", result.reason);
      return [];
    }
    return [toGmailListItem(parseGmailMessage(result.value), folder)];
  });

  return { items, total };
}

/**
 * 받은편지함 안읽음 수 — 상단바·패널 배지용.
 * 실패는 null — 호출부가 폴백(내부 카운트든 0이든)을 정한다.
 */
export async function getGmailUnreadCount(
  employeeId: string,
): Promise<number | null> {
  const listed = await gmailCall(employeeId, "안읽음 수 조회", (token) =>
    listMessages(token, { labelIds: ["INBOX", "UNREAD"], maxResults: 1 }),
  );
  if (!listed.ok) return null;
  return listed.data.resultSizeEstimate ?? 0;
}

/**
 * 배지 단일 진입점 — 연동이면 Gmail INBOX 안읽음 수, 아니면 내부 DB 수.
 * Gmail 실패(만료·통신 오류)는 0으로 눌러 내린다 — 배지가 내부 수로
 * 튀면 /mail 목록(Gmail 소스, 실패 시 빈 목록)과 다른 이야기를 하게 된다.
 * 소프트 실패 규약: 어떤 경로로도 던지지 않는다.
 */
export async function getUnifiedUnreadMailCount(
  employeeId: string,
): Promise<number> {
  if (!(await hasGmailConnection())) return getUnreadMailCount(employeeId);
  return (await getGmailUnreadCount(employeeId)) ?? 0;
}

/* ------------------------------------------------------------------ */
/* 단건 — 읽기 화면용                                                   */
/* ------------------------------------------------------------------ */

export interface GmailDetail extends ParsedGmailMessage {
  /** TRASH 라벨 유무 — 읽기 화면의 "삭제 vs 영구삭제" 표기가 본다 */
  trashed: boolean;
}

/** 한 통(format=full) — 실패·권한 밖은 null(읽기 화면이 빈 상태로 받는다) */
export async function getGmailDetail(
  employeeId: string,
  messageId: string,
): Promise<GmailDetail | null> {
  const result = await gmailCall(employeeId, "메일 조회", (token) =>
    getMessage(token, messageId),
  );
  if (!result.ok) return null;
  return {
    ...parseGmailMessage(result.data),
    trashed: (result.data.labelIds ?? []).includes("TRASH"),
  };
}

/* ------------------------------------------------------------------ */
/* 발송·상태 변경                                                       */
/* ------------------------------------------------------------------ */

export interface SendGmailInput {
  subject: string;
  body: string;
  /** 이메일 주소 문자열 — 임직원 칩도 화면 계층이 이메일로 해석해 넘긴다 */
  to: string[];
  cc?: string[];
  /** From 표시이름(임직원 이름). 주소는 연동 계정으로 고정된다 */
  senderName?: string;
}

export type GmailActionOutcome =
  | { ok: true; messageId?: string }
  | { ok: false; message: string };

/**
 * 발송 — mime.ts buildMimeMessage(순수)로 RFC2822 raw를 만들어 보낸다.
 * From 주소는 연동 계정(google_email)이다. 다른 주소를 적어도 Gmail이
 * 본인 주소로 바꿔 보내지만(위장 발신 차단), 애초에 연동 계정으로 채워
 * 표시이름까지 일관되게 한다. 첨부는 1차 제외(화면도 받지 않는다).
 */
export async function sendGmailMail(
  employeeId: string,
  input: SendGmailInput,
): Promise<GmailActionOutcome> {
  const fromEmail = await getGmailConnectionEmail(employeeId);
  if (!fromEmail) {
    return { ok: false, message: "Gmail이 연동되어 있지 않습니다." };
  }

  const raw = buildMimeMessage({
    from: { name: input.senderName, email: fromEmail },
    to: input.to.map((email) => ({ email })),
    cc: (input.cc ?? []).map((email) => ({ email })),
    subject: input.subject,
    textBody: input.body,
  });

  const sent = await gmailCall(employeeId, "발송", (token) =>
    sendMessage(token, raw),
  );
  if (!sent.ok) return sent;
  return { ok: true, messageId: sent.data.id };
}

/**
 * 읽음 처리 — UNREAD 라벨 제거. 내부 markMailRead처럼 실패가 조회를 막으면
 * 안 되는 자리(읽기 화면 진입)에서 부르므로 결과만 돌려주고 던지지 않는다.
 */
export async function markGmailRead(
  employeeId: string,
  messageId: string,
): Promise<GmailActionOutcome> {
  const result = await gmailCall(employeeId, "읽음 처리", (token) =>
    modifyMessage(token, messageId, { removeLabelIds: ["UNREAD"] }),
  );
  return result.ok ? { ok: true, messageId } : result;
}

/** 별표 토글 — STARRED 라벨 넣고 빼기 */
export async function starGmail(
  employeeId: string,
  messageId: string,
  starred: boolean,
): Promise<GmailActionOutcome> {
  const result = await gmailCall(employeeId, "별표 토글", (token) =>
    modifyMessage(
      token,
      messageId,
      starred ? { addLabelIds: ["STARRED"] } : { removeLabelIds: ["STARRED"] },
    ),
  );
  return result.ok ? { ok: true, messageId } : result;
}

/** 휴지통으로 — 영구삭제는 만들지 않는다(client.ts가 일부러 안 노출) */
export async function trashGmail(
  employeeId: string,
  messageId: string,
): Promise<GmailActionOutcome> {
  const result = await gmailCall(employeeId, "휴지통 이동", (token) =>
    trashMessage(token, messageId),
  );
  return result.ok ? { ok: true, messageId } : result;
}

/** 휴지통에서 복원 */
export async function untrashGmail(
  employeeId: string,
  messageId: string,
): Promise<GmailActionOutcome> {
  const result = await gmailCall(employeeId, "휴지통 복원", (token) =>
    untrashMessage(token, messageId),
  );
  return result.ok ? { ok: true, messageId } : result;
}
