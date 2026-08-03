import { Mail, MailOpen } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Callout } from "@/components/ui/Callout";
import { Skeleton } from "@/components/ui/Skeleton";
import { GoogleReauthNotice } from "@/features/google/GoogleReauthNotice";
import { getUnreadMail, UNREAD_PREVIEW_COUNT } from "@/lib/gmail";
import { gmailMessageUrl, senderName } from "@/features/mail/format";
import { toSeoulTime, toSeoulYmd } from "@/features/calendar/date";

/**
 * 안읽은 메일 위젯 (스펙 11 · 3.2)
 *
 * 대시보드의 나머지 위젯은 전부 우리 DB를 읽지만 이건 구글 서버를 부른다.
 * 그래서 홈 page에서 Suspense로 감싸 이 카드만 늦게 채워지게 한다 —
 * 안 그러면 구글이 느린 날 대시보드 전체가 그만큼 늦게 뜬다.
 *
 * 캐싱하지 않는다(스펙 3.2). 메일함은 30초 전 상태를 보여줄 바에
 * 안 보여주는 게 나은 종류의 데이터다.
 *
 * 헤더에 "Gmail 열기" 링크를 두지 않는다. 상단바 메일 아이콘이 정확히 같은
 * 주소를 열고 늘 떠 있다. 위젯 헤더의 '전체보기' 링크는 스펙 01 정리 때
 * 5개를 걷어낸 패턴이라 여기서 다시 들일 이유가 없다.
 */
export async function MailWidget({
  email,
  canConfigure = false,
}: {
  email: string;
  /** 시스템 관리자인지 — 스코프 설정 방법을 볼 대상인지 */
  canConfigure?: boolean;
}) {
  const result = await getUnreadMail();

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Mail className="size-4 text-muted" aria-hidden />
            메일
          </span>
        }
        description={
          result.ok && result.data.length > 0
            ? `안읽은 메일 ${result.data.length}건${
                result.data.length >= UNREAD_PREVIEW_COUNT ? " 이상" : ""
              }`
            : "안읽은 메일"
        }
        density="widget"
      />
      <CardBody density="widget">
        {!result.ok ? (
          renderProblem(result.reason, result.message, canConfigure)
        ) : result.data.length === 0 ? (
          <EmptyState
            icon={MailOpen}
            title="받은 메일이 모두 확인됐습니다"
            description="안읽은 메일이 없습니다."
            compact
          />
        ) : (
          <ul className="-mx-1 divide-y divide-line">
            {result.data.map((mail) => (
              <li key={mail.id}>
                <a
                  href={gmailMessageUrl(email, mail.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-sm px-1 py-2 transition-colors duration-fast ease-standard hover:bg-canvas"
                >
                  {/*
                    발신자는 잘리더라도 폭을 확보한다(누가 보냈는지가 먼저다).
                    제목은 남는 폭을 다 쓰고 잘린다.
                  */}
                  <span className="w-20 shrink-0 truncate text-label text-muted">
                    {senderName(mail.from)}
                  </span>
                  <span className="truncate text-body-sm font-bold text-ink">
                    {mail.subject}
                  </span>
                  <span className="ml-auto shrink-0 text-label tabular-nums text-muted">
                    {receivedLabel(mail.receivedAt)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * 스코프 미설정·토큰 만료는 Drive와 같은 안내를 쓴다(색과 재로그인 버튼까지).
 * 나머지 실패(네트워크·5xx)는 사용자가 할 일이 없으니 상태만 알린다.
 */
function renderProblem(
  reason: "scope_missing" | "reauth_required" | "error",
  message: string,
  canConfigure: boolean,
) {
  if (reason === "error") {
    return (
      <Callout tone="warn" title="메일을 불러오지 못했습니다">
        {message}
      </Callout>
    );
  }

  return (
    <GoogleReauthNotice
      service="메일"
      scopeKeyword="gmail"
      canConfigure={canConfigure}
      scopeMissingTitle="메일 연동이 아직 열려 있지 않습니다"
      scopeMissingHint={
        <>
          Google Cloud Console의 데이터 액세스에 gmail.readonly 스코프를 추가하고,
          <code className="mx-1 rounded-sm bg-surface px-1 py-0.5 text-nano">
            NEXT_PUBLIC_GOOGLE_EXTRA_SCOPES
          </code>
          에 반영하면 안읽은 메일이 표시됩니다.
        </>
      }
      expiredTitle="메일 연결이 만료되었습니다"
      expiredBody="다시 연결하면 안읽은 메일이 채워집니다. 상단바 메일 아이콘은 그대로 동작합니다."
    />
  );
}

/**
 * 오늘 온 메일은 시각(14:32), 그 전은 날짜(07-30).
 * 메일함이 늘 그렇게 보여주고, 좁은 칸에서 "오늘 07-31 14:32"는 낭비다.
 */
function receivedLabel(epochMs: number): string {
  if (!epochMs) return "";
  const received = new Date(epochMs);
  const ymd = toSeoulYmd(received);
  return ymd === toSeoulYmd(new Date()) ? toSeoulTime(received) : ymd.slice(5);
}

/**
 * Suspense 폴백.
 *
 * 줄 수를 실제 최대치(5건)에 맞춘다. 3줄로 잡아두면 메일이 5건일 때 카드가
 * 갑자기 커지면서 아래가 밀린다 — 폴백은 자리를 잡아두려고 있는 것이다.
 */
export function MailWidgetSkeleton() {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Mail className="size-4 text-muted" aria-hidden />
            메일
          </span>
        }
        description="안읽은 메일"
        density="widget"
      />
      <CardBody density="widget">
        <ul className="-mx-1 divide-y divide-line">
          {Array.from({ length: UNREAD_PREVIEW_COUNT }, (_, i) => (
            <li key={i} className="flex items-center gap-2 px-1 py-2">
              <Skeleton className="h-4 w-20 shrink-0" />
              <Skeleton className="h-4 flex-1" />
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
