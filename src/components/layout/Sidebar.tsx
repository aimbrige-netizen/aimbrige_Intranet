"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  Menu,
  Network,
  Star,
  StarOff,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AppLauncher } from "@/components/layout/AppLauncher";
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
 * 전역 모듈 레일 (64px) — DevTools 재실측(.doa_gnb) + 08-shell-extra.md.
 *
 *   배경 rgb(235,244,246) · 우측 경계 1px rgb(228,229,229)
 *   칸 <a> 64×64 · 칸 사이 margin-bottom 6px · flex-col 중앙 정렬
 *   아이콘 타일 <i> 32×32 · radius 8 — **hover/active는 이 타일에만 칠한다**
 *     hover #CDEAF1 · active #08A7BF + 흰 글리프
 *   라벨 12px/500 · 비활성 rgb(50,51,51) · 활성 rgb(8,167,191)
 *   스크롤바: 평상시 **완전 숨김** (scrollbar-width:none — 원본 CSS 그대로)
 *
 * 08에서 추가된 것:
 *   - 최상단 (16,79) 32×32 앱 런처 트리거 → 전체 메뉴 오버레이(AppLauncher)
 *   - 스크롤이 넘치면 위/아래 gnb-band 화살표 밴드(h-24)로 "더 있음" 신호
 *   - 하단 고정 영역 h-80: ≡ 확장 토글 + 조직도, 32×32 버튼 세로 스택
 *   - 확장 모드(gnb-wide): 폭 64→200, 배경 동일 #ebf4f6, 항목은 가로 행
 *     173×32 radius 8 (아이콘 24 + 라벨 14/500) — hover/active를 **행 전체**에
 *     칠한다(접힘의 "타일에만"과 반대). 활성 행 #08a7bf + 흰 라벨.
 *
 * 확장 상태(wide)는 여기서 소유하지 않는다 — 본문 들여쓰기가 같이 움직여야
 * 해서 AppShell이 localStorage("rail-wide")로 소유하고 props로 내린다.
 * (props를 옵셔널로 둔 것은 배선 전에도 타입이 깨지지 않게 하기 위한 것.
 * 기본값은 스펙대로 접힘이다.)
 *
 * 두 번 틀린 자리다. 처음엔 활성을 칸 전체 통칠로 만들었고(원본은 아이콘
 * 타일만), 다음엔 스크롤바를 그렸다가 64px에서 10px를 먹어 4자 라벨이
 * "업무…"로 잘렸다. 라벨 12px 기준 4자 = 48px라 이제 여유도 있다.
 *
 * 모듈은 묶지 않고 전부 세운다(17개). 5자 이상만 nav.ts의 `short`가 받는다.
 *
 * 768px 미만에서는 모듈과 그 하위 항목을 한 리스트로 펼친 드로어가 된다 —
 * 좁은 화면에서 레일과 패널을 둘 다 띄우면 본문이 남지 않는다. 앱 런처
 * 트리거·하단 고정 버튼·밴드는 그 드로어에 없다(데스크톱 전용).
 */
