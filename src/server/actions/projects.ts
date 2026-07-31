"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSessionEmployee } from "@/lib/auth/session";
import {
  PROJECT_FILE_BUCKET,
  PROJECT_STATUSES,
  type ProjectStatus,
} from "@/features/projects/types";

/**
 * 프로젝트 관리 (스펙 10)
 *
 * DB 제약을 코드가 먼저 지킨다:
 *   projects_name_not_blank          공백만 있는 이름 금지
 *   projects_date_order              종료일 >= 시작일
 *   milestones_title_not_blank       공백만 있는 마일스톤 제목 금지
 *   milestones_completed_consistent  is_completed와 completed_at은 언제나
 *                                    같은 update 한 번에 함께 쓴다
 *
 * 권한은 RLS가 최종 판정한다:
 *   INSERT  is_manager_or_admin()          — 팀장/매니저 이상
 *   UPDATE  담당자(owner_id) 또는 시스템 관리자
 *   마일스톤·산출물  can_edit_project()    — 위와 같은 기준
 * 서버 액션에서도 같은 기준을 먼저 확인해 친절한 문장을 돌려주고,
 * RLS가 0행으로 막았을 때는 그 사실을 그대로 알린다.
 */

export interface ProjectActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  projectId?: string;
}

export interface FileActionResult {
  ok: boolean;
  message?: string;
  url?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idSchema = z.string().regex(UUID, "대상을 찾을 수 없습니다.");

/** 빈 문자열은 "값 없음"이다 — DB에는 null로 넣는다 */
const optionalId = z
  .string()
  .trim()
  .refine((v) => v === "" || UUID.test(v), "잘못된 선택입니다.")
  .optional();

const optionalDate = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "날짜 형식이 올바르지 않습니다.")
  .optional();

const projectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "프로젝트명을 입력하세요.")
      .max(120, "120자 이내로 입력하세요."),
    teamId: optionalId,
    ownerId: optionalId,
    startDate: optionalDate,
    endDate: optionalDate,
    description: z
      .string()
      .trim()
      .max(4000, "4000자 이내로 입력하세요.")
      .optional(),
  })
  // projects_date_order를 코드에서 먼저 막는다 — DB 오류 문구가 그대로 뜨지 않게
  .refine(
    (v) => !v.startDate || !v.endDate || v.endDate >= v.startDate,
    { path: ["endDate"], message: "종료일은 시작일과 같거나 뒤여야 합니다." },
  );

const milestoneInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "마일스톤 제목을 입력하세요.")
    .max(120, "120자 이내로 입력하세요."),
  dueDate: optionalDate,
});

const createSchema = projectSchema.and(
  z.object({
    /** 초기 마일스톤 — 제목이 비어 있는 줄은 폼에서 이미 걸러 보낸다 */
    milestones: z.array(milestoneInputSchema).max(30).optional(),
  }),
);

const statusSchema = z.enum(PROJECT_STATUSES);

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

const DENIED = "이 프로젝트를 고칠 수 있는 사람은 담당자와 시스템 관리자입니다.";

/** RLS가 0행으로 막았는지, 진짜 오류인지 구분해 문장을 고른다 */
function writeError(
  error: { code?: string; message: string } | null,
  count: number | null,
): string | null {
  if (error) {
    return error.code === "42501" ? DENIED : error.message;
  }
  if (count === 0) return DENIED;
  return null;
}

