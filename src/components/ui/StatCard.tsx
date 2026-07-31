import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 지표 카드 (SEED 기반)
 *
 * SEED 원칙 6 "액센트는 하나": 항목마다 다른 브랜드 색을 만들지 않는다.
 * 브랜드 오렌지는 화면에서 가장 중요한 값 하나에만 쓰고(brand),
 * 나머지는 중립 또는 시맨틱(positive/critical/informative) 유틸리티 색으로 둔다.
 *
 * 원칙 1 "오렌지는 희소하게": 한 화면에 tone="brand"는 하나만 두는 것을 전제로 한다.
 */
export type StatTone =
  | "brand"
  | "neutral"
  | "positive"
  | "critical"
  | "informative";

const ACCENTS: Record<StatTone, { value: string; chip: string }> = {
  brand: { value: "text-primary", chip: "bg-primary-light text-primary" },
  neutral: { value: "text-ink", chip: "bg-subtle text-muted" },
  positive: { value: "text-success", chip: "bg-success/10 text-success" },
  critical: { value: "text-danger", chip: "bg-danger/10 text-danger" },
  informative: { value: "text-info", chip: "bg-info/10 text-info" },
};

export function StatCard({
  label,
  value,
  unit,
  sub,
  tone = "neutral",
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
  /** 브랜드 틴트 배경까지 채워 화면에서 가장 중요한 값 하나를 앞세운다 */
  emphasis?: boolean;
  className?: string;
}) {
  const accent = ACCENTS[tone];

  return (
    <div
      className={cn(
        "rounded-card border p-4",
        emphasis
          ? "border-primary/20 bg-primary-light"
          : "border-line bg-surface",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-label text-muted">{label}</p>
        {Icon ? (
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-sm",
              emphasis ? "bg-white text-primary" : accent.chip,
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
      </div>

      <p className="mt-3 flex items-baseline gap-1">
        <span
          className={cn(
            "text-[28px] font-bold leading-none tabular-nums",
            emphasis ? "text-primary" : accent.value,
          )}
        >
          {value}
        </span>
        {unit ? <span className="text-label text-muted">{unit}</span> : null}
      </p>

      {sub ? <p className="mt-2 truncate text-label text-muted">{sub}</p> : null}
    </div>
  );
}
