import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { DirectoryTabs } from "@/features/directory/DirectoryTabs";
import {
  getDirectory,
  getExternalContacts,
} from "@/features/directory/data";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "조직도·디렉토리" };

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: { tab?: string; inactive?: string };
}) {
  const me = await requireSessionEmployee();

  const tab =
    searchParams.tab === "list"
      ? "list"
      : searchParams.tab === "external"
        ? "external"
        : "org";

  // 휴직·퇴사 포함은 관리자만 (스펙 3.1) — 일반 사용자는 파라미터를 넣어도 무시
  const includeInactive = me.isSystemAdmin && searchParams.inactive === "1";

  const [directory, contacts] = await Promise.all([
    getDirectory({ includeInactive }),
    tab === "external" ? getExternalContacts() : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title="조직도·디렉토리"
        description="부서·팀 구조와 임직원, 외부 비즈니스 연락처를 확인합니다."
      />

      <DirectoryTabs
        activeTab={tab}
        employees={directory.employees}
        departments={directory.departments}
        teams={directory.teams}
        contacts={contacts}
        currentEmployeeId={me.id}
        isSystemAdmin={me.isSystemAdmin}
        includeInactive={includeInactive}
      />
    </>
  );
}
