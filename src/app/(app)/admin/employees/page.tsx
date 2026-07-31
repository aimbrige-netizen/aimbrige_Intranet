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
import { tenureLabel, tenureMonths } from "@/features/directory/org";
import { requireSystemAdmin } from "@/lib/auth/session";
import { parseSortDir, parseSortKey, toggledDir } from "@/lib/sort";
import { createServerSupabase } from "@/lib/supabase/server";
import { todayInSeoul } from "@/lib/utils";
import type { EmploymentStatus, EmployeeWithRelations } from "@/types/db";

export const metadata: Metadata = { title: "임직원 관리" };

const PAGE_SIZE = 30;

/** 내보내기는 페이지가 아니라 필터 전체를 담는다. 상한만 걸어 둔다 */
const EXPORT_LIMIT = 1000;

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

/**
 * 서버에서 정렬 가능한 키. 부서는 임베드 테이블 컬럼이라 PostgREST가
 * 부모 행 순서를 바꿔 주지 못한다 — 표에서도 빼 둔다.
 */
const SORTABLE_KEYS = [
  "name",
  "position",
  "status",
  "hire_date",
] as const satisfies readonly EmployeeSortKey[];

const SORT_COLUMNS: Record<(typeof SORTABLE_KEYS)[number], string> = {
  name: "name",
  position: "position",
  status: "employment_status",
  hire_date: "hire_date",
};

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

  // 역할 필터는 이름 → id 변환이 필요해 목록 질의보다 먼저 푼다
  let roleId: string | null = null;
  if (searchParams.role) {
    const { data: role } = await supabase
      .from("roles")
      .select("id")
      .eq("name", searchParams.role)
      .maybeSingle<{ id: string }>();
    // 존재하지 않는 역할 필터면 결과가 비도록 둔다
    roleId = role?.id ?? "00000000-0000-0000-0000-000000000000";
  }

  /** 목록과 내보내기가 정확히 같은 모수를 보게 조건을 한 곳에 둔다 */
  const applyFilters = <T extends { eq: unknown; or: unknown }>(input: T): T => {
    let next = input as unknown as {
      eq: (column: string, value: string) => typeof next;
      or: (filter: string) => typeof next;
    };
    if (searchParams.q) {
      // PostgREST or() 구문에서 콤마·괄호는 구분자라 제거한다
      const keyword = searchParams.q.replace(/[,()]/g, "").trim();
      if (keyword) {
        next = next.or(`name.ilike.%${keyword}%,email.ilike.%${keyword}%`);
      }
    }
    if (searchParams.department) {
      next = next.eq("department_id", searchParams.department);
    }
    if (searchParams.status) {
      next = next.eq("employment_status", searchParams.status);
    }
    if (roleId) next = next.eq("role_id", roleId);
    return next as unknown as T;
  };

  const LIST_SELECT = `id, name, email, position, phone, hire_date, employment_status, profile_image_url,
       auth_user_id,
       role:roles(id, name, label),
       department:departments!department_id(id, name),
       team:teams!team_id(id, name)`;

  /** CSV에 실제로 들어가는 컬럼만. 아바타 URL까지 끌고 올 이유가 없다 */
  const EXPORT_SELECT = `name, email, position, phone, hire_date, employment_status, auth_user_id,
       role:roles(label),
       department:departments!department_id(name),
       team:teams!team_id(name)`;

  const sortColumn = SORT_COLUMNS[sortKey];

  const [listResult, exportResult] = await Promise.all([
    applyFilters(
      supabase.from("employees").select(LIST_SELECT, { count: "exact" }),
    )
      .order(sortColumn, { ascending, nullsFirst: false })
      // 같은 값이 여러 건이면 순서가 새로고침마다 흔들린다 — 이름으로 고정
      .order("name", { ascending: true })
      .range(from, from + PAGE_SIZE - 1),
    applyFilters(supabase.from("employees").select(EXPORT_SELECT))
      .order(sortColumn, { ascending, nullsFirst: false })
      .order("name", { ascending: true })
      .range(0, EXPORT_LIMIT - 1),
  ]);

  const { data, count, error } = listResult;
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

  interface ExportSource {
    name: string;
    email: string;
    position: string | null;
    phone: string | null;
    hire_date: string | null;
    employment_status: EmploymentStatus;
    auth_user_id: string | null;
    role: { label: string } | null;
    department: { name: string } | null;
    team: { name: string } | null;
  }

  const exportRows = (
    (exportResult.data ?? []) as unknown as ExportSource[]
  ).map((employee) => ({
    name: employee.name,
    position: employee.position,
    department: employee.department?.name ?? null,
    team: employee.team?.name ?? null,
    status: employee.employment_status,
    email: employee.email,
    phone: employee.phone ?? null,
    hireDate: employee.hire_date,
    tenure: tenureLabel(tenureMonths(employee.hire_date, today)),
    role: employee.role?.label ?? null,
    hasAccount: !!employee.auth_user_id,
  }));

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
              rows={exportRows}
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
