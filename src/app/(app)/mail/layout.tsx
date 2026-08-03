import { MailPanel } from "@/features/mail/MailPanel";
import { getMailUsage, getUnreadMailCount } from "@/features/mail/data";
import {
  getGmailConnectionEmail,
  getGmailUnreadCount,
  hasGmailConnection,
} from "@/features/mail/gmail-source";
import { requireSessionEmployee } from "@/lib/auth/session";

/**
 * 메일 모듈 레이아웃.
 *
 * 게시판·근태 layout과 같은 문법 — 패널 내용물(MailPanel)을 ModulePanel의
 * 포털 슬롯에 꽂는다. 어떤 메일 화면(목록·읽기·쓰기)에 있든 메일함 트리와
 * 용량 게이지는 같은 자리에 있다.
 *
 * 패널 골격은 nav.ts의 mail 모듈(panelHidden 앵커 섹션)이 세운다.
 * 안읽음 배지·용량 게이지 값은 data.ts가 소프트 실패라 마이그레이션 28
 * 적용 전에도 0으로 그려질 뿐 화면이 죽지 않는다.
 *
 * ── 외부 수발신 (Gmail 소스 분기)
 * 연동이면 배지를 Gmail INBOX 안읽음 수로 바꾼다 — 목록(/mail page)이
 * Gmail 소스를 그리는데 배지만 내부 수면 서로 다른 이야기가 된다. Gmail
 * 조회 실패는 0(소프트 — getUnifiedUnreadMailCount와 같은 규칙). 용량
 * 게이지는 연동과 무관하게 내부 첨부 총량이다 — 500MB 쿼터는 우리
 * 스토리지의 것이지 Gmail의 것이 아니다.
 */
export default async function MailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireSessionEmployee();

  const gmailConnected = await hasGmailConnection();

  const [unreadCount, usage, googleEmail] = await Promise.all([
    gmailConnected
      ? getGmailUnreadCount(me.id).then((count) => count ?? 0)
      : getUnreadMailCount(me.id),
    getMailUsage(me.id),
    gmailConnected ? getGmailConnectionEmail(me.id) : Promise.resolve(null),
  ]);

  return (
    <>
      <MailPanel
        email={me.email}
        unreadCount={unreadCount}
        usedBytes={usage.usedBytes}
        quotaBytes={usage.quotaBytes}
        gmail={{ connected: gmailConnected, email: googleEmail }}
      />
      {children}
    </>
  );
}
