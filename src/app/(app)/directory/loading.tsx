import { Skeleton, SkeletonStats, SkeletonTable } from "@/components/ui/Skeleton";

/**
 * /directory 표는 주소록 실측(16)대로 th 높이가 48px(h-12)라, 기본
 * 스켈레톤 헤더(≈36px) 그대로면 로딩 완료 순간 헤더가 12px쯤 자라는
 * 레이아웃 시프트가 생긴다. 헤더 자리만 실제 표 높이에 맞춘다.
 * (SkeletonPage 기본값과 같은 골격 + headClassName만 다르다.)
 */
export default function DirectoryLoading() {
  return (
    <>
      <div className="mb-5">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-3 w-64" />
      </div>
      <SkeletonStats count={4} />
      <SkeletonTable rows={8} headClassName="flex h-12 items-center px-4" />
    </>
  );
}
