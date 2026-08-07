"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  CircleUser,
  LogOut,
  Menu,
  MessageSquare,
  Network,
  Search,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Avatar } from "@/components/ui/Avatar";
import { createClient } from "@/lib/supabase/client";
import { resolveModule, visibleModules } from "@/lib/nav";
import { cn } from "@/lib/utils";
import type { RoleName } from "@/types/db";

export interface TopbarUser {
  name: string;
  email: string;
  position: string | null;
  departmentName: string | null;
  profileImageUrl: string | null;
}

/** 스코프 드롭다운의 "모듈 전체" 값 */
const ALL_SCOPE = "__all__";

/**
 * 우측 클러스터 아이콘 버튼 공통 — 08-shell-extra.md "상단바 우측 클러스터".
 * 글리프 20(size-5) + p-2 = 히트영역 36px (실측 32~40 범위 안).
 *
 * 2026-08-07 UI/UX 감사: 데스크톱은 실측 범위를 지키고, 375px 모바일에서
 * 상시 노출되는 메일·알림 버튼(Settings·Network는 md:block이라 무관)만
 * p-3(44px)으로 확대한다.
 */
const ICON_BTN =
  "rounded-sm p-3 md:p-2 text-ink transition-colors duration-fast ease-standard hover:bg-subtle";

/**
 * 상단바 60px — 전체 폭.
 *
 * 좌측 끝에 심볼 + "에임브릿지" 워드마크를 상시 노출한다. 예전에는 상단바와
 * 레일의 워드마크가 둘 다 md:hidden이라 데스크톱 어디에도 회사 이름이
 * 렌더되지 않았고, 최고 가치 영역인 좌상단을 disabled된 검색창이 차지했다.
 *
 * 검색창 좌측에 스코프 드롭다운이 붙는다(01-shell.md · 03-approval.md).
 * 기본은 `전체 앱`이고 모듈에 들어가면 그 모듈 이름으로 바뀐다 — 결재함에서
 * 검색하면 결재 안에서 찾는 게 기본값이라는 뜻이다. 사용자가 직접 고른 스코프는
 * 모듈을 옮기기 전까지 유지한다.
 *
 * 통합검색 자체는 아직 placeholder다(스펙 6장). 그래서 여기까지만 만든다 —
 * 표시와 스코프 전환.
 *
 * 우측 클러스터(쪽지·설정·조직도·알림·도움말·관리자 콘솔 필·아바타)와
 * 로고는 daou-survey/08-shell-extra.md "상단바 우측 클러스터"·"로고" 실측을
 * 따른다. 원본에 있고 우리 기능이 없는 것(선물·사운드·앱 다운로드)은
 * 죽은 버튼을 만들지 않고 생략한다.
 */
