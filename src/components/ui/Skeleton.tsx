import { cn } from "@/lib/utils";

/**
 * 로딩 자리표시.
 *
 * 앱 전체에 loading.tsx가 하나도 없어서, 서버 컴포넌트가 데이터를 기다리는
 * 동안 화면이 이전 상태로 멈춰 있었다. "데이터가 없다"와 "아직 안 왔다"가
 * 구분되지 않으면 전부 0으로 보이는 인상만 강해진다.
 *
 * prefers-reduced-motion에서는 globals.css가 애니메이션을 접는다.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-sm bg-line", className)}
      {...props}
    />
  );
}

/** 지표 밴드 자리 */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        /*
         * 지표 밴드 카드는 흰 시트 위에서도 hairline 1겹을 유지한다(실화면과
         * 동일 — 시트와 카드 면이 같은 흰색이라 이 선이 유일한 구분선).
         */
        <div key={i} className="rounded-card border border-line bg-surface p-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-3 h-7 w-20" />
          <Skeleton className="mt-3 h-1 w-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * 표 자리 — 헤더 한 줄과 본문 몇 줄의 골격을 유지한다.
 *
 * 실화면 표는 md+ 흰 시트 위 직접 배치(카드 해체 스윕)라, 스켈레톤도
 * md+에서 테두리를 걷어 로딩→로드 전환 때 카드가 사라지는 깜빡임을 없앤다.
 * md 미만은 실화면과 같이 카드 면 유지. 헤더도 회색면이 아니라
 * 실측 표 문법(투명 + 진한 밑줄)을 따른다.
 */
export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface md:rounded-none md:border-0">
      <div className="border-b border-ink-sub px-4 py-3">
        <Skeleton className="h-3 w-24" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-b-0"
        >
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 flex-1" />
        </div>
      ))}
    </div>
  );
}

/** 페이지 전체 자리 — 라우트별 loading.tsx의 기본값 */
export function SkeletonPage({
  stats = 4,
  rows = 6,
}: {
  stats?: number;
  rows?: number;
}) {
  return (
    <>
      <div className="mb-5">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-3 w-64" />
      </div>
      <SkeletonStats count={stats} />
      <SkeletonTable rows={rows} />
    </>
  );
}
