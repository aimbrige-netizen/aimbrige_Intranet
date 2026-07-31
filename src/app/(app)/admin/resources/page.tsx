import type { Metadata } from "next";
import { Boxes, Car, DoorOpen, Package } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
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
      <PageHeader
        title="리소스 관리"
        meta={
          <>
            <span>예약 대상 {active}개</span>
            <span>·</span>
            <span>캘린더 예약 화면과 같은 목록</span>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="예약 가능"
          value={active}
          unit="개"
          denominator={total}
          denominatorUnit="개"
          tone="brand"
          icon={Boxes}
          emphasis
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
          tone="informative"
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

      <Card>
        <CardHeader
          title="등록된 리소스"
          description="과거 예약 이력을 보존하기 위해 삭제 대신 비활성화만 지원합니다"
          density="compact"
        />
        <CardBody density="compact">
          <ResourceManager resources={resources} />
        </CardBody>
      </Card>
    </>
  );
}
