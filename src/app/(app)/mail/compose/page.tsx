import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  MailComposer,
  type MailComposeInitial,
  type MailRecipientOption,
} from "@/features/mail/MailComposer";
import { getMailDetail, type MailDetail } from "@/features/mail/data";
import {
  getGmailDetail,
  hasGmailConnection,
  type GmailDetail,
} from "@/features/mail/gmail-source";
import { partyLabel } from "@/features/mail/gmail-view";
import { getDirectory } from "@/features/directory/data";
import { requireSessionEmployee } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "메일쓰기" };

/** 내부 메일 id는 uuid — Gmail id(16진수 문자열)와 이걸로 가른다 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RE:/FW: 접두 — 이미 붙어 있으면 중복해 쌓지 않는다 */
function prefixSubject(prefix: "RE" | "FW", subject: string): string {
  const base = subject.trim();
  if (base.toUpperCase().startsWith(`${prefix}:`)) return base;
  return `${prefix}: ${base}`.trim();
}

/** 답장·전달 본문의 원본 인용 — 플레인 텍스트 관례 그대로 */
function quoteBody(detail: MailDetail): string {
  return [
    "",
    "",
    "-----원본 메일-----",
    `보낸사람: ${detail.sender?.name ?? "(퇴사자)"}`,
    `보낸시각: ${detail.sentAt ? formatDateTime(detail.sentAt) : "-"}`,
    `제목: ${detail.subject || "(제목 없음)"}`,
    "",
    detail.body,
  ].join("\n");
}

/** Gmail 원본 인용 — 내부 quoteBody와 같은 판형, 발신자만 주소까지 싣는다 */
function quoteGmailBody(detail: GmailDetail): string {
  const from = detail.from.email
    ? `${partyLabel(detail.from)} <${detail.from.email}>`
    : partyLabel(detail.from) || "(발신자 없음)";
  return [
    "",
    "",
    "-----원본 메일-----",
    `보낸사람: ${from}`,
    `보낸시각: ${detail.internalDate ? formatDateTime(detail.internalDate) : "-"}`,
    `제목: ${detail.subject || "(제목 없음)"}`,
    "",
    detail.bodyText,
  ].join("\n");
}

/**
 * 메일쓰기 (12-mail.md /compose — 전체 화면 라우트).
 *
 * 받는사람·참조 자동완성은 조직도 데이터(getDirectory — 재직자만)를
 * 그대로 쓴다. ?reply=/?forward=/?draft= 프리필은 getMailDetail로 원본을
 * 읽어 만든다 — 권한 밖 id는 null이라 조용히 빈 폼이 된다(소프트 실패).
 */
export default async function MailComposePage({
  searchParams,
}: {
  searchParams: { reply?: string; forward?: string; draft?: string };
}) {
  const me = await requireSessionEmployee();
  const { employees, departments, teams } = await getDirectory();

  const departmentById = new Map(departments.map((d) => [d.id, d.name]));
  const teamById = new Map(teams.map((t) => [t.id, t.name]));

  // 내게 쓰기는 1차 제외 — 본인은 후보에서 뺀다
  const options: MailRecipientOption[] = employees
    .filter((employee) => employee.id !== me.id)
    .map((employee) => ({
      id: employee.id,
      name: employee.name,
      email: employee.email,
      position: employee.position,
      group:
        [
          employee.department_id
            ? departmentById.get(employee.department_id)
            : null,
          employee.team_id ? teamById.get(employee.team_id) : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
    }));

  /*
   * 발송 경로 — 연동이면 Gmail(외부 주소 겸용), 아니면 내부 DB(현행 그대로).
   * 임직원 자동완성 옵션은 양쪽 공통이다(Gmail 소스는 칩을 이메일로 해석).
   */
  const gmailConnected = await hasGmailConnection();

  /*
   * 프리필 세 갈래. 옵션에 없는 id(퇴사자 등)는 MailComposer가 조용히
   * 떨군다 — 답장 대상 발신자가 퇴사했으면 받는사람이 비어 시작한다.
   *
   * id가 uuid면 내부 메일, 아니면 Gmail 메일이다(읽기 화면과 같은 판별).
   * Gmail 임시보관 이어쓰기는 1차 제외(목록도 읽기 전용) — Gmail 모양의
   * draft id는 조용히 빈 폼으로 시작한다.
   */
  let initial: MailComposeInitial | undefined;
  let mode: string | null = null;

  if (searchParams.draft) {
    if (UUID_PATTERN.test(searchParams.draft)) {
      const draft = await getMailDetail(searchParams.draft, me.id);
      if (draft?.isDraft && draft.isMine) {
        mode = "임시보관 이어쓰기";
        initial = {
          draftId: draft.id,
          to: draft.draftTo.map((ref) => ref.id),
          cc: draft.draftCc.map((ref) => ref.id),
          subject: draft.subject,
          body: draft.body,
          attachments: draft.attachments,
        };
      }
    }
  } else if (searchParams.reply) {
    if (UUID_PATTERN.test(searchParams.reply)) {
      const source = await getMailDetail(searchParams.reply, me.id);
      if (source && !source.isDraft) {
        mode = "답장";
        initial = {
          to: source.senderId && source.senderId !== me.id ? [source.senderId] : [],
          subject: prefixSubject("RE", source.subject),
          body: quoteBody(source),
        };
      }
    } else if (gmailConnected) {
      const source = await getGmailDetail(me.id, searchParams.reply);
      if (source) {
        mode = "답장";
        initial = {
          toEmails: source.from.email ? [source.from.email] : [],
          subject: prefixSubject("RE", source.subject),
          body: quoteGmailBody(source),
        };
      }
    }
  } else if (searchParams.forward) {
    if (UUID_PATTERN.test(searchParams.forward)) {
      const source = await getMailDetail(searchParams.forward, me.id);
      if (source && !source.isDraft) {
        mode = "전달";
        initial = {
          subject: prefixSubject("FW", source.subject),
          body: quoteBody(source),
        };
      }
    } else if (gmailConnected) {
      const source = await getGmailDetail(me.id, searchParams.forward);
      if (source) {
        mode = "전달";
        initial = {
          subject: prefixSubject("FW", source.subject),
          body: quoteGmailBody(source),
        };
      }
    }
  }

  return (
    <>
      <PageHeader
        title="메일쓰기"
        backHref="/mail"
        backLabel="메일함으로"
        description={
          mode
            ? `${mode} — 내용을 확인하고 보내세요.`
            : gmailConnected
              ? "연동된 Gmail로 보내는 메일입니다 — 임직원과 외부 주소 모두 받을 수 있습니다."
              : "사내 임직원에게 보내는 메일입니다."
        }
      />
      <MailComposer
        options={options}
        initial={initial}
        authUserId={me.auth_user_id}
        source={gmailConnected ? "gmail" : "internal"}
      />
    </>
  );
}
