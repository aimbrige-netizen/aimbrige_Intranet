import {
  Skeleton,
  SkeletonStats,
  SkeletonTable,
} from "@/components/ui/Skeleton";

/**
 * 근태 관리 로딩 자리표시.
 *
 * 실화면은 제목 밴드 해체 뒤 "제목 20/500 + 메타 한 줄" 아래에
 * PeriodNavigator(가운데 기간 내비 + 우측 주간/월간 토글)가 독립 행으로
 * 들어간다 — 범용 SkeletonPage에는 이 행이 없어서 로딩→로드 전환 때
 * 지표 밴드가 아래로 밀리는 점프가 났다. 실화면과 같은 단으로 그린다.
 */
export default function AdminAttendanceLoading() {
  return (
    <>
      {/* h1 "근태 관리" 20/500(30px) + 메타 한 줄(재직·정규 근무·감사 기록) */}
      <div className="mb-5">
        <Skeleton className="h-[30px] w-24" />
        <Skeleton className="mt-2 h-3 w-72" />
      </div>

      {/*
        PeriodNavigator와 같은 골격 — 좌측 스페이서로 기간 내비를 가운데,
        주간/월간 세그먼트(트랙 40px)를 우측 끝에 둔다. mb-4 실측 동일.
      */}
      <div className="mb-4 flex flex-wrap items-center gap-2 md:flex-nowrap">
        <div className="hidden flex-1 md:block" />
        {/* ‹ 기간 라벨 › [오늘] — size-8 버튼 줄 */}
        <Skeleton className="h-8 w-64" />
        <div className="flex flex-1 justify-end">
          <Skeleton className="h-10 w-28 rounded-card" />
        </div>
      </div>

      <SkeletonStats count={4} />
      <SkeletonTable rows={8} />
    </>
  );
}
