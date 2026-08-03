"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { createClient } from "@/lib/supabase/client";
import { googleExtraScopes, googleHostedDomain, isGmailEnabled } from "@/lib/env";

/**
 * Google 연동이 끊겼을 때의 인라인 안내 (Drive · Gmail 공용)
 *
 * 두 모듈이 같은 두 가지 상태를 갖는다.
 *
 *   스코프 미설정  관리자가 Cloud Console에 스코프를 안 넣은 상태.
 *                 임직원이 다시 로그인해도 아무 일도 안 일어난다 → warn, 버튼 없음
 *   토큰 만료      스코프는 열렸는데 내 provider_token이 갱신되며 사라진 상태.
 *                 매일 반복되는 정상 동작이고 재로그인으로 즉시 풀린다 → info + 버튼
 *
 * 톤을 이렇게 나눈 이유는 "손댈 수 있는 사람이 누구냐"다. 만료는 본인이 1초 만에
 * 고치는 일상이라 경고색을 쓰면 매일 사이렌이 울리는 꼴이고, 스코프 미설정은
 * 관리자가 조치할 때까지 기능이 아예 없는 상태라 눈에 띄어야 한다.
 *
 * 재로그인 버튼이 없으면 안내 문구가 "다시 로그인하세요"라고만 말하고 끝난다 —
 * 상단바에는 로그아웃밖에 없어서 사용자가 경로를 직접 찾아야 한다.
 */
export function GoogleReauthNotice({
  service,
  scopeKeyword,
  scopeMissingTitle,
  scopeMissingHint,
  expiredTitle,
  expiredBody,
  canConfigure = false,
  className,
}: {
  /** 안내 문구에 들어갈 서비스 이름 (예: "Drive") */
  service: string;
  /** googleExtraScopes에서 이 서비스의 스코프를 식별하는 문자열 */
  scopeKeyword: string;
  scopeMissingTitle: string;
  /** 관리자에게만 보여줄 설정 방법. 일반 임직원에게는 대기 안내만 나간다 */
  scopeMissingHint: React.ReactNode;
  expiredTitle: string;
  expiredBody: React.ReactNode;
  canConfigure?: boolean;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  const reauth = async () => {
    setLoading(true);
    const supabase = createClient();
    // 재동의 후 보던 화면으로 돌아온다
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", window.location.pathname);

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
        ...(googleExtraScopes ? { scopes: googleExtraScopes } : {}),
        queryParams: {
          ...(googleHostedDomain ? { hd: googleHostedDomain } : {}),
          /*
           * Gmail 연동은 refresh token이 필요한데 Google은 access_type=offline
           * + 동의 화면일 때만 내려준다 — 재동의(prompt=consent) 버튼이 그
           * 발급 창구라 여기도 로그인 버튼과 같은 게이트로 켠다.
           */
          ...(isGmailEnabled ? { access_type: "offline" } : {}),
          // 이미 동의한 계정은 동의 화면을 건너뛰어 새 스코프가 안 붙는다
          prompt: "consent",
        },
      },
    });
  };

  if (!googleExtraScopes.includes(scopeKeyword)) {
    return (
      <Callout tone="warn" title={scopeMissingTitle} className={className}>
        {canConfigure
          ? scopeMissingHint
          : `시스템 관리자가 연결을 열어주면 ${service} 정보가 표시됩니다.`}
      </Callout>
    );
  }

  return (
    <Callout
      tone="info"
      title={expiredTitle}
      className={className}
      action={
        <Button size="small" variant="secondary" onClick={reauth} disabled={loading}>
          <RefreshCw className="size-3.5" />
          {loading ? "이동 중…" : "다시 연결"}
        </Button>
      }
    >
      {expiredBody}
    </Callout>
  );
}
