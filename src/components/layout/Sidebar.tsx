"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Star, StarOff, EllipsisVertical, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { visibleSections, type NavItem } from "@/lib/nav";
import type { Favorite, RoleName } from "@/types/db";
import { addFavorite, removeFavorite } from "@/server/actions/favorites";

/**
 * 좌측 고정 사이드바 (디자인시스템 레이아웃)
 * - 기본 72px 아이콘 레일, 호버 시 240px로 확장되며 라벨 노출
 * - 확장은 오버레이 방식이라 메인 콘텐츠가 밀리지 않는다
 * - 768px 미만에서는 햄버거로 여는 드로어
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

  // 모바일 드로어가 열린 동안에는 라벨을 항상 보여준다
  const [hovered, setHovered] = useState(false);
  const expanded = hovered || mobileOpen;

  useEffect(() => {
    onMobileClose();
    // 라우트가 바뀌면 드로어를 닫는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <>
      {/* 모바일 딤 */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-black/40 transition-opacity md:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onMobileClose}
        aria-hidden
      />

      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          "fixed left-0 top-0 z-40 flex h-dvh flex-col bg-sidebar text-sidebar-text",
          "transition-[width,transform] duration-200 ease-out",
          expanded ? "w-railopen" : "w-rail",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
        aria-label="주요 메뉴"
      >
        {/* 로고 */}
        <div className="flex h-topbar items-center gap-2.5 px-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-[13px] font-bold text-white">
            AB
          </span>
          <span
            className={cn(
              "truncate text-body font-semibold text-sidebar-active transition-opacity",
              expanded ? "opacity-100" : "opacity-0",
            )}
          >
            에임브릿지
          </span>
          <button
            type="button"
            onClick={onMobileClose}
            className="ml-auto rounded p-1 text-sidebar-text hover:text-white md:hidden"
            aria-label="메뉴 닫기"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden py-2">
          {sections.map((section) => (
            <div key={section.key} className="mb-1">
              {section.title ? (
                <p
                  className={cn(
                    "mt-3 px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/35 transition-opacity",
                    expanded ? "opacity-100" : "opacity-0",
                  )}
                >
                  {section.title}
                </p>
              ) : null}
              {section.items.map((item) => (
                <NavRow
                  key={item.key}
                  item={item}
                  expanded={expanded}
                  active={isActive(pathname, item.href)}
                  favorited={favoritePaths.has(item.href)}
                />
              ))}
            </div>
          ))}

          {favorites.length > 0 ? (
            <div className="mt-3 border-t border-white/8 pt-3">
              <p
                className={cn(
                  "px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/35 transition-opacity",
                  expanded ? "opacity-100" : "opacity-0",
                )}
              >
                즐겨찾기
              </p>
              {favorites.map((favorite) => (
                <Link
                  key={favorite.id}
                  href={favorite.target_path}
                  className={cn(
                    "flex h-10 items-center gap-3 px-4 transition-colors hover:bg-sidebar-hover",
                    pathname === favorite.target_path &&
                      "bg-sidebar-hover text-sidebar-active",
                  )}
                  title={favorite.label}
                >
                  <Star
                    className="size-4 shrink-0 fill-warn text-warn"
                    aria-hidden
                  />
                  <span
                    className={cn(
                      "truncate text-body transition-opacity",
                      expanded ? "opacity-100" : "opacity-0",
                    )}
                  >
                    {favorite.label}
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
        </nav>

        <p
          className={cn(
            "shrink-0 px-4 py-3 text-[11px] leading-relaxed text-white/30 transition-opacity",
            expanded ? "opacity-100" : "opacity-0",
          )}
        >
          메뉴를 우클릭하면
          <br />
          즐겨찾기에 추가할 수 있습니다
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
  expanded,
  active,
  favorited,
}: {
  item: NavItem;
  expanded: boolean;
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

  const rowClass = cn(
    "group/nav relative flex h-11 items-center gap-3 px-4 transition-colors",
    active
      ? "bg-sidebar-hover text-sidebar-active before:absolute before:left-0 before:top-1/2 before:h-6 before:w-0.5 before:-translate-y-1/2 before:bg-primary"
      : "hover:bg-sidebar-hover hover:text-sidebar-active",
    !item.ready && "cursor-not-allowed text-white/30 hover:bg-transparent",
  );

  const body = (
    <>
      <Icon className="size-[18px] shrink-0" aria-hidden />
      <span
        className={cn(
          "truncate text-body transition-opacity",
          expanded ? "opacity-100" : "opacity-0",
        )}
      >
        {item.label}
        {!item.ready ? (
          <span className="ml-1.5 text-[10px] text-white/30">준비중</span>
        ) : null}
      </span>
    </>
  );

  return (
    <div
      ref={rowRef}
      onContextMenu={(event) => {
        if (!item.ready) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      {item.ready ? (
        <Link href={item.href} className={rowClass} title={item.label}>
          {body}
          {expanded ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                setMenuOpen((open) => !open);
              }}
              className="ml-auto rounded p-0.5 text-white/40 opacity-0 transition hover:text-white group-hover/nav:opacity-100"
              aria-label={`${item.label} 메뉴`}
            >
              <EllipsisVertical className="size-4" />
            </button>
          ) : null}
        </Link>
      ) : (
        <div
          className={rowClass}
          title={
            item.spec ? `${item.label} — ${item.spec}에서 구현` : item.label
          }
          aria-disabled
        >
          {body}
        </div>
      )}

      {menuOpen ? (
        <div className="absolute left-[76px] z-50 -mt-1 w-44 rounded-md border border-line bg-surface py-1 text-ink shadow-pop">
          <button
            type="button"
            onClick={toggleFavorite}
            disabled={pending}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-body hover:bg-primary-light disabled:opacity-50"
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
