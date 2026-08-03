import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  MailRead,
  type MailAttachmentModel,
  type MailPerson,
  type MailReadModel,
} from "@/features/mail/MailRead";
import { getMailDetail, type MailDetail } from "@/features/mail/data";
import {
  getGmailDetail,
  hasGmailConnection,
  markGmailRead,
  type GmailDetail,
} from "@/features/mail/gmail-source";
import { partyLabel } from "@/features/mail/gmail-view";
import { getMailAttachmentUrl } from "@/server/actions/mail";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "메일" };

/** 내부 메일 id는 uuid — Gmail id(16진수 문자열)와 이걸로 가른다 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 수신자 명단 → 화면 인물. 퇴사자는 FK가 null로 되돌린 이름 자리다 */
function toPerson(name: string | null): MailPerson {
  return { name: name ?? "(퇴사자)" };
}

/**
 * getMailDetail → MailReadModel 어댑트.
 * 첨부는 비공개 버킷이라 여기서 5분 서명 URL을 발급해 넘긴다 — 발급이
 * 실패한 파일은 이름만 보인다(AttachmentRow 규약).
 */
async function toModel(detail: MailDetail): Promise<MailReadModel> {
  const attachments: MailAttachmentModel[] = await Promise.all(
    detail.attachments.map(async (file) => {
      const signed = await getMailAttachmentUrl(file.path);
      return {
        id: file.id,
        name: file.name,
        sizeBytes: file.size,
        url: signed.ok ? (signed.url ?? null) : null,
      };
    }),
  );

  return {
    id: detail.id,
    subject: detail.subject,
    sender: detail.sender
      ? { name: detail.sender.name, position: detail.sender.position }
      : { name: "(퇴사자)" },
    to: detail.recipients
      .filter((r) => r.kind === "to")
      .map((r) => toPerson(r.name)),
    cc: detail.recipients
      .filter((r) => r.kind === "cc")
      .map((r) => toPerson(r.name)),
    sentAt: detail.sentAt ?? detail.createdAt,
    body: detail.body,
    attachments,
    // 자기 자신 수신 메일(양쪽 상태 존재)은 received 우선 — 읽기 화면 진입
    // 동선이 받은메일함이고, 발신자 쪽 삭제는 보낸메일함 목록이 맡는다.
    side: detail.my ? "received" : "sent",
    inTrash: detail.my
      ? detail.my.folder === "trash"
      : detail.senderTrashed,
    shouldMarkRead: !!detail.my && detail.my.readAt === null,
  };
}

/**
 * getGmailDetail → MailReadModel 어댑트 (Gmail 소스).
 *
 * · 첨부는 이름·크기만(url null) — AttachmentRow가 이름만 그린다(어댑터 전
 *   규약 그대로). 첨부 다운로드 프록시는 1차 제외.
 * · shouldMarkRead는 false 고정 — 읽음 처리는 서버(마운트 전)에서 이미
 *   했으므로 MailRead의 이펙트(내부 markMailRead, uuid 전제)가 돌면 안 된다.
 * · side/inTrash — 삭제 버튼 표기용. MailRead가 Gmail 메일(id가 uuid
 *   아님)을 gmail-mail.ts 액션으로 분기한다 — 삭제는 휴지통 이동,
 *   영구삭제는 미제공(안내만). 답장·전달은 compose가 같은 판별로 Gmail
 *   프리필을 만든다.
 */
function toGmailModel(detail: GmailDetail): MailReadModel {
  return {
    id: detail.id,
    subject: detail.subject,
    sender: {
      name: partyLabel(detail.from) || "(발신자 없음)",
      email: detail.from.email || null,
    },
    to: detail.to.map((p) => ({ name: partyLabel(p), email: p.email })),
    cc: detail.cc.map((p) => ({ name: partyLabel(p), email: p.email })),
    sentAt: detail.internalDate || new Date(0).toISOString(),
    body: detail.bodyText,
    attachments: detail.attachments.map((file) => ({
      id: file.id,
      name: file.name,
      sizeBytes: file.size,
      url: null,
    })),
    side: "received",
    inTrash: detail.trashed,
    shouldMarkRead: false,
  };
}

/**
 * 메일 읽기 (12-mail.md /inbox/[id]).
 * Gmail 연동 + Gmail 모양의 id면 Gmail 소스로, 그 외(uuid)는 내부 DB로 —
 * 연동 후에도 위젯·북마크의 옛 내부 메일 링크가 계속 열린다.
 */
export default async function MailReadPage({
  params,
}: {
  params: { id: string };
}) {
  const me = await requireSessionEmployee();

  if (!UUID_PATTERN.test(params.id) && (await hasGmailConnection())) {
    const gmailDetail = await getGmailDetail(me.id, params.id);
    /*
     * 읽음 처리를 렌더 중 서버에서 한다 — 대상이 우리 DB가 아니라 Gmail이라
     * revalidate가 필요 없고(배지·목록은 요청마다 실시간 조회), 실패해도
     * 화면은 그대로 뜬다(markGmailRead는 던지지 않는다).
     */
    if (gmailDetail?.unread) await markGmailRead(me.id, params.id);
    return <MailRead mail={gmailDetail ? toGmailModel(gmailDetail) : null} />;
  }

  const detail = await getMailDetail(params.id, me.id);

  // 내 임시저장은 읽는 게 아니라 이어 쓴다 (임시보관함 행과 같은 목적지).
  // 남의 임시저장은 RLS가 이미 null로 돌려보낸다.
  if (detail?.isDraft && detail.isMine) {
    redirect(`/mail/compose?draft=${detail.id}`);
  }

  const mail = detail && !detail.isDraft ? await toModel(detail) : null;

  return <MailRead mail={mail} />;
}
