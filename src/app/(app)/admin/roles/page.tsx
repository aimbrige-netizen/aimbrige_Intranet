import type { Metadata } from "next";
import Link from "next/link";
import { Info, Shield, UserCog, User } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { AvatarWithName } from "@/components/ui/Avatar";
import { EmploymentStatusBadge } from "@/components/ui/Badge";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import type { EmployeeWithRelations, Role, RoleName } from "@/types/db";

export const metadata: Metadata = { title: "권한관리" };

const ROLE_META: Record<
  RoleName,
  { icon: typeof Shield; scope: string; note?: string }
> = {
  system_admin: {
    icon: Shield,
    scope: "역할 생성·수정, 사용자별 권한 할당·회수, 시스템 전체 설정",
    note: "(현재 단독 운영 중)",
  },
  manager: {
    icon: UserCog,
    scope: "팀원 데이터 조회, 결재 승인, 팀 공지 작성",
  },
  employee: {
    icon: User,
    scope: "본인 데이터 조회·수정, 결재 기안, 공지 열람",
  },
};

const ROLE_ORDER: RoleName[] = ["system_admin", "manager", "employee"];

export default async function RolesPage() {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const [{ data: roles }, { data: employees }] = await Promise.all([
    supabase.from("roles").select("id, name, label, is_system_role"),
    supabase
      .from("employees")
      .select(
        `id, name, email, position, employment_status, profile_image_url,
         role:roles(id, name, label),
         department:departments!department_id(id, name),
         team:teams!team_id(id, name)`,
      )
      .order("name"),
  ]);

  const roleList = (roles ?? []) as Role[];
  const employeeList = (employees ?? []) as unknown as EmployeeWithRelations[];

  const byRole = (name: RoleName) =>
    employeeList.filter((employee) => employee.role?.name === name);

  return (
    <>
      <PageHeader
        title="권한관리"
        description="MVP는 역할 3종 고정입니다. 배정 변경은 임직원 관리 화면에서 처리합니다."
      />

      <div className="mb-5 flex gap-2.5 rounded-card border border-primary/20 bg-primary-light px-4 py-3">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="text-body text-ink">
          <p>
            커스텀 역할 생성은 Phase 2로 미뤄져 있습니다. 지금은 3종 고정 +
            사용자 매핑만 지원합니다.
          </p>
          <p className="mt-0.5 text-caption">
            역할 배정을 바꾸려면{" "}
            <Link href="/admin/employees" className="text-primary underline">
              임직원 관리
            </Link>{" "}
            화면에서 해당 임직원을 수정하세요.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {ROLE_ORDER.map((roleName) => {
          const role = roleList.find((item) => item.name === roleName);
          const meta = ROLE_META[roleName];
          const Icon = meta.icon;
          const members = byRole(roleName);

          return (
            <Card key={roleName} className="flex flex-col">
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <Icon className="size-4 text-primary" aria-hidden />
                    {role?.label ?? roleName}
                    {meta.note ? (
                      <span className="text-label font-normal text-muted">
                        {meta.note}
                      </span>
                    ) : null}
                  </span>
                }
                description={meta.scope}
                action={
                  <span className="text-label font-bold text-ink">
                    {members.length}명
                  </span>
                }
              />
              <CardBody className="flex-1">
                {members.length === 0 ? (
                  <p className="py-6 text-center text-caption">
                    배정된 임직원이 없습니다.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {members.map((member) => (
                      <li
                        key={member.id}
                        className="flex items-center justify-between gap-2 py-2.5"
                      >
                        <Link
                          href={`/admin/employees/${member.id}`}
                          className="min-w-0 hover:underline"
                        >
                          <AvatarWithName
                            name={member.name}
                            src={member.profile_image_url}
                            size="small"
                            sub={
                              [member.department?.name, member.position]
                                .filter(Boolean)
                                .join(" · ") || member.email
                            }
                          />
                        </Link>
                        <EmploymentStatusBadge
                          status={member.employment_status}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </>
  );
}
