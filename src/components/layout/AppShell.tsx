"use client";

import { useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar, type TopbarUser } from "@/components/layout/Topbar";
import type { Favorite, RoleName } from "@/types/db";

/**
 * 사이드바(72px 레일) + 상단바(60px) + 메인 콘텐츠 셸.
 * 모바일 드로어 상태를 두 컴포넌트가 공유해야 해서 클라이언트 컴포넌트로 둔다.
 */
export function AppShell({
  user,
  role,
  favorites,
  children,
}: {
  user: TopbarUser;
  role: RoleName;
  favorites: Pick<Favorite, "id" | "label" | "target_path">[];
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-canvas">
      <Sidebar
        role={role}
        favorites={favorites}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div className="md:pl-rail">
        <Topbar user={user} onMenuClick={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-7">
          {children}
        </main>
      </div>
    </div>
  );
}
