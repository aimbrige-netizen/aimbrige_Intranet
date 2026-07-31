import { SkeletonPage } from "@/components/ui/Skeleton";

export default function EmployeesLoading() {
  return <SkeletonPage stats={4} rows={8} />;
}
