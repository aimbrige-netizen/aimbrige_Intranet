"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FileText, Hourglass, Inbox, type LucideIcon } from "lucide-react";
import { PanelPortal } from "@/components/layout/ModulePanel";
import { PANEL_EXTRA_SLOT } from "@/components/layout/panel-slots";
import { cn } from "@/lib/utils";

/**
 * 결재 모듈 패널 "결재하기" 섹션 (daou-survey/15-approval-home.md).
 *
 * 다우 결재 홈에는 본문 지표 밴드가 없다 — 카운트는 전부 패널의
 * "결재하기" 섹션 아래 카운트 행(14/400 · 높이 ~32 · 우측 수)에 있다.
 * 본문에서 걷어낸 StatCard 4칸·진행 미터의 숫자가 여기로 온다:
 * 내 차례 n · 진행중 n · 임시저장 n.
 *
 * 메일(MailPanel)과 같은 포털 문법 — nav.ts의 정적 "결재하기" 섹션은
 * panelHidden 앵커로 남아 hasPanel 판정·모바일 드로어를 맡고, 데스크톱
 * 패널에는 이 포털 내용만 보인다(중복 행 없음).
 *
 * 종전 하단 상주 위젯(ApprovalPanelWidget — 내 차례 미터·최장 대기 문서)은
 * 이 섹션이 대체한다. 같은 숫자가 패널에 두 번 뜨면 어느 쪽이 기준인지
 * 알 수 없고, 원본 패널에도 하단 위젯은 없다. 대기 경과 분포·가장 오래
 * 기다린 문서는 결재 대기함(?tab=inbox)이 그대로 보여 준다.
 */
export function ApprovalPanelSections({
  showInbox,
  myTurn,
  inProgress,
  drafts,
}: {
  /** 결재함 노출 기준 — page.tsx의 canSeeInbox와 같은 판정을 layout이 넘긴다 */
  showInbox: boolean;
  /** 지금 내 차례인 결재 대기 건수 */
  myTurn: number;
  /** 내가 올린 문서 중 진행중 건수 */
  inProgress: number;
  /** 임시저장 건수. null이면 집계 실패 — 0으로 지어내지 않고 수를 접는다 */
  drafts: number | null;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const onInbox = pathname === "/approvals" && params.get("tab") === "inbox";

  return (
    <PanelPortal slot={PANEL_EXTRA_SLOT}>
      <div className="mb-4">
        {/* 섹션 제목 14/600 — ModulePanel PanelSection과 같은 급 */}
        <p className="px-2 pb-1 text-body-sm font-semibold text-ink-sub">
          결재하기
        </p>
        <ul>
          {showInbox ? (
            <CountRow
              href="/approvals?tab=inbox"
              icon={Inbox}
              label="내 차례"
              count={myTurn}
              active={onInbox}
            />
          ) : null}
          {/*
            진행중·임시저장 문서는 결재 홈의 "기안 진행 문서" 표에 있다 —
            두 행 다 홈으로 간다. 카운트 행이지 현재 위치 표시가 아니므로
            홈에서 활성(굵기) 강조는 하지 않는다(다우 카운트 행과 동일).
          */}
          <CountRow
            href="/approvals"
            icon={Hourglass}
            label="진행중"
            count={inProgress}
            active={false}
          />
          <CountRow
            href="/approvals"
            icon={FileText}
            label="임시저장"
            count={drafts ?? undefined}
            active={false}
          />
        </ul>
      </div>
    </PanelPortal>
  );
}

/**
 * 카운트 행 — ModulePanel PanelLink 문법 복제(행 32px · 14/400 · 활성은
 * 색이 아니라 굵기 600 · 우측 수는 배지가 아니라 맨숫자). PanelLinkList를
 * 안 쓰는 이유는 MailPanel.PanelRow와 같다 — isChildActive가 ?tab= 쿼리
 * 조합을 모르는 채 경로만 보면 홈에서 세 행이 동시에 활성이 된다.
 */
function CountRow({
  href,
  icon: Icon,
  label,
  count,
  active,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  /** undefined면 수를 그리지 않는다 — 집계 실패를 0으로 말하지 않는다 */
  count?: number;
  active: boolean;
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
        {count !== undefined ? (
          <span
            className={cn(
              "shrink-0 tabular-nums",
              active ? "text-ink-sub" : "text-muted",
            )}
          >
            {count}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
