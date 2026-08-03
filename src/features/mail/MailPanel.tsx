"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  CalendarClock,
  ExternalLink,
  FileText,
  Inbox,
  Mail,
  MailCheck,
  PenLine,
  Send,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { LinkButton } from "@/components/ui/Button";
import { Meter } from "@/components/ui/Progress";
import { PanelPortal } from "@/components/layout/ModulePanel";
import {
  PANEL_EXTRA_SLOT,
  PANEL_WIDGET_SLOT,
} from "@/components/layout/panel-slots";
import { cn } from "@/lib/utils";
import { gmailInboxUrl } from "@/features/mail/format";
import {
  formatMailSize,
  type MailboxKey,
  type MailQuickFilter,
} from "@/features/mail/MailList";

/**
 * 메일 모듈 패널 (daou-survey/12-mail.md 패널 실측).
 *
 * 캘린더(CalendarPanelFilters)와 같은 포털 문법 — ModulePanel의 슬롯에
 * 꽂는다. 셀 파일은 건드리지 않는다.
 *
 * nav.ts의 mail 모듈이 패널 골격을 세운다 — 정적 앵커 섹션(받은메일함)은
 * panelHidden이라 데스크톱 패널에는 이 포털 내용만 보인다(중복 행 없음).
 *
 * 메일함 구성은 구현 결정(12-mail.md)대로: 받은/보낸/수신확인/임시보관/휴지통.
 * 스팸·예약메일함은 1차 제외, 외부메일은 Gmail 새 탭 링크가 자리를 지킨다.
 */

const MAILBOXES: {
  key: MailboxKey;
  label: string;
  href: string;
  icon: LucideIcon;
}[] = [
  { key: "inbox", label: "받은메일함", href: "/mail", icon: Inbox },
  { key: "sent", label: "보낸메일함", href: "/mail?box=sent", icon: Send },
  {
    key: "receipts",
    label: "수신확인",
    href: "/mail?box=receipts",
    icon: MailCheck,
  },
  {
    key: "drafts",
    label: "임시보관함",
    href: "/mail?box=drafts",
    icon: FileText,
  },
  { key: "trash", label: "휴지통", href: "/mail?box=trash", icon: Trash2 },
];

/** 빠른검색 — 구현 결정(12-mail.md): 안읽음·별표·오늘 3종 (원본 9종 중 1차분) */
const QUICK_FILTERS: {
  key: MailQuickFilter;
  label: string;
  href: string;
  icon: LucideIcon;
}[] = [
  { key: "unread", label: "안읽은 메일", href: "/mail?filter=unread", icon: Mail },
  {
    key: "starred",
    label: "별표 메일",
    href: "/mail?filter=starred",
    icon: Star,
  },
  {
    key: "today",
    label: "오늘 온 메일",
    href: "/mail?filter=today",
    icon: CalendarClock,
  },
];

