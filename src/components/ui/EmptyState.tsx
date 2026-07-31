import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * 빈 상태. 스펙 01의 "아직 연동되지 않았습니다" 위젯 껍데기에도 사용한다.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-1.5 py-6" : "gap-2 py-12",
        className,
      )}
    >
      {Icon ? (
        <Icon
          className={cn("text-line", compact ? "size-6" : "size-8")}
          aria-hidden
        />
      ) : null}
      <p className="text-body font-bold text-ink">{title}</p>
      {description ? (
        <p className="max-w-sm text-caption">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
