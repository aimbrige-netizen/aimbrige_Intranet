import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 지표 카드 — 큰 숫자 + 톤별 색으로 무엇이 중요한지 한눈에 보이게 한다.
 *
 * 수치를 표 형태로 나열하면 전부 같은 무게로 읽혀서 정작 봐야 할 값이 묻힌다.
 * 그래서 값은 크게, 성격은 색으로 구분한다(디자인시스템 v1.2 지표 카드).
 */
export type StatTone = "sky" | "mint" | "peach" | "lavender" | "rose" | "slate";

const TONES: Record<StatTone, { chip: string; value: string }> = {
  sky: { chip: "bg-tint-sky text-tint-sky-ink", value: "text-tint-sky-ink" },
  mint: { chip: "bg-tint-mint text-tint-mint-ink", value: "text-tint-mint-ink" },
  peach: {
    chip: "bg-tint-peach text-tint-peach-ink",
    value: "text-tint-peach-ink",
  },
  lavender: {
    chip: "bg-tint-lavender text-tint-lavender-ink",
    value: "text-tint-lavender-ink",
  },
  rose: { chip: "bg-tint-rose text-tint-rose-ink", value: "text-tint-rose-ink" },
  slate: {
    chip: "bg-tint-slate text-tint-slate-ink",
    value: "text-tint-slate-ink",
  },
};

export function StatCard({
  label,
  value,
  unit,
  sub,
  tone = "slate",
  icon: Icon,
  emphasis,
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
  tone?: StatTone;
  icon?: LucideIcon;
  /** 배경까지 톤으로 채워 더 강조한다 */
  emphasis?: boolean;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      className={cn(
        "rounded-card border p-4 transition-colors",
        emphasis
          ? cn(t.chip, "border-transparent")
          : "border-line bg-surface shadow-card",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className={cn(
            "text-label font-medium",
            emphasis ? "opacity-80" : "text-muted",
          )}
        >
          {label}
        </p>
        {Icon ? (
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-lg",
              emphasis ? "bg-white/50" : t.chip,
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </span>
        ) : null}
      </div>

      <p className="mt-2 flex items-baseline gap-1">
        <span
          className={cn(
            "text-[26px] font-bold leading-none tabular-nums",
            emphasis ? "" : t.value,
          )}
        >
          {value}
        </span>
        {unit ? (
          <span
            className={cn(
              "text-label",
              emphasis ? "opacity-70" : "text-muted",
            )}
          >
            {unit}
          </span>
        ) : null}
      </p>

      {sub ? (
        <p
          className={cn(
            "mt-1.5 truncate text-label",
            emphasis ? "opacity-70" : "text-muted",
          )}
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
}
