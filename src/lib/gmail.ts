import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { isGmailEnabled } from "@/lib/env";

/**
 * Gmail API 연동 (스펙 11 · 3.2)
 *
 * 안읽은 메일 5건의 발신자·제목·시각만 읽는다. 본문은 가져오지 않는다 —
 * 인트라넷에 메일 본문을 렌더링하지 않기로 한 스펙 결정이고, 실무적으로도
 * 본문을 서버 로그나 캐시에 흘릴 여지를 아예 없애는 편이 낫다.
 *
 * ── 토큰 제약 (Drive와 동일)
 * Supabase Auth의 provider_token은 액세스 토큰이 갱신되면(약 1시간) 사라진다.
 * 메일 위젯은 대시보드의 부가 정보라 실패해도 대시보드는 그대로 떠야 하고,
 * 그래서 던지지 않고 항상 GmailResult로 돌려준다.
 *
 * ── 상태를 셋으로 나눈 이유
 * `scope_missing`(관리자가 스코프를 아직 안 켬)과 `reauth_required`(켰지만
 * 내 토큰이 만료됨)는 사용자가 할 일이 다르다. 전자는 다시 로그인해도
 * 소용없으니 "다시 로그인" 버튼을 띄우면 안 된다.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** 위젯에 뿌리는 건수. 스펙 3.2에서 5건으로 못박혀 있다 */
export const UNREAD_PREVIEW_COUNT = 5;

export interface UnreadMail {
  id: string;
  /** 표시용으로 가공하지 않은 원본 From 헤더 */
  from: string;
  subject: string;
  /** epoch ms. Gmail internalDate는 문자열로 온다 */
  receivedAt: number;
}

export type GmailResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: "scope_missing" | "reauth_required" | "error";
      message: string;
    };

const SCOPE_MISSING: GmailResult<never> = {
  ok: false,
  reason: "scope_missing",
  message:
    "메일 연동이 아직 켜져 있지 않습니다. 관리자가 Google OAuth에 Gmail 읽기 권한을 추가해야 합니다.",
};

const REAUTH: GmailResult<never> = {
  ok: false,
  reason: "reauth_required",
  message:
    "Gmail 접근 토큰이 만료되었습니다. 다시 로그인하면 메일을 불러올 수 있습니다.",
};

async function gmailFetch(path: string, token: string): Promise<GmailResult<unknown>> {
  try {
    const response = await fetch(`${GMAIL_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (response.status === 401 || response.status === 403) {
      console.error("[gmail] 인증 거부", response.status, await response.text());
      /*
       * "토큰이 아예 없다"(REAUTH)와 "토큰은 있는데 API가 거부했다"는 다르다.
       * 후자는 대개 스코프를 방금 켰고 사용자가 아직 재동의를 안 한 상태다 —
       * 만료라고 안내하면 원인을 한 번 더 돌아서 찾게 된다.
       */
      return {
        ok: false,
        reason: "reauth_required",
        message:
          "Gmail 접근 권한이 없습니다. 메일 읽기 권한을 허용한 상태로 다시 연결해 주세요.",
      };
    }

    if (!response.ok) {
      console.error("[gmail] 요청 실패", response.status, await response.text());
      return {
        ok: false,
        reason: "error",
        message: `Gmail 요청이 실패했습니다 (${response.status}).`,
      };
    }

    return { ok: true, data: await response.json() };
  } catch (error) {
    console.error("[gmail] 예외", error);
    return {
      ok: false,
      reason: "error",
      message: "Gmail 통신 중 오류가 발생했습니다.",
    };
  }
}

/**
 * 안읽은 메일 미리보기.
 *
 * 목록 1회 + 건별 메타데이터 5회를 부른다. 건별 호출은 서로 독립이라 병렬로
 * 보낸다(직렬로 보내면 왕복이 5배가 되는데, 이건 대시보드 첫 페인트를
 * 붙잡는 시간이다).
 *
 * `format=metadata` + metadataHeaders로 필요한 헤더 3개만 받는다. full로 받으면
 * 본문 전체가 응답에 실려 온다 — 쓰지도 않을 데이터를 서버 메모리에 올릴 이유가 없다.
 */
export async function getUnreadMail(): Promise<GmailResult<UnreadMail[]>> {
  if (!isGmailEnabled) return SCOPE_MISSING;

  const supabase = createServerSupabase();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.provider_token;
  if (!token) return REAUTH;

  const listed = await gmailFetch(
    `/messages?q=${encodeURIComponent("is:unread in:inbox")}&maxResults=${UNREAD_PREVIEW_COUNT}`,
    token,
  );
  if (!listed.ok) return listed;

  const ids = (
    (listed.data as { messages?: { id?: string }[] }).messages ?? []
  )
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id));

  // 안읽은 메일이 없으면 messages 키 자체가 안 온다. 빈 목록은 오류가 아니다.
  if (ids.length === 0) return { ok: true, data: [] };

  const headers = "metadataHeaders=From&metadataHeaders=Subject";
  const details = await Promise.all(
    ids.map((id) => gmailFetch(`/messages/${id}?format=metadata&${headers}`, token)),
  );

  // 한 건이라도 인증에서 막히면 목록 전체가 못 미더우니 그 상태를 그대로 올린다.
  const denied = details.find(
    (d): d is Extract<GmailResult<unknown>, { ok: false }> =>
      !d.ok && d.reason === "reauth_required",
  );
  if (denied) return denied;

  const mails = details.flatMap((detail, index) => {
    if (!detail.ok) return [];
    return [toUnreadMail(ids[index], detail.data as GmailMessage)];
  });

  // 개별 실패가 섞였는데 전부 실패했다면 빈 목록("다 읽었습니다")으로 오해하게 된다.
  if (mails.length === 0) {
    return {
      ok: false,
      reason: "error",
      message: "메일 정보를 불러오지 못했습니다.",
    };
  }

  return { ok: true, data: mails.sort((a, b) => b.receivedAt - a.receivedAt) };
}

interface GmailMessage {
  internalDate?: string;
  payload?: { headers?: { name?: string; value?: string }[] };
}

function toUnreadMail(id: string, message: GmailMessage): UnreadMail {
  const headers = message.payload?.headers ?? [];
  const header = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name)?.value ?? "";

  return {
    id,
    from: header("from") || "(발신자 없음)",
    subject: header("subject") || "(제목 없음)",
    receivedAt: Number(message.internalDate ?? 0),
  };
}