export function Sidebar({
  role,
  favorites,
  mobileOpen,
  onMobileClose,
  wide = false,
  onToggleWide,
}: {
  role: RoleName;
  favorites: Pick<Favorite, "id" | "label" | "target_path">[];
  mobileOpen: boolean;
  onMobileClose: () => void;
  /** 레일 확장 상태 — 소유는 AppShell(localStorage "rail-wide") */
  wide?: boolean;
  onToggleWide?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const modules = visibleModules(role);
  const activeModule = resolveModule(pathname, role);
  /*
   * 즐겨찾기 판정은 favorites.target_path와 module.href의 문자열 동등 비교다.
   * 그래서 모듈 href는 쿼리를 달지 않고, 이번 레일 재편에서도 하나도 바꾸지
   * 않았다(nav.ts 상단 주석). href를 손대면 여기 별표가 조용히 꺼진다.
   */
  const favoritePaths = new Set(favorites.map((f) => f.target_path));

  const [launcherOpen, setLauncherOpen] = useState(false);

  // 라우트가 바뀌면 모바일 드로어와 앱 런처를 닫는다
  useEffect(() => {
    onMobileClose();
    setLauncherOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search]);

  /*
   * gnb-band — 숨긴 스크롤바 대신 "위/아래에 더 있음" 신호 (08).
   * 스크롤 위치·목록 길이에 따라 위/아래 화살표 밴드를 낸다.
   */
  const navRef = useRef<HTMLElement>(null);
  const [bands, setBands] = useState({ top: false, bottom: false });
  const updateBands = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    const top = el.scrollTop > 0;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setBands((prev) =>
      prev.top === top && prev.bottom === bottom ? prev : { top, bottom },
    );
  }, []);
  // 목록 내용(즐겨찾기 증감·확장 전환)이 무엇이 바뀌든 매 렌더 다시 잰다 —
  // setState는 값이 달라질 때만 일어나므로 루프는 없다.
  useEffect(updateBands);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const el = navRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateBands);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateBands]);

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
          "md:top-topbar md:h-[calc(100dvh-theme(spacing.topbar))] md:border-sidebar-line md:transition-[width]",
          wide ? "md:w-rail-wide" : "md:w-rail",
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

        {/*
          앱 런처 트리거 — 08: 레일 최상단 (16,79)의 32×32 버튼, 글리프 20px
          3×3 점 그리드. topbar(60) 기준 y79 → 위 여백 19px.
        */}
        <div
          className={cn(
            "hidden shrink-0 pb-1 pt-[19px] md:flex",
            wide ? "pl-3.5" : "justify-center",
          )}
        >
          <button
            type="button"
            onClick={() => setLauncherOpen(true)}
            aria-label="전체 메뉴"
            aria-haspopup="dialog"
            aria-expanded={launcherOpen}
            title="전체 메뉴"
            className="grid size-8 place-items-center rounded-lg text-ink-sub transition-colors duration-fast ease-standard hover:bg-sidebar-hover"
          >
            <LayoutGrid className="size-5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        {/* gnb-band(위) — 위로 스크롤할 내용이 있을 때만. 글리프 #7a7b7d (08) */}
        {bands.top ? (
          <div
            className="hidden h-6 shrink-0 items-center justify-center text-band md:flex"
            aria-hidden
          >
            <ChevronUp className="size-4" strokeWidth={1.75} />
          </div>
        ) : null}

        {/*
          17칸이 1080p 뷰포트를 넘어 스크롤이 생긴다. 원본은 이 상태에서
          막대를 완전히 숨긴다(.gnb-scroll { scrollbar-width: none }) —
          막대를 그리면 64px에서 10px를 먹어 4자 라벨이 잘리는 걸 실제로 겪었다.
          발견 가능성은 gnb-band 화살표가 대신 신호한다(08).
        */}
        <nav
          ref={navRef}
          onScroll={updateBands}
          className="scrollbar-none flex-1 overflow-y-auto overflow-x-hidden py-2"
        >
          {modules.map((module) => (
            <ModuleRow
              key={module.key}
              module={module}
              active={activeModule?.key === module.key}
              favorited={favoritePaths.has(module.href)}
              pathname={pathname}
              search={search}
              role={role}
              wide={wide}
            />
          ))}

          {favorites.length > 0 ? (
            <>
              <hr className="mx-3 my-2 border-sidebar-line" />
              {/* 레일 라벨과 같은 12px/500 — 색만 낮춰 구분한다 */}
              <p
                className={cn(
                  "px-4 pb-1 text-body-sm font-medium text-muted",
                  wide
                    ? "md:pl-[22px] md:text-left"
                    : "md:px-1 md:text-center md:text-[12px]",
                )}
              >
                즐겨찾기
              </p>
              {favorites.map((favorite) => {
                const favActive = pathname === favorite.target_path;
                return (
                  <Link
                    key={favorite.id}
                    href={favorite.target_path}
                    title={favorite.label}
                    aria-label={`즐겨찾기: ${favorite.label}`}
                    className={cn(
                      "group/fav flex items-center gap-3 rounded-card px-3 py-2 transition-colors duration-fast ease-standard hover:bg-sidebar-hover",
                      wide
                        ? cn(
                            "md:mx-auto md:mb-1 md:h-8 md:w-[173px] md:gap-2.5 md:rounded-lg md:px-2 md:py-0",
                            favActive
                              ? "md:bg-sidebar-active md:hover:bg-sidebar-active"
                              : "md:hover:bg-sidebar-hover",
                          )
                        : "md:mb-1.5 md:h-16 md:flex-col md:justify-center md:gap-1 md:rounded-none md:p-0 md:hover:bg-transparent",
                    )}
                  >
                    {/* 모듈 칸과 같은 아이콘 타일 규칙 — 확장 시 타일 없이
                        글리프(24)만 (08 "아이콘 24 + 라벨 14/500") */}
                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-lg transition-colors duration-fast ease-standard",
                        wide ? "md:size-6 md:rounded-none" : "md:size-8",
                        favActive
                          ? cn("bg-sidebar-active", wide && "md:bg-transparent")
                          : !wide && "md:group-hover/fav:bg-sidebar-hover",
                      )}
                    >
                      <Star
                        className={cn(
                          "size-[18px] shrink-0",
                          wide ? "md:size-6" : "md:size-5",
                          favActive
                            ? "fill-white text-white"
                            : "fill-warn text-warn",
                        )}
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "truncate text-body-sm leading-tight",
                        wide
                          ? "md:font-medium"
                          : "md:w-full md:text-center md:text-[12px] md:font-medium",
                        favActive
                          ? wide
                            ? "text-primary md:text-white"
                            : "text-primary"
                          : "text-sidebar-text",
                      )}
                    >
                      {favorite.label}
                    </span>
                  </Link>
                );
              })}
            </>
          ) : null}
        </nav>

        {/* gnb-band(아래) — 아래로 스크롤할 내용이 있을 때만. 글리프 #7a7b7d (08) */}
        {bands.bottom ? (
          <div
            className="hidden h-6 shrink-0 items-center justify-center text-band md:flex"
            aria-hidden
          >
            <ChevronDown className="size-4" strokeWidth={1.75} />
          </div>
        ) : null}

        {/*
          하단 고정 영역 h-80 (08 ul.footer.group_fixed_btn) —
          스크롤 목록과 분리, 32×32 버튼 2개 세로 스택(글리프 20).
        */}
        <div className="hidden h-20 shrink-0 flex-col items-center justify-center gap-1 md:flex">
          <button
            type="button"
            onClick={onToggleWide}
            aria-pressed={wide}
            aria-label={wide ? "레일 접기" : "레일 펼치기"}
            title={wide ? "레일 접기" : "레일 펼치기"}
            className="grid size-8 place-items-center rounded-lg text-ink-sub transition-colors duration-fast ease-standard hover:bg-sidebar-hover"
          >
            <Menu className="size-5" strokeWidth={1.75} aria-hidden />
          </button>
          <Link
            href="/directory"
            aria-label="조직도"
            title="조직도"
            className="grid size-8 place-items-center rounded-lg text-ink-sub transition-colors duration-fast ease-standard hover:bg-sidebar-hover"
          >
            <Network className="size-5" strokeWidth={1.75} aria-hidden />
          </Link>
        </div>
      </aside>

      <AppLauncher
        role={role}
        open={launcherOpen}
        onClose={() => setLauncherOpen(false)}
      />
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
  wide,
}: {
  module: NavModule;
  active: boolean;
  favorited: boolean;
  pathname: string;
  search: string;
  role: RoleName;
  wide: boolean;
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
          wide
            ? cn(
                /*
                 * 확장 레일(gnb-wide): 가로 행 173×32 radius 8 —
                 * 접힘과 달리 hover/active를 행 전체에 칠한다 (08).
                 */
                "md:mx-auto md:mb-1 md:h-8 md:w-[173px] md:gap-2.5 md:rounded-lg md:px-2 md:py-0",
                active
                  ? "md:bg-sidebar-active md:hover:bg-sidebar-active"
                  : "md:hover:bg-sidebar-hover",
              )
            : // 접힌 레일: 64×64 칸. 칸 자체는 투명 — hover/active는 아이콘 타일 몫.
              "md:mb-1.5 md:h-16 md:flex-col md:justify-center md:gap-1 md:rounded-none md:p-0 md:hover:bg-transparent",
        )}
      >
        {/*
          아이콘 타일 32×32 / radius 8 — 원본의 <i>.AppIcon 자리.
          접힘: hover는 타일만 #CDEAF1, 활성은 타일 #08A7BF + 흰 글리프.
          확장: 행이 칠해지므로 타일 배경 없이 글리프(24)만 놓는다 —
          08 "아이콘 24 + 라벨 14/500". 접힘의 20과 다르다.
        */}
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg transition-colors duration-fast ease-standard",
            wide ? "md:size-6 md:rounded-none" : "md:size-8",
            active
              ? cn(
                  "bg-sidebar-active text-white",
                  wide && "md:bg-transparent",
                )
              : cn(
                  "text-ink-sub",
                  !wide && "md:group-hover/nav:bg-sidebar-hover",
                ),
          )}
        >
          {/*
            32px 타일 안 글리프는 20px 정도가 원본 무게와 비슷하다.
            (다우오피스 아이콘 파일은 복제하지 않는다 — 자리와 크기만 같다)
          */}
          <Icon
            className={cn("size-[18px]", wide ? "md:size-6" : "md:size-5")}
            strokeWidth={1.75}
            aria-hidden
          />
        </span>
        {/*
          모바일은 전체 라벨, 접힌 레일은 짧은 라벨(12px/500),
          확장 레일은 전체 라벨(14/500 — 173px 행이라 다 들어간다).
          두 span이 항상 DOM에 있어 스크린리더가 두 번 읽으므로 시각용으로만 두고,
          접근성 이름은 바깥 aria-label로 준다.
        */}
        <span
          aria-hidden
          className={cn(
            "truncate text-body-sm leading-tight transition-colors duration-fast ease-standard",
            wide
              ? "md:font-medium"
              : "md:w-full md:text-center md:text-[12px] md:font-medium",
            active
              ? wide
                ? "text-primary md:text-white"
                : "text-primary"
              : "text-sidebar-text",
          )}
        >
          <span className="md:hidden">{module.label}</span>
          <span className="hidden md:inline">
            {wide ? module.label : railLabel}
          </span>
        </span>
      </Link>

      {/* 모바일 전용: 활성 모듈의 하위 화면을 들여쓰기해서 펼친다 */}
      {active && childSections.length > 0 ? (
        <div className="mb-1 md:hidden">
          {childSections.map((section) => (
            <div key={section.key}>
              {section.title ? (
                <p className="px-4 pb-0.5 pt-1.5 text-body-sm font-semibold text-ink-sub">
                  {section.title}
                </p>
              ) : null}
              {section.items.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className={cn(
                    "block rounded-card py-1.5 pl-[52px] pr-3 text-body-sm transition-colors duration-fast ease-standard hover:bg-sidebar-hover",
                    // 패널 활성 항목과 같은 이유로 primary-ink를 쓴다 —
                    // primary는 레일 배경(#ebf4f6) 위에서 2.6:1이다.
                    isChildActive(item, pathname, search)
                      ? "font-medium text-primary-ink"
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
