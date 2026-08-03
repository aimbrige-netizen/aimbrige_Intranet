import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 캘린더 콘텐츠 헤더 (09-calendar.md).
 *
 * 공용 PeriodNavigator(14px bold 라벨 + subtle 트랙 세그먼트)와 실측이 달라
 * 캘린더 한정 변형으로 분리한다:
 *  - 날짜 라벨 "2026.08" — 24/500 rgb(51,51,51) (기간 라벨이 화면에서 가장 큰 글자)
 *  - < > 화살표 + 오늘 이동
 *  - 보기 전환 필 세그먼트: 각 49×32 · radius 16 · 13px ·
 *    비활성 #4a4b4c(=line-dark) 투명 바탕 · 활성 #38393a(seg-active) 채움 + 흰 글자.
 *    트랙(테두리·회색 바닥)이 없다 — SegmentedControl을 그대로 쓰지 않는 이유.
 *
 * 훅 없음 — 서버 컴포넌트(page.tsx)에서 그대로 쓴다.
 */

const STEP_CLASS =
  "grid size-8 place-items-center rounded-sm text-muted transition-colors duration-fast ease-standard hover:bg-subtle hover:text-ink";

export function CalendarHeader({
  label,
  prevHref,
  nextHref,
  todayHref,
  atToday,
  active,
  segments,
  className,
}: {
  /** "2026.08" (월간) 또는 "2026.08.02 ~ 2026.08.08" */
  label: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  /** 오늘이 이미 표시 기간 안이면 [오늘]을 비활성화한다 */
  atToday?: boolean;
  /** 현재 보기 (segments의 value와 비교) */
  active: string;
  segments: { value: string; label: string; href: string }[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <div className="flex items-center gap-1">
        <Link href={prevHref} aria-label="이전 기간" className={STEP_CLASS}>
          <ChevronLeft className="size-5" aria-hidden />
        </Link>

        {/* 24/500 — h1 스케일(24/600)과 굵기가 달라 리터럴로 둔다. 09 실측 */}
        <p className="px-1 text-center text-[24px] font-medium leading-[36px] tracking-[-0.48px] tabular-nums text-ink-sub">
          {label}
        </p>

        <Link href={nextHref} aria-label="다음 기간" className={STEP_CLASS}>
          <ChevronRight className="size-5" aria-hidden />
        </Link>

        {atToday ? (
          <button
            type="button"
            disabled
            className="ml-1 rounded-sm border border-line px-2.5 py-1 text-label text-muted"
          >
            오늘
          </button>
        ) : (
          <Link
            href={todayHref}
            className="ml-1 rounded-sm border border-line-strong px-2.5 py-1 text-label text-ink transition-colors duration-fast ease-standard hover:bg-subtle"
          >
            오늘
          </Link>
        )}
      </div>

      <div
        role="tablist"
        aria-label="보기 전환"
        className="ml-auto flex items-center"
      >
        {segments.map((segment) => {
          const selected = segment.value === active;
          return (
            <Link
              key={segment.value}
              href={segment.href}
              role="tab"
              aria-selected={selected}
              className={cn(
                // 49×32 필 — 09 실측 그대로. radius 16은 우리 스케일에 없어 리터럴
                "grid h-8 w-[49px] place-items-center whitespace-nowrap rounded-[16px] text-label transition-colors duration-fast ease-standard",
                selected
                  ? "bg-seg-active text-white" // #38393a — 09 실측 토큰
                  : "text-line-dark hover:bg-subtle", // 비활성 #4a4b4c = line-dark
              )}
            >
              {segment.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
