import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

/**
 * 결재 홈 골격 — 제목 한 줄 + 섹션 표 3개(15-approval-home.md 재구축 구성:
 * 결재할 문서 → 기안 진행 문서 → 완료 문서, 실화면과 같은 섹션 수).
 * 지표 밴드는 홈에서 사라졌으므로 스켈레톤도 그리지 않는다 — 밴드가
 * 떴다가 표로 바뀌면 로딩 순간마다 화면이 한 번 출렁인다.
 * (?tab=inbox도 이 골격을 받는다 — 세그먼트 공용 loading. 표가 본문의
 * 대부분이라 홈 모양을 기준으로 둔다.)
 */
export default function Loading() {
  return (
    <>
      <div className="mb-5">
        <Skeleton className="h-7 w-40" />
      </div>
      <SkeletonTable rows={3} />
      <div className="mt-6">
        <SkeletonTable rows={4} />
      </div>
      <div className="mt-6">
        <SkeletonTable rows={4} />
      </div>
    </>
  );
}
