"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Star, StarOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isChildActive,
  resolveModule,
  visibleChildSections,
  visibleModules,
  type NavModule,
} from "@/lib/nav";
import type { Favorite, RoleName } from "@/types/db";
import { addFavorite, removeFavorite } from "@/server/actions/favorites";

/**
 * 전역 모듈 레일 (76px).
 *
 * 레일에는 이제 모듈만 둔다. 관리자 기능 9개 중 8개는 원래 기존 모듈의
 * 하위 화면이라 각 모듈 패널로 옮겼고, 그 결과 레일이 16칸에서 8칸으로 줄었다.
 * 76px 폭에서 truncate되던 "근태"와 "근태관리"의 구분 문제도 함께 사라진다.
 *
 * 768px 미만에서는 모듈과 그 하위 항목을 한 리스트로 펼친 드로어가 된다 —
 * 좁은 화면에서 레일과 패널을 둘 다 띄우면 본문이 남지 않는다.
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
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const modules = visibleModules(role);
  const activeModule = resolveModule(pathname, role);
  const favoritePaths = new Set(favorites.map((f) => f.target_path));

  // 라우트가 바뀌면 모바일 드로어를 닫는다
  useEffect(() => {
    onMobileClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search]);

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
          "w-drawer transition-transform duration-standard ease-standard",
          "md:top-topbar md:h-[calc(100dvh-theme(spacing.topbar))] md:w-rail",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
        aria-label="주요 메뉴"
      >
        {/* 모바일 드로어 헤더 — 데스크톱은 상단바가 그 역할을 한다 */}
        <div className="flex h-topbar shrink-0 items-center gap-2.5 border-b border-line px-4 md:hidden">
          <span className="grid size-8 shrink-0 place-items-center rounded-card bg-primary text-micro font-bold tracking-tight text-white">
            AB
          </span>
          <span className="text-body font-bold text-ink">에임브릿지</span>
          <button
            type="button"
            onClick={onMobileClose}
            className="ml-auto rounded-sm p-1.5 text-muted transition-colors hover:bg-subtle hover:text-ink"
            aria-label="메뉴 닫기"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="scrollbar-none flex-1 overflow-y-auto overflow-x-hidden py-2">
          {modules.map((module) => (
            <ModuleRow
              key={module.key}
              module={module}
              active={activeModule?.key === module.key}
              favorited={favoritePaths.has(module.href)}
              pathname={pathname}
              search={search}
              role={role}
            />
          ))}

          {favorites.length > 0 ? (
            <>
              <hr className="mx-3 my-2 border-line md:mx-4" />
              <p className="px-4 pb-1 text-nano font-bold text-muted md:text-center">
                즐겨찾기
              </p>
              {favorites.map((favorite) => (
                <Link
                  key={favorite.id}
                  href={favorite.target_path}
                  title={favorite.label}
                  aria-label={`즐겨찾기: ${favorite.label}`}
                  className={cn(
                    "flex items-center gap-3 rounded-card px-3 py-2 transition-colors duration-fast ease-standard hover:bg-sidebar-hover",
                    "md:mx-2 md:flex-col md:gap-1 md:px-1 md:py-2",
                    pathname === favorite.target_path &&
                      "bg-primary-light font-bold text-primary hover:bg-primary-light",
                  )}
                >
                  <Star
                    className="size-[18px] shrink-0 fill-warn text-warn"
                    aria-hidden
                  />
                  <span
                    aria-hidden
                    className="truncate text-body-sm md:max-w-[68px] md:text-nano md:leading-tight"
                  >
                    {favorite.label}
                  </span>
                </Link>
              ))}
            </>
          ) : null}
        </nav>
      </aside>
    </>
  );
}

function ModuleRow({
  module,
  active,
  favorited,
  pathname,
  search,
  role,
}: {
  module: NavModule;
  active: boolean;
  favorited: boolean;
  pathname: string;
  search: string;
  role: RoleName;
}) {
  const Icon = module.icon;
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
      if (favorited) await removeFavorite(module.href);
      else await addFavorite(module.label, module.href);
      setMenuOpen(false);
    });
  };

  const railLabel = module.short ?? module.label;
  // 모바일 드로어에서는 활성 모듈의 하위 항목을 그 자리에 펼친다
  const childSections = visibleChildSections(module, role);

  return (
    <div
      ref={rowRef}
      className="relative"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <Link
        href={module.href}
        title={module.label}
        aria-label={module.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group/nav flex items-center gap-3 rounded-card px-3 py-1.5 transition-colors duration-fast ease-standard hover:bg-sidebar-hover",
          "md:mx-2 md:flex-col md:gap-1 md:px-1 md:py-2",
          active && "bg-primary-light hover:bg-primary-light",
        )}
      >
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center transition-colors duration-fast ease-standard",
            active ? "text-primary" : "text-muted group-hover/nav:text-ink",
          )}
        >
          <Icon className="size-[18px]" aria-hidden />
        </span>
        {/*
          모바일은 전체 라벨, 데스크톱 레일은 짧은 라벨.
          두 span이 항상 DOM에 있어 스크린리더가 두 번 읽으므로 시각용으로만 두고,
          접근성 이름은 바깥 aria-label로 준다.
        */}
        <span
          aria-hidden
          className={cn(
            "truncate text-body-sm transition-colors duration-fast ease-standard md:max-w-[68px] md:text-nano md:leading-tight",
            active ? "font-bold text-primary" : "text-sidebar-text",
          )}
        >
          <span className="md:hidden">{module.label}</span>
          <span className="hidden md:inline">{railLabel}</span>
        </span>
      </Link>

      {/* 모바일 전용: 활성 모듈의 하위 화면을 들여쓰기해서 펼친다 */}
      {active && childSections.length > 0 ? (
        <div className="mb-1 md:hidden">
          {childSections.map((section) => (
            <div key={section.key}>
              {section.title ? (
                <p className="px-4 pb-0.5 pt-1.5 text-nano font-bold text-muted">
                  {section.title}
                </p>
              ) : null}
              {section.items.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className={cn(
                    "block rounded-card py-1.5 pl-[52px] pr-3 text-body-sm transition-colors duration-fast ease-standard hover:bg-sidebar-hover",
                    isChildActive(item, pathname, search)
                      ? "font-bold text-primary"
                      : "text-sidebar-text",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {menuOpen ? (
        <div className="absolute left-full top-1 z-50 ml-1 w-44 overflow-hidden rounded-card border border-line bg-surface py-1 text-ink shadow-pop">
          <button
            type="button"
            onClick={toggleFavorite}
            disabled={pending}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-body-sm transition-colors hover:bg-subtle disabled:opacity-50"
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
