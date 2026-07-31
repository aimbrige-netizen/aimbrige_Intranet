"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSessionEmployee, requireSystemAdmin } from "@/lib/auth/session";
import { REACTION_EMOJIS } from "@/features/boards/types";
import type { PostAttachment } from "@/features/boards/types";

export interface BoardActionResult {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  message?: string;
  postId?: string;
}

export interface AttachmentActionResult {
  ok: boolean;
  message?: string;
  /** 등록에 성공한 행 — 화면이 새로고침 없이 목록에 붙일 수 있게 돌려준다 */
  attachment?: PostAttachment;
}

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

const postSchema = z.object({
  boardId: z.string().min(1, "게시판을 선택하세요."),
  title: z.string().trim().min(1, "제목을 입력하세요.").max(200),
  content: z.string().trim().min(1, "내용을 입력하세요."),
  category: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  isPinned: z.boolean(),
});

/**
 * 글 작성 (스펙 3.2)
 * 공지 게시판은 팀장 이상만 쓸 수 있는데, 이 검사는 RLS의
 * can_post_to_board()가 강제한다. 여기서도 먼저 확인해 친절한 메시지를 준다.
 */
export async function createPost(input: unknown): Promise<BoardActionResult> {
  const me = await requireSessionEmployee();
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const supabase = createServerSupabase();

  const { data: board } = await supabase
    .from("boards")
    .select("board_type")
    .eq("id", v.boardId)
    .maybeSingle<{ board_type: string }>();

  if (!board) return { ok: false, message: "게시판을 찾을 수 없습니다." };

  if (board.board_type === "notice" && !me.isManager) {
    return {
      ok: false,
      message: "공지 게시판은 팀장/매니저 이상만 작성할 수 있습니다.",
    };
  }

  const { data, error } = await supabase
    .from("posts")
    .insert({
      board_id: v.boardId,
      title: v.title,
      content: v.content,
      // 카테고리·고정은 공지 타입에서만 의미가 있다 (스펙 3.2)
      category: board.board_type === "notice" ? (v.category ?? null) : null,
      is_pinned: board.board_type === "notice" ? v.isPinned : false,
      author_id: me.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) return { ok: false, message: error.message };

  revalidatePath("/board");
  revalidatePath(`/board/${v.boardId}`);
  revalidatePath("/");
  return { ok: true, postId: data.id };
}

export async function updatePost(
  postId: string,
  input: unknown,
): Promise<BoardActionResult> {
  await requireSessionEmployee();
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const supabase = createServerSupabase();
  const { error, count } = await supabase
    .from("posts")
    .update(
      {
        title: v.title,
        content: v.content,
        category: v.category ?? null,
        is_pinned: v.isPinned,
      },
      { count: "exact" },
    )
    .eq("id", postId);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return { ok: false, message: "수정 권한이 없습니다(작성자 본인만 가능)." };
  }

  revalidatePath(`/board/${v.boardId}`);
  revalidatePath(`/board/${v.boardId}/${postId}`);
  return { ok: true, postId };
}

export async function deletePost(
  postId: string,
  boardId: string,
): Promise<BoardActionResult> {
  await requireSessionEmployee();

  const supabase = createServerSupabase();

  // 첨부 행은 글과 함께 cascade로 지워지지만 스토리지 파일은 남는다.
  // 경로를 먼저 확보해 두고 글을 지운 뒤에 정리한다.
  const { data: files } = await supabase
    .from("post_attachments")
    .select("file_url")
    .eq("post_id", postId);

  const { error, count } = await supabase
    .from("posts")
    .delete({ count: "exact" })
    .eq("id", postId);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return { ok: false, message: "삭제 권한이 없습니다(작성자 본인만 가능)." };
  }

  const paths = (files ?? []).map((row) => row.file_url as string);
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from("post-attachments")
      .remove(paths);
    if (storageError) {
      console.error("[boards] 첨부 파일 정리 실패:", storageError.message);
    }
  }

  revalidatePath("/board");
  revalidatePath(`/board/${boardId}`);
  return { ok: true };
}

