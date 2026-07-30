import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { ResourceManager } from "@/features/calendar/ResourceManager";
import { getAllResources } from "@/features/calendar/data";
import { requireSystemAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "리소스 관리" };

export default async function ResourcesPage() {
  await requireSystemAdmin();
  const resources = await getAllResources();

  return (
    <>
      <PageHeader
        title="리소스 관리"
        description="회의실·차량·공용비품을 등록합니다. 과거 예약 이력 보존을 위해 삭제 대신 비활성화만 지원합니다."
      />

      <Card>
        <CardBody>
          <ResourceManager resources={resources} />
        </CardBody>
      </Card>
    </>
  );
}
