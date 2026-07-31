import { Skeleton, SkeletonStats } from "@/components/ui/Skeleton";

export default function ProfileLoading() {
  return (
    <>
      <div className="mb-5">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-2 h-3 w-72" />
      </div>
      <SkeletonStats count={4} />
      <div className="rounded-card border border-line bg-surface p-5">
        <div className="flex gap-5">
          <Skeleton className="size-20 rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      </div>
    </>
  );
}
