import { Skeleton, SkeletonStats, SkeletonTable } from "@/components/ui/Skeleton";

/** 제목 + 지표 4장 + 개요 카드 + 섹션 탭·표의 골격을 남긴다 */
export default function Loading() {
  return (
    <>
      <div className="mb-5">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-3 w-80" />
      </div>
      <SkeletonStats count={4} />
      <div className="mb-5 rounded-card border border-line bg-surface p-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-2.5 w-full" />
        <Skeleton className="mt-4 h-3 w-2/3" />
      </div>
      <Skeleton className="mb-4 h-10 w-72 rounded-card" />
      <SkeletonTable rows={5} />
    </>
  );
}
