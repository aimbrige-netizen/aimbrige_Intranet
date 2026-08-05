"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Skeleton,
  SkeletonStats,
  SkeletonTable,
} from "@/components/ui/Skeleton";

/**
 * 캘린더 로딩 자리표시.
 * 격자가 통째로 비어 있는 상태와 "아직 안 왔다"를 구분해 준다.
 *
 * /calendar는 한 라우트가 두 골격을 그린다 — 월간·주간·리스트(지표 밴드 +
 * 격자)와 ?view=resources(제목 한 줄 + 타임라인 + 하단 표, 17 "예약" 정밀화로
 * 지표 밴드가 없다). 서버 컴포넌트 loading은 searchParams를 못 받으므로
 * 클라이언트에서 useSearchParams로 갈라 실화면과 같은 골격을 보인다.
 * (Suspense 없이 쓰면 정적 프리렌더가 CSR로 강등된다 — 폴백은 기본 골격.)
 */
export default function CalendarLoading() {
  return (
    <Suspense fallback={<ScheduleSkeleton />}>
      <ViewAwareSkeleton />
    </Suspense>
  );
}

function ViewAwareSkeleton() {
  const view = useSearchParams().get("view");
  return view === "resources" ? <ResourceSkeleton /> : <ScheduleSkeleton />;
}

/** 월간·주간·리스트 — PageHeader + 지표 밴드 4칸 + 42칸 격자 */
function ScheduleSkeleton() {
  return (
    <>
      <div className="mb-5">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-2 h-3 w-56" />
        <div className="mt-4 flex justify-center">
          <Skeleton className="h-8 w-72" />
        </div>
      </div>

      <SkeletonStats count={4} />

      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-7 w-24 rounded-pill" />
        <Skeleton className="h-7 w-24 rounded-pill" />
        <Skeleton className="h-7 w-24 rounded-pill" />
      </div>

      <div className="rounded-card border border-line bg-surface p-3">
        <div className="grid grid-cols-7 gap-px">
          {Array.from({ length: 42 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-none" />
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * ?view=resources — 제목 20/500 한 줄 + 날짜 내비·세그먼트 + 필터 칩 +
 * 타임라인 + "내 예약 현황" 표. 실화면(page.tsx ResourceScreen)과 단이 같아야
 * 로딩→로드 전환 때 지표 밴드·격자가 나타났다 사라지는 점프가 없다.
 */
function ResourceSkeleton() {
  return (
    <>
      {/* h1 "리소스 예약 현황" — 20/500, 줄높이 30px */}
      <Skeleton className="mb-5 h-[30px] w-44" />

      {/* 날짜 내비(화살표 + 24px 라벨 + 오늘) · 우측 일간/주간 필 */}
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="ml-auto h-8 w-[98px] rounded-pill" />
      </div>

      {/* 리소스 종류 필터 칩 */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-7 w-24 rounded-pill" />
        <Skeleton className="h-7 w-24 rounded-pill" />
        <Skeleton className="h-7 w-24 rounded-pill" />
      </div>

      {/* 시간축 타임라인 — 리소스 행 나열 */}
      <div className="rounded-card border border-line bg-surface p-3">
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      </div>

      {/* 하단 "내 예약 현황" — 섹션 제목 + 표 */}
      <div className="mt-6">
        <Skeleton className="mb-3 h-4 w-40" />
        <SkeletonTable rows={3} />
      </div>
    </>
  );
}
