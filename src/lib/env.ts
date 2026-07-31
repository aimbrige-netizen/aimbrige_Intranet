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

/**
 * 로그인 시 기본(email·profile) 외에 추가로 요청할 Google 스코프.
 *
 * 캘린더 동기화(스펙 02 · 5장)에는 calendar.events 스코프가 필요하다.
 * 다만 Google Cloud Console의 "데이터 액세스"에 해당 스코프를 등록하기 전에
 * 요청하면 동의 화면에서 막혀 로그인 자체가 실패한다. 그래서 기본값을 비워두고,
 * 콘솔 설정을 끝낸 뒤 .env.local에서 켜는 방식으로 둔다.
 *
 *   NEXT_PUBLIC_GOOGLE_EXTRA_SCOPES=https://www.googleapis.com/auth/calendar.events
 */
export const googleExtraScopes: string =
  process.env.NEXT_PUBLIC_GOOGLE_EXTRA_SCOPES?.trim() || "";

/** 캘린더 동기화가 활성화된 상태인지 (스코프를 요청하고 있는지) */
export const isGoogleCalendarSyncEnabled =
  googleExtraScopes.includes("calendar");

/**
 * 메일 미리보기(스펙 11 · 3.2)가 활성화된 상태인지.
 *
 * 딥링크(상단바 메일 아이콘)는 스코프와 무관하게 항상 동작한다 —
 * 그냥 mail.google.com을 여는 링크라서 API를 부르지 않는다.
 * 이 플래그가 끄는 것은 위젯의 API 조회뿐이다.
 */
export const isGmailEnabled = googleExtraScopes.includes("gmail");

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.toLowerCase().split("@")[1];
  return !!domain && allowedEmailDomains.includes(domain);
}
