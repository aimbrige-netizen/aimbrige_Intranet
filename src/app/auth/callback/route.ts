import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit";
import { captureGmailTokens } from "@/server/gmail/tokens";
import { googleExtraScopes, isAllowedEmail, isGmailEnabled } from "@/lib/env";
import type { AuthErrorCode } from "@/lib/auth/errors";
import type { EmploymentStatus } from "@/types/db";

/**
 * Google OAuth 콜백 (스펙 3.1 · 5장)
 *  1. code → 세션 교환
 *  2. 서버에서 이메일 도메인 재검증 (Google hd 파라미터가 우회될 경우 대비)
 *  3. employees 조회 — 없거나 active 아니면 로그아웃 + 안내
 *  4. auth_user_id 링크 (최초 로그인 시)
 *  5. 로그인 감사 로그 기록
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");

  const deny = (reason: AuthErrorCode) => {
    const target = new URL("/login", url.origin);
    target.searchParams.set("error", reason);
    return NextResponse.redirect(target);
  };

  if (!code) return deny("oauth_failed");

  const supabase = createServerSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    console.error("[auth] 코드 교환 실패", error?.message);
    return deny("oauth_failed");
  }

  const user = data.user;
  const email = user.email?.toLowerCase() ?? null;

  if (!isAllowedEmail(email)) {
    await supabase.auth.signOut({ scope: "local" });
    return deny("invalid_domain");
  }

  // 아직 본인 employees 행을 읽을 권한 연결(auth_user_id)이 없을 수 있어 관리자 클라이언트로 조회
  const admin = createAdminSupabase();
  const { data: employee } = await admin
    .from("employees")
    .select("id, auth_user_id, employment_status, name")
    .eq("email", email!)
    .maybeSingle<{
      id: string;
      auth_user_id: string | null;
      employment_status: EmploymentStatus;
      name: string;
    }>();

  if (!employee) {
    await supabase.auth.signOut({ scope: "local" });
    await writeAuditLog({
      actorId: null,
      action: "login_denied",
      detail: { email, reason: "not_registered" },
    });
    return deny("not_registered");
  }

  if (employee.employment_status !== "active") {
    await supabase.auth.signOut({ scope: "local" });
    await writeAuditLog({
      actorId: employee.id,
      action: "login_denied",
      targetId: employee.id,
      detail: { email, reason: employee.employment_status },
    });
    return deny(
      employee.employment_status === "terminated" ? "terminated" : "on_leave",
    );
  }

  // 최초 로그인 또는 auth 계정이 바뀐 경우 링크를 갱신
  if (employee.auth_user_id !== user.id) {
    const { error: linkError } = await admin
      .from("employees")
      .update({ auth_user_id: user.id })
      .eq("id", employee.id);

    if (linkError) {
      console.error("[auth] auth_user_id 링크 실패", linkError.message);
      await supabase.auth.signOut({ scope: "local" });
      return deny("oauth_failed");
    }
  }

  await writeAuditLog({
    actorId: employee.id,
    action: "login",
    targetId: employee.id,
    detail: { email },
  });

  /*
   * Gmail 외부 수발신(마이그레이션 29) — Google이 refresh token을 내려준
   * 로그인에서만 저장한다(최초 동의 또는 prompt=consent 때만 온다).
   * captureGmailTokens는 내부에서 모든 실패를 삼킨다 — 토큰 저장이
   * 어떤 이유로 실패해도 로그인은 그대로 진행되어야 한다.
   *
   * isGmailEnabled 게이트: gmail 스코프를 요청하지 않은 롤아웃(예: 캘린더만
   * 켠 상태)에서 온 refresh token을 저장하면 has_gmail_connection()이 true가
   * 되어 /mail 전체가 권한 없는(403) 빈 Gmail 메일함으로 갈아타 버린다 —
   * 메일 권한을 요청한 로그인의 토큰만 연동으로 인정한다.
   */
  const providerRefreshToken = data.session?.provider_refresh_token;
  if (providerRefreshToken) {
    if (isGmailEnabled) {
      await captureGmailTokens({
        employeeId: employee.id,
        googleEmail: email!,
        refreshToken: providerRefreshToken,
        requestedScopes: googleExtraScopes,
      });
    }

    /*
     * 세션 회전(토큰 계층 보안) — exchangeCodeForSession이 준 세션에는
     * provider_token·provider_refresh_token이 그대로 들어 있고, @supabase/ssr
     * 은 세션을 httpOnly:false 쿠키로 브라우저에 내린다. 방금 서버 금고에
     * 저장한 refresh token이 document.cookie로 읽히는 상태를 여기서 끊는다:
     * GoTrue refresh 응답에는 provider_* 필드가 없으므로(src/lib/gmail.ts의
     * "갱신되면 사라진다"가 그 동작) refreshSession 한 번으로 provider 토큰이
     * 빠진 세션이 쿠키에 다시 쓰인다. 대가로 이 로그인의 provider_token
     * (~1시간짜리 캘린더·드라이브 편의)도 사라지는데, 메일함 열쇠가 쿠키에
     * 남는 것과 바꿀 수 있는 값이 아니다. 실패해도 로그인은 막지 않는다.
     */
    const { error: rotateError } = await supabase.auth.refreshSession();
    if (rotateError) {
      console.error(
        "[auth] 세션 회전 실패 — provider 토큰이 쿠키에 남습니다:",
        rotateError.message,
      );
    }
  }

  // open redirect 방지: 내부 경로만 허용
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