export function MailPanel({
  email,
  unreadCount,
  usedBytes,
  quotaBytes,
}: {
  /** Gmail 새 탭 링크용 회사 계정 (기존 gmailInboxUrl 규약) */
  email: string;
  /** 받은메일함 안읽음 수 — 배지. 0이면 배지 없음 */
  unreadCount: number;
  usedBytes: number;
  quotaBytes: number;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const boxParam = params.get("box");
  const box: MailboxKey =
    boxParam === "sent" ||
    boxParam === "receipts" ||
    boxParam === "drafts" ||
    boxParam === "trash"
      ? boxParam
      : "inbox";
  const filter = params.get("filter");

  const onList = pathname === "/mail";
  // 읽기 화면(/mail/[id])에서는 받은메일함을 활성으로 둔다 — 1차 단순화.
  const onRead =
    pathname.startsWith("/mail/") && !pathname.startsWith("/mail/compose");

  return (
    <>
      <PanelPortal slot={PANEL_EXTRA_SLOT}>
        <div className="mb-4">
          {/*
            "메일쓰기" 주요 버튼 — 실측 215×48 · radius 12 · 흰 바탕 ·
            border 1px rgb(82,82,83) · 16/600. 모듈 공통(212×48 · 14/400 ·
            line-dark #4a4b4c)과 굵기·글자가 다른 **유일한 예외**라
            ModulePanel primaryAction 대신 여기서 직접 그린다.
            실측 테두리 #525253(gray-80)은 기존 토큰에 없다 — 최근접
            line-dark(#4a4b4c)로 근사. TODO(리뷰): gray-80 토큰 추가 검토.
            폭은 모듈 공통 문법대로 패널 260 − 24×2 = 212 full-width
            (실측 215와 3px 차이는 원본 패딩 오차로 본다).
            nav의 px-2(8px)를 -mx-2로 상쇄하고 px-6(24px)을 다시 잡는다.
          */}
          <div className="-mx-2 mb-3 px-6">
            <LinkButton
              href="/mail/compose"
              size="large"
              variant="secondary"
              className="w-full border-line-dark text-[16px] font-semibold"
            >
              <PenLine className="size-4" aria-hidden />
              메일쓰기
            </LinkButton>
          </div>

          <PanelSection title="메일함">
            {MAILBOXES.map((item) => (
              <PanelRow
                key={item.key}
                href={item.href}
                icon={item.icon}
                label={item.label}
                active={
                  (onList && !filter && box === item.key) ||
                  (onRead && item.key === "inbox")
                }
                badge={
                  item.key === "inbox" && unreadCount > 0
                    ? unreadCount
                    : undefined
                }
              />
            ))}
          </PanelSection>

          <PanelSection title="빠른검색">
            {QUICK_FILTERS.map((item) => (
              <PanelRow
                key={item.key}
                href={item.href}
                icon={item.icon}
                label={item.label}
                active={onList && filter === item.key}
              />
            ))}
          </PanelSection>
        </div>
      </PanelPortal>

      {/* 하단 상주: 용량 게이지 + Gmail 새 탭 — 위젯 슬롯(스크롤 무관 고정) */}
      <PanelPortal slot={PANEL_WIDGET_SLOT}>
        <div className="px-2 pb-1 pt-0.5">
          <Meter
            value={usedBytes}
            max={quotaBytes}
            size="sm"
            tone="brand"
            aria-label="메일 첨부 용량"
          />
          {/* 실측 11px #7a7b7d — text-nano + band 토큰 그대로 */}
          <p className="mt-1.5 text-nano text-band">
            {formatMailSize(quotaBytes)} 중 {formatMailSize(usedBytes)} 사용
          </p>
        </div>
        {/*
          외부메일(Gmail) — Google OAuth 승인 전까지는 새 탭 링크가 자리를
          지킨다(12-mail.md 구현 결정). 연동이 열리면 어댑터로 교체.
        */}
        <a
          href={gmailInboxUrl(email)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 flex h-8 items-center gap-2 rounded-card px-2 text-body-sm text-ink transition-colors duration-fast ease-standard hover:bg-canvas-hover"
        >
          <ExternalLink className="size-4 shrink-0 text-muted" aria-hidden />
          Gmail 열기
        </a>
      </PanelPortal>
    </>
  );
}

/** ModulePanel의 PanelSection과 같은 급 — 제목 14/600 ink-sub */
function PanelSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="px-2 pb-1 text-body-sm font-semibold text-ink-sub">
        {title}
      </p>
      <ul>{children}</ul>
    </div>
  );
}

/**
 * 패널 행 — ModulePanel PanelLink 문법 복제(행 32px · 14/400 · 활성은
 * 색이 아니라 굵기 600). PanelLinkList를 안 쓰는 이유: isChildActive가
 * ?box= 쿼리를 모른 채 경로만 보므로 /mail?box=sent에서 받은메일함까지
 * 활성이 된다 — 메일함 판정은 이 파일이 직접 한다.
 */
function PanelRow({
  href,
  icon: Icon,
  label,
  active,
  badge,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-8 items-center gap-2 rounded-card px-2 text-body-sm transition-colors duration-fast ease-standard hover:bg-canvas-hover",
          active ? "font-semibold text-ink-sub" : "text-ink",
        )}
      >
        <Icon
          className={cn(
            "size-4 shrink-0",
            active ? "text-ink-sub" : "text-muted",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge !== undefined ? (
          /* 안읽음 수 배지 — 원본 badge accent(빨강 카운트 #ff502a = danger-ink) */
          <span className="shrink-0 rounded-pill bg-danger-ink px-1.5 py-0.5 text-nano font-medium leading-none text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
