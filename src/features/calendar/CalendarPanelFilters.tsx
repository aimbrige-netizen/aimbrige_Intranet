"use client";

import Link from "next/link";
import { Check, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { PanelPortal } from "@/components/layout/ModulePanel";
import {
  PANEL_EXTRA_SLOT,
  PANEL_WIDGET_SLOT,
} from "@/components/layout/panel-slots";
import { EVENT_COLORS } from "@/features/calendar/colors";
import type { CalendarItemKind } from "@/types/db";

/**
 * 모듈 패널의 캘린더 종류 필터 (09-calendar.md 패널 3~7).
 *
 * 왜 "캘린더 화면이 자체 좌측 열을 그리는" 방식이 아니라 포털인가:
 *  - ModulePanel은 캘린더 모듈에서 이미 그려진다(nav.ts sections가 있음).
 *    화면이 자체 열을 세우려면 그 패널을 꺼야 하는데, 패널 유무 판정
 *    (nav.ts hasPanel)은 AppShell의 본문 들여쓰기(pl-shell)·흰 시트와
 *    한 몸이라, 캘린더만 끄면 /admin/holidays·/admin/resources 같은
 *    같은 모듈의 다른 화면이 패널을 잃거나 fixed aside가 두 장 겹친다.
 *  - ModulePanel에는 이미 이런 용도의 포털 슬롯이 있고(board/attendance
 *    layout이 같은 방식), 필터 상태(hidden Set)는 CalendarBoard의 클라이언트
 *    상태라 포털이면 상태를 옮기지 않고 그대로 잇는다. 셸 파일 무수정.
 *
 * 구조(09): "내 캘린더" 섹션(내 일정·참석 일정) → "전사 캘린더" 섹션(전사일정)
 * → 구분선 → 연차·휴가 / 출장·재택 / 마일스톤 / 리소스 예약 행.
 * 데이터가 스코프 단위로 조회되므로(kindsForScope) 지금 스코프에 없는 종류는
 * 행을 두지 않는다 — 아무것도 거르지 못하는 죽은 체크박스를 보여주는 것보다
 * 섹션이 비는 쪽이 정직하다(전사 캘린더 섹션은 scope=company에서만 나타난다).
 *
 * 하단 ⚙ "캘린더 환경설정"(09 패널 7)은 관리자 전용 /admin/holidays 링크로,
 * 스크롤과 무관하게 패널 하단에 고정되는 위젯 슬롯에 둔다.
 */

/** "내 캘린더" 섹션으로 묶는 종류 — 내가 만든 것 + 내가 초대받은 것 */
const MINE_KINDS: CalendarItemKind[] = ["personal", "team", "invited"];

export function CalendarPanelFilters({
  kinds,
  hiddenKinds,
  onToggle,
  showSettings,
}: {
  /** 현재 스코프에서 나타날 수 있는 종류 (kindsForScope 결과) */
  kinds: CalendarItemKind[];
  /** 꺼둔 종류 — CalendarBoard의 필터 상태 그대로 */
  hiddenKinds: Set<CalendarItemKind>;
  onToggle: (kind: CalendarItemKind) => void;
  /** 관리자만 하단 ⚙ 캘린더 환경설정 행을 본다 */
  showSettings: boolean;
}) {
  const mine = kinds.filter((kind) => MINE_KINDS.includes(kind));
  const company = kinds.filter((kind) => kind === "company");
  const rest = kinds.filter(
    (kind) => !MINE_KINDS.includes(kind) && kind !== "company",
  );

  return (
    <>
      <PanelPortal slot={PANEL_EXTRA_SLOT}>
        <div className="mb-4">
          <FilterSection title="내 캘린더" kinds={mine} hiddenKinds={hiddenKinds} onToggle={onToggle} />
          {company.length > 0 ? (
            <FilterSection
              title="전사 캘린더"
              kinds={company}
              hiddenKinds={hiddenKinds}
              onToggle={onToggle}
            />
          ) : null}
          {/* 섹션 사이 구분선 — 패널 폭 전체(09). nav의 px-2를 -mx-2로 상쇄 */}
          <div className="-mx-2 my-3 border-t border-line-strong" aria-hidden />
          <FilterSection kinds={rest} hiddenKinds={hiddenKinds} onToggle={onToggle} />
        </div>
      </PanelPortal>

      {showSettings ? (
        <PanelPortal slot={PANEL_WIDGET_SLOT}>
          {/* 위젯 슬롯 자체가 border-t로 갈라져 하단 고정된다 — 09의 하단 ⚙ 행 */}
          <Link
            href="/admin/holidays"
            className="flex h-8 items-center gap-2 rounded-card px-2 text-body-sm text-ink transition-colors duration-fast ease-standard hover:bg-canvas-hover"
          >
            <Settings className="size-4 shrink-0 text-muted" aria-hidden />
            캘린더 환경설정
          </Link>
        </PanelPortal>
      ) : null}
    </>
  );
}

function FilterSection({
  title,
  kinds,
  hiddenKinds,
  onToggle,
}: {
  title?: string;
  kinds: CalendarItemKind[];
  hiddenKinds: Set<CalendarItemKind>;
  onToggle: (kind: CalendarItemKind) => void;
}) {
  if (kinds.length === 0) return null;

  return (
    <div className="mb-2 last:mb-0">
      {/* 섹션 제목 14/600 rgb(51,51,51) (09) — ModulePanel의 PanelSection과 같은 급 */}
      {title ? (
        <p className="px-2 pb-1 text-body-sm font-semibold text-ink-sub">
          {title}
        </p>
      ) : null}
      <ul>
        {kinds.map((kind) => (
          <FilterRow
            key={kind}
            kind={kind}
            checked={!hiddenKinds.has(kind)}
            onToggle={() => onToggle(kind)}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * 체크박스 행 — 09 실측: 체크박스 16×16 radius 4 · 체크됨 = #333 채움 + 흰 체크 ·
 * 라벨 14/400 · 우측 색 점(캘린더 색 = colors.ts의 dot 축 그대로).
 */
function FilterRow({
  kind,
  checked,
  onToggle,
}: {
  kind: CalendarItemKind;
  checked: boolean;
  onToggle: () => void;
}) {
  const color = EVENT_COLORS[kind];

  return (
    <li>
      <label className="flex h-8 cursor-pointer select-none items-center gap-2 rounded-card px-2 text-body-sm text-ink transition-colors duration-fast ease-standard hover:bg-canvas-hover">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="peer sr-only"
        />
        <span
          className={cn(
            "grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors duration-fast ease-standard peer-focus-visible:ring-2 peer-focus-visible:ring-primary/20",
            checked
              ? "border-check bg-check" // #333333 — 09 실측 토큰
              : "border-line-strong bg-surface",
          )}
          aria-hidden
        >
          {checked ? (
            <Check className="size-3 text-white" strokeWidth={3} aria-hidden />
          ) : null}
        </span>
        <span className="min-w-0 flex-1 truncate">{color.label}</span>
        {/* 우측 색 점 — 칩·표와 같은 colors.ts dot 축(테두리형 종류는 테두리 점) */}
        <span
          className={cn("size-2 shrink-0 rounded-full", color.dot)}
          aria-hidden
        />
      </label>
    </li>
  );
}