/** 읽음 기록 — 상세 진입 시 호출. 중복은 무시한다 (스펙 3.3) */
export async function markPostRead(postId: string): Promise<void> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { error } = await supabase
    .from("post_reads")
    .upsert(
      { post_id: postId, employee_id: me.id },
      { onConflict: "post_id,employee_id", ignoreDuplicates: true },
    );

  if (error) {
    // 읽음 기록 실패가 글 조회를 막아서는 안 된다
    console.error("[boards] 읽음 기록 실패:", error.message);
  }
}

/**
 * 조회수 +1 — 상세 진입 시 호출.
 * 본인 글은 DB 함수가 세지 않으므로 여기서 작성자를 따로 걸러내지 않는다.
 * 읽음 기록(post_reads)과는 별개다 — 그쪽은 "대상자 중 누가 읽었나"다.
 */
export async function incrementPostView(postId: string): Promise<void> {
  await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { error } = await supabase.rpc("increment_post_view", {
    p_post_id: postId,
  });

  if (error) {
    console.error("[boards] 조회수 기록 실패:", error.message);
  }
}

// ---------------------------------------------------------------------
// 첨부파일
//
// 업로드 경로는 `<auth uid>/<글 id>/<파일명>` 규칙을 지킨다 —
// 스토리지 정책이 경로 첫 세그먼트를 auth.uid()와 대조하므로(마이그레이션 09)
// 이 형식 자체가 권한 판정이다. 서버에서도 한 번 더 대조한다.
// 비공개 버킷이라 다운로드는 그때그때 서명 URL을 발급한다.
// ---------------------------------------------------------------------

/** 업로드한 파일을 글에 등록 (RLS: 작성자 본인만) */
export async function registerPostAttachment(
  postId: string,
  boardId: string,
  storagePath: string,
  fileName: string,
  fileSize: number,
): Promise<AttachmentActionResult> {
  await requireSessionEmployee();

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "세션이 만료되었습니다." };

  if (!storagePath.startsWith(`${user.id}/${postId}/`)) {
    return { ok: false, message: "첨부 경로가 올바르지 않습니다." };
  }

  const { data, error } = await supabase
    .from("post_attachments")
    .insert({
      post_id: postId,
      file_url: storagePath,
      file_name: fileName,
      file_size: fileSize,
    })
    .select("id, post_id, file_url, file_name, file_size, uploaded_at")
    .single<PostAttachment>();

  if (error) {
    return {
      ok: false,
      message:
        error.code === "42501"
          ? "첨부는 글 작성자 본인만 추가할 수 있습니다."
          : error.message,
    };
  }

  revalidatePath(`/board/${boardId}/${postId}`);
  return { ok: true, attachment: data };
}

/** 첨부 삭제 — 메타 행과 실제 파일을 함께 정리한다 */
export async function removePostAttachment(
  attachmentId: string,
  postId: string,
  boardId: string,
): Promise<AttachmentActionResult> {
  await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { data: row } = await supabase
    .from("post_attachments")
    .select("file_url")
    .eq("id", attachmentId)
    .maybeSingle<{ file_url: string }>();

  const { error, count } = await supabase
    .from("post_attachments")
    .delete({ count: "exact" })
    .eq("id", attachmentId);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return { ok: false, message: "삭제 권한이 없습니다(작성자 본인만 가능)." };
  }

  // 메타를 지웠으면 파일도 지운다.
  // 관리자는 남의 경로를 지울 수 없어 실패할 수 있는데, 그렇다고 목록에
  // 되살릴 일은 아니라 로그만 남긴다.
  if (row?.file_url) {
    const { error: storageError } = await supabase.storage
      .from("post-attachments")
      .remove([row.file_url]);
    if (storageError) {
      console.error("[boards] 첨부 파일 삭제 실패:", storageError.message);
    }
  }

  revalidatePath(`/board/${boardId}/${postId}`);
  return { ok: true };
}

