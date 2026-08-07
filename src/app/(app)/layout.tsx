import { AppShell } from "@/components/layout/AppShell";
import { ToastProvider } from "@/components/ui/Toast";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getFavorites } from "@/features/dashboard/widget-data";
import { getUnifiedUnreadMailCount } from "@/features/mail/gmail-source";

/**
 * 로그인 이후 화면 공통 셸.
 * 미들웨어가 이미 세션·재직상태·관리자 권한을 검사하지만,
 * 서버 컴포넌트에서도 requireSessionEmployee로 한 번 더 확인한다.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireSessionEmployee();
  /*
   * 상단바 쪽지 배지(12-mail.md) — 소프트 실패라 마이그레이션 28 전에는 0.
   * Gmail 연동 시에는 Gmail INBOX 안읽음 수로 전환된다(외부 수발신 —
   * getUnifiedUnreadMailCount가 연동 여부까지 판단하고, 미연동이면 기존
   * 내부 카운트(getUnreadMailCount) 경로 그대로다).
   */
  const [favorites, mailUnreadCount] = await Promise.all([
    getFavorites(me.id),
    getUnifiedUnreadMailCount(me.id),
  ]);

  return (
    <ToastProvider>
      <AppShell
        role={me.roleName}
        favorites={favorites}
        mailUnreadCount={mailUnreadCount}
        user={{
          name: me.name,
          email: me.email,
          position: me.position,
          departmentName: me.department?.name ?? null,
          profileImageUrl: me.profile_image_url,
        }}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
