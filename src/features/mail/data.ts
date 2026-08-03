import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type {
  MailAttachment,
  MailRecipientFolder,
  MailRecipientKind,
} from "@/types/db";

/**
 * ⚑ 사내 메일 조회 계층 (스펙 12 · 마이그레이션 28)
 *
 * 모든 함수는 소프트 실패다 — 마이그레이션 28이 아직 적용되지 않은 환경에서
 * 테이블이 없으면 console.error만 남기고 빈 값을 돌려준다(widget-data.ts와
 * 같은 규약). 메일함이 비어 보일지언정 화면이 죽지는 않는다.
 *
 * 폴더 어휘 정리:
 *   화면 폴더(MailboxFolder)  : inbox / sent / drafts / trash
 *   DB 수신자 폴더            : inbox / trash          (mail_recipients.folder)
 *   발신자 쪽 sent/trash      : mail_messages.sender_trashed·sender_deleted_at
 * 휴지통 화면은 수신자 휴지통 행과 발신자 휴지통 메시지의 합집합이다.
 */

/** 한 페이지에 담는 메일 수 */
export const MAIL_PAGE_SIZE = 20;

/** 용량 게이지의 분모 — "500.0MB 중 x 사용" (12-mail.md 패널 5) */
export const MAIL_QUOTA_BYTES = 500 * 1024 * 1024;

/**
 * 휴지통 합집합을 만들 때 각 출처에서 훑는 최대 행 수.
 * 두 질의를 시간순으로 섞어야 해서 페이지네이션을 메모리에서 한다 —
 * 휴지통이 이 수를 넘으면 그 너머 페이지는 잘린다(총 건수는 정확).
 */
const TRASH_SCAN_LIMIT = 200;

/** 화면의 메일함 폴더 */
export type MailboxFolder = "inbox" | "sent" | "drafts" | "trash";

