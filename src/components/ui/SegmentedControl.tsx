import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 세그먼티드 컨트롤 — 회색 트랙 위에 흰 썸.
 *
 * 선택된 탭을 진한 오렌지로 칠하면 화면당 하나여야 할 주요 액션 버튼과
 * 오렌지가 경합한다. SEED처럼 subtle 트랙 + 흰 썸 + Bold ink로 둔다.
 *
 * 같은 클래스 문자열이 6곳(결재 탭, 근태 승인함, 캘린더 ×3, 조직도, 파일함)에
 * 복제돼 있어 탭 스타일 하나 바꾸려면 6곳을 고쳐야 했다.
 *
 * href를 주면 Link(서버 컴포넌트에서 사용 가능), onChange를 주면 button이 된다.
 */

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: LucideIcon;
  /** 링크형으로 쓸 때의 이동 경로 */
  href?: string;
  /** 라벨 뒤 건수 등 */
  badge?: React.ReactNode;
  disabled?: boolean;
}

const SIZES = {
  small: "px-2.5 py-1 text-label",
  medium: "px-3 py-1.5 text-body-sm",
} as const;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "medium",
  ariaLabel,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange?: (value: T) => void;
  size?: keyof typeof SIZES;
  ariaLabel?: string;
  className?: string;
}) {
  const isTablist = options.every((o) => !!o.href) || !!onChange;

  return (
    <div
      role={isTablist ? "tablist" : undefined}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex rounded-card border border-line bg-subtle p-1",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;

        const itemClass = cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm transition-colors duration-fast ease-standard",
          SIZES[size],
          selected
            ? "bg-surface font-bold text-ink shadow-raised"
            : "text-muted hover:text-ink",
          option.disabled && "pointer-events-none opacity-40",
        );

        const inner = (
          <>
            {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
            {option.label}
            {option.badge !== undefined && option.badge !== null ? (
              <span
                className={cn(
                  "tabular-nums",
                  selected ? "text-primary-ink" : "text-muted",
                )}
              >
                {option.badge}
              </span>
            ) : null}
          </>
        );

        if (option.href && !option.disabled) {
          return (
            <Link
              key={option.value}
              href={option.href}
              role="tab"
              aria-selected={selected}
              className={itemClass}
            >
              {inner}
            </Link>
          );
        }

        /*
         * onClick을 조건부로 붙인다.
         * 이 모듈에는 "use client"가 없어서 서버 컴포넌트에서도 렌더되는데,
         * 그때 DOM 요소에 함수 prop이 있으면 Next가 통째로 막는다
         * ("Event handlers cannot be passed to Client Component props").
         * href가 있어도 disabled면 이 분기로 떨어지므로, 화살표 함수를
         * 항상 만들면 서버 렌더 화면 전체가 죽는다.
         */
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={option.disabled}
            onClick={onChange ? () => onChange(option.value) : undefined}
            className={itemClass}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
