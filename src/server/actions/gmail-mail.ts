"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSessionEmployee } from "@/lib/auth/session";
import { disconnectGmail } from "@/server/gmail/tokens";
import {
  markGmailRead,
  sendGmailMail,
  starGmail,
  trashGmail,
  untrashGmail,
} from "@/features/mail/gmail-source";
import { EMAIL_PATTERN } from "@/features/mail/gmail-view";
import type { MailActionResult } from "@/server/actions/mail";

/**
 * ⚑ Gmail 외부 메일 액션 (외부 수발신 · 담당 C)
 *
 * actions/mail.ts(내부 메일)와 같은 결과 규약(MailActionResult)을 쓰되,
 * 대상이 DB 행이 아니라 **본인 Gmail 메일함**이다. 그래서 모든 액션의
 * 첫 줄이 requireSessionEmployee() — 세션의 임직원 id만 gmail-source에
 * 넘긴다(본인 토큰으로 본인 메일함 규약의 서버 측 대조점). 클라이언트가
 * 넘긴 어떤 값도 "누구의 메일함인가"에 관여하지 못한다.
 *
 * messageId는 Gmail id(16진수 문자열)라 내부 액션의 uuid 검증 대신
 * 안전한 문자 집합만 확인한다(경로 조립은 client.ts가 encodeURIComponent
 * 하지만, 이상값은 여기서 먼저 거른다).
 */

const gmailIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "메일을 찾을 수 없습니다.");

const emailSchema = z
  .string()
  .trim()
  .regex(EMAIL_PATTERN, "이메일 형식이 아닙니다.");

const sendSchema = z.object({
  subject: z.string().trim().min(1, "제목을 입력하세요.").max(200),
  body: z.string().max(100000, "본문이 너무 깁니다."),
  to: z
    .array(emailSchema)
    .min(1, "받는사람을 지정하세요.")
    .max(100, "받는사람은 100명 이내로 지정하세요."),
  cc: z.array(emailSchema).max(100).optional(),
});

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

/** 메일 화면 + 상단바·패널 배지(레이아웃)를 다시 만든다 — mail.ts와 같은 좌표 */
function revalidateGmailPaths(): void {
  revalidatePath("/mail");
  revalidatePath("/", "layout");
}

/**
 * 외부 발송 — 임직원 칩·외부 주소 전부 이메일 배열로 받는다
 * (MailComposer가 임직원 칩을 이메일로 해석해 넘긴다).
 */
export async function sendGmailMailAction(
  input: unknown,
): Promise<MailActionResult> {
  const me = await requireSessionEmployee();
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const result = await sendGmailMail(me.id, {
    subject: v.subject,
    body: v.body,
    to: v.to,
    cc: v.cc ?? [],
    senderName: me.name,
  });
  if (!result.ok) return { ok: false, message: result.message };

  revalidateGmailPaths();
  return { ok: true, messageId: result.messageId };
}

/** 읽음 처리 — 내부 markMailRead처럼 조회를 막지 않도록 결과를 삼킨다 */
export async function markGmailReadAction(messageId: string): Promise<void> {
  const me = await requireSessionEmployee();
  const parsed = gmailIdSchema.safeParse(messageId);
  if (!parsed.success) return;

  const result = await markGmailRead(me.id, parsed.data);
  if (result.ok) revalidateGmailPaths();
}

/** 별표 토글 */
export async function starGmailAction(
  messageId: string,
  starred: boolean,
): Promise<MailActionResult> {
  const me = await requireSessionEmployee();
  const parsed = gmailIdSchema.safeParse(messageId);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const result = await starGmail(me.id, parsed.data, starred);
  if (!result.ok) return result;

  revalidateGmailPaths();
  return { ok: true };
}

/** 휴지통으로 — Gmail 영구삭제는 제공하지 않는다(client.ts 결정과 한 몸) */
export async function trashGmailAction(
  messageId: string,
): Promise<MailActionResult> {
  const me = await requireSessionEmployee();
  const parsed = gmailIdSchema.safeParse(messageId);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const result = await trashGmail(me.id, parsed.data);
  if (!result.ok) return result;

  revalidateGmailPaths();
  return { ok: true };
}

/** 휴지통에서 복원 */
export async function restoreGmailAction(
  messageId: string,
): Promise<MailActionResult> {
  const me = await requireSessionEmployee();
  const parsed = gmailIdSchema.safeParse(messageId);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const result = await untrashGmail(me.id, parsed.data);
  if (!result.ok) return result;

  revalidateGmailPaths();
  return { ok: true };
}

/**
 * 연동 해제 — 패널의 해제 버튼. refresh token 행 삭제(tokens.ts)라
 * 재연동은 다시 로그인(동의)으로만 가능하다는 안내를 화면이 함께 띄운다.
 */
export async function disconnectGmailAction(): Promise<MailActionResult> {
  const me = await requireSessionEmployee();

  const removed = await disconnectGmail(me.id);
  if (!removed) {
    return { ok: false, message: "연동 해제에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }

  revalidateGmailPaths();
  return { ok: true };
}
