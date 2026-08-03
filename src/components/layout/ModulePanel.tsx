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
  visiblePrimaryAction,
  type NavChild,
} from "@/lib/nav";
import {
  PANEL_EXTRA_SLOT,
  PANEL_WIDGET_SLOT,
  type PanelSlot,
} from "@/components/layout/panel-slots";
import type { RoleName } from "@/types/db";

/**
 * 모듈 사이드 패널 (260px) — daou-survey/03-approval.md 실측.
 *
 * 이게 없어서 7개 모듈이 각자 하위 섹션을 콘텐츠 영역에 우겨넣었고,
 * 같은 목적(하위 화면 이동)에 서로 다른 UI 패턴이 11가지 쓰였다.
 * "승인함으로 이동"이 본문 우측 상단에 텍스트 링크로 떠 있던 것도 같은 이유다.
 *
 * 구성은 위에서부터 모듈 제목 → 주요 액션 → 하위 섹션 트리 → 상주 위젯.
 * 상주 위젯(출퇴근 버튼 등)은 스크롤과 무관하게 항상 손에 닿아야 해서
 * 하단에 고정한다.
 *
 * 실측 대비 바뀐 것:
 *   - 폭 224 → 260
 *   - 배경 흰색 + 우측 경계선 → **둘 다 없앤다.** 패널은 본문과 같은 바닥 위에
 *     떠 있는 목록이지 별도의 면이 아니다. 종전에는 흰 패널 / 흰 본문이
 *     경계선 한 줄로만 갈려서 선이 유일한 구조 신호였는데, canvas가 회청으로
 *     바뀐 지금은 흰 카드들이 알아서 떠 보인다.
 *   - 모듈 제목 15/bold → 20/500
 *   - 섹션 제목 11/bold → 14/600, 항목 13 → 14/400 · 행 높이 32
 *     섹션과 항목이 같은 14px이고 굵기로만 갈리는 게 실측의 핵심이다.
 *     11px로 줄여 놓으면 위계가 아니라 그냥 작아 보인다.
 *
 * 데스크톱 전용. 768px 미만에서는 레일 드로어가 하위 항목까지 함께 펼친다.
 */
