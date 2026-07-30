"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { requireSystemAdmin } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";

export interface OrgActionResult {
  ok: boolean;
  message?: string;
  id?: string;
}

const nameSchema = z.string().trim().min(1, "이름을 입력하세요.").max(60);
const optionalId = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/**
 * 부서/팀 관리 (스펙 02 · 3.1 편집 모드, 4장 "별도 화면 없이 조직도에서 CUD")
 * 모두 시스템 관리자 전용이며 변경은 감사 로그에 남긴다.
 */

export async function createDepartment(input: {
  name: string;
  parentId?: string | null;
}): Promise<OrgActionResult> {
  const me = await requireSystemAdmin();
  const parsed = z
    .object({ name: nameSchema, parentId: optionalId })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message };
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("departments")
    .insert({ name: parsed.data.name, parent_id: parsed.data.parentId ?? null })
    .select("id")
    .single<{ id: string }>();

  if (error) return { ok: false, message: error.message };

  await writeAuditLog({
    actorId: me.id,
    action: "department_created",
    targetId: data.id,
    detail: { after: { name: parsed.data.name } },
  });

  revalidatePath("/directory");
  return { ok: true, id: data.id };
}

export async function updateDepartment(
  id: string,
  input: { name: string; parentId?: string | null; managerId?: string | null },
): Promise<OrgActionResult> {
  const me = await requireSystemAdmin();
  const parsed = z
    .object({
      name: nameSchema,
      parentId: optionalId,
      managerId: optionalId,
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message };
  }

  // 자기 자신을 상위 부서로 지정하면 트리가 끊어진다
  if (parsed.data.parentId === id) {
    return { ok: false, message: "자기 자신을 상위 부서로 지정할 수 없습니다." };
  }

  const admin = createAdminSupabase();

  const { data: before } = await admin
    .from("departments")
    .select("id, name, parent_id, manager_id")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      name: string;
      parent_id: string | null;
      manager_id: string | null;
    }>();

  if (!before) return { ok: false, message: "부서를 찾을 수 없습니다." };

  // 순환 참조 방지: 새 상위가 이 부서의 하위인지 확인
  if (parsed.data.parentId) {
    const { data: all } = await admin
      .from("departments")
      .select("id, parent_id");
    if (isDescendant(all ?? [], parsed.data.parentId, id)) {
      return {
        ok: false,
        message: "하위 부서를 상위 부서로 지정할 수 없습니다.",
      };
    }
  }

  const { error } = await admin
    .from("departments")
    .update({
      name: parsed.data.name,
      parent_id: parsed.data.parentId ?? null,
      manager_id: parsed.data.managerId ?? null,
    })
    .eq("id", id);

  if (error) return { ok: false, message: error.message };

  await writeAuditLog({
    actorId: me.id,
    action: "department_updated",
    targetId: id,
    detail: {
      before: { name: before.name, parent_id: before.parent_id },
      after: { name: parsed.data.name, parent_id: parsed.data.parentId ?? null },
    },
  });

  revalidatePath("/directory");
  return { ok: true, id };
}

export async function deleteDepartment(id: string): Promise<OrgActionResult> {
  const me = await requireSystemAdmin();
  const admin = createAdminSupabase();

  // 소속 인원·하위 조직이 남아 있으면 지우지 않는다(고아 데이터 방지)
  const [{ count: employeeCount }, { count: teamCount }, { count: childCount }] =
    await Promise.all([
      admin
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("department_id", id),
      admin
        .from("teams")
        .select("id", { count: "exact", head: true })
        .eq("department_id", id),
      admin
        .from("departments")
        .select("id", { count: "exact", head: true })
        .eq("parent_id", id),
    ]);

  if ((employeeCount ?? 0) > 0) {
    return {
      ok: false,
      message: `소속 임직원이 ${employeeCount}명 있어 삭제할 수 없습니다. 먼저 소속을 옮기세요.`,
    };
  }
  if ((teamCount ?? 0) > 0 || (childCount ?? 0) > 0) {
    return {
      ok: false,
      message: "하위 팀 또는 하위 부서가 있어 삭제할 수 없습니다.",
    };
  }

  const { data: before } = await admin
    .from("departments")
    .select("name")
    .eq("id", id)
    .maybeSingle<{ name: string }>();

  const { error } = await admin.from("departments").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };

  await writeAuditLog({
    actorId: me.id,
    action: "department_deleted",
    targetId: id,
    detail: { before: { name: before?.name ?? null } },
  });

  revalidatePath("/directory");
  return { ok: true };
}

export async function createTeam(input: {
  name: string;
  departmentId?: string | null;
}): Promise<OrgActionResult> {
  const me = await requireSystemAdmin();
  const parsed = z
    .object({ name: nameSchema, departmentId: optionalId })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message };
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("teams")
    .insert({
      name: parsed.data.name,
      department_id: parsed.data.departmentId ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) return { ok: false, message: error.message };

  await writeAuditLog({
    actorId: me.id,
    action: "team_created",
    targetId: data.id,
    detail: { after: { name: parsed.data.name } },
  });

  revalidatePath("/directory");
  return { ok: true, id: data.id };
}

export async function updateTeam(
  id: string,
  input: { name: string; departmentId?: string | null; managerId?: string | null },
): Promise<OrgActionResult> {
  const me = await requireSystemAdmin();
  const parsed = z
    .object({
      name: nameSchema,
      departmentId: optionalId,
      managerId: optionalId,
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message };
  }

  const admin = createAdminSupabase();
  const { data: before } = await admin
    .from("teams")
    .select("name, department_id")
    .eq("id", id)
    .maybeSingle<{ name: string; department_id: string | null }>();

  if (!before) return { ok: false, message: "팀을 찾을 수 없습니다." };

  const { error } = await admin
    .from("teams")
    .update({
      name: parsed.data.name,
      department_id: parsed.data.departmentId ?? null,
      manager_id: parsed.data.managerId ?? null,
    })
    .eq("id", id);

  if (error) return { ok: false, message: error.message };

  await writeAuditLog({
    actorId: me.id,
    action: "team_updated",
    targetId: id,
    detail: {
      before: { name: before.name, department_id: before.department_id },
      after: {
        name: parsed.data.name,
        department_id: parsed.data.departmentId ?? null,
      },
    },
  });

  revalidatePath("/directory");
  return { ok: true, id };
}

export async function deleteTeam(id: string): Promise<OrgActionResult> {
  const me = await requireSystemAdmin();
  const admin = createAdminSupabase();

  const { count } = await admin
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("team_id", id);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: `소속 임직원이 ${count}명 있어 삭제할 수 없습니다. 먼저 소속을 옮기세요.`,
    };
  }

  const { data: before } = await admin
    .from("teams")
    .select("name")
    .eq("id", id)
    .maybeSingle<{ name: string }>();

  const { error } = await admin.from("teams").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };

  await writeAuditLog({
    actorId: me.id,
    action: "team_deleted",
    targetId: id,
    detail: { before: { name: before?.name ?? null } },
  });

  revalidatePath("/directory");
  return { ok: true };
}

/** candidate가 root의 하위 트리에 속하는지 (순환 참조 검사용) */
function isDescendant(
  rows: { id: string; parent_id: string | null }[],
  candidate: string,
  root: string,
): boolean {
  const byId = new Map(rows.map((r) => [r.id, r.parent_id]));
  let cursor: string | null | undefined = candidate;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === root) return true;
    if (seen.has(cursor)) break; // 이미 깨진 데이터 방어
    seen.add(cursor);
    cursor = byId.get(cursor) ?? null;
  }
  return false;
}
