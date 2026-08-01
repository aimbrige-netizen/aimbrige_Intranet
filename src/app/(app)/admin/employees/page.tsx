import type { Metadata } from "next";
import { Building2, KeyRound, ListChecks, UserRoundCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Callout } from "@/components/ui/Callout";
import { StatCard } from "@/components/ui/StatCard";
import { Pagination } from "@/components/ui/Pagination";
import { CreateEmployeeButton } from "@/features/employees/CreateEmployeeButton";
import { EmployeeFilters } from "@/features/employees/EmployeeFilters";
import { EmployeeExportButton } from "@/features/directory/EmployeeExportButton";
import {
  EmployeeTable,
  type EmployeeSortKey,
  type EmployeeTableRow,
} from "@/features/directory/EmployeeTable";
import { resolveRoleFilterId } from "@/features/employees/data";
import {
  applyEmployeeFilters,
  EMPLOYEE_EXPORT_LIMIT,
  EMPLOYEE_SORTABLE_KEYS,
  EMPLOYEE_SORT_COLUMNS,
  type EmployeeExportQuery,
} from "@/features/employees/export";
import { exportEmployees } from "@/server/actions/employees";
import { requireSystemAdmin } from "@/lib/auth/session";
import { parseSortDir, parseSortKey, toggledDir } from "@/lib/sort";
import { createServerSupabase } from "@/lib/supabase/server";
import { todayInSeoul } from "@/lib/utils";
import type { EmploymentStatus, EmployeeWithRelations } from "@/types/db";

export const metadata: Metadata = { title: "임직원 관리" };

const PAGE_SIZE = 30;

/**
 * 목록 파라미터 규약: q / department / role / status / sort / dir / page.
 * 조직도 목록(/directory?tab=people)도 같은 이름을 쓴다.
 */
interface SearchParams {
  q?: string;
  department?: string;
  role?: string;
  status?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

/** 정렬 키·컬럼 매핑은 내보내기 액션과 함께 features/employees/export에 있다 */
const SORTABLE_KEYS =
  EMPLOYEE_SORTABLE_KEYS satisfies readonly EmployeeSortKey[];

/** 요약 밴드용 원장 — 이름 없이 상태 컬럼만 읽는다 */
interface CensusRow {
  id: string;
  employment_status: EmploymentStatus;
  auth_user_id: string | null;
  department_id: string | null;
  team_id: string | null;
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
  const sortKey = parseSortKey(searchParams.sort, SORTABLE_KEYS);
  const sortDir = parseSortDir(searchParams.dir);
  const ascending = sortDir === "asc";
  const today = todayInSeoul();

  const [{ data: departments }, { data: teams }, { data: census }] =
    await Promise.all([
      supabase.from("departments").select("id, name").order("name"),
      supabase.from("teams").select("id, name, department_id").order("name"),
      supabase
        .from("employees")
        .select("id, employment_status, auth_user_id, department_id, team_id"),
    ]);

  const rows = (census ?? []) as CensusRow[];
  const total = rows.length;
  const statusCounts: Record<EmploymentStatus, number> = {
    active: 0,
    leave: 0,
    terminated: 0,
  };
  const departmentCounts = new Map<string, number>();
  let linked = 0;
  let placed = 0;

  rows.forEach((row) => {
    statusCounts[row.employment_status] += 1;
    if (row.auth_user_id) linked += 1;
    if (row.department_id || row.team_id) placed += 1;
    if (row.department_id) {
      departmentCounts.set(
        row.department_id,
        (departmentCounts.get(row.department_id) ?? 0) + 1,
      );
    }
  });

  const roleId = await resolveRoleFilterId(searchParams.role);

  const LIST_SELECT = `id, name, email, position, phone, hire_date, employment_status, profile_image_url,
       auth_user_id,
       role:roles(id, name, label),
       department:departments!department_id(id, name),
       team:teams!team_id(id, name)`;

  /**
   * 내보내기 조건은 목록과 같은 것을 그대로 액션에 넘긴다.
   * 예전에는 여기서 최대 1000명을 미리 한 번 더 읽었다 — 버튼을 누르지 않는
   * 대부분의 로드에서 순수한 낭비였다. 이제 누를 때 액션이 읽는다.
   */
  const exportQuery: EmployeeExportQuery = {
    q: searchParams.q,
    department: searchParams.department,
    status: searchParams.status,
    role: searchParams.role,
    sortKey,
    ascending,
    withAdminColumns: true,
  };

  const { data, count, error } = await applyEmployeeFilters(
    supabase.from("employees").select(LIST_SELECT, { count: "exact" }),
    exportQuery,
    roleId,
  )
    .order(EMPLOYEE_SORT_COLUMNS[sortKey], { ascending, nullsFirst: false })
    // 같은 값이 여러 건이면 순서가 새로고침마다 흔들린다 — 이름으로 고정
    .order("name", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  const employees = (data ?? []) as unknown as (EmployeeWithRelations & {
    phone: string | null;
  })[];
  const matched = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(matched / PAGE_SIZE));