export function Topbar({
  user,
  role,
  notificationCount = 0,
  mailUnreadCount = 0,
  onMenuClick,
}: {
  user: TopbarUser;
  role: RoleName;
  notificationCount?: number;
  /**
   * 사내 메일 받은메일함 안읽음 수 — 쪽지 아이콘 배지 (12-mail.md).
   * 출처는 server-only 조회 계층(data.ts getUnreadMailCount)이라
   * (app)/layout.tsx가 조회해 AppShell을 거쳐 내려온다.
   */
  mailUnreadCount?: number;
  onMenuClick: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  const isAdmin = role === "system_admin";

  const modules = visibleModules(role);
  const moduleScope = resolveModule(pathname, role);
  const moduleScopeKey = moduleScope?.key ?? ALL_SCOPE;

  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeKey, setScopeKey] = useState(moduleScopeKey);
  const scopeRef = useRef<HTMLDivElement>(null);

  // 모듈을 옮기면 스코프도 따라간다. 같은 모듈 안에서 고른 값은 유지된다.
  useEffect(() => {
    setScopeKey(moduleScopeKey);
    setScopeOpen(false);
  }, [moduleScopeKey]);

  const scopeLabel =
    modules.find((m) => m.key === scopeKey)?.label ?? "전체 앱";

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  useEffect(() => {
    if (!scopeOpen) return;
    const close = (event: MouseEvent) => {
      if (!scopeRef.current?.contains(event.target as Node)) setScopeOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [scopeOpen]);

  useEffect(() => {
    if (!helpOpen) return;
    const close = (event: MouseEvent) => {
      if (!helpRef.current?.contains(event.target as Node)) setHelpOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [helpOpen]);

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
        // 2026-08-07 UI/UX 감사: 32px→44px, 모바일 유일한 1차 내비 진입점
        className="-ml-1 rounded-sm p-3 text-ink transition-colors duration-fast ease-standard hover:bg-subtle md:hidden"
        aria-label="메뉴 열기"
      >
        <Menu className="size-5" />
      </button>

      {/* 자체 제작 심볼+워드마크 — 08-shell-extra.md "로고/워드마크" */}
      <Link
        href="/"
        className="flex shrink-0 items-center rounded-sm transition-opacity duration-fast ease-standard hover:opacity-80"
        aria-label="에임브릿지 홈"
      >
        <Logo />
      </Link>

      {/* 양쪽 spacer로 검색을 가운데 둔다 */}
      <div className="hidden flex-1 md:block" />

      {/*
        스코프 + 입력이 한 덩어리다. 둘을 떼어 놓으면 "전체 앱"이 검색과
        무관한 별개 필터로 보인다 — 실측도 하나의 필드로 붙어 있다.
        실측(.global-search-bar): 360×40 · radius 20 · 흰 바탕 ·
        테두리 1px rgb(228,229,229). 회색 채움이 아니다.
      */}
      <div className="relative hidden h-10 w-full max-w-[360px] items-center rounded-pill border border-sidebar-line bg-surface md:flex">
        <div ref={scopeRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setScopeOpen((open) => !open)}
            aria-expanded={scopeOpen}
            aria-haspopup="listbox"
            aria-label={`검색 범위: ${scopeLabel}`}
            className="flex h-10 items-center gap-1 rounded-l-pill pl-4 pr-3 text-body-sm text-ink-sub transition-colors duration-fast ease-standard hover:text-ink"
          >
            <span className="max-w-[92px] truncate">{scopeLabel}</span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted transition-transform duration-fast ease-standard",
                scopeOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>

          {scopeOpen ? (
            <div
              role="listbox"
              aria-label="검색 범위"
              className="scrollbar-thin absolute left-0 top-[calc(100%+6px)] z-40 max-h-[60vh] w-52 overflow-y-auto rounded-card border border-line bg-surface py-1 shadow-pop"
            >
              <ScopeOption
                label="전체 앱"
                selected={scopeKey === ALL_SCOPE}
                onSelect={() => {
                  setScopeKey(ALL_SCOPE);
                  setScopeOpen(false);
                }}
              />
              <hr className="my-1 border-line" />
              {modules.map((module) => (
                <ScopeOption
                  key={module.key}
                  label={module.label}
                  selected={scopeKey === module.key}
                  onSelect={() => {
                    setScopeKey(module.key);
                    setScopeOpen(false);
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>

        <span className="h-4 w-px shrink-0 bg-line-strong" aria-hidden />

        <Search
          className="pointer-events-none ml-3 size-4 shrink-0 text-muted"
          aria-hidden
        />
        <input
          type="search"
          disabled
          placeholder="통합검색"
          aria-label={`${scopeLabel} 검색`}
          className="h-10 min-w-0 flex-1 bg-transparent pl-2 pr-2 text-body-sm placeholder:text-muted disabled:cursor-not-allowed"
        />
        {/*
          상세검색 필터 — 원본 검색창 안 우측 위치 재현(08-shell-extra.md).
          통합검색 자체가 아직 placeholder(스펙 6장)라 죽은 버튼 대신
          disabled 톤(gray-52 — 06 field placeholder와 같은 단) 아이콘만 둔다.
        */}
        <SlidersHorizontal
          className="mr-3 size-5 shrink-0 text-muted"
          aria-hidden
        />
      </div>

      {/*
        우측 클러스터 — 08-shell-extra.md 순서: 쪽지 → 설정 → 조직도 →
        알림 벨 → 도움말 → 시안 필 버튼 → 아바타.
        원본의 선물·사운드·"앱 다운로드"는 대응 기능이 없어 생략한다
        (시각 재현용 죽은 버튼 금지). 설정·조직도·도움말·필 버튼은
        모바일에서 숨긴다 — 원본 셸 자체가 min-width 1440 데스크톱 전용이고,
        모바일은 드로어 내비가 같은 목적지를 이미 담당한다.
      */}
      <div className="ml-auto flex flex-1 items-center justify-end gap-1.5">
        {/*
          쪽지 자리 — 사내 메일함(/mail)으로 간다(스펙 12 — 메일 모듈 신설로
          Gmail 새 탭 딥링크에서 전환. 외부메일 링크는 메일 패널 하단이 담당).
          안읽음 배지는 알림 벨과 같은 문법(badge accent #ff502a = danger-ink).
        */}
        <Link
          href="/mail"
          className={cn(ICON_BTN, "relative")}
          aria-label={`메일 — 안읽음 ${mailUnreadCount}건`}
          title="메일"
        >
          <MessageSquare className="size-5" />
          {mailUnreadCount > 0 ? (
            <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-danger-ink px-1 text-[10px] font-bold leading-4 text-white">
              {mailUnreadCount > 99 ? "99+" : mailUnreadCount}
            </span>
          ) : null}
        </Link>

        {isAdmin ? (
          <Link
            href="/admin"
            className={cn(ICON_BTN, "hidden md:block")}
            aria-label="설정"
            title="설정"
          >
            <Settings className="size-5" />
          </Link>
        ) : null}

        <Link
          href="/directory"
          className={cn(ICON_BTN, "hidden md:block")}
          aria-label="조직도"
          title="조직도"
        >
          <Network className="size-5" />
        </Link>

        <button
          type="button"
          className={cn(ICON_BTN, "relative")}
          aria-label={`알림 ${notificationCount}건`}
        >
          <Bell className="size-5" />
          {notificationCount > 0 ? (
            /* 카운트 배지 bg = badge accent #ff502a (06 badge 그룹) — danger-ink 토큰 */
            <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-danger-ink px-1 text-[10px] font-bold leading-4 text-white">
              {notificationCount > 99 ? "99+" : notificationCount}
            </span>
          ) : null}
        </button>

        {/* 도움말 — 화면이 아직 없어서 클릭하면 준비중 툴팁만 띄운다 */}
        <div ref={helpRef} className="relative hidden md:block">
          <button
            type="button"
            onClick={() => setHelpOpen((open) => !open)}
            className={ICON_BTN}
            aria-label="도움말"
            aria-expanded={helpOpen}
          >
            <CircleHelp className="size-5" />
          </button>
          {helpOpen ? (
            <div
              role="status"
              className="absolute right-0 top-[calc(100%+6px)] z-40 whitespace-nowrap rounded-sm bg-ink px-2.5 py-1.5 text-micro text-white shadow-pop"
            >
              도움말 준비중
            </div>
          ) : null}
        </div>

        {/*
          원본 "경영업무포털" 시안 채움 필 자리(h-40 · radius 20 · #08a7bf ·
          흰 글자) — 우리 매핑은 관리자 콘솔. hover는 원본 규칙대로 밝아진다.
        */}
        {isAdmin ? (
          <Link
            href="/admin"
            className="ml-1 hidden h-10 shrink-0 items-center rounded-pill bg-primary px-4 text-body-sm text-white transition-colors duration-fast ease-standard hover:bg-primary-hover md:flex"
          >
            관리자 콘솔
          </Link>
        ) : null}

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
              className="!bg-primary-light !text-primary-ink"
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

          {/*
            프로필 팝업 — 08-shell-extra.md: 흰 카드 radius 12 + shadow-pop,
            상단 아바타 40 + 이름/이메일, 행 3개(내 프로필 / 개인 설정 / 로그아웃).
            개인 설정 화면은 별도 라우트가 없어 프로필 화면이 겸한다.
            border-line은 스펙 외지만 흰 상단바 위에서 카드 윤곽이 사라지지
            않도록 다른 팝업(스코프 드롭다운)과 같은 hairline을 유지한다.
          */}
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+6px)] w-60 overflow-hidden rounded-card border border-line bg-surface shadow-pop"
            >
              <div className="flex items-center gap-3 border-b border-line px-4 py-4">
                <Avatar
                  name={user.name}
                  src={user.profileImageUrl}
                  size="medium"
                  className="!size-10 !bg-primary-light !text-primary-ink"
                />
                <div className="min-w-0">
                  <p className="truncate text-body font-bold text-ink">
                    {user.name}
                  </p>
                  <p className="truncate text-caption">{user.email}</p>
                </div>
              </div>
              <div className="py-1">
                <Link
                  href="/profile"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-body-sm text-ink transition-colors duration-fast ease-standard hover:bg-subtle"
                  role="menuitem"
                >
                  <CircleUser className="size-4 text-muted" />내 프로필
                </Link>
                <Link
                  href="/profile"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-body-sm text-ink transition-colors duration-fast ease-standard hover:bg-subtle"
                  role="menuitem"
                >
                  <Settings className="size-4 text-muted" />
                  개인 설정
                </Link>
                <button
                  type="button"
                  onClick={signOut}
                  disabled={signingOut}
                  className={cn(
                    "flex w-full items-center gap-2 px-4 py-2.5 text-left text-body-sm transition-colors duration-fast ease-standard",
                    "text-danger hover:bg-danger-light disabled:opacity-50",
                  )}
                  role="menuitem"
                >
                  <LogOut className="size-4" />
                  {signingOut ? "로그아웃 중…" : "로그아웃"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function ScopeOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex h-8 w-full items-center gap-2 px-3 text-left text-body-sm transition-colors duration-fast ease-standard hover:bg-subtle",
        selected ? "font-medium text-primary-ink" : "text-ink",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? (
        <Check className="size-4 shrink-0 text-primary-ink" aria-hidden />
      ) : null}
    </button>
  );
}
