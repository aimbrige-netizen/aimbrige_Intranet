"use client";

import Link from "next/link";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  MessageCircleQuestion,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Settings,
  StickyNote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RoleName } from "@/types/db";

/**
 * 버튼 공통 — 32×32 히트영역(size-8) + 글리프 20(size-5), radius 8.
 * 흰 바 위라 hover는 subtle(#f8f8f8 = 원본 button-bg-base-hover)이다 —
 * 레일의 sidebar-hover(#cdeaf1)는 #ebf4f6 배경 전용.
 */
const UTIL_BTN =
  "grid size-8 shrink-0 place-items-center rounded-lg transition-colors duration-fast ease-standard hover:bg-subtle";

/**
 * 우측 유틸바 (64px) — daou-survey/08-shell-extra.md "우측 유틸바" 실측.
 * 원본 이름 organizer, `--doa-organizer-w: 4rem`.
 *
 *   폭 64 · 흰 배경 · 상단바 아래 전체 높이 · 화면 우측 고정 ·
 *   **경계선 없음** — 모듈 화면의 흰 시트와는 같은 색이라 이어져 보이고,
 *   홈(canvas #edf0f3)에서는 색 경계가 곧 구분선이다.
 *
 *   상단(실측 y): 접기 토글 글리프 20 at y82 · 메모 32 at y124 · + 32 at y197
 *   하단 고정: 32 버튼 2개 at y809 · y845 (4px 간격)
 *
 * 우리 매핑(08 "우리 매핑" 줄 그대로):
 *   접기 = 유틸바 자체 접힘(0px) — 우측 가장자리 손잡이로 복원
 *   메모 = 기능 없음 → disabled 톤 + "메모 준비중" 툴팁 (죽은 화면 대신 스텁)
 *   +    = 빠른 등록 → /approvals/new
 *   문의 = 기능 없음 → "문의 준비중" 툴팁
 *   ⚙   = 관리자만 /admin, 그 외 /profile
 *
 * 열림 상태는 AppShell이 소유한다 — 본문 우측 여백(md:pr-16)이 함께
 * 움직여야 하기 때문. 원본 셸이 min-width 1440 데스크톱 전용이라
 * 유틸바도 md 미만에서는 그리지 않는다.
 */
export function UtilityRail({
  role,
  open,
  onToggle,
}: {
  role: RoleName;
  open: boolean;
  onToggle: () => void;
}) {
  if (!open) {
    /*
     * 접힌 상태 — 바(64px)는 사라지고 다시 여는 손잡이만 우측 가장자리에
     * 남긴다. 손잡이 세로 위치는 열려 있을 때의 접기 토글과 같은 높이
     * (topbar+16)라 토글이 "제자리에서" 뒤집히는 것으로 읽힌다.
     * hairline은 원본 스펙 외지만, 흰 시트 위에서 손잡이 윤곽이
     * 사라지지 않게 하는 최소 장치다.
     */
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="유틸바 펼치기"
        title="유틸바 펼치기"
        className="fixed right-0 top-[calc(theme(spacing.topbar)+16px)] z-20 hidden h-8 w-5 place-items-center rounded-l-lg border border-r-0 border-line bg-surface text-muted transition-colors duration-fast ease-standard hover:text-ink md:grid"
      >
        <PanelRightOpen className="size-4" strokeWidth={1.75} aria-hidden />
      </button>
    );
  }

  return (
    <aside
      aria-label="유틸리티 바"
      className="fixed right-0 top-topbar z-20 hidden h-[calc(100dvh-theme(spacing.topbar))] w-16 flex-col items-center bg-surface md:flex"
    >
      {/* 접기 토글 — 실측 글리프 20 at y82 → 32 버튼 상단 y76 = topbar+16 */}
      <button
        type="button"
        onClick={onToggle}
        aria-label="유틸바 접기"
        title="유틸바 접기"
        className={cn(UTIL_BTN, "mt-4 text-ink-sub")}
      >
        <PanelRightClose className="size-5" strokeWidth={1.75} aria-hidden />
      </button>

      {/* 메모 — 실측 y124: 토글 하단(y108)과 16px 간격 */}
      <StubButton
        icon={StickyNote}
        label="메모"
        note="메모 준비중"
        className="mt-4"
      />

      {/* + 빠른 등록 — 실측 y197: 메모 하단(y156)과 41px → 4px 그리드 40 */}
      <Link
        href="/approvals/new"
        aria-label="빠른 등록 — 새 결재 작성"
        title="빠른 등록"
        className={cn(UTIL_BTN, "mt-10 text-ink-sub")}
      >
        <Plus className="size-5" strokeWidth={1.75} aria-hidden />
      </Link>

      {/*
        하단 고정 — 실측 y809/y845(간격 4px). 바닥 여백은 실측이 뷰포트
        높이에 묶여 있어 상단 리듬과 같은 16px로 둔다.
      */}
      <div className="mt-auto flex shrink-0 flex-col items-center gap-1 pb-4">
        <StubButton
          icon={MessageCircleQuestion}
          label="문의"
          note="문의 준비중"
        />
        <Link
          href={role === "system_admin" ? "/admin" : "/profile"}
          aria-label="설정"
          title="설정"
          className={cn(UTIL_BTN, "text-ink-sub")}
        >
          <Settings className="size-5" strokeWidth={1.75} aria-hidden />
        </Link>
      </div>
    </aside>
  );
}

/**
 * 기능 없는 자리의 스텁 — 죽은 링크 대신 muted 톤 + 클릭 시 "준비중" 툴팁.
 * Topbar 도움말과 같은 문법(bg-ink 말풍선)이되, 우측 고정 바라 왼쪽으로 띄운다.
 * disabled 속성을 쓰지 않는 이유: disabled면 클릭·포커스가 죽어서
 * "왜 안 되지"에 답할 기회(툴팁) 자체가 사라진다.
 */
function StubButton({
  icon: Icon,
  label,
  note,
  className,
}: {
  icon: LucideIcon;
  label: string;
  note: string;
  className?: string;
}) {
  const [tipOpen, setTipOpen] = useState(false);

  return (
    <div className={cn("relative shrink-0", className)}>
      <button
        type="button"
        onClick={() => setTipOpen((prev) => !prev)}
        onBlur={() => setTipOpen(false)}
        aria-label={label}
        title={note}
        className={cn(UTIL_BTN, "text-muted")}
      >
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      </button>
      {tipOpen ? (
        <div
          role="status"
          className="absolute right-[calc(100%+6px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-sm bg-ink px-2.5 py-1.5 text-micro text-white shadow-pop"
        >
          {note}
        </div>
      ) : null}
    </div>
  );
}
