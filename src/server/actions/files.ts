"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSessionEmployee, requireSystemAdmin } from "@/lib/auth/session";
import {
  ensureIntranetFolder,
  extractDriveId,
  uploadFile,
} from "@/lib/google-drive";

export interface FileActionResult {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  message?: string;
  reauthRequired?: boolean;
}

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

/**
 * 개인 폴더 확보 (스펙 3.1 / 5장)
 * 최초 진입 시 Drive에 "에임브릿지 인트라넷" 폴더를 만들고 매핑을 저장한다.
 */
export async function ensureMyDriveFolder(): Promise<
  FileActionResult & { folderId?: string }
> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { data: existing } = await supabase
    .from("employee_drive_folders")
    .select("drive_folder_id")
    .eq("employee_id", me.id)
    .maybeSingle<{ drive_folder_id: string }>();

  if (existing?.drive_folder_id) {
    return { ok: true, folderId: existing.drive_folder_id };
  }

  const result = await ensureIntranetFolder();
  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      reauthRequired: result.reason === "reauth_required",
    };
  }

  const { error } = await supabase.rpc("set_my_drive_folder", {
    p_folder_id: result.data,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/files");
  return { ok: true, folderId: result.data };
}

/** 파일 업로드 — FormData로 받는다(파일 본문을 서버 액션으로 넘기기 위해) */
export async function uploadToFolder(
  formData: FormData,
): Promise<FileActionResult> {
  await requireSessionEmployee();

  const folderId = String(formData.get("folderId") ?? "");
  if (!folderId) return { ok: false, message: "대상 폴더가 지정되지 않았습니다." };

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return { ok: false, message: "업로드할 파일을 선택하세요." };

  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const result = await uploadFile(folderId, file.name, file.type, bytes);
    if (!result.ok) {
      return {
        ok: false,
        message: `${file.name}: ${result.message}`,
        reauthRequired: result.reason === "reauth_required",
      };
    }
  }

  revalidatePath("/files");
  revalidatePath("/files/team");
  return { ok: true };
}

// ---------------------------------------------------------------------
// 관리자 (스펙 3.4)
// ---------------------------------------------------------------------

const folderLinkSchema = z.object({
  scopeType: z.enum(["team", "department"]),
  scopeId: z.string().min(1, "팀 또는 부서를 선택하세요."),
  link: z.string().trim().min(1, "Drive 폴더 링크를 붙여넣으세요."),
  label: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
});

export async function saveFolderLink(
  input: unknown,
): Promise<FileActionResult> {
  await requireSystemAdmin();
  const parsed = folderLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const folderId = extractDriveId(v.link);
  if (!folderId) {
    return {
      ok: false,
      fieldErrors: {
        link: "링크에서 폴더 ID를 찾지 못했습니다. Drive 폴더 주소를 그대로 붙여넣어 주세요.",
      },
    };
  }

  const supabase = createServerSupabase();
  const { error } = await supabase.from("drive_folder_links").upsert(
    {
      scope_type: v.scopeType,
      scope_id: v.scopeId,
      drive_folder_id: folderId,
      label: v.label ?? null,
    },
    { onConflict: "scope_type,scope_id" },
  );

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/files");
  revalidatePath("/files/team");
  return { ok: true };
}

export async function deleteFolderLink(id: string): Promise<FileActionResult> {
  await requireSystemAdmin();
  const supabase = createServerSupabase();
  const { error } = await supabase.from("drive_folder_links").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/files");
  revalidatePath("/files/team");
  return { ok: true };
}

const librarySchema = z.object({
  link: z.string().trim().min(1, "Drive 파일 링크를 붙여넣으세요."),
  displayName: z.string().trim().min(1, "표시이름을 입력하세요.").max(120),
  category: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  description: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
});

export async function addLibraryDocument(
  input: unknown,
): Promise<FileActionResult> {
  const me = await requireSystemAdmin();
  const parsed = librarySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const fileId = extractDriveId(v.link);
  if (!fileId) {
    return {
      ok: false,
      fieldErrors: {
        link: "링크에서 파일 ID를 찾지 못했습니다. Drive 파일 공유링크를 붙여넣어 주세요.",
      },
    };
  }

  const supabase = createServerSupabase();
  const { error } = await supabase.from("library_documents").insert({
    drive_file_id: fileId,
    display_name: v.displayName,
    category: v.category ?? null,
    description: v.description ?? null,
    added_by: me.id,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/files");
  revalidatePath("/files/library");
  return { ok: true };
}

/** 라이브러리 목록에서만 제외 — Drive의 실제 파일은 지우지 않는다 (스펙 3.4) */
export async function deleteLibraryDocument(
  id: string,
): Promise<FileActionResult> {
  await requireSystemAdmin();
  const supabase = createServerSupabase();
  const { error } = await supabase.from("library_documents").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/files");
  revalidatePath("/files/library");
  return { ok: true };
}
