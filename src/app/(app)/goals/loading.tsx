import { SkeletonStats, Skeleton } from "@/components/ui/Skeleton";

/** 지표 4장 + 상태 분포 + 카드 그리드를 기다리는 동안 골격을 남긴다 */
export default function Loading() {
  return (
    <>
      <div className="mb-5">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="mt-2 h-3 w-64" />
      </div>
      <SkeletonStats count={4} />
      <div className="mb-5 rounded-card border border-line bg-surface p-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-2 w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rounded-card border border-line bg-surface p-4">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="mt-3 h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-4 h-1 w-full" />
            <Skeleton className="mt-3 h-7 w-40" />
          </div>
        ))}
      </div>
    </>
  );
}
