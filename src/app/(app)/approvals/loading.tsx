import { SkeletonPage } from "@/components/ui/Skeleton";

/** 목록은 집계 4건 + 표를 기다린다 — 그동안 골격을 남긴다 */
export default function Loading() {
  return <SkeletonPage stats={4} rows={8} />;
}
