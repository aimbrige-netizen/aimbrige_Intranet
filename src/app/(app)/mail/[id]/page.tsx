import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  MailRead,
  type MailAttachmentModel,
  type MailPerson,
  type MailReadModel,
} from "@/features/mail/MailRead";
import { getMailDetail, type MailDetail } from "@/features/mail/data";
import { getMailAttachmentUrl } from "@/server/actions/mail";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "메일" };

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
 * 메일 읽기 (12-mail.md /inbox/[id]).
 */
export default async function MailReadPage({
  params,
}: {
  params: { id: string };
}) {
  const me = await requireSessionEmployee();

  const detail = await getMailDetail(params.id, me.id);

  // 내 임시저장은 읽는 게 아니라 이어 쓴다 (임시보관함 행과 같은 목적지).
  // 남의 임시저장은 RLS가 이미 null로 돌려보낸다.
  if (detail?.isDraft && detail.isMine) {
    redirect(`/mail/compose?draft=${detail.id}`);
  }

  const mail = detail && !detail.isDraft ? await toModel(detail) : null;

  return <MailRead mail={mail} />;
}
