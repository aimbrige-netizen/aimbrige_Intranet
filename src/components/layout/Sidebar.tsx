"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Star, StarOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { visibleSections, type NavItem } from "@/lib/nav";
import type { Favorite, RoleName } from "@/types/db";
import { addFavorite, removeFavorite } from "@/server/actions/favorites";

/**
 * 좌측 고정 사이드바 (디자인시스템 v1.1 레이아웃)
 * - 화이트 배경 76px 레일. 아이콘 + 짧은 라벨을 항상 노출한다(호버 확장 없음).
 *   호버로만 라벨이 보이는 방식은 클릭 전까지 메뉴를 못 읽어서 폐기했다.
 * - 활성 항목은 아이콘을 Primary 사각 블록으로 채워 한눈에 구분한다.
 * - 768px 미만에서는 라벨이 옆에 붙는 드로어로 전환한다.
 */
export function Sidebar({
  role,
  favorites,
  mobileOpen,
  onMobileClose,
}: {
  role: RoleName;
  favorites: Pick<Favorite, "id" | "label" | "target_path">[];
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const pathname = usePathname();
  const sections = visibleSections(role);
  const favoritePaths = new Set(favorites.map((f) => f.target_path));

  // 라우트가 바뀌면 모바일 드로어를 닫는다
  useEffect(() => {
    onMobileClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-30 bg-ink/30 transition-opacity md:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onMobileClose}
        aria-hidden
      />

      <aside
        className={cn(
          "fixed left-0 top-0 z-40 flex h-dvh flex-col border-r border-line bg-sidebar",
          "w-drawer transition-transform duration-200 ease-out md:w-rail",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
        aria-label="주요 메뉴"
      >
        {/* 로고 — 상단바와 같은 높이로 맞춰 가로선이 이어지게 */}
        <div className="flex h-topbar shrink-0 items-center gap-2.5 border-b border-line px-4 md:justify-center md:px-0">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-[12px] font-bold tracking-tight text-white">
            AB
          </span>
          <span className="text-body font-semibold text-ink md:hidden">
            에임브릿지
          </span>
          <button
            type="button"
            onClick={onMobileClose}
            className="ml-auto rounded-md p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink md:hidden"
            aria-label="메뉴 닫기"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="scrollbar-none flex-1 overflow-y-auto overflow-x-hidden py-2">
          {sections.map((section, index) => (
            <div key={section.key}>
              {index > 0 ? (
                <hr className="mx-3 my-2 border-line md:mx-4" />
              ) : null}
              {section.title ? (
                <p className="px-4 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted/70 md:text-center">
                  {section.title}
                </p>
              ) : null}
              {section.items.map((item) => (
                <NavRow
                  key={item.key}
                  item={item}
                  active={isActive(pathname, item.href)}
                  favorited={favoritePaths.has(item.href)}
                />
              ))}
            </div>
          ))}

          {favorites.length > 0 ? (
            <>
              <hr className="mx-3 my-2 border-line md:mx-4" />
              <p className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted/70 md:text-center">
                즐겨찾기
              </p>
              {favorites.map((favorite) => (
                <Link
                  key={favorite.id}
                  href={favorite.target_path}
                  title={favorite.label}
                  aria-label={`즐겨찾기: ${favorite.label}`}
                  className={cn(
                    "mx-1.5 flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-sidebar-hover",
                    "md:flex-col md:gap-1 md:px-1 md:py-2",
                    pathname === favorite.target_path && "text-primary",
                  )}
                >
                  <Star
                    className="size-[18px] shrink-0 fill-warn text-warn"
                    aria-hidden
                  />
                  <span
                    aria-hidden
                    className="truncate text-body md:max-w-[68px] md:text-[10px] md:leading-tight"
                  >
                    {favorite.label}
                  </span>
                </Link>
              ))}
            </>
          ) : null}
        </nav>

        <p className="shrink-0 border-t border-line px-4 py-3 text-[10px] leading-relaxed text-muted md:hidden">
          메뉴를 길게 누르거나 우클릭하면 즐겨찾기에 추가할 수 있습니다
        </p>
      </aside>
    </>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavRow({
  item,
  active,
  favorited,
}: {
  item: NavItem;
  active: boolean;
  favorited: boolean;
}) {
  const Icon = item.icon;
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const toggleFavorite = () => {
    startTransition(async () => {
      if (favorited) await removeFavorite(item.href);
      else await addFavorite(item.label, item.href);
      setMenuOpen(false);
    });
  };

  const railLabel = item.short ?? item.label;

  const body = (
    <>
      {/* 활성 상태는 아이콘 블록을 Primary로 채운다 */}
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-[10px] transition-colors",
          active
            ? "bg-primary text-white"
            : item.ready
              ? "text-muted group-hover/nav:text-primary"
              : "text-muted/45",
        )}
      >
        <Icon className="size-[18px]" aria-hidden />
      </span>
      {/*
        모바일 드로어는 전체 라벨, 데스크톱 레일은 짧은 라벨을 쓴다.
        두 span이 항상 DOM에 있어 스크린리더가 "홈홈"처럼 두 번 읽으므로
        시각 표시용으로만 두고, 접근성 이름은 바깥 요소의 aria-label로 준다.
      */}
      <span
        aria-hidden
        className={cn(
          "truncate text-body transition-colors md:max-w-[68px] md:text-[10px] md:leading-tight",
          active
            ? "font-semibold text-primary"
            : item.ready
              ? "text-sidebar-text"
              : "text-muted/45",
        )}
      >
        <span className="md:hidden">{item.label}</span>
        <span className="hidden md:inline">{railLabel}</span>
      </span>
    </>
  );

  const rowClass = cn(
    "group/nav flex items-center gap-3 rounded-lg px-3 py-1.5 transition-colors",
    "md:mx-1.5 md:flex-col md:gap-1 md:px-1 md:py-2",
    item.ready ? "hover:bg-sidebar-hover" : "cursor-not-allowed",
    active && "bg-primary-light/60",
  );

  return (
    <div
      ref={rowRef}
      className="relative"
      onContextMenu={(event) => {
        if (!item.ready) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      {item.ready ? (
        <Link
          href={item.href}
          className={rowClass}
          title={item.label}
          aria-label={item.label}
          aria-current={active ? "page" : undefined}
        >
          {body}
        </Link>
      ) : (
        <div
          className={rowClass}
          title={
            item.spec ? `${item.label} — ${item.spec}에서 구현` : item.label
          }
          aria-label={`${item.label} (준비중)`}
          aria-disabled
        >
          {body}
        </div>
      )}

      {menuOpen ? (
        <div className="absolute left-full top-1 z-50 ml-1 w-44 overflow-hidden rounded-lg border border-line bg-surface py-1 text-ink shadow-pop">
          <button
            type="button"
            onClick={toggleFavorite}
            disabled={pending}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-body transition-colors hover:bg-canvas disabled:opacity-50"
          >
            {favorited ? (
              <>
                <StarOff className="size-4 text-muted" />
                즐겨찾기 해제
              </>
            ) : (
              <>
                <Star className="size-4 text-warn" />
                즐겨찾기 추가
              </>
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
