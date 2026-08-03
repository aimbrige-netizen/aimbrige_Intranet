"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { ModulePanel } from "@/components/layout/ModulePanel";
import { Topbar, type TopbarUser } from "@/components/layout/Topbar";
import { UtilityRail } from "@/components/layout/UtilityRail";
import { hasPanel, resolveModule } from "@/lib/nav";
import { cn } from "@/lib/utils";
import type { Favorite, RoleName } from "@/types/db";

/** 레일 확장 상태 저장 키 — 08 "상태는 세션 지속(localStorage 급)" */
const RAIL_WIDE_KEY = "rail-wide";

/**
 * 2뎁스 셸 — daou-survey/01·03·08 실측 치수.
 *
 *  ┌────────────────────────────────────────────────┐
 *  │ [AB 에임브릿지] 전체앱▾ 검색  알림 프로필      │ 60px 상단바 (전체 폭)
 *  ├──────┬──────────┬──────────────────────┬──────┤
 *  │ 레일 │  모듈    │  본문                │ 유틸 │
 *  │64/200│  260px   │  (모듈=흰 시트)      │ 64px │
 *  └──────┴──────────┴──────────────────────┴──────┘
 *
 * 본문 시작 x = 레일 폭 + 260. 레일이 64(접힘)/200(확장, 08 gnb-wide)으로
 * 움직이므로 시작점도 324/460 두 값이 된다. 현재 레일 폭은 CSS 변수
 * --rail-w로도 내려간다 — ModulePanel의 fixed left가 이 변수를 참조해서
 * 레일 확장 시 패널·본문이 한 몸으로 밀린다(기본값 64px는 globals.css).
 *
 * 모듈 화면 본문 = 전면 흰 시트 (08 "모듈 화면 본문"):
 * 원본 .go_content는 x324부터 화면 끝까지 배경 #fff고, 회청 canvas는
 * 홈 대시보드에만 보인다. 그래서 패널 있는 모듈 화면은 본문 래퍼를
 * bg-surface 시트(그림자·테두리 없음)로 깔고, 홈(패널 없음)은 canvas를
 * 유지한다. 패널(260, 투명)과 흰 시트의 색 경계가 "나누는 줄"이다.
 *
 * 우측 유틸바(64, 원본 organizer)가 열려 있으면 본문에 md:pr-16을 줘서
 * 콘텐츠가 바 밑으로 들어가지 않게 한다.
 *
 * 레일 확장 상태(wide)를 Sidebar가 아니라 여기서 소유하는 이유:
 * 본문 들여쓰기·패널 오프셋이 레일 폭과 같이 움직여야 한다. SSR에는
 * localStorage가 없으므로 접힘(기본)으로 그리고 마운트 후 저장값을
 * 반영한다 — 하이드레이션 불일치를 안 만드는 대신, 확장을 켜 둔
 * 사용자는 첫 페인트 직후 한 번 펼쳐지는 전환을 본다(transition이 흡수).
 *
 * 모바일 드로어 상태를 상단바와 레일이 공유해야 해서 클라이언트 컴포넌트다.
 */
export function AppShell({
  user,
  role,
  favorites,
  mailUnreadCount = 0,
  children,
}: {
  user: TopbarUser;
  role: RoleName;
  favorites: Pick<Favorite, "id" | "label" | "target_path">[];
  /** 상단바 쪽지 배지 — (app)/layout이 getUnreadMailCount로 조회해 넘긴다 */
  mailUnreadCount?: number;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  const [wide, setWide] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(RAIL_WIDE_KEY) === "1") setWide(true);
    } catch {
      // localStorage 접근 불가(프라이빗 모드 등) — 기본 접힘 유지
    }
  }, []);
  const toggleWide = () => {
    setWide((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(RAIL_WIDE_KEY, next ? "1" : "0");
      } catch {
        // 저장 실패는 무시 — 이번 세션 안에서는 상태로 동작한다
      }
      return next;
    });
  };

  /* 우측 유틸바 접힘(08 "접기 토글 — 유틸바 숨김"). 세션 한정 상태. */
  const [utilityOpen, setUtilityOpen] = useState(true);

  /*
   * 패널 유무에 따라 본문 들여쓰기가 달라진다. 판정은 ModulePanel과
   * 단일 출처(nav.ts hasPanel)를 공유한다 — 종전처럼 여기서 원시
   * sections/primaryAction을 직접 보면 역할 필터가 빠져서, 역할 제한
   * 모듈에서 패널 없는 324px 들여쓰기(260px 죽은 여백)가 생긴다.
   */
  const active = resolveModule(pathname, role);
  const withPanel = !!active && hasPanel(active, role);

  return (
    <div
      className="min-h-dvh bg-canvas"
      /* 현재 레일 폭 — Sidebar 폭(w-rail/w-rail-wide)과 같은 값.
         ModulePanel이 left-[var(--rail-w)]로 참조한다. */
      style={{ "--rail-w": wide ? "200px" : "64px" } as CSSProperties}
    >
      <Topbar
        user={user}
        role={role}
        mailUnreadCount={mailUnreadCount}
        onMenuClick={() => setMobileOpen(true)}
      />

      <Sidebar
        role={role}
        favorites={favorites}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        wide={wide}
        onToggleWide={toggleWide}
      />

      <ModulePanel role={role} />

      <UtilityRail
        role={role}
        open={utilityOpen}
        onToggle={() => setUtilityOpen((prev) => !prev)}
      />

      {/*
        본문 좌측 오프셋 = 레일 폭(64/200) + 패널 유무(+260):
        64 → ml-rail · 200 → ml-rail-wide · 324 → ml-shell · 460 → 200+260.
        왼쪽은 padding이 아니라 **margin**이다 — CSS 배경은 padding-box까지
        칠하므로 pl-shell + bg-surface면 흰 시트가 레일 오른쪽(x=64)부터
        칠해져, 투명 패널 밴드(64~324)의 canvas와 08의 "패널/시트 색 경계"가
        사라진다. margin은 배경 바깥이라 시트가 정확히 x=324부터 시작한다.
        우측 pr-16은 fixed 유틸바(흰색)가 덮는 영역이라 padding으로 남긴다.
        transition은 margin·padding에만 건다 — 흰 시트/캔버스 배경 전환
        (라우트 이동)까지 애니메이션되면 화면 사이에 회색 플래시가 생긴다.
      */}
      <div
        className={cn(
          "transition-[margin,padding] duration-standard ease-standard",
          withPanel
            ? cn(
                /*
                 * 모듈 화면 = 전면 흰 시트 (08). md 미만은 패널·레일이 없는
                 * 드로어 문법이라 canvas 위 카드 배치를 그대로 둔다.
                 * min-h는 시트가 짧은 화면에서도 바닥까지 흰색이 닿게 한다.
                 */
                "min-h-[calc(100dvh-theme(spacing.topbar))] md:bg-surface",
                wide ? "md:ml-[460px]" : "md:ml-shell",
              )
            : wide
              ? "md:ml-rail-wide"
              : "md:ml-rail",
          utilityOpen && "md:pr-16",
        )}
      >
        <main className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