function refresh(projectId?: string) {
  revalidatePath("/projects");
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

// ---------------------------------------------------------------------
// 프로젝트
// ---------------------------------------------------------------------

/**
 * 새 프로젝트 등록 (스펙 3.2).
 *
 * 초기 마일스톤은 프로젝트가 생긴 뒤에만 붙일 수 있어 두 번에 나눠 넣는다.
 * 벌크 insert는 배열 안 행마다 키가 다르면 빠진 키에 기본값이 아니라 NULL이
 * 들어가므로(이 프로젝트에서 실제로 터진 적이 있다) 모든 행의 키를 똑같이 맞춘다.
 */
export async function createProject(
  input: unknown,
): Promise<ProjectActionResult> {
  const me = await requireSessionEmployee();
  if (!me.isManager) {
    return {
      ok: false,
      message: "프로젝트 등록은 팀장/매니저 이상만 할 수 있습니다.",
    };
  }

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const v = parsed.data;

  // 담당자를 비워 두면 본인이 담당자다 (스펙 3.2 "기본값 본인")
  const ownerId = v.ownerId ? v.ownerId : me.id;

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      name: v.name,
      team_id: v.teamId ? v.teamId : null,
      owner_id: ownerId,
      status: "planning",
      start_date: v.startDate ? v.startDate : null,
      end_date: v.endDate ? v.endDate : null,
      description: v.description ? v.description : null,
      result_summary: null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    console.error("[projects] 등록 실패:", error.message);
    return {
      ok: false,
      message:
        error.code === "42501"
          ? "프로젝트 등록은 팀장/매니저 이상만 할 수 있습니다."
          : error.message,
    };
  }

  const projectId = data.id;
  const milestones = (v.milestones ?? []).filter((m) => m.title.trim());

  if (milestones.length > 0) {
    const { error: milestoneError } = await supabase
      .from("project_milestones")
      .insert(
        milestones.map((m, index) => ({
          project_id: projectId,
          title: m.title,
          // 모든 행이 같은 키를 갖도록 값이 없어도 자리를 비우지 않는다
          due_date: m.dueDate ? m.dueDate : null,
          is_completed: false,
          completed_at: null,
          sort_order: index,
        })),
      );

    if (milestoneError) {
      console.error(
        "[projects] 초기 마일스톤 등록 실패:",
        milestoneError.message,
      );
      refresh(projectId);
      // 프로젝트 자체는 만들어졌다. 되돌리는 대신 사실대로 알리고 열 수 있게 둔다
      return {
        ok: true,
        projectId,
        message: `프로젝트는 등록됐지만 초기 마일스톤을 저장하지 못했습니다: ${milestoneError.message}`,
      };
    }
  }

  refresh(projectId);
  return { ok: true, projectId };
}

/** 기본 정보 수정 — 담당자·관리자만 (RLS가 최종 판정) */
export async function updateProject(
  id: string,
  input: unknown,
): Promise<ProjectActionResult> {
  const me = await requireSessionEmployee();

  const key = idSchema.safeParse(id);
  if (!key.success) return { ok: false, message: "대상을 찾을 수 없습니다." };

  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const v = parsed.data;

  const ownerId = v.ownerId ? v.ownerId : null;

  /*
   * 담당자를 남에게 넘기면 RLS의 with check가 새 행을 다시 검사한다.
   * 관리자가 아닌 담당자는 그 순간 자기 권한을 잃으므로 update 자체가 막힌다.
   * DB가 뱉는 42501보다 먼저 이유를 알려 준다.
   */
  if (!me.isSystemAdmin && ownerId !== me.id) {
    return {
      ok: false,
      fieldErrors: {
        ownerId:
          "담당자를 다른 사람으로 바꾸는 것은 시스템 관리자만 할 수 있습니다.",
      },
    };
  }

  const supabase = createServerSupabase();
  const { error, count } = await supabase
    .from("projects")
    .update(
      {
        name: v.name,
        team_id: v.teamId ? v.teamId : null,
        owner_id: ownerId,
        start_date: v.startDate ? v.startDate : null,
        end_date: v.endDate ? v.endDate : null,
        description: v.description ? v.description : null,
      },
      { count: "exact" },
    )
    .eq("id", key.data);

  const failure = writeError(error, count);
  if (failure) {
    if (error) console.error("[projects] 수정 실패:", error.message);
    return { ok: false, message: failure };
  }

  refresh(key.data);
  return { ok: true, projectId: key.data };
}

/**
 * 상태 변경 (스펙 3.3 상태 변경 드롭다운).
 *
 * 완료로 넘길 때는 결과 요약을 함께 받는다 — 스펙이 둘을 한 동작으로 묶어 뒀고,
 * 나중에 채우겠다고 비워 두면 "무엇을 해서 끝났는지"가 영원히 비어 있게 된다.
 * 완료가 아닌 상태로 되돌릴 때는 이미 적어 둔 요약을 지우지 않는다.
 */
export async function setProjectStatus(
  id: string,
  status: ProjectStatus,
  resultSummary?: string,
): Promise<ProjectActionResult> {
  await requireSessionEmployee();

  const key = idSchema.safeParse(id);
  if (!key.success) return { ok: false, message: "대상을 찾을 수 없습니다." };

  const parsedStatus = statusSchema.safeParse(status);
  if (!parsedStatus.success) {
    return { ok: false, message: "알 수 없는 상태입니다." };
  }

  const patch: Record<string, unknown> = { status: parsedStatus.data };

  if (parsedStatus.data === "completed") {
    const summary = (resultSummary ?? "").trim();
    if (!summary) {
      return {
        ok: false,
        fieldErrors: { resultSummary: "완료 처리하려면 결과 요약을 입력하세요." },
      };
    }
    if (summary.length > 4000) {
      return {
        ok: false,
        fieldErrors: { resultSummary: "4000자 이내로 입력하세요." },
      };
    }
    patch.result_summary = summary;
  }

  const supabase = createServerSupabase();
  const { error, count } = await supabase
    .from("projects")
    .update(patch, { count: "exact" })
    .eq("id", key.data);

  const failure = writeError(error, count);
  if (failure) {
    if (error) console.error("[projects] 상태 변경 실패:", error.message);
    return { ok: false, message: failure };
  }

  refresh(key.data);
  return { ok: true, projectId: key.data };
}

