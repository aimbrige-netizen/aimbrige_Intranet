/**
 * 환경변수 접근 지점.
 * 값이 비어 있으면 런타임에서 원인을 알기 쉬운 에러를 던진다.
 */

function required(key: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `환경변수 ${key} 가 설정되지 않았습니다. .env.local 파일을 확인하세요.`,
    );
  }
  return value;
}

/** 브라우저·서버 공통 (NEXT_PUBLIC_ 접두사 필요) */
export const publicEnv = {
  get supabaseUrl() {
    return required(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    );
  },
  get supabaseAnonKey() {
    return required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  },
};

/** 서버 전용 — 클라이언트 컴포넌트에서 import 하면 안 된다 */
export const serverEnv = {
  get supabaseServiceRoleKey() {
    return required(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  },
};

/**
 * 로그인 허용 도메인. 기본값 sding.kr (기획서 3.1)
 * 여러 도메인을 허용해야 하면 콤마로 구분한다.
 */
export const allowedEmailDomains: string[] = (
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS ?? "sding.kr"
)
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

/** Google OAuth 계정 선택창을 특정 워크스페이스로 제한할 때 쓰는 hd 파라미터 */
export const googleHostedDomain =
  process.env.NEXT_PUBLIC_GOOGLE_HOSTED_DOMAIN ?? allowedEmailDomains[0];

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.toLowerCase().split("@")[1];
  return !!domain && allowedEmailDomains.includes(domain);
}
