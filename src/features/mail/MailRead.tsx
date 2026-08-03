"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Forward,
  MailX,
  Paperclip,
  Reply,
  Trash2,
} from "lucide-react";
import { Button, LinkButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn, formatDateTime } from "@/lib/utils";
import {
  deleteMailPermanently,
  markMailRead,
  trashMail,
  type MailSide,
} from "@/server/actions/mail";
import { trashGmailAction } from "@/server/actions/gmail-mail";
import { isInternalMailId } from "@/features/mail/gmail-view";
import { formatMailSize } from "@/features/mail/MailList";

/**
 * 메일 읽기 화면 (daou-survey/12-mail.md 읽기 실측).
 *
 * MailReadModel은 이 화면의 뷰모델이다. [id]/page.tsx가 data.ts의
 * getMailDetail 결과를 이 모양으로 어댑트한다. null(권한 밖·삭제·미존재)은
 * 이 컴포넌트가 빈 상태로 받는다.
 *
 * 읽음 처리(markMailRead)는 마운트 이펙트에서 클라이언트 액션 호출로 한다 —
 * 서버 컴포넌트 렌더 중에는 revalidatePath를 부를 수 없고, 클라이언트 호출
 * 경로는 revalidate가 상단바·패널의 안읽음 배지까지 즉시 되살린다.
 */

export interface MailPerson {
  name: string;
  position?: string | null;
  email?: string | null;
}

export interface MailAttachmentModel {
  id: string;
  name: string;
  sizeBytes: number;
  /** 스토리지 서명 URL — 발급 실패 시 null(그럼 이름만 표시) */
  url?: string | null;
}

export interface MailReadModel {
  id: string;
  subject: string;
  sender: MailPerson;
  to: MailPerson[];
  cc: MailPerson[];
  /** ISO 발송 시각 */
  sentAt: string;
  /** 플레인 텍스트 본문 — 줄바꿈은 그대로 보존해 그린다 */
  body: string;
  attachments: MailAttachmentModel[];
  /** 삭제가 만질 상태 — 수신자 행(received) vs 발신자 상태(sent). 자기 자신
   *  수신 메일은 received 우선(읽기 화면은 받은메일함에서 진입한다) */
  side: MailSide;
  /** 이미 휴지통이면 삭제 버튼이 영구삭제가 된다 */
  inTrash: boolean;
  /** 내 수신자 행이 있고 아직 안 읽음 — 마운트 시 읽음 처리(수신확인 원천) */
  shouldMarkRead: boolean;
}

function personLabel(person: MailPerson): string {
  return person.position ? `${person.name} ${person.position}` : person.name;
}

