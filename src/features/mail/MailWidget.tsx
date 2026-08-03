import Link from "next/link";
import { Mail, MailOpen, PenLine } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Callout } from "@/components/ui/Callout";
import { LinkButton } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { GoogleReauthNotice } from "@/features/google/GoogleReauthNotice";
import { getUnreadMail, UNREAD_PREVIEW_COUNT } from "@/lib/gmail";
import { getMailList } from "@/features/mail/data";
import {
  getGmailMailbox,
  getGmailUnreadCount,
  hasGmailConnection,
} from "@/features/mail/gmail-source";
import { requireSessionEmployee } from "@/lib/auth/session";
import { gmailMessageUrl, senderName } from "@/features/mail/format";
import { toSeoulTime, toSeoulYmd } from "@/features/calendar/date";

/**
 * 안읽은 메일 위젯 — 사내 메일판 (스펙 12 · 메일 모듈 신설).
 *
 * Gmail 안읽음(스펙 11 · 3.2)을 보여주던 카드를 사내 메일 받은메일함의
 * 안읽음 최근 5건(발신자·제목·시각)으로 전환한다. 행을 누르면 읽기
 * 화면(/mail/[id])으로, 하단에 "메일쓰기"/"전체 보기"가 붙는다.
 *
 * Suspense는 유지한다(호출부 page.tsx 계약). 조회가 구글에서 우리 DB로
 * 바뀌었어도, 이 카드만 따로 스트리밍되면 대시보드 본문이 메일 질의를
 * 기다리지 않는 구조 자체는 그대로 유효하다.
 *
 * 기존 Gmail 경로는 삭제하지 않고 GmailMailWidget으로 보존한다 —
 * 외부메일(Gmail) 연동은 Google OAuth 승인 후 어댑터로 복귀한다는 게
 * 12-mail.md 구현 결정이다. 그때 USE_GMAIL_WIDGET 스위치(또는 별도
 * 외부메일 위젯)로 되살린다.
 */

/** 외부메일(Gmail) 위젯 복귀 스위치 — OAuth 승인·어댑터 연결 전까지 false */
const USE_GMAIL_WIDGET: boolean = false;

export interface MailWidgetProps {
  /** Gmail 딥링크·재연결 안내에 쓰던 회사 계정 — 호출부(page.tsx) 계약 유지 */
  email: string;
  /** 시스템 관리자인지 — Gmail 스코프 설정 안내를 볼 대상인지 (Gmail 경로 전용) */
  canConfigure?: boolean;
}