  const toRow = (
    employee: EmployeeWithRelations & { phone: string | null },
  ): EmployeeTableRow => ({
    id: employee.id,
    name: employee.name,
    position: employee.position,
    departmentName: employee.department?.name ?? null,
    teamName: employee.team?.name ?? null,
    employmentStatus: employee.employment_status,
    email: employee.email,
    phone: employee.phone ?? null,
    hireDate: employee.hire_date,
    profileImageUrl: employee.profile_image_url,
    roleName: employee.role?.name ?? null,
    hasAccount: !!employee.auth_user_id,
  });

  const tableRows: EmployeeTableRow[] = employees.map(toRow);

  const filterParams = {
    q: searchParams.q,
    department: searchParams.department,
    role: searchParams.role,
    status: searchParams.status,
  };

  const sortHref = (key: EmployeeSortKey) => {
    const search = new URLSearchParams();
    Object.entries(filterParams).forEach(([field, value]) => {
      if (value) search.set(field, value);
    });
    search.set("sort", key);
    search.set(
      "dir",
      // 입사일은 최근 입사자부터 보는 쪽이 자연스럽다
      toggledDir(sortKey === key, sortDir, key === "hire_date" ? "desc" : "asc"),
    );
    return `/admin/employees?${search.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="임직원 관리"
        description="계정 등록·역할 지정·재직상태를 관리합니다. 모든 변경은 감사 로그에 기록됩니다."
        meta={
          <>
            <span>전체 {total}명</span>
            <span>·</span>
            <span>부서 {departments?.length ?? 0}개</span>
            <span>·</span>
            <span>팀 {teams?.length ?? 0}개</span>
            <span>·</span>
            <span>기준 {today}</span>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="재직 인원"
          value={statusCounts.active}
          unit="명"
          denominator={total}
          denominatorUnit="명"
          tone="brand"
          icon={UserRoundCheck}
          emphasis
          max={total || 1}
          meterValue={statusCounts.active}
          sub={`휴직 ${statusCounts.leave}명 · 퇴사 ${statusCounts.terminated}명`}
        />
        <StatCard
          label="계정 연결"
          value={linked}
          unit="명"
          denominator={total}
          denominatorUnit="명"
          tone="positive"
          icon={KeyRound}
          max={total || 1}
          meterValue={linked}
          sub={
            total - linked > 0
              ? `미연결 ${total - linked}명 · 첫 로그인 시 연결`
              : "전원 연결 완료"
          }
        />
        <StatCard
          label="조직 배치"
          value={placed}
          unit="명"
          denominator={total}
          denominatorUnit="명"
          tone="informative"
          icon={Building2}
          max={total || 1}
          meterValue={placed}
          sub={
            total - placed > 0
              ? `미배정 ${total - placed}명`
              : "전원 부서·팀 배치"
          }
        />
        <StatCard
          label="조회 결과"
          value={matched}
          unit="명"
          denominator={total}
          denominatorUnit="명"
          tone="neutral"
          icon={ListChecks}
          max={total || 1}
          meterValue={matched}
          sub={`${page} / ${totalPages} 페이지 · ${PAGE_SIZE}명씩`}
        />
      </div>

      <EmployeeFilters
        departments={departments ?? []}
        params={filterParams}
        sortParams={{ sort: searchParams.sort, dir: searchParams.dir }}
        statusCounts={statusCounts}
        departmentCounts={departmentCounts}
        total={total}
        shown={matched}
        actions={
          <>
            <EmployeeExportButton
              fetchRows={exportEmployees.bind(null, exportQuery)}
              total={matched}
              limit={EMPLOYEE_EXPORT_LIMIT}
              filename="임직원명부_관리"
              withAdminColumns
            />
            <CreateEmployeeButton
              departments={departments ?? []}
              teams={teams ?? []}
            />
          </>
        }
      />

      {error ? (
        <Callout tone="danger" title="목록을 불러오지 못했습니다">
          {error.message}
        </Callout>
      ) : (
        <Card className="overflow-hidden">
          <EmployeeTable
            rows={tableRows}
            today={today}
            hrefBase="/admin/employees"
            columns={{ role: true, account: true }}
            sort={{ key: sortKey, dir: sortDir }}
            sortHref={sortHref}
            sortableKeys={[...SORTABLE_KEYS]}
            minWidth="min-w-[1180px]"
            emptyDescription="검색어나 필터를 바꿔보세요. 첫 등록이라면 툴바의 '임직원 추가'를 사용합니다."
          />
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={matched}
            basePath="/admin/employees"
            params={{
              ...filterParams,
              sort: searchParams.sort,
              dir: searchParams.dir,
            }}
          />
        </Card>
      )}
    </>
  );
}
