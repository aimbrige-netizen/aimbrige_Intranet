import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit";
import { isAllowedEmail } from "@/lib/env";
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

  // open redirect 방지: 내부 경로만 허용
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
