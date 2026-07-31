"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";
import { googleExtraScopes, googleHostedDomain } from "@/lib/env";

/**
 * Drive 접근 토큰이 없을 때 안내 (스펙 06 · 5장 제약)
 *
 * provider_token은 로그인 후 약 1시간이면 사라진다. 이 모듈은 전체가 Drive API에
 * 의존하므로 실패를 조용히 넘기면 "빈 폴더"처럼 보여 오해를 부른다.
 * 그래서 원인을 밝히고 재인증 버튼을 준다.
 */
export function DriveReauthNotice({ message }: { message: string }) {
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

  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
        <KeyRound className="size-8 text-muted" aria-hidden />
        <div>
          <p className="text-h2 text-ink">Drive 연결이 필요합니다</p>
          <p className="mx-auto mt-1 max-w-lg text-caption">{message}</p>
        </div>

        {scopeMissing ? (
          <div className="mx-auto max-w-lg rounded-card border border-warn/40 bg-warn-light px-4 py-3 text-left text-label text-ink">
            <p className="font-bold">Drive 스코프가 아직 설정되지 않았습니다</p>
            <p className="mt-1 leading-relaxed">
              시스템 관리자가 먼저 아래를 처리해야 합니다.
              <br />
              1. Google Cloud Console → 데이터 액세스 →{" "}
              <code className="text-[11px]">
                https://www.googleapis.com/auth/drive
              </code>{" "}
              스코프 추가
              <br />
              2. 대상(Audience) → 테스트 사용자에 로그인할 계정 등록
              <br />
              3. <code className="text-[11px]">.env.local</code>의{" "}
              <code className="text-[11px]">NEXT_PUBLIC_GOOGLE_EXTRA_SCOPES</code>
              에 Drive 스코프 추가 후 서버 재시작
            </p>
          </div>
        ) : (
          <Button onClick={reauth} disabled={loading}>
            {loading ? "이동 중…" : "Google 다시 연결"}
          </Button>
        )}

        <p className="mx-auto max-w-lg text-[11px] leading-relaxed text-muted">
          Google 접근 토큰은 로그인 후 약 1시간이면 만료됩니다. 항상 연결을 유지하려면
          refresh token을 서버에 보관하는 방식이 필요한데, 유출 시 임직원 드라이브
          전체가 열리는 위험이 있어 별도 보안 검토 후 도입할 예정입니다.
        </p>
      </CardBody>
    </Card>
  );
}
