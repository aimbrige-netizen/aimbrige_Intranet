"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { LinkButton } from "@/components/ui/Button";
import {
  isChildActive,
  resolveModule,
  visibleChildSections,
  type NavChild,
} from "@/lib/nav";
import type { RoleName } from "@/types/db";

/**
 * 모듈 사이드 패널 (224px).
 *
 * 이게 없어서 7개 모듈이 각자 하위 섹션을 콘텐츠 영역에 우겨넣었고,
 * 같은 목적(하위 화면 이동)에 서로 다른 UI 패턴이 11가지 쓰였다.
 * "승인함으로 이동"이 본문 우측 상단에 텍스트 링크로 떠 있던 것도 같은 이유다.
 *
 * 구성은 위에서부터 모듈 제목 → 주요 액션 → 하위 섹션 트리 → 상주 위젯.
 * 상주 위젯(출퇴근 버튼 등)은 스크롤과 무관하게 항상 손에 닿아야 해서
 * 하단에 고정한다.
 *
 * 데스크톱 전용. 768px 미만에서는 레일 드로어가 하위 항목까지 함께 펼친다.
 */
/** 세그먼트 layout이 동적 항목을 꽂는 자리 */
export const PANEL_EXTRA_SLOT = "module-panel-extra";
/** 세그먼트 layout이 상주 위젯을 꽂는 자리 */
export const PANEL_WIDGET_SLOT = "module-panel-widget";

export function ModulePanel({ role }: { role: RoleName }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const active = resolveModule(pathname, role);

  if (!active) return null;

  const sections = visibleChildSections(active, role);
  const ActionIcon = active.primaryAction?.icon;

  return (
    <aside
      className={cn(
        "fixed left-rail top-topbar z-20 hidden h-[calc(100dvh-theme(spacing.topbar))] w-panel flex-col border-r border-line bg-surface md:flex",
      )}
      aria-label={`${active.label} 메뉴`}
    >
      <div className="flex h-12 shrink-0 items-center border-b border-line px-4">
        <h2 className="truncate text-body font-bold text-ink">
          {active.label}
        </h2>
      </div>

      {active.primaryAction ? (
        <div className="shrink-0 px-3 pt-3">
          <LinkButton
            href={active.primaryAction.href}
            size="small"
            variant="primary-low"
            className="w-full"
          >
            {ActionIcon ? <ActionIcon className="size-4" aria-hidden /> : null}
            {active.primaryAction.label}
          </LinkButton>
        </div>
      ) : null}

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3">
        {/*
          동적 항목(게시판 목록 등)이 정적 메뉴보다 위에 온다.
          "관리" 섹션은 늘 맨 아래여야 하는데 정적 sections에 섞여 있으므로,
          extra 슬롯을 앞에 두고 관리자 섹션은 뒤에 남긴다.
        */}
        <div id={PANEL_EXTRA_SLOT} />

        {sections.map((section) => (
          <PanelSection key={section.key} title={section.title}>
            {section.items.map((item) => (
              <PanelLink
                key={item.key}
                item={item}
                active={isChildActive(item, pathname, search)}
              />
            ))}
          </PanelSection>
        ))}
      </nav>

      <div
        id={PANEL_WIDGET_SLOT}
        className="shrink-0 border-t border-line p-3 empty:hidden"
      />
    </aside>
  );
}

/**
 * 세그먼트 layout에서 패널 안에 서버 데이터를 꽂을 때 쓴다.
 * 패널은 상위 layout이 그리므로 DOM이 이미 있고, 마운트 후 포털로 붙인다.
 */
export function PanelPortal({
  slot,
  children,
}: {
  slot: typeof PANEL_EXTRA_SLOT | typeof PANEL_WIDGET_SLOT;
  children: React.ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById(slot));
  }, [slot]);

  return target ? createPortal(children, target) : null;
}

/** 패널 안에서 쓰는 링크 목록 — 동적 섹션용 공개 API */
export function PanelLinkList({
  title,
  items,
}: {
  title?: string;
  items: (NavChild & { badge?: number })[];
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  return (
    <PanelSection title={title}>
      {items.map((item) => (
        <PanelLink
          key={item.key}
          item={item}
          active={isChildActive(item, pathname, search)}
          badge={item.badge}
        />
      ))}
    </PanelSection>
  );
}

function PanelSection({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 last:mb-0">
      {title ? (
        <p className="px-2 pb-1 text-nano font-bold text-muted">{title}</p>
      ) : null}
      <ul>{children}</ul>
    </div>
  );
}

function PanelLink({
  item,
  active,
  badge,
}: {
  item: NavChild;
  active: boolean;
  badge?: number;
}) {
  const Icon = item.icon;

  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-card px-2 py-1.5 text-body-sm transition-colors duration-fast ease-standard",
          active
            ? "bg-primary-light font-bold text-primary"
            : "text-ink hover:bg-subtle",
        )}
      >
        {Icon ? (
          <Icon
            className={cn(
              "size-4 shrink-0",
              active ? "text-primary" : "text-muted",
            )}
            aria-hidden
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {badge ? (
          <span
            className={cn(
              "shrink-0 tabular-nums",
              active ? "text-primary" : "text-muted",
            )}
          >
            {badge}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