/** 결과 요약만 고치기 — 상태는 그대로 둔다 */
export async function saveProjectResult(
  id: string,
  summary: string,
): Promise<ProjectActionResult> {
  await requireSessionEmployee();

  const key = idSchema.safeParse(id);
  if (!key.success) return { ok: false, message: "대상을 찾을 수 없습니다." };

  const text = (summary ?? "").trim();
  if (text.length > 4000) {
    return {
      ok: false,
      fieldErrors: { resultSummary: "4000자 이내로 입력하세요." },
    };
  }

  const supabase = createServerSupabase();
  const { error, count } = await supabase
    .from("projects")
    .update({ result_summary: text ? text : null }, { count: "exact" })
    .eq("id", key.data);

  const failure = writeError(error, count);
  if (failure) {
    if (error) console.error("[projects] 결과 요약 저장 실패:", error.message);
    return { ok: false, message: failure };
  }

  refresh(key.data);
  return { ok: true, projectId: key.data };
}

// ---------------------------------------------------------------------
// 마일스톤
// ---------------------------------------------------------------------

export async function addMilestone(
  projectId: string,
  input: unknown,
): Promise<ProjectActionResult> {
  await requireSessionEmployee();

  const key = idSchema.safeParse(projectId);
  if (!key.success) return { ok: false, message: "대상을 찾을 수 없습니다." };

  const parsed = milestoneInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const supabase = createServerSupabase();

  // 맨 뒤에 붙인다 — 마일스톤 목록의 기본 순서는 "일이 벌어지는 차례"다
  const { data: last } = await supabase
    .from("project_milestones")
    .select("sort_order")
    .eq("project_id", key.data)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();

  const { error } = await supabase.from("project_milestones").insert({
    project_id: key.data,
    title: parsed.data.title,
    due_date: parsed.data.dueDate ? parsed.data.dueDate : null,
    // 새 마일스톤은 언제나 미완료다 — 두 값을 짝으로 맞춰 넣는다
    is_completed: false,
    completed_at: null,
    sort_order: (last?.sort_order ?? -1) + 1,
  });

  if (error) {
    console.error("[projects] 마일스톤 추가 실패:", error.message);
    return {
      ok: false,
      message: error.code === "42501" ? DENIED : error.message,
    };
  }

  refresh(key.data);
  return { ok: true, projectId: key.data };
}

export async function updateMilestone(
  milestoneId: string,
  projectId: string,
  input: unknown,
): Promise<ProjectActionResult> {
  await requireSessionEmployee();

  const key = idSchema.safeParse(milestoneId);
  const project = idSchema.safeParse(projectId);
  if (!key.success || !project.success) {
    return { ok: false, message: "대상을 찾을 수 없습니다." };
  }

  const parsed = milestoneInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const supabase = createServerSupabase();
  const { error, count } = await supabase
    .from("project_milestones")
    .update(
      {
        title: parsed.data.title,
        due_date: parsed.data.dueDate ? parsed.data.dueDate : null,
      },
      { count: "exact" },
    )
    .eq("id", key.data);

  const failure = writeError(error, count);
  if (failure) {
    if (error) console.error("[projects] 마일스톤 수정 실패:", error.message);
    return { ok: false, message: failure };
  }

  refresh(project.data);
  return { ok: true, projectId: project.data };
}

/**
 * 완료 체크 토글.
 * is_completed와 completed_at은 반드시 같은 update 한 번에 함께 쓴다 —
 * 나눠 쓰면 그 사이에 milestones_completed_consistent를 어기는 순간이 생긴다.
 */
export async function setMilestoneCompleted(
  milestoneId: string,
  projectId: string,
  isCompleted: boolean,
): Promise<ProjectActionResult> {
  await requireSessionEmployee();

  const key = idSchema.safeParse(milestoneId);
  const project = idSchema.safeParse(projectId);
  if (!key.success || !project.success) {
    return { ok: false, message: "대상을 찾을 수 없습니다." };
  }

  const supabase = createServerSupabase();
  const { error, count } = await supabase
    .from("project_milestones")
    .update(
      {
        is_completed: isCompleted,
        completed_at: isCompleted ? new Date().toISOString() : null,
      },
      { count: "exact" },
    )
    .eq("id", key.data);

  const failure = writeError(error, count);
  if (failure) {
    if (error) console.error("[projects] 마일스톤 완료 처리 실패:", error.message);
    return { ok: false, message: failure };
  }

  refresh(project.data);
  return { ok: true, projectId: project.data };
}

