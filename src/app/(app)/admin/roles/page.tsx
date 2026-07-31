import type { Metadata } from "next";
import { KeyRound, ShieldAlert, Users, UserX } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { RoleBoard, type RoleMember } from "./RoleBoard";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import type { EmployeeWithRelations, Role, RoleName } from "@/types/db";

export const metadata: Metadata = { title: "권한관리" };

const FALLBACK_LABELS: Record<RoleName, string> = {
  system_admin: "시스템 관리자",
  manager: "팀장·매니저",
  employee: "일반직원",
};

export default async function RolesPage() {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const [{ data: roles }, { data: employees }] = await Promise.all([
    supabase.from("roles").select("id, name, label, is_system_role"),
    supabase
      .from("employees")
      .select(
        `id, name, email, position, employment_status, profile_image_url, auth_user_id,
         role:roles(id, name, label),
         department:departments!department_id(id, name),
         team:teams!team_id(id, name)`,
      )
      .order("name"),
  ]);

  const roleList = (roles ?? []) as Role[];
  const employeeList = (employees ?? []) as unknown as EmployeeWithRelations[];

  const labels = { ...FALLBACK_LABELS };
  roleList.forEach((role) => {
    if (role.label) labels[role.name] = role.label;
  });

  const members: RoleMember[] = employeeList.map((employee) => ({
    id: employee.id,
    name: employee.name,
    email: employee.email,
    position: employee.position,
    departmentName: employee.department?.name ?? null,
    teamName: employee.team?.name ?? null,
    employmentStatus: employee.employment_status,
    profileImageUrl: employee.profile_image_url,
    roleName: employee.role?.name ?? "employee",
    linked: !!employee.auth_user_id,
  }));

  const total = members.length;
  const privileged = members.filter(
    (member) => member.roleName !== "employee",
  ).length;
  const unlinked = members.filter((member) => !member.linked).length;
  /*
   * 퇴사·휴직자가 관리 권한을 그대로 들고 있는 상태 — 권한 회수 누락이다.
   * 세 화면을 오가며 눈으로 대조해야 알 수 있던 값이라 지표로 올린다.
   */
  const staleGrants = members.filter(
    (member) =>
      member.roleName !== "employee" && member.employmentStatus !== "active",
  ).length;

  return (
    <>
      <PageHeader
        title="권한관리"
        description="역할 3종 고정 · 배정 변경은 임직원 상세 화면에서 처리합니다."
        meta={
          <>
            <span>등록 {total}명</span>
            <span>·</span>
            <span>역할 {roleList.length || 3}종</span>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="권한 보유"
          value={privileged}
          unit="명"
          denominator={total}
          denominatorUnit="명"
          tone="brand"
          icon={KeyRound}
          emphasis
          max={total || 1}
          meterValue={privileged}
          sub="관리자 또는 팀장·매니저"
        />
        <StatCard
          label="일반직원"
          value={total - privileged}
          unit="명"
          denominator={total}
          denominatorUnit="명"
          tone="neutral"
          icon={Users}
          max={total || 1}
          meterValue={total - privileged}
          sub="본인 데이터만 열람"
        />
        <StatCard
          label="로그인 계정 미연결"
          value={unlinked}
          unit="명"
          denominator={total}
          denominatorUnit="명"
          tone={unlinked > 0 ? "warning" : "positive"}
          icon={UserX}
          sub={unlinked > 0 ? "역할이 있어도 로그인 불가" : "전원 연결됨"}
        />
        <StatCard
          label="회수 누락 의심"
          value={staleGrants}
          unit="명"
          denominator={privileged || 0}
          denominatorUnit="명"
          tone={staleGrants > 0 ? "critical" : "positive"}
          icon={ShieldAlert}
          sub={
            staleGrants > 0
              ? "재직 중이 아닌데 권한 보유"
              : "재직자만 권한을 보유"
          }
        />
      </div>

      <RoleBoard labels={labels} members={members} />
    </>
  );
}
