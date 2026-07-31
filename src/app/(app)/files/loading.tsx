import { SkeletonPage } from "@/components/ui/Skeleton";

/**
 * 파일함은 매 요청마다 Drive API를 부른다(목록 + 용량 + 경로).
 * 자리표시가 없으면 그 시간 동안 이전 화면이 그대로 멈춰 있어
 * "비어 있는 파일함"처럼 보인다.
 */
export default function FilesLoading() {
  return <SkeletonPage stats={4} rows={8} />;
}
