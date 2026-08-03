"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getMailUsage, MAIL_QUOTA_BYTES } from "@/features/mail/data";
import type { MailAttachment } from "@/types/db";

/**
 * ⚑ 사내 메일 액션 (스펙 12 · 마이그레이션 28)
 *
 * 발송은 send_mail() RPC 한 곳으로 몬다 — 메시지와 수신자 행이 한 트랜잭션에
 * 생겨야 하고, to/cc 중복 정리도 거기서 한다. 나머지 상태 변경(읽음·별표·
 * 휴지통·복원·영구삭제)은 RLS 아래의 직접 UPDATE/DELETE인데, RLS에 막힌
 * UPDATE/DELETE는 에러가 아니라 0행으로 끝나므로 전부 count로 반영을
 * 확인한다(규약 3 — boards.ts의 leaveCommunity와 같은 이유).
 *
 * 받은 메일과 보낸 메일은 지우는 곳이 다르다(수신자 행 folder vs 메시지의
 * sender_trashed). 자기 자신에게 보낸 메일은 양쪽에 다 있어서 "어느 쪽을
 * 지울지"를 액션이 추측할 수 없다 — 그래서 target을 명시적으로 받는다.
 */

export interface MailActionResult {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  message?: string;
  /** 발송된 메일 id — 발송 후 상세로 이동시킨다 */
  messageId?: string;
  /** 임시저장 id — 저장 후 같은 draft를 계속 편집한다 */
  draftId?: string;
}

export interface MailAttachmentActionResult {
  ok: boolean;
  message?: string;
  /** 등록에 성공한 행 — 화면이 새로고침 없이 목록에 붙일 수 있게 돌려준다 */
  attachment?: MailAttachment;
}

/** 받은 메일(수신자 행)인지 보낸 메일(발신자 상태)인지 */
export type MailSide = "received" | "sent";

/**
 * 메일함 화면을 다시 만든다. 실제 라우트는 /mail(메일함은 ?box= 쿼리로
 * 갈린다) · /mail/[id] · /mail/compose 셋뿐이다 — 존재하지 않는
 * /mail/inbox 따위를 돌리면 겉으로는 "/" layout revalidate에 묻혀
 * 동작해 보이지만, 그 한 줄이 사라지는 순간 읽기 화면 캐시가 늘지 않는
 * 잠복 버그가 된다.
 */
function revalidateMailPaths(messageId?: string): void {
  revalidatePath("/mail");
  revalidatePath("/mail/compose");
  if (messageId) revalidatePath(`/mail/${messageId}`);
  // 상단바·패널의 안읽음 배지와 용량 게이지는 레이아웃에 산다
  revalidatePath("/", "layout");
}

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

const uuidSchema = z.string().uuid("대상을 찾을 수 없습니다.");

const sendSchema = z.object({
  subject: z.string().trim().min(1, "제목을 입력하세요.").max(200),
  body: z.string().max(100000, "본문이 너무 깁니다."),
  to: z
    .array(uuidSchema)
    .min(1, "받는사람을 지정하세요.")
    .max(100, "받는사람은 100명 이내로 지정하세요."),
  cc: z.array(uuidSchema).max(100).optional(),
  /** 임시저장을 발송으로 승격할 때만 */
  draftId: uuidSchema.nullable().optional(),
});

/**
 * 발송 (스펙 12 쓰기 화면)
 * to/cc 중복 정리·수신자 검증·draft 승격은 send_mail()이 한 트랜잭션으로 한다.
 */
export async function sendMail(input: unknown): Promise<MailActionResult> {
  await requireSessionEmployee();
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("send_mail", {
    p_subject: v.subject,
    p_body: v.body,
    p_to: v.to,
    p_cc: v.cc ?? [],
    p_draft_id: v.draftId ?? null,
  });

  // RPC는 사용자에게 그대로 보여줄 문장으로 예외를 던진다
  if (error) return { ok: false, message: error.message };

  revalidateMailPaths(data as string);
  return { ok: true, messageId: data as string };
}

const draftSchema = z.object({
  draftId: uuidSchema.nullable().optional(),
  /** 임시저장은 제목 없이도 저장된다 — 발송 시점에만 제목을 강제한다 */
  subject: z.string().trim().max(200, "제목은 200자 이내로 입력하세요."),
  body: z.string().max(100000, "본문이 너무 깁니다."),
  to: z.array(uuidSchema).max(100).optional(),
  cc: z.array(uuidSchema).max(100).optional(),
});

