"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  visibleChildSections,
  visibleModules,
  type NavChild,
} from "@/lib/nav";
import type { RoleName } from "@/types/db";

/**
 * 전체 메뉴 오버레이 (앱 런처) — daou-survey/08-shell-extra.md 실측.
 *
 *   - fixed, 상단바(60) 아래 전체 높이. 흰 패널 폭 1040px 좌측 고정,
 *     우측 그림자 `rgba(20,30,50,0.2) 6px 0 24px -6px` (shadow-launcher 토큰).
 *   - 패널 밖은 딤(bg-ink/30) — 클릭·ESC로 닫힘.
 *   - 헤더(h-68): X 닫기 + "전체 메뉴"(18/600) + 우측 앱 검색 인풋.
 *     원본의 "사용 가능한 앱 보기" 토글은 우리에게 개념이 없어 생략.
 *   - 본문 열 폭 400/400/240: 앞 두 열 = "임직원포털" 앱 2열 그리드
 *     (행 36px · 아이콘 20을 틴트 타일에 + 라벨 14), 셋째 열(240) = "관리자".
 *
 * 관리자 열은 nav.ts의 admin 섹션들(/admin 계열 href)을 그대로 모은다 —
 * 시스템 모듈(개요·감사 로그)을 앞에, 각 모듈의 관리 항목을 뒤에.
 * nav.ts는 읽기 전용 계약이라 여기서 목록만 파생하고 href는 손대지 않는다.
 *
 * 검색은 라벨 부분일치(클라이언트) — 임직원포털·관리자 열 둘 다 거른다.
 * 데스크톱 전용: 768px 미만은 레일 드로어가 전체 목록을 이미 편다.
 */

/** /admin 계열 링크 전부 — 시스템 모듈 항목을 앞세우고 href로 중복 제거 */
function collectAdminLinks(role: RoleName): NavChild[] {
  if (role !== "system_admin") return [];
  const mods = visibleModules(role);
  const ordered = [
    ...mods.filter((m) => m.key === "system"),
    ...mods.filter((m) => m.key !== "system"),
  ];
  const seen = new Set<string>();
  const out: NavChild[] = [];
  for (const mod of ordered) {
    for (const section of visibleChildSections(mod, role)) {
      for (const item of section.items) {
        if (!item.href.startsWith("/admin")) continue;
        if (seen.has(item.href)) continue;
        seen.add(item.href);
        out.push(item);
      }
    }
  }
  return out;
}

export function AppLauncher({
  role,
  open,
  onClose,
}: {
  role: RoleName;
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /*
   * 열릴 때마다: 검색 비우기 + 인풋 포커스, ESC 닫기, Tab 포커스 트랩.
   * aria-modal="true"를 선언했으니 실제로도 모달이어야 한다 — 트랩이 없으면
   * Tab이 딤 뒤 상단바·유틸바(z-20, 딤 아래지만 포커스 가능)로 빠져나가서,
   * 스크린리더는 "갇힌 다이얼로그"로 안내받는데 키보드는 가려진 컨트롤을
   * 조작하게 된다. 닫힐 때는 포커스를 열기 전 요소(레일 트리거)로 되돌린다.
   */
  useEffect(() => {
    if (!open) return;
    const prev =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setQuery("");
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const root = panelRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
        // display:none 등 비가시 요소 제외 (여기서는 전부 가시지만 방어)
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement;
      if (event.shiftKey) {
        if (current === first || !root.contains(current)) {
          event.preventDefault();
          last.focus();
        }
      } else if (current === last || !root.contains(current)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // 라우트 이동으로 닫힐 때도 트리거 복원이 무해하다 — 새 화면에서
      // 레일은 그대로 있고, 포커스가 body로 떨어지는 것보다 낫다.
      prev?.focus();
    };
  }, [open, onClose]);

  const modules = useMemo(() => visibleModules(role), [role]);
  const adminLinks = useMemo(() => collectAdminLinks(role), [role]);

  const q = query.trim().toLowerCase();
  const shownModules = q
    ? modules.filter((m) => m.label.toLowerCase().includes(q))
    : modules;
  const shownAdmin = q
    ? adminLinks.filter((i) => i.label.toLowerCase().includes(q))
    : adminLinks;

  if (!open) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-topbar z-50 hidden md:block"
      role="dialog"
      aria-modal="true"
      aria-label="전체 메뉴"
    >
      {/* 패널 밖 딤 — 클릭으로 닫힘 (모바일 드로어 딤과 같은 bg-ink/30) */}
      <div
        className="absolute inset-0 bg-ink/30"
        onClick={onClose}
        aria-hidden
      />

      {/* 흰 패널 1040px — 우측으로만 번지는 방향성 그림자. ref는 포커스 트랩 범위 */}
      <div
        ref={panelRef}
        className="absolute inset-y-0 left-0 flex w-[1040px] max-w-full flex-col bg-surface shadow-launcher"
      >
        <div className="flex h-[68px] shrink-0 items-center gap-3 border-b border-line px-5">
          <button
            type="button"
            onClick={onClose}
            aria-label="전체 메뉴 닫기"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-sub transition-colors duration-fast ease-standard hover:bg-subtle"
          >
            <X className="size-5" strokeWidth={1.75} aria-hidden />
          </button>
          {/* 18/600 — text-h2가 정확히 heading-m(18/27/600)이다 */}
          <h2 className="text-h2 text-ink">전체 메뉴</h2>
          <div className="relative ml-auto">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="앱 검색"
              aria-label="앱 검색"
              className="h-9 w-60 rounded-lg border border-line-strong bg-surface pl-8 pr-3 text-body-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 1·2열(400+400): 임직원포털 앱 2열 그리드 */}
          <section
            aria-label="임직원포털"
            className="min-w-0 flex-1 overflow-y-auto px-6 py-5"
          >
            <h3 className="text-body-sm font-medium text-ink-sub">
              임직원포털
            </h3>
            {shownModules.length > 0 ? (
              <ul className="mt-3 grid grid-cols-2 gap-x-4">
                {shownModules.map((module) => {
                  const Icon = module.icon;
                  return (
                    <li key={module.key}>
                      <Link
                        href={module.href}
                        onClick={onClose}
                        className="flex h-9 items-center gap-2.5 rounded-lg px-2 text-body-sm text-ink transition-colors duration-fast ease-standard hover:bg-subtle"
                      >
                        {/* 둥근 사각 틴트 타일 안 20px 글리프 */}
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary-light text-primary">
                          <Icon
                            className="size-5"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                        </span>
                        <span className="truncate">{module.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-body-sm text-faint">
                검색 결과가 없습니다
              </p>
            )}
          </section>

          {/* 3열(240): 관리자 — system_admin에게만 존재 */}
          {adminLinks.length > 0 ? (
            <section
              aria-label="관리자"
              className="w-[240px] shrink-0 overflow-y-auto px-4 py-5"
            >
              <h3 className="text-body-sm font-medium text-ink-sub">관리자</h3>
              {shownAdmin.length > 0 ? (
                <ul className="mt-3">
                  {shownAdmin.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          onClick={onClose}
                          className={cn(
                            "flex h-8 items-center gap-2 rounded-lg px-2 text-body-sm text-ink-sub",
                            "transition-colors duration-fast ease-standard hover:bg-subtle",
                          )}
                        >
                          {Icon ? (
                            <Icon
                              className="size-4 shrink-0 text-muted"
                              strokeWidth={1.75}
                              aria-hidden
                            />
                          ) : null}
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-body-sm text-faint">
                  검색 결과가 없습니다
                </p>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
