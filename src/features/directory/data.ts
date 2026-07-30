import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type {
  Department,
  Employee,
  EmployeeWithRelations,
  ExternalContactWithCreator,
  Team,
} from "@/types/db";

/** 조직도·목록 뷰에서 쓰는 임직원 요약 */
export type DirectoryEmployee = Pick<
  Employee,
  | "id"
  | "name"
  | "email"
  | "position"
  | "phone"
  | "profile_image_url"
  | "employment_status"
  | "department_id"
  | "team_id"
  | "hire_date"
>;

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

/** 임직원 프로필 상세 (동료 조회용, 스펙 3.2) */
export async function getDirectoryEmployee(
  id: string,
): Promise<EmployeeWithRelations | null> {
  const supabase = createServerSupabase();

  const { data } = await supabase
    .from("employees")
    .select(
      `id, auth_user_id, email, name, department_id, team_id, position, role_id,
       employment_status, hire_date, phone, responsibilities, profile_image_url,
       created_at, updated_at,
       role:roles(id, name, label),
       department:departments!department_id(id, name),
       team:teams!team_id(id, name)`,
    )
    .eq("id", id)
    .maybeSingle<EmployeeWithRelations>();

  return data ?? null;
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
