"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSystemAdmin } from "@/lib/auth/session";
import { diffFields, writeAuditLog } from "@/lib/audit";
import { allowedEmailDomains } from "@/lib/env";
import type { Employee, EmploymentStatus, RoleName } from "@/types/db";

export interface EmployeeActionResult {
  ok: boolean;
  /** 필드별 에러 — 입력창 바로 아래 표시 */
  fieldErrors?: Record<string, string>;
  message?: string;
  employeeId?: string;
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** 관리자 화면 드롭다운에 노출되는 역할 — 시스템 관리자는 제외 (스펙 3.4) */
const ASSIGNABLE_ROLES = ["manager", "employee"] as const;

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

const optionalUuid = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

const baseSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력하세요."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "이메일을 입력하세요.")
    .refine((value) => EMAIL_PATTERN.test(value), "이메일 형식이 올바르지 않습니다.")
    .refine(
      (value) => allowedEmailDomains.includes(value.split("@")[1] ?? ""),
      `회사 도메인(${allowedEmailDomains.map((d) => `@${d}`).join(", ")}) 계정만 등록할 수 있습니다.`,
    ),
  department_id: optionalUuid,
  team_id: optionalUuid,
  position: optionalText,
  hire_date: z.string().trim().min(1, "입사일을 선택하세요."),
  role: z.enum(ASSIGNABLE_ROLES, { message: "역할을 선택하세요." }),
});

const updateSchema = baseSchema.extend({
  employment_status: z.enum(["active", "leave", "terminated"]),
});

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

