import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmploymentStatusBadge, RoleBadge } from "@/components/ui/Badge";
import { AvatarWithName } from "@/components/ui/Avatar";
import { Pagination } from "@/components/ui/Pagination";
import { CreateEmployeeButton } from "@/features/employees/CreateEmployeeButton";
import { EmployeeFilters } from "@/features/employees/EmployeeFilters";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import type { EmployeeWithRelations } from "@/types/db";

export const metadata: Metadata = { title: "임직원 관리" };

const PAGE_SIZE = 30;

interface SearchParams {
  q?: string;
  department?: string;
  role?: string;
  status?: string;
  page?: string;
}

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;

  const [{ data: departments }, { data: teams }] = await Promise.all([
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("teams").select("id, name, department_id").order("name"),
  ]);

  let query = supabase
    .from("employees")
    .select(
      `id, name, email, position, hire_date, employment_status, profile_image_url,
       role:roles(id, name, label),
       department:departments!department_id(id, name),
       team:teams!team_id(id, name)`,
      { count: "exact" },
    )
    .order("name", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  if (searchParams.q) {
    // PostgREST or() 구문에서 콤마·괄호는 구분자라 제거한다
    const keyword = searchParams.q.replace(/[,()]/g, "").trim();
    if (keyword) {
      query = query.or(`name.ilike.%${keyword}%,email.ilike.%${keyword}%`);
    }
  }
  if (searchParams.department) {
    query = query.eq("department_id", searchParams.department);
  }
  if (searchParams.status) {
    query = query.eq("employment_status", searchParams.status);
  }
  if (searchParams.role) {
    const { data: role } = await supabase
      .from("roles")
      .select("id")
      .eq("name", searchParams.role)
      .maybeSingle<{ id: string }>();
    // 존재하지 않는 역할 필터면 결과가 비도록 둔다
    query = query.eq("role_id", role?.id ?? "00000000-0000-0000-0000-000000000000");
  }

  const { data, count, error } = await query;
  const employees = (data ?? []) as unknown as EmployeeWithRelations[];

  return (
    <>
      <PageHeader
        title="임직원 관리"
        description="계정 등록·역할 지정·재직상태를 관리합니다. 모든 변경은 감사 로그에 기록됩니다."
        action={
          <CreateEmployeeButton
            departments={departments ?? []}
            teams={teams ?? []}
          />
        }
      />

      <EmployeeFilters departments={departments ?? []} />

      <Card className="overflow-hidden">
        {error ? (
          <EmptyState
            title="목록을 불러오지 못했습니다"
            description={error.message}
          />
        ) : employees.length === 0 ? (
          <EmptyState
            icon={Users}
            title="조건에 맞는 임직원이 없습니다"
            description="검색어나 필터를 바꿔보세요. 첫 등록이라면 우측 상단 '임직원 추가'를 사용하세요."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="ab-table min-w-[880px]">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>이메일</th>
                  <th>부서</th>
                  <th>팀</th>
                  <th>직급</th>
                  <th>역할</th>
                  <th>재직상태</th>
                  <th>입사일</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id}>
                    <td>
                      <Link
                        href={`/admin/employees/${employee.id}`}
                        className="inline-block hover:underline"
                      >
                        <AvatarWithName
                          name={employee.name}
                          src={employee.profile_image_url}
                          size="sm"
                        />
                      </Link>
                    </td>
                    <td className="text-muted">{employee.email}</td>
                    <td>{employee.department?.name ?? "-"}</td>
                    <td>{employee.team?.name ?? "-"}</td>
                    <td>{employee.position ?? "-"}</td>
                    <td>
                      <RoleBadge role={employee.role?.name} />
                    </td>
                    <td>
                      <EmploymentStatusBadge
                        status={employee.employment_status}
                      />
                    </td>
                    <td className="whitespace-nowrap text-muted">
                      {formatDate(employee.hire_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={count ?? 0}
          basePath="/admin/employees"
          params={{
            q: searchParams.q,
            department: searchParams.department,
            role: searchParams.role,
            status: searchParams.status,
          }}
        />
      </Card>
    </>
  );
}
