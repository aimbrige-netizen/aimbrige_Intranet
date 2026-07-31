"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSessionEmployee } from "@/lib/auth/session";
import { todayYmd } from "@/features/calendar/date";

/**
 * 업무일지 생성·수정·삭제 (스펙 09 · 3.1)
 *
 * 쓰기는 언제나 본인 것만이다. RLS(work_logs_insert/update/delete)가 이미
 * employee_id = current_employee_id()로 막지만, 여기서도 employee_id를
 * 조건에 실어 둔다 — 팀장 조회 화면에서 실수로 수정 경로가 열리면
 * DB 오류 메시지가 아니라 "찾지 못했습니다"로 끝나는 편이 낫다.
 */
export interface WorklogActionResult {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  message?: string;
}

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 태깅은 선택. 빈 문자열은 클라이언트에서 null로 바꿔 보낸다 */
const projectIdSchema = z
  .string()
  .regex(UUID, "프로젝트를 다시 선택하세요.")
  .nullable()
  .optional();

/**
 * 내용은 공백만이면 안 된다 — work_logs_content_not_blank(btrim(content) <> '')
 * 제약과 같은 규칙을 폼 단계에서 먼저 잡는다.
 */
const contentSchema = z
  .string()
  .trim()
  .min(1, "내용을 입력하세요.")
  .max(4000, "내용은 4000자까지 입력할 수 있습니다.");

const createSchema = z.object({
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜를 선택하세요."),
  content: contentSchema,
  projectId: projectIdSchema,
});

const updateSchema = z.object({
  content: contentSchema,
  projectId: projectIdSchema,
});

export async function createWorkLog(
  input: unknown,
): Promise<WorklogActionResult> {
  const me = await requireSessionEmployee();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  // 업무일지는 "한 일"의 기록이다. 아직 오지 않은 날은 기록할 것이 없다
  if (v.logDate > todayYmd()) {
    return {
      ok: false,
      fieldErrors: { logDate: "아직 오지 않은 날짜에는 기록할 수 없습니다." },
    };
  }

  const supabase = createServerSupabase();
  const { error } = await supabase.from("work_logs").insert({
    employee_id: me.id,
    log_date: v.logDate,
    content: v.content,
    project_id: v.projectId ?? null,
  });

  if (error) {
    console.error("[worklog] 기록 저장 실패:", error.message);
    return { ok: false, message: error.message };
  }

  revalidatePath("/worklog");
  return { ok: true };
}

export async function updateWorkLog(
  id: string,
  input: unknown,
): Promise<WorklogActionResult> {
  const me = await requireSessionEmployee();
  if (!UUID.test(id)) {
    return { ok: false, message: "잘못된 기록입니다." };
  }

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("work_logs")
    .update({ content: v.content, project_id: v.projectId ?? null })
    .eq("id", id)
    .eq("employee_id", me.id)
    .select("id");

  if (error) {
    console.error("[worklog] 기록 수정 실패:", error.message);
    return { ok: false, message: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, message: "수정할 기록을 찾지 못했습니다." };
  }

  revalidatePath("/worklog");
  return { ok: true };
}

export async function deleteWorkLog(
  id: string,
): Promise<WorklogActionResult> {
  const me = await requireSessionEmployee();
  if (!UUID.test(id)) {
    return { ok: false, message: "잘못된 기록입니다." };
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("work_logs")
    .delete()
    .eq("id", id)
    .eq("employee_id", me.id)
    .select("id");

  if (error) {
    console.error("[worklog] 기록 삭제 실패:", error.message);
    return { ok: false, message: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, message: "삭제할 기록을 찾지 못했습니다." };
  }

  revalidatePath("/worklog");
  return { ok: true };
}
