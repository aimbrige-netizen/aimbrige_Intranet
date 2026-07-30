"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { googleExtraScopes, googleHostedDomain } from "@/lib/env";

/** Google 계정 로그인 버튼 — 로그인 화면에는 이 버튼 하나만 노출 (스펙 3.1) */
export function GoogleSignInButton({ next }: { next?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    if (next) callback.searchParams.set("next", next);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
        // 캘린더 동기화용 추가 스코프. 콘솔에 등록된 뒤에만 값이 채워진다(env 참고).
        ...(googleExtraScopes ? { scopes: googleExtraScopes } : {}),
        queryParams: {
          // hd를 설정한 경우에만 Google 계정 선택창을 해당 워크스페이스로 제한.
          // (허용 도메인이 여러 개일 땐 hd 하나로 표현할 수 없어 생략 — 서버 검증이 실제 통제선)
          ...(googleHostedDomain ? { hd: googleHostedDomain } : {}),
          prompt: "select_account",
        },
      },
    });

    if (oauthError) {
      setError(oauthError.message);
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={signIn}
        disabled={loading}
        className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-line-strong bg-surface text-body font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-60"
      >
        <GoogleMark />
        {loading ? "이동 중…" : "Google 계정으로 로그인"}
      </button>
      {error ? (
        <p className="mt-2 text-label text-danger">{error}</p>
      ) : null}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg className="size-[18px]" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2a7 7 0 0 1-6.6-4.8H1.4v3.1A11.9 11.9 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.4 14.5a7.1 7.1 0 0 1 0-4.6V6.8H1.4a11.9 11.9 0 0 0 0 10.7l4-3Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A11.6 11.6 0 0 0 12 0 11.9 11.9 0 0 0 1.4 6.8l4 3.1A7 7 0 0 1 12 4.8Z"
      />
    </svg>
  );
}
