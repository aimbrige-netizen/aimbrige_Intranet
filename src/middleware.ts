import type { NextRequest } from "next/server";
import {
  createMiddlewareSupabase,
  redirectWithCookies,
} from "@/lib/supabase/middleware";
import type { AuthErrorCode } from "@/lib/auth/errors";
import type { EmploymentStatus, RoleName } from "@/types/db";

/** 비로그인 상태로 접근 가능한 경로 */
const PUBLIC_PREFIXES = ["/login", "/auth"];

function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * 인증/권한 게이트 (스펙 01 · 5장 인증·권한 플로우)
 *  1. 세션 확인 → 없으면 /login
 *  2. employees 조회 → 없거나 active 아니면 로그아웃 + 안내
 *  3. /admin/* 은 system_admin 만 통과
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { supabase, getResponse } = createMiddlewareSupabase(request);

  // getUser()는 Auth 서버에 토큰을 검증하므로 쿠키 위조를 막을 수 있다.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isPublicPath(pathname)) {
    // 이미 로그인한 사용자가 /login 으로 오면 홈으로 보낸다.
    if (user && pathname === "/login") {
      return redirectWithCookies(new URL("/", request.url), getResponse());
    }
    return getResponse();
  }

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return redirectWithCookies(loginUrl, getResponse());
  }

  const { data: employee } = await supabase
    .from("employees")
    .select("id, employment_status, role:roles(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle<{
      id: string;
      employment_status: EmploymentStatus;
      role: { name: RoleName } | null;
    }>();

  if (!employee || employee.employment_status !== "active") {
    const reason: AuthErrorCode = !employee
      ? "not_registered"
      : employee.employment_status === "terminated"
        ? "terminated"
        : "on_leave";

    // 세션을 로컬에서 즉시 끊는다(네트워크 왕복 없이 쿠키 제거).
    await supabase.auth.signOut({ scope: "local" });

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", reason);
    return redirectWithCookies(loginUrl, getResponse());
  }

  if (pathname.startsWith("/admin") && employee.role?.name !== "system_admin") {
    const homeUrl = new URL("/", request.url);
    homeUrl.searchParams.set("denied", "admin_only");
    return redirectWithCookies(homeUrl, getResponse());
  }

  return getResponse();
}

export const config = {
  matcher: [
    /*
     * 정적 파일·이미지 최적화 요청은 제외한다.
     * 매 요청마다 세션 검증 + employees 조회가 돌기 때문에 범위를 좁게 잡는다.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
