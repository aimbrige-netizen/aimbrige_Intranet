import type { Metadata } from "next";
import { Boxes, Car, DoorOpen, Package } from "lucide-react";
import { SectionHeader } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { ResourceManager } from "@/features/calendar/ResourceManager";
import { getAllResources } from "@/features/calendar/data";
import { requireSystemAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "리소스 관리" };

export default async function ResourcesPage() {
  await requireSystemAdmin();
  const resources = await getAllResources();

  const total = resources.length;
  const active = resources.filter((resource) => resource.is_active).length;
  const countOf = (type: string) =>
    resources.filter((resource) => resource.type === type).length;
  const seats = resources
    .filter((resource) => resource.type === "meeting_room")
    .reduce((sum, resource) => sum + (resource.capacity ?? 0), 0);

  return (
    <>
      {/*
        콘텐츠 제목 "리소스 관리" 20/500 — PageHeader급 밴드 없음(확립 문법).
        종전 메타(예약 대상 n개·안내)는 카드와 섹션 설명이 나눠 든다.
      */}
      <h1 className="mb-5 text-title-l text-ink">
        리소스 관리
      </h1>

      {/*
        민트 규율 — 예약 가능이 "지금 살아 있는 값"이라 민트, 종류별 개수는
        분류 셈값이라 중립이다(색 절제). 종전 brand 강조는 장식이라 걷어냈다.
      */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="예약 가능"
          value={active}
          unit="개"
          denominator={total}
          denominatorUnit="개"
          tone="positive"
          icon={Boxes}
          max={total || 1}
          meterValue={active}
          state={total === 0 ? "empty" : "ok"}
          sub={
            total === 0
              ? "등록된 리소스가 없습니다"
              : `비활성 ${total - active}개`
          }
        />
        <StatCard
          label="회의실"
          value={countOf("meeting_room")}
          unit="개"
          denominator={total}
          denominatorUnit="개"
          tone="neutral"
          icon={DoorOpen}
          max={total || 1}
          meterValue={countOf("meeting_room")}
          sub={seats > 0 ? `총 정원 ${seats}인` : "정원 미등록"}
        />
        <StatCard
          label="차량"
          value={countOf("vehicle")}
          unit="개"
          denominator={total}
          denominatorUnit="개"
          tone="neutral"
          icon={Car}
          max={total || 1}
          meterValue={countOf("vehicle")}
        />
        <StatCard
          label="공용비품"
          value={countOf("equipment")}
          unit="개"
          denominator={total}
          denominatorUnit="개"
          tone="neutral"
          icon={Package}
          max={total || 1}
          meterValue={countOf("equipment")}
        />
      </div>

      {/* 08 흰 시트: 카드 해체 — 섹션 제목 + 직접 배치, md 미만만 카드 유지 */}
      <section>
        <SectionHeader
          title={`등록된 리소스 (총${total}개)`}
          description="캘린더 예약 화면과 같은 목록 · 과거 예약 이력을 보존하기 위해 삭제 대신 비활성화만 지원합니다"
        />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <ResourceManager resources={resources} />
        </div>
      </section>
    </>
  );
}
