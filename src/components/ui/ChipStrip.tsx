import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Chip / DayStrip — 기간을 칸으로 쪼개 각 칸의 상태를 칩으로 보여준다.
 *
 * Badge는 px-2 py-0.5 한 줄짜리 규격이라 "8h 30m" 아래 "출 08:00 · 퇴 17:30"
 * 두 줄을 담을 수 없었다. 표만으로는 한 주의 흐름이 보이지 않아서,
 * 표 위에 항상 이 스트립을 둔다.
 *
 * 훅을 쓰지 않으므로 서버 컴포넌트에서도 그대로 렌더할 수 있다.
 * 선택 동작이 필요하면 href(서버)나 onSelect(클라이언트) 중 하나를 준다.
 */

export type ChipTone =
  | "neutral"
  | "primary"
  | "success"
  | "info"
  | "warn"
  | "danger"
  | "ghost";

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: "bg-subtle text-ink",
  primary: "bg-primary-light text-primary",
  /*
   * 상태 톤의 색 글자는 Badge(틴트 위 ink)와 달리 유지한다 — 이 칩의 문법은
   * chip(06 L45)이 아니라 **tag-attendance**(06 L52-58)다: 옅은 면 위에
   * 상태색 글자(출근 #00af52 · 휴가 #0d99ff · 결근 #ff502a…).
   * 07-modules.md 근태 태그 절이 이 글자색을 톤별로 명시한다.
   * 대비 2.5~2.7:1은 원본 코드값의 결과다 — "원본은 4.5:1을 고집하지
   * 않는다. 코드값을 따른다."(tailwind.config.ts)
   */
  success: "bg-success-light text-success-ink",
  info: "bg-info-light text-info-ink",
  warn: "bg-warn-light text-warn-ink",
  danger: "bg-danger-light text-danger-ink",
  // 기록이 없는 칸의 골격 유지용 — 값이 아니라 "여기에 들어올 자리"라는 표시
  ghost: "border border-dashed border-line-strong text-muted",
};

export interface ChipLine {
  text: React.ReactNode;
  /** 두 번째 줄처럼 보조적인 값은 흐리게 */
  dim?: boolean;
}

/** 1~2줄을 담을 수 있는 칩. 한 줄이면 문자열만 넘겨도 된다 */
export function Chip({
  lines,
  tone = "neutral",
  title,
  className,
}: {
  lines: (ChipLine | string)[];
  tone?: ChipTone;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "block w-full rounded-sm px-1.5 py-1 text-left",
        CHIP_TONES[tone],
        className,
      )}
    >
      {lines.map((line, i) => {
        const item: ChipLine = typeof line === "string" ? { text: line } : line;
        return (
          <span
            key={i}
            className={cn(
              "block truncate tabular-nums",
              i === 0 ? "text-nano font-bold" : "text-nano",
              item.dim && "opacity-70",
            )}
          >
            {item.text}
          </span>
        );
      })}
    </span>
  );
}

export interface StripChip {
  lines: (ChipLine | string)[];
  tone?: ChipTone;
  title?: string;
}

export interface StripDay {
  /** YYYY-MM-DD */
  date: string;
  chips?: StripChip[];
  /** 이번 달이 아니거나 입사 전 등, 판단 대상이 아닌 칸 */
  muted?: boolean;
  /** 공휴일 이름. 있으면 날짜를 빨강으로 칠하고 이름을 붙인다 */
  holiday?: string;
  selected?: boolean;
  href?: string;
  onSelect?: (date: string) => void;
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/**
 * 요일 숫자 색. 한국 캘린더 기본 규칙 — 일요일·공휴일 빨강, 토요일 파랑.
 */
function weekdayToneClass(weekday: number, holiday: boolean, muted: boolean) {
  if (muted) return "text-muted/50";
  if (holiday || weekday === 0) return "text-danger";
  if (weekday === 6) return "text-info";
  return "text-ink";
}

/** UTC 파싱을 피하려고 문자열을 직접 쪼갠다 (로컬 타임존 밀림 방지) */
function weekdayOf(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function DayStrip({
  days,
  emptyLabel = "기록 없음",
  showWeekday = true,
  className,
}: {
  days: StripDay[];
  /** 칩이 하나도 없는 칸에 그릴 점선 자리표시. null이면 빈 칸으로 둔다 */
  emptyLabel?: string | null;
  showWeekday?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-7 gap-1.5", className)}>
      {days.map((day) => {
        const weekday = weekdayOf(day.date);
        const dayNumber = Number(day.date.slice(8, 10));
        const interactive = !!(day.href || day.onSelect);

        const inner = (
          <>
            <span className="mb-1.5 flex items-baseline gap-1">
              <span
                className={cn(
                  "text-body-sm font-bold tabular-nums",
                  weekdayToneClass(weekday, !!day.holiday, !!day.muted),
                )}
              >
                {dayNumber}
              </span>
              {showWeekday ? (
                <span
                  className={cn(
                    "text-nano",
                    weekdayToneClass(weekday, !!day.holiday, !!day.muted),
                  )}
                >
                  {WEEKDAY_LABELS[weekday]}
                </span>
              ) : null}
              {day.holiday ? (
                <span className="truncate text-nano text-danger">
                  {day.holiday}
                </span>
              ) : null}
            </span>

            <span className="flex flex-col gap-1">
              {day.chips?.length ? (
                day.chips.map((chip, i) => (
                  <Chip
                    key={i}
                    lines={chip.lines}
                    tone={chip.tone}
                    title={chip.title}
                  />
                ))
              ) : emptyLabel && !day.muted ? (
                <Chip lines={[emptyLabel]} tone="ghost" />
              ) : null}
            </span>
          </>
        );

        /*
          선택된 칸은 흰 카드로 한 단계 떠오른다.
          같은 흰 면 위에서는 테두리만으로 층이 구분되지 않아 raised를 쓴다.
        */
        const cellClass = cn(
          "flex min-h-24 flex-col rounded-card border p-2 text-left transition-colors duration-fast ease-standard",
          day.selected
            ? "border-line-strong bg-surface shadow-raised"
            : "border-transparent",
          interactive && !day.selected && "hover:bg-subtle",
          day.muted && "opacity-60",
        );

        if (day.href) {
          return (
            <Link key={day.date} href={day.href} className={cellClass}>
              {inner}
            </Link>
          );
        }

        if (day.onSelect) {
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => day.onSelect?.(day.date)}
              aria-pressed={day.selected}
              className={cellClass}
            >
              {inner}
            </button>
          );
        }

        return (
          <div key={day.date} className={cellClass}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
