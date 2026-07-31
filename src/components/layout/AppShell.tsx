"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { ModulePanel } from "@/components/layout/ModulePanel";
import { Topbar, type TopbarUser } from "@/components/layout/Topbar";
import { resolveModule } from "@/lib/nav";
import { cn } from "@/lib/utils";
import type { Favorite, RoleName } from "@/types/db";

/**
 * 2뎁스 셸.
 *
 *  ┌──────────────────────────────────────────┐
 *  │ [AB 에임브릿지]  검색        알림 프로필 │ 56px 상단바 (전체 폭)
 *  ├──────┬──────────┬────────────────────────┤
 *  │ 레일 │  모듈    │  본문                  │
 *  │ 76px │  224px   │                        │
 *  └──────┴──────────┴────────────────────────┘
 *
 * 상단바가 레일 위까지 덮는 이유: 브랜드는 화면 좌상단에 있어야 하는데
 * 76px 레일 안에는 워드마크가 들어가지 않는다. 예전엔 상단바·레일의 워드마크가
 * 둘 다 md:hidden이라 데스크톱 어디에도 "에임브릿지"가 렌더되지 않았다.
 *
 * 모바일 드로어 상태를 상단바와 레일이 공유해야 해서 클라이언트 컴포넌트다.
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
  const pathname = usePathname();

  // 패널 유무에 따라 본문 들여쓰기가 달라진다. 판정 근거는 ModulePanel과 같다
  const active = resolveModule(pathname, role);
  const hasPanel = !!active?.sections?.length || !!active?.primaryAction;

  return (
    <div className="min-h-dvh bg-canvas">
      <Topbar user={user} onMenuClick={() => setMobileOpen(true)} />

      <Sidebar
        role={role}
        favorites={favorites}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <ModulePanel role={role} />

      <div className={cn(hasPanel ? "md:pl-shell" : "md:pl-rail")}>
        <main className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
