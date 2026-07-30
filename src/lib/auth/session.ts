import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import type { EmployeeWithRelations, SessionEmployee } from "@/types/db";

const EMPLOYEE_SELECT = `
  id, auth_user_id, email, name, department_id, team_id, position, role_id,
  employment_status, hire_date, phone, emergency_contact, profile_image_url,
  created_at, updated_at,
  role:roles(id, name, label),
  department:departments(id, name),
  team:teams(id, name)
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

    const { data } = await supabase
      .from("employees")
      .select(EMPLOYEE_SELECT)
      .eq("auth_user_id", user.id)
      .maybeSingle<EmployeeWithRelations>();

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