/**
 * 임시저장 (스펙 12 임시보관함)
 * 받는사람은 mail_recipients가 아니라 draft_to/draft_cc 배열에 남는다 —
 * 수신자 행을 만들면 안읽음 배지가 남의 임시저장을 세기 때문이다(마이그레이션 28).
 */
export async function saveMailDraft(input: unknown): Promise<MailActionResult> {
  const me = await requireSessionEmployee();
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const supabase = createServerSupabase();
  const fields = {
    subject: v.subject,
    body: v.body,
    draft_to: v.to ?? [],
    draft_cc: v.cc ?? [],
  };

  if (v.draftId) {
    const { error, count } = await supabase
      .from("mail_messages")
      .update(fields, { count: "exact" })
      .eq("id", v.draftId)
      .eq("sender_id", me.id)
      .eq("is_draft", true);

    if (error) return { ok: false, message: error.message };
    if (count === 0) {
      return { ok: false, message: "임시보관 메일을 찾을 수 없습니다." };
    }

    revalidateMailPaths(v.draftId);
    return { ok: true, draftId: v.draftId };
  }

  const { data, error } = await supabase
    .from("mail_messages")
    .insert({ ...fields, sender_id: me.id, is_draft: true })
    .select("id")
    .single<{ id: string }>();

  if (error) return { ok: false, message: error.message };

  revalidateMailPaths(data.id);
  return { ok: true, draftId: data.id };
}

/**
 * 임시저장 삭제 — 휴지통 없이 바로 지운다(발송 전이라 잃을 사람이 없다).
 * 실제 DELETE는 RLS가 임시저장에만 허용한다.
 */
export async function deleteMailDraft(
  draftId: string,
): Promise<MailActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  // 첨부 행은 cascade로 지워지지만 스토리지 파일은 남는다 —
  // 경로를 먼저 확보하고 지운 뒤 정리한다(boards.deletePost와 같은 순서)
  const { data: files } = await supabase
    .from("mail_attachments")
    .select("path")
    .eq("message_id", draftId);

  const { error, count } = await supabase
    .from("mail_messages")
    .delete({ count: "exact" })
    .eq("id", draftId)
    .eq("sender_id", me.id)
    .eq("is_draft", true);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return { ok: false, message: "임시보관 메일을 찾을 수 없습니다." };
  }

  const paths = (files ?? []).map((row) => row.path as string);
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from("mail-attachments")
      .remove(paths);
    if (storageError) {
      console.error("[mail] 첨부 파일 정리 실패:", storageError.message);
    }
  }

  revalidateMailPaths();
  return { ok: true };
}

/**
 * 읽음 처리 — 읽기 화면 진입 시 호출. 실패가 조회를 막아서는 안 되므로
 * 결과를 던지지 않는다(boards.markPostRead와 같은 규약).
 * 시각은 가드 트리거가 서버 now()로 덮는다 — 여기서 보내는 값은 신호일 뿐이다.
 */
export async function markMailRead(messageId: string): Promise<void> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { error } = await supabase
    .from("mail_recipients")
    .update({ read_at: new Date().toISOString() })
    .eq("message_id", messageId)
    .eq("recipient_id", me.id)
    .is("read_at", null);

  if (error) {
    console.error("[mail] 읽음 기록 실패:", error.message);
    return;
  }
  // 이미 읽었거나 내 수신 메일이 아니면 0행 — 정상이다(배지에 변화 없음)
  revalidateMailPaths(messageId);
}

/** 별표 토글 — 수신자 행에만 있다(발신자 쪽 목록에는 별표 개념이 없다) */
export async function toggleMailStar(
  messageId: string,
  starred: boolean,
): Promise<MailActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { error, count } = await supabase
    .from("mail_recipients")
    .update({ starred }, { count: "exact" })
    .eq("message_id", messageId)
    .eq("recipient_id", me.id);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return { ok: false, message: "받은 메일에만 별표를 붙일 수 있습니다." };
  }

  revalidateMailPaths(messageId);
  return { ok: true };
}

