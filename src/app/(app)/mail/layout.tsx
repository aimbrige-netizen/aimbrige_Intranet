import { MailPanel } from "@/features/mail/MailPanel";
import { getMailUsage, getUnreadMailCount } from "@/features/mail/data";
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
 */
export default async function MailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireSessionEmployee();

  const [unreadCount, usage] = await Promise.all([
    getUnreadMailCount(me.id),
    getMailUsage(me.id),
  ]);

  return (
    <>
      <MailPanel
        email={me.email}
        unreadCount={unreadCount}
        usedBytes={usage.usedBytes}
        quotaBytes={usage.quotaBytes}
      />
      {children}
    </>
  );
}
