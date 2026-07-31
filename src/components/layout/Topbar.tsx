"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, Menu, Search, LogOut, CircleUser } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export interface TopbarUser {
  name: string;
  email: string;
  position: string | null;
  departmentName: string | null;
  profileImageUrl: string | null;
}

/**
 * 상단바 56px — 전체 폭.
 *
 * 좌측 끝에 심볼 + "에임브릿지" 워드마크를 상시 노출한다. 예전에는 상단바와
 * 레일의 워드마크가 둘 다 md:hidden이라 데스크톱 어디에도 회사 이름이
 * 렌더되지 않았고, 최고 가치 영역인 좌상단을 disabled된 검색창이 차지했다.
 *
 * 통합검색은 아직 placeholder다(스펙 6장).
 */
export function Topbar({
  user,
  notificationCount = 0,
  onMenuClick,
}: {
  user: TopbarUser;
  notificationCount?: number;
  onMenuClick: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const signOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-30 flex h-topbar items-center gap-3 border-b border-line bg-surface px-4 md:px-5">
      <button
        type="button"
        onClick={onMenuClick}
        className="-ml-1 rounded-sm p-1.5 text-ink transition-colors duration-fast ease-standard hover:bg-subtle md:hidden"
        aria-label="메뉴 열기"
      >
        <Menu className="size-5" />
      </button>

      <Link
        href="/"
        className="flex shrink-0 items-center gap-2 rounded-sm transition-opacity duration-fast ease-standard hover:opacity-80"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-sm bg-primary text-nano font-bold tracking-tight text-white">
          AB
        </span>
        <span className="text-body font-bold tracking-tight text-ink">
          에임브릿지
        </span>
      </Link>

      {/* 양쪽 spacer로 검색을 가운데 둔다 */}
      <div className="hidden flex-1 md:block" />

      <div className="relative hidden w-full max-w-md md:block">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          type="search"
          disabled
          placeholder="통합검색"
          className="h-9 w-full rounded-pill border border-transparent bg-subtle pl-10 pr-4 text-body-sm placeholder:text-muted disabled:cursor-not-allowed"
        />
      </div>

      <div className="ml-auto flex flex-1 items-center justify-end gap-1.5">
        <button
          type="button"
          className="relative rounded-sm p-2 text-ink transition-colors duration-fast ease-standard hover:bg-subtle"
          aria-label={`알림 ${notificationCount}건`}
        >
          <Bell className="size-[18px]" />
          {notificationCount > 0 ? (
            <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">
              {notificationCount > 99 ? "99+" : notificationCount}
            </span>
          ) : null}
        </button>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex items-center gap-2 rounded-pill py-1 pl-1 pr-2 transition-colors duration-fast ease-standard hover:bg-subtle"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <Avatar
              name={user.name}
              src={user.profileImageUrl}
              size="medium"
              className="!bg-primary-light !text-primary"
            />
            <span className="hidden text-left lg:block">
              <span className="block text-label font-bold leading-tight text-ink">
                {user.name}
              </span>
              <span className="block text-micro leading-tight text-muted">
                {[user.departmentName, user.position]
                  .filter(Boolean)
                  .join(" · ") || user.email}
              </span>
            </span>
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+6px)] w-56 overflow-hidden rounded-card border border-line bg-surface shadow-pop"
            >
              <div className="border-b border-line px-4 py-3">
                <p className="truncate text-body font-bold text-ink">
                  {user.name}
                </p>
                <p className="truncate text-caption">{user.email}</p>
              </div>
              <Link
                href="/profile"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-4 py-2.5 text-body-sm text-ink transition-colors duration-fast ease-standard hover:bg-subtle"
                role="menuitem"
              >
                <CircleUser className="size-4 text-muted" />내 프로필
              </Link>
              <button
                type="button"
                onClick={signOut}
                disabled={signingOut}
                className={cn(
                  "flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-left text-body-sm transition-colors duration-fast ease-standard",
                  "text-danger hover:bg-danger-light disabled:opacity-50",
                )}
                role="menuitem"
              >
                <LogOut className="size-4" />
                {signingOut ? "로그아웃 중…" : "로그아웃"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
