/**
 * DB 타입 정의 (수기 관리)
 * 스키마 근거: aimbridge_intranet_spec_01_auth_dashboard.md 4장
 *
 * 참고: 테이블이 늘어나면
 *   npx supabase gen types typescript --project-id <ref> > src/types/supabase.ts
 * 로 자동생성으로 전환하는 걸 권장한다.
 */

export type EmploymentStatus = "active" | "leave" | "terminated";
export type RoleName = "system_admin" | "manager" | "employee";

export type AuditAction =
  | "login"
  | "login_denied"
  | "employee_created"
  | "employee_updated"
  | "employment_status_changed"
  | "role_changed"
  | "profile_updated";

export type WidgetKey =
  | "approval_pending"
  | "attendance_today"
  | "notices"
  | "calendar_upcoming"
  | "favorites";

export interface Department {
  id: string;
  name: string;
  parent_id: string | null;
  manager_id: string | null;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  department_id: string | null;
  manager_id: string | null;
  created_at: string;
}

export interface Role {
  id: string;
  name: RoleName;
  label: string;
  is_system_role: boolean;
}

export interface Employee {
  id: string;
  auth_user_id: string | null;
  email: string;
  name: string;
  department_id: string | null;
  team_id: string | null;
  position: string | null;
  role_id: string;
  employment_status: EmploymentStatus;
  hire_date: string | null;
  phone: string | null;
  emergency_contact: string | null;
  profile_image_url: string | null;
  created_at: string;
  updated_at: string;
}

/** 목록·상세에서 조인해 쓰는 형태 */
export interface EmployeeWithRelations extends Employee {
  role: Pick<Role, "id" | "name" | "label"> | null;
  department: Pick<Department, "id" | "name"> | null;
  team: Pick<Team, "id" | "name"> | null;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: AuditAction;
  target_id: string | null;
  detail: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
  created_at: string;
}

export interface AuditLogWithActor extends AuditLog {
  actor: Pick<Employee, "id" | "name" | "email"> | null;
}

export interface DashboardWidget {
  id: string;
  employee_id: string;
  widget_key: WidgetKey;
  is_visible: boolean;
  sort_order: number;
}

export interface Favorite {
  id: string;
  employee_id: string;
  label: string;
  target_path: string;
  sort_order: number;
  created_at: string;
}

/** 로그인한 사용자 세션 컨텍스트 */
export interface SessionEmployee extends EmployeeWithRelations {
  roleName: RoleName;
  isSystemAdmin: boolean;
  isManager: boolean;
}