export interface MailListFilter {
  /** 안읽음만 (받은메일함 계열 전용) */
  unread?: boolean;
  /** 별표만 (받은메일함 계열 전용) */
  starred?: boolean;
  /** YYYY-MM-DD — 이 날짜(서울) 00:00 이후 발송분만. 빠른검색 "오늘온메일" */
  sinceYmd?: string;
  /** 제목 검색어 */
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface MailListItem {
  messageId: string;
  subject: string;
  /** 본문 첫 줄 미리보기 (공백 정리 후 120자) */
  preview: string;
  senderId: string | null;
  /** 발신자 이름. null이면 퇴사자(FK가 null로 되돌린 경우) */
  senderName: string | null;
  /** 정렬·표시 시각 — 발송 시각, 임시저장은 마지막 저장 시각 */
  at: string;
  /** 받은 메일에서 내가 읽었는가. 보낸메일함·임시보관함은 항상 true */
  isRead: boolean;
  starred: boolean;
  /** 내가 to인지 cc인지. 발신자 쪽 목록에서는 null */
  kind: MailRecipientKind | null;
  /** 발신자 쪽 목록의 수신확인: 읽은 수신자 수 (수신자 쪽은 null) */
  readCount: number | null;
  recipientCount: number | null;
  /** 보낸메일함 표기용 수신자 이름(to 먼저) */
  recipientNames: string[];
  attachmentCount: number;
  /** 본문 바이트 + 첨부 합 — 목록의 "3.6KB" 표기 */
  sizeBytes: number;
  /** 휴지통 행의 출처 — 복원·영구삭제 액션이 어느 쪽 상태를 만질지 정한다 */
  trashSource: "recipient" | "sender" | null;
}

export interface MailPage {
  items: MailListItem[];
  /** 필터를 적용한 전체 건수. 페이지네이터의 분모 */
  total: number;
}

const EMPTY_PAGE: MailPage = { items: [], total: 0 };

/** PostgREST 필터 문자열에서 구분자를 제거한다 (boards의 keywordOf와 같은 규약) */
function keywordOf(q?: string): string {
  return (q ?? "").replace(/[,()]/g, "").trim();
}

function previewOf(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** 목록의 크기 표기는 바이트 기준 — 한글은 UTF-8로 3바이트라 length로는 틀린다 */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

type Supabase = ReturnType<typeof createServerSupabase>;

// ---------------------------------------------------------------------
// 행 타입은 임베드 결과의 실제 모양을 따른다 (FK 명시 — 규약)
// ---------------------------------------------------------------------

interface RecipientRow {
  message_id: string;
  kind: MailRecipientKind;
  folder: MailRecipientFolder;
  read_at: string | null;
  starred: boolean;
  created_at: string;
  message: {
    id: string;
    subject: string;
    body: string;
    sent_at: string | null;
    sender: { id: string; name: string } | null;
  } | null;
}

interface SentRow {
  id: string;
  subject: string;
  body: string;
  sent_at: string | null;
  recipients: {
    recipient_id: string;
    kind: MailRecipientKind;
    read_at: string | null;
    recipient: { id: string; name: string } | null;
  }[];
}

interface DraftRow {
  id: string;
  subject: string;
  body: string;
  updated_at: string;
  draft_to: string[];
  draft_cc: string[];
}

/** 페이지에 실린 메일들의 첨부 수·용량 합을 한 질의로 붙인다 */
async function attachmentStats(
  supabase: Supabase,
  messageIds: string[],
): Promise<Map<string, { count: number; size: number }>> {
  const map = new Map<string, { count: number; size: number }>();
  if (messageIds.length === 0) return map;

  const { data, error } = await supabase
    .from("mail_attachments")
    .select("message_id, size")
    .in("message_id", messageIds);

  if (error) {
    console.error("[mail] 첨부 집계 실패:", error.message);
    return map;
  }
  (data ?? []).forEach((row) => {
    const prev = map.get(row.message_id as string) ?? { count: 0, size: 0 };
    map.set(row.message_id as string, {
      count: prev.count + 1,
      size: prev.size + Number(row.size ?? 0),
    });
  });
  return map;
}

async function applyAttachmentStats(
  supabase: Supabase,
  items: MailListItem[],
): Promise<MailListItem[]> {
  const stats = await attachmentStats(
    supabase,
    items.map((item) => item.messageId),
  );
  return items.map((item) => {
    const stat = stats.get(item.messageId);
    if (!stat) return item;
    return {
      ...item,
      attachmentCount: stat.count,
      sizeBytes: item.sizeBytes + stat.size,
    };
  });
}

function itemFromRecipientRow(
  row: RecipientRow,
  trash: boolean,
): MailListItem {
  const body = row.message?.body ?? "";
  return {
    messageId: row.message_id,
    subject: row.message?.subject ?? "",
    preview: previewOf(body),
    senderId: row.message?.sender?.id ?? null,
    senderName: row.message?.sender?.name ?? null,
    at: row.message?.sent_at ?? row.created_at,
    isRead: row.read_at !== null,
    starred: row.starred,
    kind: row.kind,
    readCount: null,
    recipientCount: null,
    recipientNames: [],
    attachmentCount: 0,
    sizeBytes: byteLength(body),
    trashSource: trash ? "recipient" : null,
  };
}

function itemFromSentRow(
  row: SentRow,
  senderId: string,
  trash: boolean,
): MailListItem {
  const recipients = [...(row.recipients ?? [])].sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === "to" ? -1 : 1,
  );
  return {
    messageId: row.id,
    subject: row.subject,
    preview: previewOf(row.body),
    senderId,
    senderName: null,
    at: row.sent_at ?? "",
    isRead: true,
    starred: false,
    kind: null,
    readCount: recipients.filter((r) => r.read_at !== null).length,
    recipientCount: recipients.length,
    recipientNames: recipients
      .map((r) => r.recipient?.name ?? "")
      .filter((name) => name !== ""),
    attachmentCount: 0,
    sizeBytes: byteLength(row.body),
    trashSource: trash ? "sender" : null,
  };
}

/** 수신자 관점 목록(받은메일함·수신자 휴지통) — 공통 질의 */
function recipientQuery(
  supabase: Supabase,
  employeeId: string,
  folder: MailRecipientFolder,
  filter: MailListFilter,
) {
  /*
   * !inner — 임베드 컬럼(message.sent_at, message.subject)으로 상위 행을
   * 거르려면 inner join이어야 한다. 수신자 행에는 메시지가 항상 있으므로
   * inner로 바꿔도 행이 사라지지 않는다.
   */
  let query = supabase
    .from("mail_recipients")
    .select(
      `message_id, kind, folder, read_at, starred, created_at,
       message:mail_messages!message_id!inner(
         id, subject, body, sent_at,
         sender:employees!sender_id(id, name)
       )`,
      { count: "exact" },
    )
    .eq("recipient_id", employeeId)
    .eq("folder", folder)
    .order("created_at", { ascending: false });

  if (filter.unread) query = query.is("read_at", null);
  if (filter.starred) query = query.eq("starred", true);
  if (filter.sinceYmd) {
    query = query.gte("message.sent_at", `${filter.sinceYmd}T00:00:00+09:00`);
  }
  const keyword = keywordOf(filter.q);
  if (keyword) query = query.ilike("message.subject", `%${keyword}%`);

  return query;
}

async function listInbox(
  supabase: Supabase,
  employeeId: string,
  filter: MailListFilter,
): Promise<MailPage> {
  const pageSize = filter.pageSize ?? MAIL_PAGE_SIZE;
  const page = Math.max(1, filter.page ?? 1);
  const from = (page - 1) * pageSize;

  const { data, count, error } = await recipientQuery(
    supabase,
    employeeId,
    "inbox",
    filter,
  ).range(from, from + pageSize - 1);

  if (error) {
    console.error("[mail] 받은메일함 조회 실패:", error.message);
    return EMPTY_PAGE;
  }

  const rows = (data ?? []) as unknown as RecipientRow[];
  const items = await applyAttachmentStats(
    supabase,
    rows.map((row) => itemFromRecipientRow(row, false)),
  );
  return { items, total: count ?? rows.length };
}

async function listSent(
  supabase: Supabase,
  employeeId: string,
  filter: MailListFilter,
): Promise<MailPage> {
  const pageSize = filter.pageSize ?? MAIL_PAGE_SIZE;
  const page = Math.max(1, filter.page ?? 1);
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("mail_messages")
    .select(
      `id, subject, body, sent_at,
       recipients:mail_recipients!message_id(
         recipient_id, kind, read_at,
         recipient:employees!recipient_id(id, name)
       )`,
      { count: "exact" },
    )
    .eq("sender_id", employeeId)
    .eq("is_draft", false)
    .eq("sender_trashed", false)
    .is("sender_deleted_at", null)
    .order("sent_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (filter.sinceYmd) {
    query = query.gte("sent_at", `${filter.sinceYmd}T00:00:00+09:00`);
  }
  const keyword = keywordOf(filter.q);
  if (keyword) query = query.ilike("subject", `%${keyword}%`);

  const { data, count, error } = await query;

  if (error) {
    console.error("[mail] 보낸메일함 조회 실패:", error.message);
    return EMPTY_PAGE;
  }

  const rows = (data ?? []) as unknown as SentRow[];
  const items = await applyAttachmentStats(
    supabase,
    rows.map((row) => itemFromSentRow(row, employeeId, false)),
  );
  return { items, total: count ?? rows.length };
}

async function listDrafts(
  supabase: Supabase,
  employeeId: string,
  filter: MailListFilter,
): Promise<MailPage> {
  const pageSize = filter.pageSize ?? MAIL_PAGE_SIZE;
  const page = Math.max(1, filter.page ?? 1);
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("mail_messages")
    .select("id, subject, body, updated_at, draft_to, draft_cc", {
      count: "exact",
    })
    .eq("sender_id", employeeId)
    .eq("is_draft", true)
    .order("updated_at", { ascending: false })
    .range(from, from + pageSize - 1);

  const keyword = keywordOf(filter.q);
  if (keyword) query = query.ilike("subject", `%${keyword}%`);

  const { data, count, error } = await query;

  if (error) {
    console.error("[mail] 임시보관함 조회 실패:", error.message);
    return EMPTY_PAGE;
  }

  const rows = (data ?? []) as unknown as DraftRow[];

  // 임시저장의 받는사람 이름 — 페이지 전체를 한 질의로 해석한다
  const draftIds = Array.from(
    new Set(rows.flatMap((row) => [...row.draft_to, ...row.draft_cc])),
  );
  const names = new Map<string, string>();
  if (draftIds.length > 0) {
    const { data: employees } = await supabase
      .from("employees")
      .select("id, name")
      .in("id", draftIds);
    (employees ?? []).forEach((emp) =>
      names.set(emp.id as string, emp.name as string),
    );
  }

  const items = await applyAttachmentStats(
    supabase,
    rows.map((row) => ({
      messageId: row.id,
      subject: row.subject,
      preview: previewOf(row.body),
      senderId: employeeId,
      senderName: null,
      at: row.updated_at,
      isRead: true,
      starred: false,
      kind: null,
      readCount: null,
      recipientCount: row.draft_to.length + row.draft_cc.length,
      recipientNames: [...row.draft_to, ...row.draft_cc]
        .map((id) => names.get(id) ?? "")
        .filter((name) => name !== ""),
      attachmentCount: 0,
      sizeBytes: byteLength(row.body),
      trashSource: null,
    })),
  );
  return { items, total: count ?? rows.length };
}

/**
 * 휴지통 — 수신자 휴지통 행 + 발신자 휴지통 메시지의 합집합.
 *
 * 두 출처를 시간순으로 섞어야 해서 각각 TRASH_SCAN_LIMIT까지 가져와
 * 메모리에서 정렬·페이지네이션한다. 총 건수는 count로 정확히 받는다
 * (PostgREST의 count는 limit과 무관하게 전체 일치 행을 센다).
 */
async function listTrash(
  supabase: Supabase,
  employeeId: string,
  filter: MailListFilter,
): Promise<MailPage> {
  const pageSize = filter.pageSize ?? MAIL_PAGE_SIZE;
  const page = Math.max(1, filter.page ?? 1);
  const from = (page - 1) * pageSize;

  const keyword = keywordOf(filter.q);

  /*
   * 필터 대칭성: unread·starred는 수신자 행에만 있는 개념이라 발신자 쪽
   * 휴지통에는 존재하지 않는다 — 이 필터가 걸리면 발신자 출처를 아예
   * 제외한다(안 그러면 발신자 쪽만 필터 없이 섞여 두 출처가 다른 기준이
   * 된다). sinceYmd·keyword는 양쪽에 똑같이 적용한다.
   */
  const recipientOnly = Boolean(filter.unread || filter.starred);

  let sentTrashQuery = supabase
    .from("mail_messages")
    .select(
      `id, subject, body, sent_at,
       recipients:mail_recipients!message_id(
         recipient_id, kind, read_at,
         recipient:employees!recipient_id(id, name)
       )`,
      { count: "exact" },
    )
    .eq("sender_id", employeeId)
    .eq("is_draft", false)
    .eq("sender_trashed", true)
    .is("sender_deleted_at", null)
    .order("sent_at", { ascending: false })
    .limit(TRASH_SCAN_LIMIT);
  if (filter.sinceYmd) {
    sentTrashQuery = sentTrashQuery.gte(
      "sent_at",
      `${filter.sinceYmd}T00:00:00+09:00`,
    );
  }
  if (keyword) sentTrashQuery = sentTrashQuery.ilike("subject", `%${keyword}%`);

  const [received, sentTrash] = await Promise.all([
    recipientQuery(supabase, employeeId, "trash", filter).limit(
      TRASH_SCAN_LIMIT,
    ),
    recipientOnly ? null : sentTrashQuery,
  ]);

  if (received.error || sentTrash?.error) {
    console.error(
      "[mail] 휴지통 조회 실패:",
      received.error?.message ?? sentTrash?.error?.message,
    );
    return EMPTY_PAGE;
  }

  const merged = [
    ...((received.data ?? []) as unknown as RecipientRow[]).map((row) =>
      itemFromRecipientRow(row, true),
    ),
    ...((sentTrash?.data ?? []) as unknown as SentRow[]).map((row) =>
      itemFromSentRow(row, employeeId, true),
    ),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const items = await applyAttachmentStats(
    supabase,
    merged.slice(from, from + pageSize),
  );
  return {
    items,
    total: (received.count ?? 0) + (sentTrash?.count ?? 0),
  };
}

/** 폴더별 메일 목록 (스펙 12 · 받은메일함/보낸메일함/임시보관함/휴지통) */
export async function getMailList(
  employeeId: string,
  folder: MailboxFolder,
  filter: MailListFilter = {},
): Promise<MailPage> {
  const supabase = createServerSupabase();
  switch (folder) {
    case "inbox":
      return listInbox(supabase, employeeId, filter);
    case "sent":
      return listSent(supabase, employeeId, filter);
    case "drafts":
      return listDrafts(supabase, employeeId, filter);
    case "trash":
      return listTrash(supabase, employeeId, filter);
  }
}

/** 레일 배지 — 받은메일함의 안읽음 수 */
export async function getUnreadMailCount(employeeId: string): Promise<number> {
  const supabase = createServerSupabase();
  const { count, error } = await supabase
    .from("mail_recipients")
    .select("message_id", { count: "exact", head: true })
    .eq("recipient_id", employeeId)
    .eq("folder", "inbox")
    .is("read_at", null);

  if (error) {
    console.error("[mail] 안읽음 수 조회 실패:", error.message);
    return 0;
  }
  return count ?? 0;
}

// ---------------------------------------------------------------------
// 단건 조회
// ---------------------------------------------------------------------

export interface MailRecipientEntry {
  recipientId: string;
  name: string | null;
  kind: MailRecipientKind;
  /**
   * 수신확인 — **발신자 전용**(보낸메일함 상세). 수신자가 볼 때는 본인
   * 행 말고는 항상 null이다 — 동료 수신자의 읽음 여부는 스펙 12가 발신자의
   * 기능으로만 정의했고, RLS(마이그레이션 28 mail_recipients_select)도
   * 그렇게 좁혀져 있다.
   */
  readAt: string | null;
  isMe: boolean;
}

export interface MailPartyRef {
  id: string;
  name: string | null;
}

export interface MailDetail {
  id: string;
  subject: string;
  body: string;
  isDraft: boolean;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  senderId: string | null;
  sender: {
    id: string;
    name: string;
    position: string | null;
    profileImageUrl: string | null;
  } | null;
  /** 내가 보낸 메일인가 — 툴바(수정·발송취소류 vs 답장·전달) 분기 */
  isMine: boolean;
  senderTrashed: boolean;
  /** 발송된 메일의 수신자 목록(to 먼저) */
  recipients: MailRecipientEntry[];
  /** 임시저장의 받는사람/참조 — compose 화면이 다시 채운다 */
  draftTo: MailPartyRef[];
  draftCc: MailPartyRef[];
  attachments: MailAttachment[];
  /** 내 수신함 행. 받은 메일이 아니면 null — 별표·읽음·폴더 상태의 출처 */
  my: {
    kind: MailRecipientKind;
    folder: MailRecipientFolder;
    readAt: string | null;
    starred: boolean;
  } | null;
}

interface DetailRow {
  id: string;
  sender_id: string | null;
  subject: string;
  body: string;
  is_draft: boolean;
  sent_at: string | null;
  sender_trashed: boolean;
  sender_deleted_at: string | null;
  draft_to: string[];
  draft_cc: string[];
  created_at: string;
  updated_at: string;
  sender: {
    id: string;
    name: string;
    position: string | null;
    profile_image_url: string | null;
  } | null;
  recipients: {
    recipient_id: string;
    kind: MailRecipientKind;
    folder: MailRecipientFolder;
    read_at: string | null;
    starred: boolean;
    recipient: { id: string; name: string } | null;
  }[];
  attachments: MailAttachment[];
}

/**
 * 메일 한 건 (읽기 화면 + compose의 임시저장 불러오기).
 * 읽음 처리는 하지 않는다 — markMailRead 액션이 따로 한다(조회는 부작용 없이).
 */
export async function getMailDetail(
  messageId: string,
  employeeId: string,
): Promise<MailDetail | null> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("mail_messages")
    .select(
      `id, sender_id, subject, body, is_draft, sent_at, sender_trashed,
       sender_deleted_at, draft_to, draft_cc, created_at, updated_at,
       sender:employees!sender_id(id, name, position, profile_image_url),
       recipients:mail_recipients!message_id(
         recipient_id, kind, folder, read_at, starred,
         recipient:employees!recipient_id(id, name)
       ),
       attachments:mail_attachments(id, message_id, path, name, size, uploaded_at)`,
    )
    .eq("id", messageId)
    .maybeSingle();

  if (error) {
    console.error("[mail] 메일 조회 실패:", error.message);
    return null;
  }
  if (!data) return null;

  const row = data as unknown as DetailRow;

  const isMine = row.sender_id === employeeId;
  const mine = (row.recipients ?? []).find(
    (r) => r.recipient_id === employeeId,
  );

  /*
   * 수신자 명단 두 갈래 (마이그레이션 28 mail_recipients_select):
   *   발신자 — 임베드가 전 수신자 행을 준다. readAt = 수신확인 그대로.
   *   수신자 — RLS가 본인 행만 주므로 to/cc 명단은 mail_recipient_list()
   *            (definer, 상태 컬럼 없음)로 받는다. readAt은 본인 것만 싣고
   *            동료 수신자는 null — 수신확인은 발신자 전용이다.
   */
  let recipients: MailRecipientEntry[];
  if (isMine) {
    recipients = (row.recipients ?? []).map((r) => ({
      recipientId: r.recipient_id,
      name: r.recipient?.name ?? null,
      kind: r.kind,
      readAt: r.read_at,
      isMe: r.recipient_id === employeeId,
    }));
  } else {
    const { data: roster, error: rosterError } = await supabase.rpc(
      "mail_recipient_list",
      { p_message_id: messageId },
    );
    if (rosterError) {
      console.error("[mail] 수신자 명단 조회 실패:", rosterError.message);
    }
    const rosterRows = (roster ?? []) as {
      recipient_id: string;
      kind: MailRecipientKind;
      name: string | null;
    }[];
    recipients = rosterRows.map((r) => ({
      recipientId: r.recipient_id,
      name: r.name,
      kind: r.kind,
      readAt: r.recipient_id === employeeId ? (mine?.read_at ?? null) : null,
      isMe: r.recipient_id === employeeId,
    }));
  }
  recipients.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "to" ? -1 : 1));

  // 임시저장 받는사람 이름 해석 — compose가 칩으로 다시 그릴 수 있게
  const draftIds = Array.from(new Set([...row.draft_to, ...row.draft_cc]));
  const names = new Map<string, string>();
  if (row.is_draft && draftIds.length > 0) {
    const { data: employees } = await supabase
      .from("employees")
      .select("id, name")
      .in("id", draftIds);
    (employees ?? []).forEach((emp) =>
      names.set(emp.id as string, emp.name as string),
    );
  }
  const toRef = (id: string): MailPartyRef => ({
    id,
    name: names.get(id) ?? null,
  });

  return {
    id: row.id,
    subject: row.subject,
    body: row.body,
    isDraft: row.is_draft,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    senderId: row.sender_id,
    sender: row.sender
      ? {
          id: row.sender.id,
          name: row.sender.name,
          position: row.sender.position,
          profileImageUrl: row.sender.profile_image_url,
        }
      : null,
    isMine,
    senderTrashed: row.sender_trashed,
    recipients,
    draftTo: row.draft_to.map(toRef),
    draftCc: row.draft_cc.map(toRef),
    attachments: [...(row.attachments ?? [])].sort((a, b) =>
      a.uploaded_at.localeCompare(b.uploaded_at),
    ),
    my: mine
      ? {
          kind: mine.kind,
          folder: mine.folder,
          readAt: mine.read_at,
          starred: mine.starred,
        }
      : null,
  };
}

// ---------------------------------------------------------------------
// 용량 게이지 (12-mail.md 패널 5 — "500.0MB 중 244.0KB 사용")
// ---------------------------------------------------------------------

export interface MailUsage {
  usedBytes: number;
  quotaBytes: number;
}

/**
 * 내가 올린 첨부의 총량. 본문 텍스트는 세지 않는다 — 용량을 실제로 차지하는
 * 건 스토리지의 첨부 파일이고, 스펙도 "첨부 총량으로 표시"로 정했다.
 */
export async function getMailUsage(employeeId: string): Promise<MailUsage> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("mail_attachments")
    .select("size, message:mail_messages!message_id!inner(sender_id)")
    .eq("message.sender_id", employeeId);

  if (error) {
    console.error("[mail] 용량 집계 실패:", error.message);
    return { usedBytes: 0, quotaBytes: MAIL_QUOTA_BYTES };
  }

  const usedBytes = (data ?? []).reduce(
    (sum, row) => sum + Number((row as { size: number | null }).size ?? 0),
    0,
  );
  return { usedBytes, quotaBytes: MAIL_QUOTA_BYTES };
}