export async function MailWidget(props: MailWidgetProps) {
  if (USE_GMAIL_WIDGET) return <GmailMailWidget {...props} />;

  /*
   * 세션은 (app)/layout·page가 이미 조회했고 react cache로 같은 요청 안에서
   * 재사용된다 — props로 employeeId를 새로 받으면 호출부 시그니처가 바뀌므로
   * (담당 밖 파일) 여기서 직접 얻는다.
   */
  const me = await requireSessionEmployee();

  /*
   * 외부 수발신 — Gmail 연동이면 위젯도 Gmail 안읽음으로 전환한다(담당 C).
   * provider_token 경로(GmailMailWidget)와 달리 refresh token 계층이라
   * 재로그인 없이도 산다. 내부 소스 경로는 아래 그대로 — 개조 아님, 분기 추가.
   */
  if (await hasGmailConnection()) {
    return <GmailSourceMailWidget employeeId={me.id} />;
  }

  const { items, total } = await getMailList(me.id, "inbox", {
    unread: true,
    pageSize: UNREAD_PREVIEW_COUNT,
  });

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Mail className="size-4 text-muted" aria-hidden />
            메일
          </span>
        }
        description={total > 0 ? `안읽은 메일 ${total}건` : "안읽은 메일"}
        density="widget"
      />
      <CardBody density="widget">
        {items.length === 0 ? (
          <EmptyState
            icon={MailOpen}
            title="받은 메일이 모두 확인됐습니다"
            description="안읽은 메일이 없습니다."
            compact
          />
        ) : (
          <ul className="-mx-1 divide-y divide-line">
            {items.map((mail) => (
              <li key={mail.messageId}>
                <Link
                  href={`/mail/${mail.messageId}`}
                  className="flex items-center gap-2 rounded-sm px-1 py-2 transition-colors duration-fast ease-standard hover:bg-canvas"
                >
                  {/*
                    발신자는 잘리더라도 폭을 확보한다(누가 보냈는지가 먼저다).
                    제목은 남는 폭을 다 쓰고 잘린다 — Gmail판과 같은 배치.
                  */}
                  <span className="w-20 shrink-0 truncate text-label text-muted">
                    {mail.senderName ?? "(퇴사자)"}
                  </span>
                  <span className="truncate text-body-sm font-bold text-ink">
                    {mail.subject || "(제목 없음)"}
                  </span>
                  <span className="ml-auto shrink-0 text-label tabular-nums text-muted">
                    {receivedLabel(Date.parse(mail.at))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <MailWidgetFooter />
      </CardBody>
    </Card>
  );
}

/**
 * Gmail 소스 안읽은 메일 위젯 (외부 수발신 · 담당 C).
 *
 * 사내 메일판과 같은 판형 — 행은 /mail/[id](Gmail 분기)로 들어간다.
 * 헤더 건수는 INBOX 안읽음 총계(estimate), 실패는 목록 길이로 폴백(소프트).
 * getGmailMailbox가 실패하면 빈 목록이 온다 — "모두 확인" 빈 상태로
 * 그려질 뿐 대시보드는 죽지 않는다(내부 소스의 소프트 실패와 같은 규약).
 */
async function GmailSourceMailWidget({ employeeId }: { employeeId: string }) {
  const [{ items }, unreadTotal] = await Promise.all([
    getGmailMailbox(employeeId, "inbox", {
      unread: true,
      pageSize: UNREAD_PREVIEW_COUNT,
    }),
    getGmailUnreadCount(employeeId),
  ]);
  const total = unreadTotal ?? items.length;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Mail className="size-4 text-muted" aria-hidden />
            메일
          </span>
        }
        description={total > 0 ? `안읽은 메일 ${total}건` : "안읽은 메일"}
        density="widget"
      />
      <CardBody density="widget">
        {items.length === 0 ? (
          <EmptyState
            icon={MailOpen}
            title="받은 메일이 모두 확인됐습니다"
            description="안읽은 메일이 없습니다."
            compact
          />
        ) : (
          <ul className="-mx-1 divide-y divide-line">
            {items.map((mail) => (
              <li key={mail.messageId}>
                <Link
                  href={`/mail/${mail.messageId}`}
                  className="flex items-center gap-2 rounded-sm px-1 py-2 transition-colors duration-fast ease-standard hover:bg-canvas"
                >
                  <span className="w-20 shrink-0 truncate text-label text-muted">
                    {mail.senderName ?? "(발신자 없음)"}
                  </span>
                  <span className="truncate text-body-sm font-bold text-ink">
                    {mail.subject || "(제목 없음)"}
                  </span>
                  <span className="ml-auto shrink-0 text-label tabular-nums text-muted">
                    {receivedLabel(Date.parse(mail.at))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <MailWidgetFooter />
      </CardBody>
    </Card>
  );
}

/**
 * "메일쓰기"/"전체 보기" — 담당 스펙이 못박은 두 링크. 빈 상태에서도 항상
 * 보여야 하므로 EmptyState action이 아니라 카드 하단 고정 행으로 둔다.
 */
function MailWidgetFooter() {
  return (
    <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
      <LinkButton href="/mail/compose" size="small" variant="secondary">
        <PenLine className="size-3.5" aria-hidden />
        메일쓰기
      </LinkButton>
      <LinkButton href="/mail" size="small" variant="ghost">
        전체 보기
      </LinkButton>
    </div>
  );
}

/**
 * [미사용 보존] Gmail 안읽은 메일 위젯 (스펙 11 · 3.2) — 삭제 금지.
 *
 * 대시보드의 나머지 위젯은 전부 우리 DB를 읽지만 이건 구글 서버를 부른다.
 * 그래서 홈 page에서 Suspense로 감싸 이 카드만 늦게 채워지게 했다 —
 * 안 그러면 구글이 느린 날 대시보드 전체가 그만큼 늦게 뜬다.
 *
 * 캐싱하지 않는다(스펙 3.2). 메일함은 30초 전 상태를 보여줄 바에
 * 안 보여주는 게 나은 종류의 데이터다.
 *
 * 헤더에 "Gmail 열기" 링크를 두지 않는다. 외부메일 링크는 메일 패널 하단
 * (MailPanel)이 담당한다.
 */
export async function GmailMailWidget({
  email,
  canConfigure = false,
}: MailWidgetProps) {
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
 * (Gmail 경로 전용 — 사내 메일 조회는 data.ts가 소프트 실패로 빈 목록을 준다)
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
 * 사내 메일 쪽은 ISO 문자열이라 Date.parse로 epochMs를 만들어 넘긴다
 * (빈 문자열이면 NaN → falsy → 빈 표기).
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
 * 하단 링크 행은 데이터와 무관하게 정적이라 폴백에서도 실제 링크를 그린다.
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
        <MailWidgetFooter />
      </CardBody>
    </Card>
  );
}
