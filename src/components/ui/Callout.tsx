import {
  CircleAlert,
  Info,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 안내·경고 블록.
 *
 * "테두리 + 옅은 면 + 아이콘 + 문구" 조합이 8곳에 각각 다른 클래스 문자열로
 * 복제돼 있었다. 톤마다 아이콘과 대비가 제각각이라 같은 심각도인데도
 * 화면마다 다르게 보였다.
 *
 * 주의: 여기에 개발 진행 상황("아직 미구현", "마이그레이션 실행 필요")을
 * 적지 않는다. 그건 PENDING.md의 몫이고, 제품 화면에 적으면 미완성으로 읽힌다.
 */

type CalloutTone = "neutral" | "info" | "warn" | "danger" | "success";

const TONES: Record<
  CalloutTone,
  { shell: string; icon: string; defaultIcon: LucideIcon }
> = {
  neutral: {
    shell: "border-line bg-subtle",
    icon: "text-muted",
    defaultIcon: Info,
  },
  info: {
    shell: "border-info/30 bg-info-light",
    icon: "text-info-ink",
    defaultIcon: Info,
  },
  warn: {
    shell: "border-warn/40 bg-warn-light",
    icon: "text-warn-ink",
    defaultIcon: TriangleAlert,
  },
  danger: {
    shell: "border-danger/30 bg-danger-light",
    icon: "text-danger-ink",
    defaultIcon: CircleAlert,
  },
  success: {
    shell: "border-success/30 bg-success-light",
    icon: "text-success-ink",
    defaultIcon: ShieldAlert,
  },
};

export function Callout({
  tone = "neutral",
  title,
  icon,
  action,
  children,
  className,
}: {
  tone?: CalloutTone;
  title?: React.ReactNode;
  /** 기본 아이콘을 바꾸고 싶을 때. null이면 아이콘 없음 */
  icon?: LucideIcon | null;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const meta = TONES[tone];
  const Icon = icon === null ? null : (icon ?? meta.defaultIcon);

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      // 2026-08-07 UI/UX 감사: danger 외 톤(success/warn/info/neutral)은
      // 스크린리더에 아예 안 읽혔다. role="status"+aria-live="polite" 추가.
      aria-live={tone === "danger" ? undefined : "polite"}
      className={cn(
        "flex items-start gap-2.5 rounded-card border px-4 py-3",
        meta.shell,
        className,
      )}
    >
      {Icon ? (
        <Icon className={cn("mt-0.5 size-4 shrink-0", meta.icon)} aria-hidden />
      ) : null}
      <div className="min-w-0 flex-1">
        {title ? (
          <p className="text-body-sm font-bold text-ink">{title}</p>
        ) : null}
        {children ? (
          <div
            className={cn(
              "text-label leading-relaxed text-ink",
              title && "mt-0.5",
            )}
          >
            {children}
          </div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
