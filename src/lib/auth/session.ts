import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import type { EmployeeWithRelations, SessionEmployee } from "@/types/db";

// departments!department_id / teams!team_id: employees<->departments,teams 사이에
// FK가 두 방향(소속 department_id/team_id, 그리고 부서·팀의 manager_id)으로 있어서
// 힌트 없이 embed하면 PostgREST가 "more than one relationship" 에러를 낸다.
// emergency_contact는 컬럼 권한에서 제외돼 있어 여기서 조회하지 않는다.
// 필요한 화면에서 getEmergencyContact()로 따로 가져온다.
const EMPLOYEE_SELECT = `
  id, auth_user_id, email, name, department_id, team_id, position, role_id,
  employment_status, hire_date, phone, responsibilities, profile_image_url,
  created_at, updated_at,
  role:roles(id, name, label),
  department:departments!department_id(id, name),
  team:teams!team_id(id, name)
` as const;

/**
 * 현재 로그인한 임직원 정보. 같은 요청 안에서는 한 번만 조회한다(react cache).
 * 접근 차단 판단은 미들웨어가 이미 했지만, 서버 컴포넌트에서도 방어적으로 재확인한다.
 */
export const getSessionEmployee = cache(
  async (): Promise<SessionEmployee | null> => {
    const supabase = createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("employees")
      .select(EMPLOYEE_SELECT)
      .eq("auth_user_id", user.id)
      .maybeSingle<EmployeeWithRelations>();

    if (error) {
      console.error("[session] employees 조회 실패:", error.message);
    }

    if (!data || data.employment_status !== "active") return null;

    const roleName = data.role?.name ?? "employee";
    return {
      ...data,
      roleName,
      isSystemAdmin: roleName === "system_admin",
      isManager: roleName === "manager" || roleName === "system_admin",
    };
  },
);

/**
 * 비상연락처 조회. 컬럼 권한으로 일반 SELECT에서 막혀 있어 RPC로만 읽는다.
 * 본인 또는 시스템 관리자가 아니면 DB 함수가 예외를 던진다.
 */
export async function getEmergencyContact(
  employeeId: string,
): Promise<string | null> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("get_emergency_contact", {
    target_employee_id: employeeId,
  });

  if (error) {
    console.error("[session] 비상연락처 조회 실패:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

/** 로그인 필수 페이지에서 사용 */
export async function requireSessionEmployee(): Promise<SessionEmployee> {
  const employee = await getSessionEmployee();
  if (!employee) redirect("/login");
  return employee;
}

/** 시스템 관리자 전용 페이지에서 사용 (미들웨어 뒤 2차 방어선) */
export async function requireSystemAdmin(): Promise<SessionEmployee> {
  const employee = await requireSessionEmployee();
  if (!employee.isSystemAdmin) redirect("/?denied=admin_only");
  return employee;
}
