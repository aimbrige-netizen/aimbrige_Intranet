import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type { DirectoryEmployee } from "@/features/directory/org";
import type {
  Department,
  Employee,
  ExternalContactWithCreator,
  Role,
  Team,
} from "@/types/db";

export type { DirectoryEmployee };

const DIRECTORY_SELECT =
  "id, name, email, position, phone, profile_image_url, employment_status, department_id, team_id, hire_date";

export interface DirectoryData {
  employees: DirectoryEmployee[];
  departments: Department[];
  teams: Team[];
}

/**
 * 조직도/목록 뷰 데이터.
 * includeInactive는 관리자만 true로 넘길 수 있게 호출부에서 통제한다(스펙 3.1).
 */
export async function getDirectory(options?: {
  includeInactive?: boolean;
}): Promise<DirectoryData> {
  const supabase = createServerSupabase();

  let employeeQuery = supabase
    .from("employees")
    .select(DIRECTORY_SELECT)
    .order("name");

  if (!options?.includeInactive) {
    employeeQuery = employeeQuery.eq("employment_status", "active");
  }

  const [{ data: employees }, { data: departments }, { data: teams }] =
    await Promise.all([
      employeeQuery,
      supabase.from("departments").select("*").order("name"),
      supabase.from("teams").select("*").order("name"),
    ]);

  return {
    employees: (employees ?? []) as DirectoryEmployee[],
    departments: (departments ?? []) as Department[],
    teams: (teams ?? []) as Team[],
  };
}

/**
 * 임직원 프로필 상세 (동료 조회용, 스펙 3.2)
 *
 * departments.manager_id / teams.manager_id는 스키마에도 있고 조직 편집에서
 * 지정까지 하는데, 예전 select는 (id, name)만 가져와 리포팅 라인을 화면에
 * 올릴 방법이 없었다. 매니저와 같은 팀 동료를 함께 조회한다.
 */
export interface DirectoryProfileEmployee extends Employee {
  role: Pick<Role, "id" | "name" | "label"> | null;
  department: Pick<Department, "id" | "name" | "manager_id"> | null;
  team: Pick<Team, "id" | "name" | "manager_id"> | null;
}

export interface DirectoryProfile {
  employee: DirectoryProfileEmployee;
  departmentManager: DirectoryEmployee | null;
  teamManager: DirectoryEmployee | null;
  /** 같은 팀 재직 동료 (본인 제외) */
  teammates: DirectoryEmployee[];
  /** 같은 부서 재직 인원 (본인 포함) */
  departmentSize: number;
}

export async function getDirectoryProfile(
  id: string,
): Promise<DirectoryProfile | null> {
  const supabase = createServerSupabase();

  const { data: employee } = await supabase
    .from("employees")
    .select(
      `id, auth_user_id, email, name, department_id, team_id, position, role_id,
       employment_status, hire_date, phone, responsibilities, profile_image_url,
       created_at, updated_at,
       role:roles(id, name, label),
       department:departments!department_id(id, name, manager_id),
       team:teams!team_id(id, name, manager_id)`,
    )
    .eq("id", id)
    .maybeSingle<DirectoryProfileEmployee>();

  if (!employee) return null;

  const managerIds = [
    employee.department?.manager_id,
    employee.team?.manager_id,
  ].filter((value): value is string => !!value);

  const [managerResult, teammateResult, departmentCount] = await Promise.all([
    managerIds.length > 0
      ? supabase.from("employees").select(DIRECTORY_SELECT).in("id", managerIds)
      : Promise.resolve({ data: [] as DirectoryEmployee[] }),
    employee.team_id
      ? supabase
          .from("employees")
          .select(DIRECTORY_SELECT)
          .eq("team_id", employee.team_id)
          .eq("employment_status", "active")
          .neq("id", employee.id)
          .order("name")
      : Promise.resolve({ data: [] as DirectoryEmployee[] }),
    employee.department_id
      ? supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("department_id", employee.department_id)
          .eq("employment_status", "active")
      : Promise.resolve({ count: 0 }),
  ]);

  const managers = (managerResult.data ?? []) as DirectoryEmployee[];
  const findManager = (managerId: string | null | undefined) =>
    managerId ? (managers.find((m) => m.id === managerId) ?? null) : null;

  return {
    employee,
    departmentManager: findManager(employee.department?.manager_id),
    teamManager: findManager(employee.team?.manager_id),
    teammates: (teammateResult.data ?? []) as DirectoryEmployee[],
    departmentSize: ("count" in departmentCount ? departmentCount.count : 0) ?? 0,
  };
}

