import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";

/**
 * 미들웨어용 Supabase 클라이언트 + 응답 객체를 함께 만든다.
 * 세션 토큰 갱신 결과를 응답 쿠키에 실어야 하므로 response를 같이 들고 다닌다.
 */
export function createMiddlewareSupabase(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  return {
    supabase,
    /** setAll 이후에 교체되므로 항상 이 함수로 최신 response를 가져간다 */
    getResponse: () => response,
  };
}

/**
 * 리다이렉트 응답에 그동안 갱신된 세션 쿠키를 옮겨 담는다.
 * 이걸 빼먹으면 리다이렉트 때마다 세션이 초기화돼 무한 루프가 난다.
 */
export function redirectWithCookies(
  url: URL,
  carrier: NextResponse,
): NextResponse {
  const redirect = NextResponse.redirect(url);
  carrier.cookies.getAll().forEach((cookie) => {
    redirect.cookies.set(cookie);
  });
  return redirect;
}