async function roleIdByName(name: RoleName): Promise<string | null> {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("roles")
    .select("id")
    .eq("name", name)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

/** 임직원 신규 등록 (스펙 3.4) */
export async function createEmployee(
  input: unknown,
): Promise<EmployeeActionResult> {
  const me = await requireSystemAdmin();

  const parsed = baseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const values = parsed.data;

  const admin = createAdminSupabase();

  const { data: duplicate } = await admin
    .from("employees")
    .select("id")
    .ilike("email", values.email)
    .maybeSingle();

  if (duplicate) {
    return {
      ok: false,
      fieldErrors: { email: "이미 등록된 이메일입니다." },
    };
  }

  const roleId = await roleIdByName(values.role);
  if (!roleId) return { ok: false, message: "역할 정보를 찾지 못했습니다." };

  const { data: created, error } = await admin
    .from("employees")
    .insert({
      name: values.name,
      email: values.email,
      department_id: values.department_id ?? null,
      team_id: values.team_id ?? null,
      position: values.position ?? null,
      hire_date: values.hire_date,
      role_id: roleId,
      employment_status: "active" satisfies EmploymentStatus,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) return { ok: false, message: error.message };

  await writeAuditLog({
    actorId: me.id,
    action: "employee_created",
    targetId: created.id,
    detail: {
      after: {
        name: values.name,
        email: values.email,
        role: values.role,
        hire_date: values.hire_date,
      },
    },
  });

  revalidatePath("/admin/employees");
  return { ok: true, employeeId: created.id };
}

/** 임직원 정보 수정 + 재직상태 변경 (스펙 3.4 상세/수정) */
export async function updateEmployee(
  id: string,
  input: unknown,
): Promise<EmployeeActionResult> {
  const me = await requireSystemAdmin();

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const values = parsed.data;

  const admin = createAdminSupabase();
  const { data: before, error: loadError } = await admin
    .from("employees")
    .select(
      "id, name, email, department_id, team_id, position, hire_date, role_id, employment_status",
    )
    .eq("id", id)
    .maybeSingle<
      Pick<
        Employee,
        | "id"
        | "name"
        | "email"
        | "department_id"
        | "team_id"
        | "position"
        | "hire_date"
        | "role_id"
        | "employment_status"
      >
    >();

  if (loadError || !before) {
    return { ok: false, message: "대상 임직원을 찾을 수 없습니다." };
  }

  // 본인 계정의 역할·재직상태를 스스로 내리는 실수를 막는다(단독 관리자 운영이라 복구가 어려움)
  if (before.id === me.id && values.employment_status !== "active") {
    return {
      ok: false,
      fieldErrors: {
        employment_status:
          "본인 계정의 재직상태는 변경할 수 없습니다. 다른 관리자 계정으로 처리하세요.",
      },
    };
  }

  // 이메일 중복 확인(본인 제외)
  if (before.email.toLowerCase() !== values.email) {
    const { data: duplicate } = await admin
      .from("employees")
      .select("id")
      .ilike("email", values.email)
      .neq("id", id)
      .maybeSingle();
    if (duplicate) {
      return { ok: false, fieldErrors: { email: "이미 등록된 이메일입니다." } };
    }
  }

  // 현재 역할이 시스템 관리자면 그대로 유지 (드롭다운에 노출되지 않는 역할이라 덮어쓰면 안 됨)
  const { data: currentRole } = await admin
    .from("roles")
    .select("name")
    .eq("id", before.role_id)
    .maybeSingle<{ name: RoleName }>();

  let nextRoleId = before.role_id;
  if (currentRole?.name !== "system_admin") {
    const roleId = await roleIdByName(values.role);
    if (!roleId) return { ok: false, message: "역할 정보를 찾지 못했습니다." };
    nextRoleId = roleId;
  }

  const patch = {
    name: values.name,
    email: values.email,
    department_id: values.department_id ?? null,
    team_id: values.team_id ?? null,
    position: values.position ?? null,
    hire_date: values.hire_date,
    role_id: nextRoleId,
    employment_status: values.employment_status,
  };

  const { error } = await admin.from("employees").update(patch).eq("id", id);
  if (error) return { ok: false, message: error.message };

  // 재직상태가 바뀌면 auth 계정 차단 여부도 함께 맞춘다
  if (before.employment_status !== values.employment_status) {
    await syncAuthBan(id, values.employment_status);
  }

  const changes = diffFields(
    before as unknown as Record<string, unknown>,
    patch as unknown as Record<string, unknown>,
  );

  if (changes) {
    await writeAuditLog({
      actorId: me.id,
      action:
        before.employment_status !== values.employment_status
          ? "employment_status_changed"
          : before.role_id !== nextRoleId
            ? "role_changed"
            : "employee_updated",
      targetId: id,
      detail: changes,
    });
  }

  // 조직 이동·승진은 프로필 상세 타임라인(스펙 02 · 3.2)에 별도 action으로 남긴다.
  // 위의 employee_updated 로그는 관리자용이고, 이쪽은 전 직원이 보는 이력이다.
  const movedOrg =
    before.department_id !== patch.department_id ||
    before.team_id !== patch.team_id;
  if (movedOrg) {
    await writeAuditLog({
      actorId: me.id,
      action: "employee_transferred",
      targetId: id,
      detail: {
        before: {
          department_id: before.department_id,
          team_id: before.team_id,
        },
        after: { department_id: patch.department_id, team_id: patch.team_id },
      },
    });
  }

  if ((before.position ?? null) !== (patch.position ?? null)) {
    await writeAuditLog({
      actorId: me.id,
      action: "employee_promoted",
      targetId: id,
      detail: {
        before: { position: before.position },
        after: { position: patch.position },
      },
    });
  }

  revalidatePath("/admin/employees");
  revalidatePath(`/admin/employees/${id}`);
  revalidatePath("/directory");
  return { ok: true, employeeId: id };
}

/**
 * 재직상태에 맞춰 Supabase Auth 계정 차단(ban)을 동기화한다.
 *
 * 미들웨어가 매 요청 재직상태를 확인하지만, 이미 발급된 refresh 토큰까지
 * 확실히 끊으려면 auth 레이어에서도 막아야 한다. ban 처리 시 기존 세션이 무효화된다.
 * 재직중으로 되돌리면 차단을 해제한다.
 */
async function syncAuthBan(
  employeeId: string,
  status: EmploymentStatus,
): Promise<void> {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("employees")
    .select("auth_user_id")
    .eq("id", employeeId)
    .maybeSingle<{ auth_user_id: string | null }>();

  // 아직 한 번도 로그인하지 않은 계정은 auth 사용자가 없다
  if (!data?.auth_user_id) return;

  // 100년 = 사실상 영구 차단. 'none'은 차단 해제.
  const banDuration = status === "active" ? "none" : "876000h";

  const { error } = await admin.auth.admin.updateUserById(data.auth_user_id, {
    ban_duration: banDuration,
  });

  if (error) {
    // 실패해도 미들웨어가 접근을 계속 차단하므로 본 처리를 되돌리지 않는다
    console.error("[employees] auth 계정 차단 동기화 실패", error.message);
  }
}

/** 부서 선택에 따른 팀 옵션 필터링용 (클라이언트에서 호출) */
export async function listTeamsByDepartment(
  departmentId: string | null,
): Promise<{ id: string; name: string }[]> {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  let query = supabase.from("teams").select("id, name").order("name");
  if (departmentId) query = query.eq("department_id", departmentId);

  const { data } = await query;
  return data ?? [];
}
