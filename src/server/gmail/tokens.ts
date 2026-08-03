import "server-only";

import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * ⚑ Gmail 토큰 계층 (마이그레이션 29)
 *
 * gmail_connections는 RLS 정책 0개(= service role 전용)라 이 모듈만이
 * refresh token에 닿는 유일한 경로다. 그래서 이 파일의 규칙:
 *
 *  1) "server-only" import — 클라이언트 번들에 섞이면 빌드가 죽는다(의도).
 *  2) 절대 "use server"를 붙이지 않는다. 붙이면 모든 export가 클라이언트에서
 *     호출 가능한 서버 액션이 되고, getRefreshToken(employeeId)이 곧
 *     "아무나 남의 refresh token을 뽑는 RPC"가 된다. 이 모듈의 함수는
 *     서버 코드(라우트 핸들러·서버 액션·서버 컴포넌트)에서만 부른다.
 *  3) refresh token은 반환값을 서버 밖으로 흘리지 않는다 — 화면에 필요한
 *     정보는 연동 여부(boolean)뿐이고 그건 DB 함수 has_gmail_connection()이
 *     담당한다.
 *  4) access token은 저장하지 않는다. 매번 refresh grant로 발급하되,
 *     프로세스 메모리에서만 만료까지 캐시한다(만료 60초 전 갱신).
 *
 * ── GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET ──────────────
 * 아직 .env.local에 없다(Google Cloud Console 웹 클라이언트 값 —
 * Supabase 대시보드의 Google provider에 넣은 것과 같은 클라이언트).
 * 그래서 없을 때 던지지 않고 not_configured로 소프트 실패한다 —
 * 내부 메일(DB 소스)은 이 값 없이도 그대로 동작해야 하기 때문이다.
 */

/* ------------------------------------------------------------------ */
/* 연동 저장/조회/해제                                                  */
/* ------------------------------------------------------------------ */

export interface GmailConnectionInput {
  employeeId: string;
  googleEmail: string;
  refreshToken: string;
  scopes: string[];
}

/**
 * 연동 저장(upsert). 재로그인으로 새 refresh token이 오면 덮어쓴다.
 * 실패해도 던지지 않고 false — 호출부(로그인 콜백)가 로그인을 계속해야 한다.
 */
export async function saveConnection({
  employeeId,
  googleEmail,
  refreshToken,
  scopes,
}: GmailConnectionInput): Promise<boolean> {
  try {
    const admin = createAdminSupabase();
    const { error } = await admin.from("gmail_connections").upsert(
      {
        employee_id: employeeId,
        google_email: googleEmail,
        refresh_token: refreshToken,
        scopes,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "employee_id" },
    );

    if (error) {
      console.error("[gmail-tokens] 연동 저장 실패:", error.message);
      return false;
    }

    // 이전 연동의 캐시된 access token은 새 토큰과 무관하니 비운다
    accessTokenCache.delete(employeeId);
    return true;
  } catch (error) {
    console.error("[gmail-tokens] 연동 저장 예외:", error);
    return false;
  }
}

/**
 * refresh token 조회 — 서버 전용. 반환값을 로그·응답·클라이언트 props 등
 * 어디로도 내보내지 말 것. 연동이 없으면 null.
 */
export async function getRefreshToken(
  employeeId: string,
): Promise<string | null> {
  try {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("gmail_connections")
      .select("refresh_token")
      .eq("employee_id", employeeId)
      .maybeSingle<{ refresh_token: string }>();

    if (error) {
      console.error("[gmail-tokens] refresh token 조회 실패:", error.message);
      return null;
    }
    return data?.refresh_token ?? null;
  } catch (error) {
    console.error("[gmail-tokens] refresh token 조회 예외:", error);
    return null;
  }
}