/** 휴지통으로 (스펙 12 목록 툴바 삭제) */
export async function trashMail(
  messageId: string,
  side: MailSide,
): Promise<MailActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  if (side === "received") {
    const { error, count } = await supabase
      .from("mail_recipients")
      .update({ folder: "trash" }, { count: "exact" })
      .eq("message_id", messageId)
      .eq("recipient_id", me.id)
      .eq("folder", "inbox");

    if (error) return { ok: false, message: error.message };
    if (count === 0) return { ok: false, message: "삭제할 메일이 없습니다." };
  } else {
    const { error, count } = await supabase
      .from("mail_messages")
      .update({ sender_trashed: true }, { count: "exact" })
      .eq("id", messageId)
      .eq("sender_id", me.id)
      .eq("is_draft", false)
      .eq("sender_trashed", false);

    if (error) return { ok: false, message: error.message };
    if (count === 0) return { ok: false, message: "삭제할 메일이 없습니다." };
  }

  revalidateMailPaths(messageId);
  return { ok: true };
}

/** 휴지통에서 복원 */
export async function restoreMail(
  messageId: string,
  side: MailSide,
): Promise<MailActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  if (side === "received") {
    const { error, count } = await supabase
      .from("mail_recipients")
      .update({ folder: "inbox" }, { count: "exact" })
      .eq("message_id", messageId)
      .eq("recipient_id", me.id)
      .eq("folder", "trash");

    if (error) return { ok: false, message: error.message };
    if (count === 0) return { ok: false, message: "복원할 메일이 없습니다." };
  } else {
    const { error, count } = await supabase
      .from("mail_messages")
      .update({ sender_trashed: false }, { count: "exact" })
      .eq("id", messageId)
      .eq("sender_id", me.id)
      .eq("sender_trashed", true)
      .is("sender_deleted_at", null);

    if (error) return { ok: false, message: error.message };
    if (count === 0) return { ok: false, message: "복원할 메일이 없습니다." };
  }

  revalidateMailPaths(messageId);
  return { ok: true };
}

/**
 * 영구삭제 — 휴지통에서만 (스펙 12).
 *
 * 받은 메일: 내 수신자 행을 지운다(RLS가 folder='trash'에서만 허용).
 * 보낸 메일: 행을 지우면 수신자들의 받은메일까지 cascade로 사라지므로
 * sender_deleted_at만 찍는다 — 발신자 화면에서만 사라진다. 가드 트리거가
 * 휴지통 밖 삭제와 되돌리기를 막고 시각을 서버 now()로 덮는다.
 */
