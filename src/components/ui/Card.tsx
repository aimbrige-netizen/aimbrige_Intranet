import { cn } from "@/lib/utils";

/**
 * 카드: radius 8px + hairline, 그림자 없음 (디자인시스템 v2.0)
 *
 * density="compact"를 추가한 이유: 기본 패딩(px-5 py-4)이면 헤더+바디만으로
 * 세로 103px을 먹는다. 지표 밴드나 목록 옆 보조 카드처럼 여러 장을 나열하는
 * 자리에서는 이 여백이 그대로 빈 화면이 된다.
 */
export type CardDensity = "default" | "compact";

const HEADER_PAD: Record<CardDensity, string> = {
  default: "px-5 py-4",
  compact: "px-4 py-2.5",
};

const BODY_PAD: Record<CardDensity, string> = {
  default: "px-5 py-4",
  compact: "px-4 py-3",
};

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <section className={cn("ab-card", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  density = "default",
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  density?: CardDensity;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex items-start justify-between gap-3 border-b border-line",
        HEADER_PAD[density],
        className,
      )}
    >
      <div className="min-w-0">
        <h2
          className={cn(
            "font-bold leading-tight text-ink",
            density === "compact" ? "text-body-sm" : "text-[15px]",
          )}
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-caption">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function CardBody({
  density = "default",
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { density?: CardDensity }) {
  return <div className={cn(BODY_PAD[density], className)} {...props} />;
}

/**
 * 카드 없이 쓰는 섹션 제목.
 * 카드 안에 카드를 넣지 않으려고 분리했다 — 중첩되면 테두리가 두 겹으로 보인다.
 */
export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("mb-2.5 flex items-end justify-between gap-3", className)}
    >
      <div className="min-w-0">
        <h2 className="text-h3 text-ink">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-caption">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
