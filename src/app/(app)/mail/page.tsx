import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  MailList,
  type MailboxKey,
  type MailListRow,
  type MailQuickFilter,
} from "@/features/mail/MailList";
import {
  getMailList,
  type MailboxFolder,
  type MailListItem,
} from "@/features/mail/data";
import {
  getGmailMailbox,
  hasGmailConnection,
} from "@/features/mail/gmail-source";
import { requireSessionEmployee } from "@/lib/auth/session";
import { toSeoulYmd } from "@/features/calendar/date";

export const metadata: Metadata = { title: "메일" };

/*
 * 메일함 라벨 — MailPanel(클라이언트)에도 같은 라벨이 있다. "use client"
 * 모듈의 런타임 export는 서버 컴포넌트에서 참조가 되어 쓸 수 없으므로
 * (panel-slots.ts와 같은 사정) 여기서 따로 든다.
 */
const BOX_META: Record<MailboxKey, { title: string; description: string }> = {
  inbox: { title: "받은메일함", description: "임직원이 보낸 사내 메일" },
  sent: { title: "보낸메일함", description: "내가 보낸 메일" },
  receipts: {
    title: "수신확인",
    description: "보낸 메일을 상대가 읽었는지 확인",
  },
  drafts: { title: "임시보관함", description: "작성 중 저장해 둔 메일" },
  trash: { title: "휴지통", description: "삭제한 메일" },
};

/**
 * Gmail 소스일 때의 설명 — 제목(메일함 이름)은 그대로 두고 출처만 밝힌다.
 * 수신확인·임시보관은 Gmail에서 의미가 줄어드는 함이라 그 사정을 적는다.
 */
const GMAIL_BOX_DESCRIPTION: Record<MailboxKey, string> = {
  inbox: "연동된 Gmail 받은편지함",
  sent: "Gmail로 보낸 메일",
  receipts: "Gmail은 수신확인을 제공하지 않습니다 — 보낸메일함과 같게 표시됩니다",
  drafts: "Gmail 임시보관함 — 1차에서는 읽기만 지원합니다",
  trash: "Gmail 휴지통",
};

const FILTER_LABELS: Record<MailQuickFilter, string> = {
  unread: "안읽은 메일",
  starred: "별표 메일",
  today: "오늘 온 메일",
};

function parseBox(value: string | undefined): MailboxKey {
  return value === "sent" ||
    value === "receipts" ||
    value === "drafts" ||
    value === "trash"
    ? value
    : "inbox";
}

function parseFilter(value: string | undefined): MailQuickFilter | null {
  return value === "unread" || value === "starred" || value === "today"
    ? value
    : null;
}

/** "홍길동 외 2" — 보낸함 계열의 수신자 요약 */
function recipientSummary(names: string[]): string {
  if (names.length === 0) return "(받는사람 없음)";
  return names.length === 1 ? names[0] : `${names[0]} 외 ${names.length - 1}`;
}

/**
 * data.ts의 MailListItem → 화면 뷰모델(MailListRow) 어댑트.
 *
 * side(액션이 만질 상태의 소재)는 함이 정한다 — 휴지통만 행마다 출처
 * (trashSource)가 갈린다. 수신확인 라벨은 보낸함 계열에서 read_at 집계
 * (readCount/recipientCount)로 만든다(스펙 12 구현 결정 — 수신확인은
 * 우리 read_at으로 보낸메일함에서 표시).
 */
function toRow(item: MailListItem, box: MailboxKey): MailListRow {
  const side =
    box === "drafts"
      ? "draft"
      : box === "trash"
        ? item.trashSource === "sender"
          ? "sent"
          : "received"
        : box === "inbox"
          ? "received"
          : "sent";

  const counterpart =
    side === "received"
      ? (item.senderName ?? "(퇴사자)")
      : recipientSummary(item.recipientNames);

  const receiptLabel =
    (box === "sent" || box === "receipts") &&
    item.recipientCount !== null &&
    item.recipientCount > 0
      ? `읽음 ${item.readCount ?? 0}/${item.recipientCount}`
      : undefined;

  return {
    id: item.messageId,
    counterpart,
    subject: item.subject,
    sizeBytes: item.sizeBytes,
    sentAt: item.at,
    isRead: item.isRead,
    isStarred: item.starred,
    hasAttachment: item.attachmentCount > 0,
    side,
    receiptLabel,
  };
}

/**
 * 메일 목록 (12-mail.md).
 * ?box= 로 메일함을, ?filter= 로 빠른검색을 가른다 — 둘 다 패널이 건다.
 */
export default async function MailPage({
  searchParams,
}: {
  searchParams: { box?: string; filter?: string };
}) {
  const me = await requireSessionEmployee();

  const box = parseBox(searchParams.box);
  const filter = parseFilter(searchParams.filter);

  /*
   * 수신확인함은 별도 폴더가 아니라 보낸메일함의 다른 얼굴이다 — 데이터는
   * sent 그대로 받고 receiptLabel(읽음 n/m)로 구분한다(스펙 12: "수신확인 →
   * 우리 read_at으로 보낸메일함에서 읽음 여부 표시").
   */
  const folder: MailboxFolder = box === "receipts" ? "sent" : box;

  /*
   * 소스 분기 — 담당 스펙의 한 점: 연동이면 Gmail, 아니면 내부 DB(현행
   * 그대로). 두 소스가 같은 MailPage(MailListItem[])를 돌려주므로 아래
   * toRow부터는 분기가 없다. Gmail 쪽은 실패 시 빈 페이지(소프트) —
   * 내부 소스로 섞어 폴백하지 않는다(두 메일함은 다른 세계라 섞이면
   * "이 목록이 어디인가"가 불명해진다).
   */
  const gmailConnected = await hasGmailConnection();
  const listFilter = {
    unread: filter === "unread" || undefined,
    starred: filter === "starred" || undefined,
    sinceYmd: filter === "today" ? toSeoulYmd(new Date()) : undefined,
  };
  const { items } = gmailConnected
    ? await getGmailMailbox(me.id, folder, listFilter)
    : await getMailList(me.id, folder, listFilter);
  const rows = items.map((item) => toRow(item, box));

  const meta = BOX_META[box];
  const description = gmailConnected
    ? GMAIL_BOX_DESCRIPTION[box]
    : meta.description;

  return (
    <>
      <PageHeader
        title={meta.title}
        description={
          filter ? `${description} — ${FILTER_LABELS[filter]}` : description
        }
      />
      <MailList box={box} filter={filter} rows={rows} />
    </>
  );
}
