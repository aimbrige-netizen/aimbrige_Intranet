import { SkeletonPage } from "@/components/ui/Skeleton";

export default function AdminAttendanceLoading() {
  return <SkeletonPage stats={4} rows={8} />;
}
