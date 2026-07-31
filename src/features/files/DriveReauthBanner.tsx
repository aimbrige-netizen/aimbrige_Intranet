"use client";

import { GoogleReauthNotice } from "@/features/google/GoogleReauthNotice";

/**
 * Drive 연결이 끊겼을 때의 인라인 배너.
 *
 * 토큰 만료는 매일 반복되는 정상 상태다. 예전에는 그때마다 파일함 전체가
 * 카드 한 장짜리 안내문으로 바뀌어서, 표도 지표도 사라지고 "이 화면이 무엇을
 * 하는 곳인지"까지 같이 사라졌다. 골격은 그대로 두고 한 줄로 알린다.
 *
 * 상태 판정과 재로그인 흐름은 메일 위젯과 완전히 같아서 GoogleReauthNotice로
 * 옮겼다. 여기 남은 것은 Drive에 고유한 문구뿐이다.
 */
export function DriveReauthBanner({
  canConfigure = false,
}: {
  /** 시스템 관리자인지 — 스코프 설정 안내를 볼 대상인지 */
  canConfigure?: boolean;
}) {
  return (
    <GoogleReauthNotice
      service="Drive"
      scopeKeyword="drive"
      canConfigure={canConfigure}
      className="mb-4"
      scopeMissingTitle="Google Drive 연결이 아직 열려 있지 않습니다"
      scopeMissingHint={
        <>
          Google Cloud Console의 데이터 액세스에 Drive 스코프를 추가하고,
          <code className="mx-1 rounded-sm bg-surface px-1 py-0.5 text-nano">
            NEXT_PUBLIC_GOOGLE_EXTRA_SCOPES
          </code>
          에 반영하면 파일 목록이 연결됩니다.
        </>
      }
      expiredTitle="Drive 연결이 만료되었습니다"
      expiredBody="다시 연결하면 목록과 사용량이 최신 상태로 채워집니다."
    />
  );
}