export function ModulePanel({ role }: { role: RoleName }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const active = resolveModule(pathname, role);

  if (!active) return null;

  const sections = visibleChildSections(active, role);
  // 주요 액션에도 역할 제한이 있다 (프로젝트 등록은 팀장 이상)
  const primaryAction = visiblePrimaryAction(active, role);
  const ActionIcon = primaryAction?.icon;

  /*
   * 보여줄 것이 하나도 없으면 아예 그리지 않는다 — 홈처럼 패널 없는 모듈에서
   * 빈 fixed aside가 본문 위 260px를 투명하게 덮어 클릭을 먹는다.
   * 아래 조건은 nav.ts의 hasPanel과 같은 원시 함수 조합
   * (visibleChildSections + visiblePrimaryAction)이라, AppShell의
   * pl-rail/pl-shell 판정과 항상 같은 답이 나온다.
   */
  if (sections.length === 0 && !primaryAction) return null;

  return (
    <aside
      className={cn(
        "fixed left-[var(--rail-w)] top-topbar z-20 hidden h-[calc(100dvh-theme(spacing.topbar))] w-panel flex-col transition-[left] duration-standard ease-standard md:flex",
      )}
      aria-label={`${active.label} 메뉴`}
    >
      <div className="flex h-14 shrink-0 items-center px-4">
        {/* 20px/500 — fontSize 스케일에 20px 단이 없다(h2 19 / h1 24) */}
        <h2 className="truncate text-[20px] font-medium leading-[1.35] tracking-[-0.02em] text-ink">
          {active.label}
        </h2>
      </div>

      {primaryAction ? (
        /* px-6: 패널 260 − 24×2 = 버튼 폭 212 (아래 실측 212×48의 그 212다.
           px-4는 228을 렌더했다) */
        <div className="shrink-0 px-6 pb-1">
          {/*
            실측(07-modules.md — 결재 "새 결재 진행"·게시판 "글쓰기" 동일):
            212×48 · radius 12 · 흰 바탕 · border 1px #4a4b4c(line-dark) ·
            14px/400 먹색. 종전 h-10 · 16px/600은 03-approval.md 오독이었다 —
            버튼의 무게는 큰 글자가 아니라 진한 윤곽선이 만든다.
            large가 h-12 · rounded-card · text-body(14)라 그대로 쓰고,
            secondary의 border-line-strong만 line-dark로, BASE의
            font-medium만 400으로 되돌린다. hover는 원본
            button-bg-base-hover(#f8f8f8)=subtle — secondary가 이미 그 값이다.
          */}
          <LinkButton
            href={primaryAction.href}
            size="large"
            variant="secondary"
            className="w-full border-line-dark font-normal"
          >
            {ActionIcon ? <ActionIcon className="size-4" aria-hidden /> : null}
            {primaryAction.label}
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

      {/*
        상주 위젯 구분선은 line(#eaecef)이 아니라 line-strong이다.
        패널 배경이 사라지면서 이 선은 흰 면이 아니라 canvas(#edf0f3) 위에
        놓이는데, line은 canvas와 거의 같은 밝기라 아예 안 보인다.
      */}
      <div
        id={PANEL_WIDGET_SLOT}
        className="shrink-0 border-t border-line-strong px-2 py-3 empty:hidden"
      />
    </aside>
  );
}

/**
 * 세그먼트 layout에서 패널 안에 서버 데이터를 꽂을 때 쓴다.
 *
 * 대상 DOM은 상위 layout(AppShell → ModulePanel)이 그린다. 보통은 자식 이펙트가
 * 돌 때 이미 붙어 있지만, 스트리밍 SSR에서는 자식 서브트리가 셸보다 먼저
 * 하이드레이트될 수 있어 첫 이펙트에서 null이 나온다. 그래서 잡힐 때까지
 * 프레임 단위로 재시도한다(실패해도 조용히 포기 — 패널 없는 모듈이 있다).
 *
 * pathname이 바뀌면 패널이 다시 그려지므로 대상도 다시 찾는다.
 */
export function PanelPortal({
  slot,
  children,
}: {
  slot: PanelSlot;
  children: React.ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const find = () => {
      const el = document.getElementById(slot);
      if (el) {
        setTarget(el);
        return;
      }
      if (tries < 60) {
        tries += 1;
        frame = requestAnimationFrame(find);
      }
    };
    find();
    return () => cancelAnimationFrame(frame);
  }, [slot, pathname]);

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
    <div className="mb-4 last:mb-0">
      {/*
        섹션 제목과 항목은 같은 14px이고 굵기(600 vs 400)로만 갈린다.
        muted를 쓰지 않는 이유는 globals.css의 .ab-form-label과 같다 —
        실측치로 옅어진 muted는 흐린 글자색이지 구조 라벨색이 아니다.
      */}
      {title ? (
        <p className="px-2 pb-1 text-body-sm font-semibold text-ink-sub">
          {title}
        </p>
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
          // 행 높이 32px 고정. 14px/400, 활성만 600으로 올린다.
          "flex h-8 items-center gap-2 rounded-card px-2 text-body-sm transition-colors duration-fast ease-standard hover:bg-canvas-hover",
          /*
           * 활성 강조는 색·틴트가 아니라 굵기다 (07-modules.md 결재함 트리 —
           * 활성/제목 14/600 rgb(51,51,51), 배경 틴트 없음).
           *
           * bg-primary-light 틴트를 제거한 근거: 원본 트리는 굵기만으로
           * 활성을 표시하고, 틴트를 남기면 색+굵기 이중 강조가 돼 원본
           * 문법과 달라진다. 배경 없는 패널에서 primary-light 면은 패널
           * 유일의 색면이 돼 주요 액션 버튼보다 무거워지는 문제도 있었다.
           * 섹션 제목과 같은 text-ink-sub/600을 쓰므로 "지금 보고 있는
           * 항목"은 제목과 같은 급으로 읽힌다 — 이게 원본의 위계다.
           *
           * hover(canvas-hover)는 활성에도 그대로 둔다 — 틴트가 사라진
           * 지금 활성 행도 겉보기엔 일반 행이라, hover까지 없애면 그 행만
           * 포인터에 반응하지 않는 죽은 행이 된다.
           * (canvas-hover인 이유: 패널 행은 canvas(#edf0f3) 위에 놓여서
           * subtle(#f8f8f8)을 쓰면 hover가 어두워지는 대신 밝아진다 —
           * 흰 카드 위 표 행 hover와 방향이 반대가 된다.)
           */
          active ? "font-semibold text-ink-sub" : "text-ink",
        )}
      >
        {/* 활성 강조가 굵기로 바뀌면서 아이콘·배지도 시안이 아니라
            라벨과 같은 ink-sub를 따른다 — 색 강조를 남기면 틴트를 뺀
            의미가 없다. */}
        {Icon ? (
          <Icon
            className={cn(
              "size-4 shrink-0",
              active ? "text-ink-sub" : "text-muted",
            )}
            aria-hidden
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {badge ? (
          <span
            className={cn(
              "shrink-0 tabular-nums",
              active ? "text-ink-sub" : "text-muted",
            )}
          >
            {badge}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
