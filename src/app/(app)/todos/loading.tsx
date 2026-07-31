import { SkeletonPage } from "@/components/ui/Skeleton";

/** 지표 4장 + 이번 주 스트립 + 체크리스트를 기다리는 동안 골격을 남긴다 */
export default function Loading() {
  return <SkeletonPage stats={4} rows={6} />;
}