export function MailRead({ mail }: { mail: MailReadModel | null }) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /*
   * 읽음 처리 — 안읽은 받은 메일에서만. markMailRead는 read_at IS NULL
   * 조건이 걸린 UPDATE라 중복 호출(StrictMode 이중 이펙트 포함)은 0행으로
   * 끝난다(무해). revalidate가 이 화면과 배지를 함께 되살린다.
   */
  const mailId = mail?.id;
  const shouldMarkRead = mail?.shouldMarkRead ?? false;
  useEffect(() => {
    if (mailId && shouldMarkRead) void markMailRead(mailId);
  }, [mailId, shouldMarkRead]);

  if (!mail) {
    /*
     * notFound()를 던지지 않는 이유 — 권한 밖 메일과 미존재 메일을 구분해
     * 알려줄 이유가 없다. 목록 복귀 동선을 담은 빈 상태로 충분하다.
     */
    return (
      <EmptyState
        icon={MailX}
        title="메일을 표시할 수 없습니다"
        description="삭제되었거나 열람 권한이 없는 메일입니다."
        action={
          <LinkButton href="/mail" size="small" variant="secondary">
            받은메일함으로
          </LinkButton>
        }
      />
    );
  }

  /**
   * 휴지통 밖이면 휴지통 이동, 휴지통 안이면 영구삭제 (RLS 0행 확인은 액션 몫).
   * Gmail 메일(id가 uuid 아님 — 목록과 같은 판별)은 gmail-mail.ts 액션으로
   * 분기한다 — 내부 액션은 uuid 전제라 Gmail id에 22P02로 실패한다.
   * Gmail 영구삭제는 제공하지 않는다(client.ts가 일부러 안 노출한 결정).
   */
  const remove = () => {
    if (!isInternalMailId(mail.id)) {
      if (mail.inTrash) {
        setNotice("Gmail 영구삭제는 제공하지 않습니다 — Gmail 웹에서 지워 주세요.");
        return;
      }
      startTransition(async () => {
        const result = await trashGmailAction(mail.id);
        if (!result.ok) {
          setNotice(result.message ?? "삭제하지 못했습니다.");
          return;
        }
        router.push("/mail");
        router.refresh();
      });
      return;
    }
    if (
      mail.inTrash &&
      !window.confirm("영구삭제는 되돌릴 수 없습니다. 계속할까요?")
    ) {
      return;
    }
    startTransition(async () => {
      const result = mail.inTrash
        ? await deleteMailPermanently(mail.id, mail.side)
        : await trashMail(mail.id, mail.side);
      if (!result.ok) {
        setNotice(result.message ?? "삭제하지 못했습니다.");
        return;
      }
      router.push("/mail");
      router.refresh();
    });
  };

  return (
    <div>
      <Link
        href="/mail"
        className="mb-2 inline-flex items-center gap-1 text-label text-muted transition-colors duration-fast ease-standard hover:text-ink"
      >
        <ChevronLeft className="size-3.5" aria-hidden />
        목록으로
      </Link>

      {/* 상단 액션 — 고스트 h-32 · 13px (활성 시 먹색). 답장·전달은 compose 프리필 이동 */}
      <div className="flex items-center gap-1 border-b border-line pb-2">
        <LinkButton
          href={`/mail/compose?reply=${mail.id}`}
          variant="ghost"
          size="xsmall"
        >
          <Reply className="size-4" aria-hidden />
          답장
        </LinkButton>
        <LinkButton
          href={`/mail/compose?forward=${mail.id}`}
          variant="ghost"
          size="xsmall"
        >
          <Forward className="size-4" aria-hidden />
          전달
        </LinkButton>
        <Button variant="ghost" size="xsmall" onClick={remove} disabled={pending}>
          <Trash2 className="size-4" aria-hidden />
          {mail.inTrash ? "영구삭제" : "삭제"}
        </Button>
        {notice ? (
          <span className="ml-auto text-label text-muted">{notice}</span>
        ) : null}
      </div>

      {/* 제목 20/500 — PageHeader(20/600)보다 한 단 가볍다(실측) */}
      <h1 className="mt-5 text-[20px] font-medium leading-[30px] tracking-[-0.4px] text-ink">
        {mail.subject || "(제목 없음)"}
      </h1>

      {/* 발신자 14/600 + 수신자·시각 메타 */}
      <div className="mt-3 space-y-1">
        <p className="text-body-sm font-semibold text-ink">
          {personLabel(mail.sender)}
          {mail.sender.email ? (
            <span className="ml-1.5 font-normal text-muted">
              {mail.sender.email}
            </span>
          ) : null}
        </p>
        <p className="text-label text-muted">
          받는사람 {mail.to.map(personLabel).join(", ") || "-"}
        </p>
        {mail.cc.length > 0 ? (
          <p className="text-label text-muted">
            참조 {mail.cc.map(personLabel).join(", ")}
          </p>
        ) : null}
        <p className="text-label tabular-nums text-muted">
          {formatDateTime(mail.sentAt)}
        </p>
      </div>

      <div className="my-5 border-t border-line" aria-hidden />

      {/* 본문 — 플레인 텍스트, 줄바꿈 보존. 18px 행간은 본문 글에 빡빡해 한 단 푼다 */}
      <div className="whitespace-pre-wrap text-body leading-relaxed text-ink">
        {mail.body}
      </div>

      {mail.attachments.length > 0 ? (
        <div className="mt-6">
          <p className="mb-2 flex items-center gap-1.5 text-label font-bold text-ink-sub">
            <Paperclip className="size-3.5" aria-hidden />
            첨부 {mail.attachments.length}개
          </p>
          <ul className="space-y-1.5">
            {mail.attachments.map((file) => (
              <li key={file.id}>
                <AttachmentRow file={file} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** 첨부 행 — url이 오면 다운로드 링크, 없으면(어댑터 전) 이름만 */
function AttachmentRow({ file }: { file: MailAttachmentModel }) {
  const inner = (
    <>
      <span className="min-w-0 truncate text-body-sm text-ink">
        {file.name}
      </span>
      <span className="shrink-0 text-micro tabular-nums text-muted">
        {formatMailSize(file.sizeBytes)}
      </span>
    </>
  );
  const base =
    "flex max-w-md items-center justify-between gap-3 rounded-card border border-line px-3 py-2";

  return file.url ? (
    <a
      href={file.url}
      download={file.name}
      className={cn(
        base,
        "transition-colors duration-fast ease-standard hover:bg-subtle",
      )}
    >
      {inner}
    </a>
  ) : (
    <span className={base}>{inner}</span>
  );
}
