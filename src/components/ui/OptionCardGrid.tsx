import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 선택형 카드 그리드.
 *
 * 휴가 종류·리소스·문서 유형·역할 부여·외부연락처 카테고리 5곳이 전부
 * 드롭다운이었다. 드롭다운은 "무엇을 고를 수 있는지"만 알려주고
 * "고르면 어떻게 되는지"(잔여 며칠, 정원 몇 명, 권한 범위)를 못 보여준다.
 * 가장 위험한 선택인 역할 부여조차 설명 없는 2줄짜리 select였다.
 *
 * 사용 완료·정원 초과 항목은 목록에서 지우지 않고 흐리게 남긴다 —
 * 없어진 건지 못 쓰는 건지 구분돼야 한다.
 */

export interface OptionCardItem<T extends string> {
  value: T;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 카드 하단 메타 줄. 잔여·지급규칙·만료일처럼 선택 판단에 필요한 값 */
  meta?: React.ReactNode[];
  icon?: LucideIcon;
  /** 아이콘 대신 이모지·문자를 쓸 때 */
  emblem?: React.ReactNode;
  disabled?: boolean;
  /** 왜 못 고르는지. "사용완료", "정원 초과" */
  disabledLabel?: string;
}

export function OptionCardGrid<T extends string>({
  options,
  value,
  onChange,
  name,
  columns = 3,
  scroll,
  className,
}: {
  options: OptionCardItem<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** 라디오 그룹 이름 — 폼 안에서 쓸 때 */
  name?: string;
  columns?: 2 | 3 | 4;
  /** true면 줄바꿈 대신 가로 스크롤 */
  scroll?: boolean;
  className?: string;
}) {
  const layout = scroll
    ? "flex snap-x gap-2.5 overflow-x-auto pb-1"
    : cn(
        "grid gap-2.5",
        columns === 2
          ? "grid-cols-1 sm:grid-cols-2"
          : columns === 3
            ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            : "grid-cols-2 lg:grid-cols-4",
      );

  return (
    <div role="radiogroup" aria-label={name} className={cn(layout, className)}>
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-card border p-3 text-left transition-colors duration-fast ease-standard",
              scroll && "w-52 shrink-0 snap-start",
              selected
                ? "border-primary bg-primary-light"
                : "border-line bg-surface hover:border-line-strong",
              option.disabled &&
                "pointer-events-none border-line bg-subtle opacity-60",
            )}
          >
            <span className="flex items-start gap-2">
              {Icon || option.emblem ? (
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-sm text-body-sm",
                    selected
                      ? "bg-white text-primary-ink"
                      : "bg-subtle text-muted",
                  )}
                >
                  {Icon ? <Icon className="size-4" aria-hidden /> : option.emblem}
                </span>
              ) : null}

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "truncate text-body-sm font-bold",
                      selected ? "text-primary-ink" : "text-ink",
                    )}
                  >
                    {option.title}
                  </span>
                  {option.disabled && option.disabledLabel ? (
                    <span className="shrink-0 rounded-sm bg-line px-1.5 py-0.5 text-nano text-muted">
                      {option.disabledLabel}
                    </span>
                  ) : null}
                </span>

                {option.description ? (
                  <span className="mt-0.5 block text-nano leading-relaxed text-muted">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </span>

            {option.meta?.length ? (
              <span className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 border-t border-line pt-2">
                {option.meta.map((m, i) => (
                  <span key={i} className="text-nano tabular-nums text-muted">
                    {m}
                  </span>
                ))}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
