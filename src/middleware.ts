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
 *
 * 주의: "세션이 있으면 /login에서 /로 보낸다"와 "재직 여부를 확인한다"를
 * 반드시 같은 employees 조회 결과로 판단해야 한다. 예전엔 /login 분기가
 * employees 조회 없이 raw user만 보고 "/"로 돌려보냈는데, 이후 서버
 * 컴포넌트 쪽 재확인(requireSessionEmployee)이 등록되지 않은/비활성
 * 계정이라고 다시 /login으로 돌려보내면서 로그아웃 없이 무한 리다이렉트
 * 루프(ERR_TOO_MANY_REDIRECTS)가 발생했다. 지금은 이 판단을 한 번만 하고
 * 모든 분기가 그 결과를 공유한다.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { supabase, getResponse } = createMiddlewareSupabase(request);

  // getUser()는 Auth 서버에 토큰을 검증하므로 쿠키 위조를 막을 수 있다.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (isPublicPath(pathname)) return getResponse();
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return redirectWithCookies(loginUrl, getResponse());
  }

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("id, employment_status, role:roles(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle<{
      id: string;
      employment_status: EmploymentStatus;
      role: { name: RoleName } | null;
    }>();

  if (employeeError) {
    console.error("[middleware] employees 조회 실패:", employeeError.message);
  }

  const isActiveEmployee =
    !!employee && employee.employment_status === "active";

  if (!isActiveEmployee) {
    // /auth/callback 등 자체적으로 상태를 판단하는 공개 경로는 그대로 통과시킨다.
    if (isPublicPath(pathname) && pathname !== "/login") {
      return getResponse();
    }

    // 세션을 로컬에서 즉시 끊는다(네트워크 왕복 없이 쿠키 제거) — 여기서 로그아웃하지
    // 않으면 다음 요청에도 여전히 user가 존재해 같은 판단이 반복되며 루프에 빠진다.
    await supabase.auth.signOut({ scope: "local" });

    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/login") {
      const reason: AuthErrorCode = !employee
        ? "not_registered"
        : employee.employment_status === "terminated"
          ? "terminated"
          : "on_leave";
      loginUrl.searchParams.set("error", reason);
    }
    return redirectWithCookies(loginUrl, getResponse());
  }

  // 여기부터는 재직중인 유효한 임직원.
  if (pathname === "/login") {
    return redirectWithCookies(new URL("/", request.url), getResponse());
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
