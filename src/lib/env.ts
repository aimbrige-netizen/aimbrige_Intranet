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
 * 로그인 허용 도메인. 콤마로 구분해 여러 도메인을 허용할 수 있다.
 * (예: 회사 워크스페이스 도메인 준비 전까지 개인 gmail.com도 임시 허용)
 */
export const allowedEmailDomains: string[] = (
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS ?? ""
)
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

/**
 * Google OAuth 계정 선택창을 특정 워크스페이스로 제한할 때 쓰는 hd 파라미터.
 * 허용 도메인이 여러 개(예: gmail.com + 회사 도메인 임시 병행)이면 hd 하나로
 * 표현할 수 없으므로 명시적으로 설정했을 때만 사용하고, 그 외엔 선택창을
 * 제한하지 않는다 — 실제 접근 통제는 서버의 isAllowedEmail 검증이 담당한다.
 */
export const googleHostedDomain: string | null =
  process.env.NEXT_PUBLIC_GOOGLE_HOSTED_DOMAIN?.trim() || null;

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.toLowerCase().split("@")[1];
  return !!domain && allowedEmailDomains.includes(domain);
}
