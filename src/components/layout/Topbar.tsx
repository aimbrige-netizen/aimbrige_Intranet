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
 * 상단바 56px (스펙 3.2 / 디자인시스템 v2.0)
 * 통합검색은 placeholder만, 알림은 count만 — 상세는 후순위(스펙 6장)
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
    <header className="sticky top-0 z-20 flex h-topbar items-center gap-3 border-b border-line bg-surface px-4 md:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="-ml-1 rounded-sm p-1.5 text-ink transition-colors duration-fast ease-standard hover:bg-subtle md:hidden"
        aria-label="메뉴 열기"
      >
        <Menu className="size-5" />
      </button>

      <Link href="/" className="text-body font-bold text-ink md:hidden">
        에임브릿지 인트라넷
      </Link>

      {/* 통합검색 — placeholder만, 실제 검색은 후순위 */}
      <div className="relative ml-auto hidden w-full max-w-md md:ml-0 md:block">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          type="search"
          disabled
          placeholder="통합검색 (준비중)"
          className="h-9 w-full rounded-pill border border-transparent bg-subtle pl-10 pr-4 text-body-sm placeholder:text-muted disabled:cursor-not-allowed"
        />
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          className="relative rounded-sm p-2 text-ink transition-colors duration-fast ease-standard hover:bg-subtle"
          aria-label={`알림 ${notificationCount}건`}
          title="알림 상세는 준비중입니다"
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
            <span className="hidden text-left md:block">
              <span className="block text-label font-bold leading-tight text-ink">
                {user.name}
              </span>
              <span className="block text-[12px] leading-tight text-muted">
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
