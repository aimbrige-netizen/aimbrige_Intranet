import { SkeletonPage } from "@/components/ui/Skeleton";

export default function DirectoryLoading() {
  return <SkeletonPage stats={4} rows={8} />;
}