export async function removeMilestone(
  milestoneId: string,
  projectId: string,
): Promise<ProjectActionResult> {
  await requireSessionEmployee();

  const key = idSchema.safeParse(milestoneId);
  const project = idSchema.safeParse(projectId);
  if (!key.success || !project.success) {
    return { ok: false, message: "대상을 찾을 수 없습니다." };
  }

  const supabase = createServerSupabase();
  const { error, count } = await supabase
    .from("project_milestones")
    .delete({ count: "exact" })
    .eq("id", key.data);

  const failure = writeError(error, count);
  if (failure) {
    if (error) console.error("[projects] 마일스톤 삭제 실패:", error.message);
    return { ok: false, message: failure };
  }

  refresh(project.data);
  return { ok: true, projectId: project.data };
}

// ---------------------------------------------------------------------
// 산출물 파일
//
// 업로드 경로는 `<auth uid>/<프로젝트 id>/<시각>-<파일명>` 규칙을 지킨다 —
// 스토리지 정책이 경로 첫 세그먼트를 auth.uid()와 대조하므로(마이그레이션 19)
// 이 형식 자체가 권한 판정이다. 게시판·결재 첨부와 같은 규칙이고,
// 서버에서도 한 번 더 대조한다. 비공개 버킷이라 다운로드는 서명 URL만 가능하다.
// ---------------------------------------------------------------------

export async function registerProjectFile(
  projectId: string,
  storagePath: string,
  fileName: string,
  fileSize: number,
): Promise<FileActionResult> {
  const me = await requireSessionEmployee();

  const project = idSchema.safeParse(projectId);
  if (!project.success) return { ok: false, message: "대상을 찾을 수 없습니다." };

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "세션이 만료되었습니다." };

  if (!storagePath.startsWith(`${user.id}/${project.data}/`)) {
    return { ok: false, message: "첨부 경로가 올바르지 않습니다." };
  }

  const { error } = await supabase.from("project_files").insert({
    project_id: project.data,
    file_url: storagePath,
    file_name: fileName,
    file_size: fileSize,
    uploaded_by: me.id,
  });

  if (error) {
    console.error("[projects] 산출물 등록 실패:", error.message);
    return {
      ok: false,
      message: error.code === "42501" ? DENIED : error.message,
    };
  }

  refresh(project.data);
  return { ok: true };
}

/** 산출물 삭제 — 메타 행과 실제 파일을 함께 정리한다 */
export async function removeProjectFile(
  fileId: string,
  projectId: string,
): Promise<FileActionResult> {
  await requireSessionEmployee();

  const key = idSchema.safeParse(fileId);
  const project = idSchema.safeParse(projectId);
  if (!key.success || !project.success) {
    return { ok: false, message: "대상을 찾을 수 없습니다." };
  }

  const supabase = createServerSupabase();

  const { data: row } = await supabase
    .from("project_files")
    .select("file_url")
    .eq("id", key.data)
    .maybeSingle<{ file_url: string }>();

  const { error, count } = await supabase
    .from("project_files")
    .delete({ count: "exact" })
    .eq("id", key.data);

  const failure = writeError(error, count);
  if (failure) {
    if (error) console.error("[projects] 산출물 삭제 실패:", error.message);
    return { ok: false, message: failure };
  }

  /*
   * 메타를 지웠으면 파일도 지운다.
   * 스토리지 삭제 정책은 경로 첫 세그먼트(업로더) 또는 관리자만 통과시키므로,
   * 남의 경로를 지우는 담당자는 여기서 실패할 수 있다. 그렇다고 목록에
   * 되살릴 일은 아니라 로그만 남긴다.
   */
  if (row?.file_url) {
    const { error: storageError } = await supabase.storage
      .from(PROJECT_FILE_BUCKET)
      .remove([row.file_url]);
    if (storageError) {
      console.error("[projects] 산출물 파일 정리 실패:", storageError.message);
    }
  }

  refresh(project.data);
  return { ok: true };
}

/** 다운로드용 서명 URL (5분) */
export async function getProjectFileUrl(
  storagePath: string,
): Promise<FileActionResult> {
  await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { data, error } = await supabase.storage
    .from(PROJECT_FILE_BUCKET)
    .createSignedUrl(storagePath, 60 * 5);

  if (error) {
    console.error("[projects] 서명 URL 발급 실패:", error.message);
    return { ok: false, message: error.message };
  }
  return { ok: true, url: data.signedUrl };
}