/** 연동 해제 — 행 삭제 + 메모리 캐시 제거. invalid_grant 자동 정리에도 쓴다. */
export async function disconnectGmail(employeeId: string): Promise<boolean> {
  accessTokenCache.delete(employeeId);
  try {
    const admin = createAdminSupabase();
    const { error } = await admin
      .from("gmail_connections")
      .delete()
      .eq("employee_id", employeeId);

    if (error) {
      console.error("[gmail-tokens] 연동 해제 실패:", error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[gmail-tokens] 연동 해제 예외:", error);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* access token 발급                                                    */
/* ------------------------------------------------------------------ */

export type MintResult =
  | { ok: true; accessToken: string; /** epoch ms */ expiresAt: number }
  | {
      ok: false;
      /**
       * not_configured — GOOGLE_OAUTH_CLIENT_ID/SECRET이 .env.local에 없음
       * invalid_grant  — refresh token이 폐기됨(비밀번호 변경·권한 회수 등).
       *                  호출부는 연동 해제 후 재연동을 안내해야 한다.
       * error          — 그 외 통신/응답 오류
       */
      reason: "not_configured" | "invalid_grant" | "error";
      message: string;
    };

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** 만료 60초 전부터는 캐시를 버리고 새로 발급한다 */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * employeeId → 발급된 access token 캐시. 프로세스 메모리 한정 —
 * DB·쿠키·클라이언트 어디에도 저장하지 않는다(보안 규약).
 * 서버리스 환경에서 프로세스가 재활용되면 캐시도 사라지는데, 그 경우
 * refresh grant 한 번이 더 나갈 뿐 동작은 같다.
 */
const accessTokenCache = new Map<
  string,
  { accessToken: string; expiresAt: number }
>();

function oauthClientEnv(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * refresh token으로 access token 발급 (refresh grant).
 *
 * 순수 호출 — DB를 건드리지 않고 결과만 돌려준다. invalid_grant 시의
 * 연동 해제까지 묶은 진입점은 getAccessToken(employeeId)을 쓸 것.
 */
export async function mintAccessToken(
  refreshToken: string,
): Promise<MintResult> {
  const env = oauthClientEnv();
  if (!env) {
    // .env.local에 아직 없는 값 — 던지지 않는다(내부 메일은 계속 동작해야 함)
    return {
      ok: false,
      reason: "not_configured",
      message:
        "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET이 설정되지 않았습니다. .env.local에 추가해야 Gmail 연동이 동작합니다.",
    };
  }

  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: env.clientId,
        client_secret: env.clientSecret,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        error_description?: string;
      };

      if (body.error === "invalid_grant") {
        // 토큰이 폐기됐다 — 재발급이 아니라 재연동(재로그인)이 필요한 상태
        return {
          ok: false,
          reason: "invalid_grant",
          message:
            "Gmail 연동이 만료되었습니다. 다시 로그인해 재연동해 주세요.",
        };
      }

      console.error(
        "[gmail-tokens] access token 발급 실패:",
        response.status,
        body.error,
        body.error_description,
      );
      return {
        ok: false,
        reason: "error",
        message: `Google 토큰 발급이 실패했습니다 (${response.status}).`,
      };
    }

    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!body.access_token) {
      return {
        ok: false,
        reason: "error",
        message: "Google 토큰 응답에 access_token이 없습니다.",
      };
    }

    return {
      ok: true,
      accessToken: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
  } catch (error) {
    console.error("[gmail-tokens] 토큰 엔드포인트 통신 예외:", error);
    return {
      ok: false,
      reason: "error",
      message: "Google 토큰 서버와 통신하지 못했습니다.",
    };
  }
}

/**
 * 캐시된 access token 무효화 — Google이 토큰을 먼저 폐기해 API가 401을
 * 돌려준 경우(gmail-source의 401 재시도 경로)가 부른다. 여기서 지워야
 * 다음 getAccessToken이 캐시 히트 대신 refresh grant로 새 토큰을 받아
 * 다시 캐시한다 — 죽은 토큰이 만료(최대 ~59분)까지 캐시에 남아 매 호출이
 * "죽은 토큰 401 → refresh" 왕복을 반복하는 상태를 없앤다.
 */
export function invalidateAccessToken(employeeId: string): void {
  accessTokenCache.delete(employeeId);
}

export type AccessTokenResult =
  | { ok: true; accessToken: string }
  | {
      ok: false;
      /** not_connected — gmail_connections에 행이 없음(연동 전) */
      reason: "not_connected" | "not_configured" | "invalid_grant" | "error";
      message: string;
    };

/**
 * "본인 토큰으로 본인 메일함" 진입점 — Gmail API를 부르는 서버 코드는
 * 반드시 이 함수로 access token을 얻는다. 호출부는 employeeId가
 * auth.uid()의 임직원인지(requireSessionEmployee 등) 먼저 검증했어야 한다.
 *
 *  · 프로세스 메모리 캐시 히트(만료 60초 전까지)면 네트워크 없이 반환
 *  · invalid_grant면 죽은 연동을 그 자리에서 해제해 두 번째 실패를 없앤다
 */
export async function getAccessToken(
  employeeId: string,
): Promise<AccessTokenResult> {
  const cached = accessTokenCache.get(employeeId);
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return { ok: true, accessToken: cached.accessToken };
  }
  accessTokenCache.delete(employeeId);

  const refreshToken = await getRefreshToken(employeeId);
  if (!refreshToken) {
    return {
      ok: false,
      reason: "not_connected",
      message: "Gmail이 연동되어 있지 않습니다.",
    };
  }

  const minted = await mintAccessToken(refreshToken);
  if (!minted.ok) {
    if (minted.reason === "invalid_grant") {
      await disconnectGmail(employeeId);
    }
    return minted;
  }

  accessTokenCache.set(employeeId, {
    accessToken: minted.accessToken,
    expiresAt: minted.expiresAt,
  });
  return { ok: true, accessToken: minted.accessToken };
}

/* ------------------------------------------------------------------ */
/* 로그인 콜백 훅                                                       */
/* ------------------------------------------------------------------ */

export interface CaptureGmailTokensInput {
  employeeId: string;
  googleEmail: string;
  refreshToken: string;
  /** 로그인 시 요청한 추가 스코프(공백/콤마 구분 문자열 그대로 받아 정리) */
  requestedScopes?: string;
}

/**
 * 로그인 콜백 전용 훅 — session.provider_refresh_token이 왔을 때만 불린다.
 * (Google은 최초 동의 또는 prompt=consent일 때만 refresh token을 내려주므로
 * 매 로그인마다 오는 값이 아니다. 안 오면 기존 연동을 그대로 둔다.)
 *
 * 어떤 실패도 로그인 흐름을 막으면 안 되므로 절대 던지지 않는다.
 */
export async function captureGmailTokens({
  employeeId,
  googleEmail,
  refreshToken,
  requestedScopes = "",
}: CaptureGmailTokensInput): Promise<void> {
  try {
    const scopes = requestedScopes
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const saved = await saveConnection({
      employeeId,
      googleEmail,
      refreshToken,
      scopes,
    });

    if (!saved) {
      // saveConnection이 이미 원인을 로그에 남겼다 — 로그인은 계속 진행
      console.error("[gmail-tokens] captureGmailTokens: 저장 실패(로그인은 계속)");
    }
  } catch (error) {
    console.error("[gmail-tokens] captureGmailTokens 예외(로그인은 계속):", error);
  }
}