/** 모듈 패널의 '내 소속' 위젯용 컨텍스트 */
export interface MyOrgContext {
  departmentName: string | null;
  teamName: string | null;
  manager: DirectoryEmployee | null;
  managerRole: "부서장" | "팀장" | null;
  teamId: string | null;
  teamSize: number;
  departmentSize: number;
}

export async function getMyOrgContext(me: {
  id: string;
  department_id: string | null;
  team_id: string | null;
}): Promise<MyOrgContext> {
  const supabase = createServerSupabase();

  const [departmentResult, teamResult] = await Promise.all([
    me.department_id
      ? supabase
          .from("departments")
          .select("id, name, manager_id")
          .eq("id", me.department_id)
          .maybeSingle<Pick<Department, "id" | "name" | "manager_id">>()
      : Promise.resolve({ data: null }),
    me.team_id
      ? supabase
          .from("teams")
          .select("id, name, manager_id")
          .eq("id", me.team_id)
          .maybeSingle<Pick<Team, "id" | "name" | "manager_id">>()
      : Promise.resolve({ data: null }),
  ]);

  const department = departmentResult.data;
  const team = teamResult.data;

  // 팀장이 있으면 팀장, 없으면 부서장이 나의 리포팅 라인이다
  const managerId = team?.manager_id ?? department?.manager_id ?? null;
  const managerRole = team?.manager_id
    ? ("팀장" as const)
    : department?.manager_id
      ? ("부서장" as const)
      : null;

  const [managerResult, teamCount, departmentCount] = await Promise.all([
    managerId
      ? supabase
          .from("employees")
          .select(DIRECTORY_SELECT)
          .eq("id", managerId)
          .maybeSingle<DirectoryEmployee>()
      : Promise.resolve({ data: null }),
    me.team_id
      ? supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("team_id", me.team_id)
          .eq("employment_status", "active")
      : Promise.resolve({ count: 0 }),
    me.department_id
      ? supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("department_id", me.department_id)
          .eq("employment_status", "active")
      : Promise.resolve({ count: 0 }),
  ]);

  return {
    departmentName: department?.name ?? null,
    teamName: team?.name ?? null,
    manager: managerResult.data ?? null,
    managerRole,
    teamId: team?.id ?? null,
    teamSize: ("count" in teamCount ? teamCount.count : 0) ?? 0,
    departmentSize:
      ("count" in departmentCount ? departmentCount.count : 0) ?? 0,
  };
}

export interface OrgHistoryRow {
  id: string;
  action: string;
  created_at: string;
}

/**
 * 조직 변경 이력 (스펙 3.2)
 *
 * audit_logs 자체는 시스템 관리자 전용(스펙 01)이라 직접 조회하면 일반 사용자는 아무것도
 * 못 본다. 조직 관련 action만 골라 주는 SECURITY DEFINER 함수를 거쳐 전 직원에게 연다.
 */
export async function getEmployeeTimeline(
  employeeId: string,
): Promise<OrgHistoryRow[]> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase.rpc("list_org_history", {
    target_employee_id: employeeId,
  });

  if (error) {
    console.error("[directory] 조직 변경 이력 조회 실패:", error.message);
    return [];
  }
  return (data ?? []) as OrgHistoryRow[];
}

/** 외부 연락처 목록 (스펙 3.3) */
export async function getExternalContacts(options?: {
  keyword?: string;
  category?: string;
}): Promise<ExternalContactWithCreator[]> {
  const supabase = createServerSupabase();

  let query = supabase
    .from("external_contacts")
    .select(
      `id, name, company, role, phone, email, memo, category, created_by,
       created_at, updated_at,
       creator:employees!created_by(id, name)`,
    )
    .order("name");

  if (options?.keyword) {
    // PostgREST or() 구문에서 콤마·괄호는 구분자라 제거한다
    const keyword = options.keyword.replace(/[,()]/g, "").trim();
    if (keyword) {
      query = query.or(
        `name.ilike.%${keyword}%,company.ilike.%${keyword}%,email.ilike.%${keyword}%`,
      );
    }
  }
  if (options?.category) {
    query = query.eq("category", options.category);
  }

  const { data } = await query;
  return (data ?? []) as unknown as ExternalContactWithCreator[];
}
