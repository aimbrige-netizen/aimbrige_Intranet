import { Skeleton, SkeletonStats } from "@/components/ui/Skeleton";

/**
 * 캘린더 로딩 자리표시.
 * 격자가 통째로 비어 있는 상태와 "아직 안 왔다"를 구분해 준다.
 */
export default function CalendarLoading() {
  return (
    <>
      <div className="mb-5">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-2 h-3 w-56" />
        <div className="mt-4 flex justify-center">
          <Skeleton className="h-8 w-72" />
        </div>
      </div>

      <SkeletonStats count={4} />

      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-7 w-24 rounded-pill" />
        <Skeleton className="h-7 w-24 rounded-pill" />
        <Skeleton className="h-7 w-24 rounded-pill" />
      </div>

      <div className="rounded-card border border-line bg-surface p-3">
        <div className="grid grid-cols-7 gap-px">
          {Array.from({ length: 42 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-none" />
          ))}
        </div>
      </div>
    </>
  );
}