/** 다운로드용 서명 URL (5분) */
export async function getPostAttachmentUrl(
  storagePath: string,
): Promise<{ ok: boolean; url?: string; message?: string }> {
  await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { data, error } = await supabase.storage
    .from("post-attachments")
    .createSignedUrl(storagePath, 60 * 5);

  if (error) return { ok: false, message: error.message };
  return { ok: true, url: data.signedUrl };
}

const commentSchema = z.object({
  postId: z.string().min(1),
  content: z.string().trim().min(1, "댓글을 입력하세요.").max(2000),
});

export async function createComment(
  input: unknown,
  boardId: string,
): Promise<BoardActionResult> {
  const me = await requireSessionEmployee();
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = createServerSupabase();
  const { error } = await supabase.from("comments").insert({
    post_id: parsed.data.postId,
    author_id: me.id,
    content: parsed.data.content,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath(`/board/${boardId}/${parsed.data.postId}`);
  return { ok: true };
}

export async function deleteComment(
  commentId: string,
  boardId: string,
  postId: string,
): Promise<BoardActionResult> {
  await requireSessionEmployee();

  const supabase = createServerSupabase();
  const { error, count } = await supabase
    .from("comments")
    .delete({ count: "exact" })
    .eq("id", commentId);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return { ok: false, message: "삭제 권한이 없습니다." };
  }

  revalidatePath(`/board/${boardId}/${postId}`);
  return { ok: true };
}

/** 이모지 반응 토글 (스펙 3.3) */
export async function toggleReaction(
  postId: string,
  emoji: string,
  boardId: string,
): Promise<BoardActionResult> {
  const me = await requireSessionEmployee();

  if (!(REACTION_EMOJIS as readonly string[]).includes(emoji)) {
    return { ok: false, message: "허용되지 않은 이모지입니다." };
  }

  const supabase = createServerSupabase();

  const { data: existing } = await supabase
    .from("reactions")
    .select("post_id")
    .eq("post_id", postId)
    .eq("employee_id", me.id)
    .eq("emoji", emoji)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .from("reactions")
        .delete()
        .eq("post_id", postId)
        .eq("employee_id", me.id)
        .eq("emoji", emoji)
    : await supabase
        .from("reactions")
        .insert({ post_id: postId, employee_id: me.id, emoji });

  if (error) return { ok: false, message: error.message };

  revalidatePath(`/board/${boardId}/${postId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------
// 게시판 관리 (스펙 3.4) — 시스템 관리자 전용
// ---------------------------------------------------------------------

const boardSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력하세요.").max(60),
  boardType: z.enum(["notice", "discussion"]),
  departmentId: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
});

export async function createBoard(
  input: unknown,
): Promise<BoardActionResult> {
  await requireSystemAdmin();
  const parsed = boardSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const supabase = createServerSupabase();
  const { error } = await supabase.from("boards").insert({
    name: v.name,
    board_type: v.boardType,
    // 부서 지정은 공지 타입에서만 (DB CHECK 제약과 동일한 규칙)
    department_id: v.boardType === "notice" ? (v.departmentId ?? null) : null,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/boards");
  revalidatePath("/board");
  return { ok: true };
}

export async function deleteBoard(id: string): Promise<BoardActionResult> {
  await requireSystemAdmin();

  const supabase = createServerSupabase();

  // 글이 남아 있으면 지우지 않는다(cascade로 글까지 날아가는 사고 방지)
  const { count } = await supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("board_id", id);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: `게시글이 ${count}건 있어 삭제할 수 없습니다. 먼저 글을 정리하세요.`,
    };
  }

  const { error } = await supabase.from("boards").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/boards");
  revalidatePath("/board");
  return { ok: true };
}
