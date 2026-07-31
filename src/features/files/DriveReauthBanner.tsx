"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { createClient } from "@/lib/supabase/client";
import { googleExtraScopes, googleHostedDomain } from "@/lib/env";

/**
 * Drive 연결이 끊겼을 때의 인라인 배너.
 *
 * 토큰 만료는 매일 반복되는 정상 상태다. 예전에는 그때마다 파일함 전체가
 * 카드 한 장짜리 안내문으로 바뀌어서, 표도 지표도 사라지고 "이 화면이 무엇을
 * 하는 곳인지"까지 같이 사라졌다. 골격은 그대로 두고 한 줄로 알린다.
 *
 * 관리자 설정 안내는 실제로 처리할 수 있는 사람(system_admin)에게만 보인다.
 */
export function DriveReauthBanner({
  canConfigure = false,
}: {
  /** 시스템 관리자인지 — 스코프 설정 안내를 볼 대상인지 */
  canConfigure?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const scopeMissing = !googleExtraScopes.includes("drive");

  const reauth = async () => {
    setLoading(true);
    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", window.location.pathname);

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
        ...(googleExtraScopes ? { scopes: googleExtraScopes } : {}),
        queryParams: {
          ...(googleHostedDomain ? { hd: googleHostedDomain } : {}),
          prompt: "consent",
        },
      },
    });
  };

  if (scopeMissing) {
    return (
      <Callout
        tone="warn"
        title="Google Drive 연결이 아직 열려 있지 않습니다"
        className="mb-4"
      >
        {canConfigure ? (
          <>
            Google Cloud Console의 데이터 액세스에 Drive 스코프를 추가하고,
            <code className="mx-1 rounded-sm bg-surface px-1 py-0.5 text-nano">
              NEXT_PUBLIC_GOOGLE_EXTRA_SCOPES
            </code>
            에 반영하면 파일 목록이 연결됩니다.
          </>
        ) : (
          "시스템 관리자가 연결을 열어주면 파일 목록이 표시됩니다."
        )}
      </Callout>
    );
  }

  return (
    <Callout
      tone="info"
      title="Drive 연결이 만료되었습니다"
      className="mb-4"
      action={
        <Button size="small" variant="secondary" onClick={reauth} disabled={loading}>
          <RefreshCw className="size-3.5" />
          {loading ? "이동 중…" : "다시 연결"}
        </Button>
      }
    >
      다시 연결하면 목록과 사용량이 최신 상태로 채워집니다.
    </Callout>
  );
}