export async function deleteMailPermanently(
  messageId: string,
  side: MailSide,
): Promise<MailActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  if (side === "received") {
    const { error, count } = await supabase
      .from("mail_recipients")
      .delete({ count: "exact" })
      .eq("message_id", messageId)
      .eq("recipient_id", me.id)
      .eq("folder", "trash");

    if (error) return { ok: false, message: error.message };
    if (count === 0) {
      return { ok: false, message: "휴지통에 있는 메일만 영구삭제할 수 있습니다." };
    }
  } else {
    const { error, count } = await supabase
      .from("mail_messages")
      .update({ sender_deleted_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", messageId)
      .eq("sender_id", me.id)
      .eq("sender_trashed", true)
      .is("sender_deleted_at", null);

    if (error) return { ok: false, message: error.message };
    if (count === 0) {
      return { ok: false, message: "휴지통에 있는 메일만 영구삭제할 수 있습니다." };
    }
  }

  revalidateMailPaths(messageId);
  return { ok: true };
}

/** 휴지통 비우기 (12-mail.md 패널 — "휴지통(비우기)") */
export async function emptyMailTrash(): Promise<MailActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  const [received, sent] = await Promise.all([
    supabase
      .from("mail_recipients")
      .delete({ count: "exact" })
      .eq("recipient_id", me.id)
      .eq("folder", "trash"),
    supabase
      .from("mail_messages")
      .update({ sender_deleted_at: new Date().toISOString() }, { count: "exact" })
      .eq("sender_id", me.id)
      .eq("sender_trashed", true)
      .is("sender_deleted_at", null),
  ]);

  if (received.error) return { ok: false, message: received.error.message };
  if (sent.error) return { ok: false, message: sent.error.message };

  revalidateMailPaths();
  const removed = (received.count ?? 0) + (sent.count ?? 0);
  if (removed === 0) {
    return { ok: false, message: "휴지통이 이미 비어 있습니다." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// 첨부파일
//
// 업로드 경로는 `<auth uid>/<메일 id>/<파일명>` 규칙을 지킨다 —
// 스토리지 정책이 경로 첫 세그먼트를 auth.uid()와 대조하므로(마이그레이션 28)
// 이 형식 자체가 권한 판정이다. 서버에서도 한 번 더 대조한다.
// 비공개 버킷이라 다운로드는 그때그때 서명 URL을 발급한다.
// (boards.ts의 첨부 3종과 같은 문법)
// ---------------------------------------------------------------------

/** 업로드한 파일을 메일에 등록 (RLS: 발신자 본인이 임시저장 상태에서만) */
export async function registerMailAttachment(
  messageId: string,
  storagePath: string,
  fileName: string,
): Promise<MailAttachmentActionResult> {
  const me = await requireSessionEmployee();

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "세션이 만료되었습니다." };

  if (!storagePath.startsWith(`${user.id}/${messageId}/`)) {
    return { ok: false, message: "첨부 경로가 올바르지 않습니다." };
  }

  /*
   * 크기는 클라이언트 신고값이 아니라 **스토리지에 실제로 올라간 객체의
   * 크기**를 쓴다. 신고값을 믿으면 size=0으로 등록해 500MB 쿼터를 통째로
   * 우회하고 목록의 크기 표기도 오염된다. list() 조회는 storage RLS
   * (경로 1세그먼트 = 본인 uid)의 SELECT 정책 아래에서 돈다.
   */
  const slash = storagePath.lastIndexOf("/");
  const prefix = storagePath.slice(0, slash);
  const objectName = storagePath.slice(slash + 1);
  const { data: objects, error: listError } = await supabase.storage
    .from("mail-attachments")
    .list(prefix, { limit: 100, search: objectName });
  if (listError) {
    return { ok: false, message: `첨부 확인 실패 — ${listError.message}` };
  }
  const object = (objects ?? []).find((item) => item.name === objectName);
  const fileSize = Number(
    (object?.metadata as { size?: number } | null | undefined)?.size ?? NaN,
  );
  if (!object || !Number.isFinite(fileSize)) {
    return { ok: false, message: "업로드된 파일을 찾을 수 없습니다." };
  }

  // 용량 게이지가 넘치면 등록을 거절한다 — 게이지가 장식이 되지 않게
  const usage = await getMailUsage(me.id);
  if (usage.usedBytes + fileSize > MAIL_QUOTA_BYTES) {
    return {
      ok: false,
      message: "메일 용량(500MB)을 초과합니다. 기존 첨부를 정리해 주세요.",
    };
  }

  const { data, error } = await supabase
    .from("mail_attachments")
    .insert({
      message_id: messageId,
      path: storagePath,
      name: fileName,
      size: fileSize,
    })
    .select("id, message_id, path, name, size, uploaded_at")
    .single<MailAttachment>();

  if (error) {
    return {
      ok: false,
      message:
        error.code === "42501"
          ? "첨부는 임시저장 상태의 메일에 작성자 본인만 추가할 수 있습니다."
          : error.message,
    };
  }

  revalidateMailPaths(messageId);
  return { ok: true, attachment: data };
}

/** 첨부 삭제 — 메타 행과 실제 파일을 함께 정리한다 */
export async function removeMailAttachment(
  attachmentId: string,
  messageId: string,
): Promise<MailAttachmentActionResult> {
  await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { data: row } = await supabase
    .from("mail_attachments")
    .select("path")
    .eq("id", attachmentId)
    .maybeSingle<{ path: string }>();

  const { error, count } = await supabase
    .from("mail_attachments")
    .delete({ count: "exact" })
    .eq("id", attachmentId);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    // 발송된 메일의 첨부는 동결이다(마이그레이션 28) — 본문 불변과 한 세트
    return {
      ok: false,
      message: "첨부는 임시저장 상태에서 작성자 본인만 삭제할 수 있습니다.",
    };
  }

  if (row?.path) {
    const { error: storageError } = await supabase.storage
      .from("mail-attachments")
      .remove([row.path]);
    if (storageError) {
      console.error("[mail] 첨부 파일 삭제 실패:", storageError.message);
    }
  }

  revalidateMailPaths(messageId);
  return { ok: true };
}

/** 다운로드용 서명 URL (5분) */
export async function getMailAttachmentUrl(
  storagePath: string,
): Promise<{ ok: boolean; url?: string; message?: string }> {
  await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { data, error } = await supabase.storage
    .from("mail-attachments")
    .createSignedUrl(storagePath, 60 * 5);

  if (error) return { ok: false, message: error.message };
  return { ok: true, url: data.signedUrl };
}
