import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * 빈 상태.
 *
 * action 슬롯은 원래도 있었는데 12곳 전부 비워둔 채로 썼다. 그래서 사용자가
 * 빈 화면에 도착하면 다음 행동으로 갈 버튼이 없었다. 빈 상태는 막다른 길이
 * 아니라 시작점이어야 한다.
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
          className={cn("text-line-strong", compact ? "size-6" : "size-8")}
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

/**
 * 표가 비었을 때 쓰는 행.
 *
 * EmptyState로 표 전체를 갈아끼우면 thead까지 사라져서, 신규 계정은
 * 이 표가 무엇을 추적하는 표인지 알 방법이 없어진다. 컬럼 구조는 남기고
 * 본문 자리에만 안내를 넣는다.
 */
export function TableEmptyRow({
  colSpan,
  icon,
  title,
  description,
  action,
}: {
  colSpan: number;
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="!border-b-0 px-4 py-10">
        <EmptyState
          icon={icon}
          title={title}
          description={description}
          action={action}
          compact
        />
      </td>
    </tr>
  );
}
