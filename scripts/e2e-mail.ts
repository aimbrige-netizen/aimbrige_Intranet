/**
 * 스펙 12 사내 메일 RLS·트리거·send_mail() e2e 검증 (마이그레이션 28).
 *
 * ⚠ **마이그레이션 28(20260803000028_mail.sql) 적용 후 실행할 것** —
 *   적용 전에는 mail_messages / mail_recipients 테이블이 없어 전부 실패한다.
 *
 *   npm run e2e:mail -- --yes
 *
 * 메일은 "본문 한 벌(mail_messages) + 수신자별 상태 행(mail_recipients)" 구조라
 * 찔러야 하는 자리가 네 갈래로 갈린다.
 *
 *  (1) 발송 관문. mail_recipients에는 INSERT 정책이 아예 없고 행 생성은
 *      send_mail()(definer)만 한다. 직접 INSERT·upsert의 INSERT 경로·남의
 *      임시저장 승격이 전부 막히는지, 그리고 to/cc에 같은 사람이 겹치면
 *      to 한 통으로 접히는지(PK (message_id, recipient_id) 설계의 전제)를 본다.
 *
 *  (2) 수신자 상태. read_at은 한 번 찍히면 못 되돌리고 값은 클라이언트가 아니라
 *      서버 시각이다 — 발신자의 "수신확인"이 이 값 하나로 서므로, 위조 값이
 *      그대로 저장되는지·제3자가 남의 읽음을 조작할 수 있는지를 다 찌른다.
 *
 *  (3) 발신자 상태. 발신자의 영구삭제는 실제 DELETE가 아니라 sender_deleted_at
 *      스탬프다(행을 지우면 수신자 메일함까지 cascade로 증발한다). 그래서
 *      "휴지통에서만 가능·되돌릴 수 없음·메시지 행은 살아 있음"을 세트로 본다.
 *      실제 DELETE가 허용되는 것은 수신자 행이 없는 임시저장뿐이다.
 *
 *  (4) 안읽음 배지. 배지 질의는 mail_recipients만 세고 messages를 조인하지
 *      않는다 — 임시저장의 받는사람이 draft_to(메시지 쪽 배열)에만 있어야 하는
 *      이유가 그것이라, 임시저장이 배지에 새는지를 수치로 확인한다.
 *
 * 이 스크립트가 만든 메일은 전부 제목에 [e2e] 접두사를 붙이고 finally에서
 * 지운다(수신자·첨부는 cascade). 데모 직원 서현우를 잠시 퇴사 처리했다가
 * 원복한다(퇴사자 수신 거부 검증용).
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

if (!process.argv.includes("--yes")) {
  console.error(
    [
      "",
      "이 스크립트는 실제 DB에 [e2e] 메일을 만들고 데모 직원 한 명(서현우)을",
      "잠시 퇴사 처리합니다(끝나면 전부 원복·삭제). 마이그레이션 28 적용 후에만 동작합니다.",
      "실행하려면: npm run e2e:mail -- --yes",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  ✔ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✖ ${label}${detail ? " — " + detail : ""}`);
  }
};

/** 트리거·함수가 raise한 우리 문장인지까지 본다. 제약 위반으로 우연히 막힌 것과 구분된다 */
const raised = (error: { message: string } | null | undefined, needle: string) =>
  Boolean(error && error.message.includes(needle));

/**
 * 정책에 막힌 쓰기.
 *
 * RLS에 걸린 UPDATE·DELETE는 오류가 아니라 **0행 처리**로 끝난다(규약 3).
 * 권한 자체가 없으면 오류로 오므로 둘 다 받는다. 다만 "막혔다"는 것만으로는
 * 부족해서, 호출한 쪽에서 값이 그대로인지 함께 본다.
 */
const noRows = (res: { data: unknown[] | null; error: unknown | null }) =>
  Boolean(res.error) || res.data?.length === 0;

/** WITH CHECK에 막힌 INSERT (42501). 제약 위반과 구분하려고 코드까지 본다 */
const denied = (error: { code?: string } | null | undefined) =>
  error?.code === "42501";

/**
 * 가드 트리거(P0001 raise)나 정책(42501) 어느 쪽이 먼저 막았든 "막혔다"로 본다.
 * BEFORE 트리거가 WITH CHECK보다 먼저 돌므로 보통은 트리거 문장이 오지만,
 * 어느 쪽이 막았는지는 detail로 남겨 구분한다.
 */
const blocked = (
  error: { code?: string; message: string } | null | undefined,
  needle: string,
) => denied(error) || raised(error, needle);

const stamp = Date.now();

/** 존재하지 않는 수신자 — send_mail()의 실재 검증을 찌르는 데 쓴다 */
const GHOST_ID = "00000000-0000-4000-8000-000000000000";

const SUBJ_MAIN = `[e2e] 업무 공유 ${stamp}`;
const SUBJ_DUP = `[e2e] 중복수신 ${stamp}`;
const SUBJ_TRASH = `[e2e] 휴지통 대상 ${stamp}`;
const SUBJ_DRAFT = `[e2e] 임시저장 ${stamp}`;
const SUBJ_DRAFT_EDIT = `[e2e] 임시저장 수정 ${stamp}`;
const SUBJ_DRAFT_SENT = `[e2e] 임시저장 발송 ${stamp}`;
const SUBJ_DRAFT_DROP = `[e2e] 삭제할 임시저장 ${stamp}`;

async function clientFor(email: string) {
  const { data: link, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw new Error(`generateLink(${email}): ${error.message}`);

  const pub = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: v, error: otpError } = await pub.auth.verifyOtp({
    token_hash: link.properties!.hashed_token,
    type: "email",
  });
  if (otpError) throw new Error(`verifyOtp(${email}): ${otpError.message}`);

  const authId = v.session!.user.id;
  await admin.from("employees").update({ auth_user_id: authId }).eq("email", email);

  return {
    sb: createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${v.session!.access_token}` } },
    }) as SupabaseClient,
    authId,
  };
}

interface MsgRow {
  id: string;
  subject: string;
  body: string;
  is_draft: boolean;
  sent_at: string | null;
  sender_trashed: boolean;
  sender_deleted_at: string | null;
  draft_to: string[];
  draft_cc: string[];
}

/** 메시지 행의 현재 상태 (admin — RLS 밖의 실측값) */
async function msgRow(id: string): Promise<MsgRow | null> {
  const { data } = await admin
    .from("mail_messages")
    .select(
      "id, subject, body, is_draft, sent_at, sender_trashed, sender_deleted_at, draft_to, draft_cc",
    )
    .eq("id", id)
    .maybeSingle();
  return (data as MsgRow | null) ?? null;
}

interface RecipRow {
  kind: string;
  folder: string;
  read_at: string | null;
  starred: boolean;
}

/** 수신자 상태 행의 현재 상태 (admin) */
async function recipRow(messageId: string, recipientId: string): Promise<RecipRow | null> {
  const { data } = await admin
    .from("mail_recipients")
    .select("kind, folder, read_at, starred")
    .eq("message_id", messageId)
    .eq("recipient_id", recipientId)
    .maybeSingle();
  return (data as RecipRow | null) ?? null;
}

/** 메시지의 수신자 행 수 (admin — 위조 INSERT가 실제로 안 들어갔는지) */
async function recipCount(messageId: string) {
  const { count } = await admin
    .from("mail_recipients")
    .select("message_id", { count: "exact", head: true })
    .eq("message_id", messageId);
  return count ?? 0;
}

/**
 * 안읽음 배지 질의 — 앱과 같은 모양(recipients만 세고 messages를 조인하지
 * 않는다). 임시저장이 배지에 새면 여기서 수치로 드러난다.
 */
async function unreadCount(sb: SupabaseClient, employeeId: string) {
  const { count, error } = await sb
    .from("mail_recipients")
    .select("message_id", { count: "exact", head: true })
    .eq("recipient_id", employeeId)
    .eq("folder", "inbox")
    .is("read_at", null);
  if (error) return -1;
  return count ?? 0;
}

/** 받은메일함 목록 — 앱이 쓸 임베드 형태 그대로 (규약 4: FK 명시) */
interface InboxRow {
  message_id: string;
  kind: string;
  folder: string;
  read_at: string | null;
  starred: boolean;
  message: {
    id: string;
    subject: string;
    sent_at: string | null;
    sender: { id: string; name: string } | null;
  } | null;
}

async function inboxOf(sb: SupabaseClient, employeeId: string, folder = "inbox") {
  const res = await sb
    .from("mail_recipients")
    .select(
      `message_id, kind, folder, read_at, starred, created_at,
       message:mail_messages!message_id(id, subject, sent_at,
         sender:employees!sender_id(id, name))`,
    )
    .eq("recipient_id", employeeId)
    .eq("folder", folder)
    .order("created_at", { ascending: false });
  return {
    rows: (res.data ?? []) as unknown as InboxRow[],
    error: res.error,
  };
}

const inboxRowOf = (rows: InboxRow[], subject: string) =>
  rows.find((r) => r.message?.subject === subject) ?? null;

async function main() {
  const SENDER = "sylee@demo.aimbrige.kr"; // 이수연 — 발신자
  const TO = "dwjung@demo.aimbrige.kr"; // 정도원 — 받는사람
  const CC = "mjpark@demo.aimbrige.kr"; // 박민준 — 참조
  const THIRD = "hjchoi@demo.aimbrige.kr"; // 최현정 — 무관한 제3자
  const TERM = "hwseo@demo.aimbrige.kr"; // 서현우 — 잠시 퇴사 처리(수신 거부 검증)

  const emp = async (email: string) => {
    const { data } = await admin
      .from("employees")
      .select("id, name, employment_status")
      .eq("email", email)
      .single();
    if (!data) throw new Error(`${email} 직원 행이 없습니다. npm run seed:demo 먼저.`);
    return data as { id: string; name: string; employment_status: string };
  };

  const sender = await emp(SENDER);
  const receiver = await emp(TO);
  const ccEmp = await emp(CC);
  const third = await emp(THIRD);
  const termEmp = await emp(TERM);

  const authIds: string[] = [];
  let termChanged = false;

  try {
    // ── 준비 ────────────────────────────────────────────────────────
    // 서현우를 잠시 퇴사 처리한다 — send_mail()의 "퇴사자에게 배달하지 않는다"
    // 분기는 실제 terminated 행이 있어야 찌를 수 있다. finally에서 원복.
    await admin
      .from("employees")
      .update({ employment_status: "terminated" })
      .eq("id", termEmp.id);
    termChanged = true;

    const senderUser = await clientFor(SENDER);
    const toUser = await clientFor(TO);
    const ccUser = await clientFor(CC);
    const thirdUser = await clientFor(THIRD);
    authIds.push(senderUser.authId, toUser.authId, ccUser.authId, thirdUser.authId);

    /*
     * 안읽음 배지 장부. 시딩·이전 실행의 잔재와 무관하게 검증하려고 절대값이
     * 아니라 기준값 대비 증감으로 계산한다. 아래 주석의 산수가 곧 기대값이다.
     */
    const baseTo = await unreadCount(toUser.sb, receiver.id);
    const baseCc = await unreadCount(ccUser.sb, ccEmp.id);
    if (baseTo < 0 || baseCc < 0) {
      throw new Error("안읽음 배지 질의가 실패했습니다 — 마이그레이션 28이 적용됐는지 확인하세요.");
    }

    // ── [1] 송신 — send_mail() ──────────────────────────────────────
    console.log("\n[1] send_mail() — 발송·배달·입력 검증");

    const sendMain = await senderUser.sb.rpc("send_mail", {
      p_subject: SUBJ_MAIN,
      p_body: "본문입니다. 받은메일함과 수신확인에 같이 보여야 합니다.",
      p_to: [receiver.id],
      p_cc: [ccEmp.id],
    });
    const mailMain = sendMain.data as string | null;
    check(
      "★ send_mail(to+cc)이 메시지 id를 돌려준다",
      Boolean(mailMain),
      sendMain.error?.message,
    );
    if (!mailMain) throw new Error("기본 메일 발송이 실패해 이후 검증을 할 수 없습니다.");

    interface SentRow {
      id: string;
      subject: string;
      recipients: { recipient_id: string; kind: string; read_at: string | null }[];
    }
    const sentBox = await senderUser.sb
      .from("mail_messages")
      .select(
        `id, subject, sent_at,
         recipients:mail_recipients!message_id(recipient_id, kind, read_at)`,
      )
      .eq("sender_id", sender.id)
      .eq("is_draft", false)
      .eq("sender_trashed", false)
      .is("sender_deleted_at", null)
      .order("sent_at", { ascending: false });
    const sentRows = (sentBox.data ?? []) as unknown as SentRow[];
    const sentMain = sentRows.find((r) => r.id === mailMain);
    check(
      "발신자 보낸메일함에 보이고 수신자 행(to/cc)이 임베드로 따라온다 (수신확인 목록)",
      !sentBox.error &&
        sentMain?.subject === SUBJ_MAIN &&
        sentMain.recipients.length === 2 &&
        sentMain.recipients.some((r) => r.recipient_id === receiver.id && r.kind === "to") &&
        sentMain.recipients.some((r) => r.recipient_id === ccEmp.id && r.kind === "cc"),
      sentBox.error ? sentBox.error.message : JSON.stringify(sentMain ?? null),
    );

    const toInbox1 = await inboxOf(toUser.sb, receiver.id);
    const toRowMain = inboxRowOf(toInbox1.rows, SUBJ_MAIN);
    check(
      "★ 받는사람 받은메일함에 kind=to로 보이고 발신자 임베드(employees!sender_id)가 돈다 (규약 4)",
      !toInbox1.error &&
        toRowMain?.kind === "to" &&
        toRowMain.read_at === null &&
        toRowMain.message?.sender?.name === sender.name,
      toInbox1.error ? toInbox1.error.message : JSON.stringify(toRowMain ?? null),
    );

    const ccInbox1 = await inboxOf(ccUser.sb, ccEmp.id);
    const ccRowMain = inboxRowOf(ccInbox1.rows, SUBJ_MAIN);
    check(
      "참조 수신자 받은메일함에는 kind=cc로 보인다",
      !ccInbox1.error && ccRowMain?.kind === "cc",
      ccInbox1.error ? ccInbox1.error.message : JSON.stringify(ccRowMain ?? null),
    );

    const readScreen = await toUser.sb
      .from("mail_messages")
      .select("id, subject, body, sent_at")
      .eq("id", mailMain)
      .maybeSingle();
    const readScreenRow = readScreen.data as { subject: string; body: string } | null;
    check(
      "수신자가 읽기 화면에서 제목·본문을 그대로 읽는다",
      readScreenRow?.subject === SUBJ_MAIN && (readScreenRow?.body ?? "").includes("본문"),
      readScreen.error ? readScreen.error.message : "행이 없다",
    );

    // to/cc 중복 — PK (message_id, recipient_id) 설계의 전제. 같은 사람이
    // to와 cc에 다 적혀도 to 한 통으로 접혀야 받은메일함이 두 줄 뜨지 않는다.
    const sendDup = await senderUser.sb.rpc("send_mail", {
      p_subject: SUBJ_DUP,
      p_body: "to/cc 중복 정리 검증",
      p_to: [receiver.id],
      p_cc: [receiver.id, ccEmp.id],
    });
    const mailDup = sendDup.data as string | null;
    const dupRow = mailDup ? await recipRow(mailDup, receiver.id) : null;
    check(
      "★ to/cc에 같은 사람이 겹치면 to 한 통으로 접힌다 (행 2개면 배지가 2를 센다)",
      Boolean(mailDup) && (await recipCount(mailDup!)) === 2 && dupRow?.kind === "to",
      sendDup.error
        ? sendDup.error.message
        : `행 ${mailDup ? await recipCount(mailDup) : "?"}개, kind=${dupRow?.kind}`,
    );
    if (!mailDup) throw new Error("중복 검증 메일 발송 실패로 이후 집계 검증을 할 수 없습니다.");

    // 휴지통 수명주기 전용 메일 — 파괴적 검증은 이 한 통에서만 한다
    const sendTrash = await senderUser.sb.rpc("send_mail", {
      p_subject: SUBJ_TRASH,
      p_body: "휴지통 이동·복원·영구삭제 검증 대상",
      p_to: [receiver.id],
    });
    const mailTrash = sendTrash.data as string | null;
    if (!mailTrash) {
      throw new Error(`휴지통 검증 메일 발송 실패: ${sendTrash.error?.message}`);
    }

    const emptySubject = await senderUser.sb.rpc("send_mail", {
      p_subject: "   ",
      p_body: "제목 없음",
      p_to: [receiver.id],
    });
    check(
      "공백뿐인 제목은 거부된다",
      raised(emptySubject.error, "제목을 입력하세요"),
      emptySubject.error ? emptySubject.error.message : "제목 없는 메일이 발송됐다",
    );

    const emptyTo = await senderUser.sb.rpc("send_mail", {
      p_subject: `[e2e] 수신자 없음 ${stamp}`,
      p_body: "받는사람 없음",
      p_to: [],
    });
    check(
      "받는사람이 없으면 거부된다",
      raised(emptyTo.error, "받는사람을 지정하세요"),
      emptyTo.error ? emptyTo.error.message : "수신자 없는 메일이 발송됐다",
    );

    const longSubject = await senderUser.sb.rpc("send_mail", {
      p_subject: "가".repeat(201),
      p_body: "제목 길이",
      p_to: [receiver.id],
    });
    check(
      "200자를 넘는 제목은 거부된다 (목록 레이아웃 보호)",
      raised(longSubject.error, "제목은 200자 이내"),
      longSubject.error ? longSubject.error.message : "201자 제목이 통과했다",
    );

    const longBody = await senderUser.sb.rpc("send_mail", {
      p_subject: `[e2e] 본문 길이 ${stamp}`,
      p_body: "가".repeat(100001),
      p_to: [receiver.id],
    });
    check(
      "10만 자를 넘는 본문은 거부된다",
      raised(longBody.error, "본문이 너무 깁니다"),
      longBody.error ? longBody.error.message : "10만 자 본문이 통과했다",
    );

    const ghostTo = await senderUser.sb.rpc("send_mail", {
      p_subject: `[e2e] 유령 수신자 ${stamp}`,
      p_body: "없는 계정",
      p_to: [GHOST_ID],
    });
    check(
      "존재하지 않는 수신자는 거부된다",
      raised(ghostTo.error, "받을 수 없는 수신자"),
      ghostTo.error ? ghostTo.error.message : "유령에게 발송됐다",
    );

    const termTo = await senderUser.sb.rpc("send_mail", {
      p_subject: `[e2e] 퇴사자 수신 ${stamp}`,
      p_body: "퇴사자",
      p_to: [receiver.id],
      p_cc: [termEmp.id],
    });
    check(
      "★ 퇴사자가 cc에 섞여 있어도 발송 전체가 거부된다 (아무도 안 여는 메일함에 배달하지 않는다)",
      raised(termTo.error, "받을 수 없는 수신자"),
      termTo.error ? termTo.error.message : "퇴사자에게 배달됐다",
    );

    // 상한 검사는 실재 검증보다 먼저 돌므로 무작위 uuid로 찌를 수 있다 —
    // zod 상한은 액션 계층뿐이라 rpc() 직접 호출의 사내 스팸을 RPC가 막아야 한다
    const tooMany = await senderUser.sb.rpc("send_mail", {
      p_subject: `[e2e] 수신자 과다 ${stamp}`,
      p_body: "상한",
      p_to: Array.from({ length: 101 }, () => randomUUID()),
    });
    check(
      "★ 받는사람 101명은 거부된다 (rpc 직접 호출 스팸 방어 — 상한이 RPC 안에 있다)",
      raised(tooMany.error, "받는사람은 100명 이내"),
      tooMany.error ? tooMany.error.message : "101명 발송이 통과했다",
    );

    // 장부: 정도원 +3(MAIN·DUP·TRASH), 박민준 +2(MAIN cc·DUP cc)
    check(
      "발송 직후 안읽음 배지 — 정도원 +3 · 박민준 +2",
      (await unreadCount(toUser.sb, receiver.id)) === baseTo + 3 &&
        (await unreadCount(ccUser.sb, ccEmp.id)) === baseCc + 2,
      `정도원=${await unreadCount(toUser.sb, receiver.id)}(기준 ${baseTo}) 박민준=${await unreadCount(ccUser.sb, ccEmp.id)}(기준 ${baseCc})`,
    );

    // ── [2] RLS — 제3자 격리·발송 경로 봉쇄 ─────────────────────────
    console.log("\n[2] RLS — 제3자 격리 · 발송 경로 봉쇄");

    const thirdMsg = await thirdUser.sb
      .from("mail_messages")
      .select("id, subject")
      .eq("id", mailMain)
      .maybeSingle();
    check(
      "★ 제3자에게는 메시지 행이 보이지 않는다",
      !thirdMsg.error && thirdMsg.data === null,
      thirdMsg.error ? thirdMsg.error.message : "남의 메일이 보인다",
    );

    const thirdRecips = await thirdUser.sb
      .from("mail_recipients")
      .select("recipient_id, kind")
      .eq("message_id", mailMain);
    check(
      "제3자에게는 수신자 행도 보이지 않는다 (누가 받았는지 자체가 비밀)",
      !thirdRecips.error && (thirdRecips.data ?? []).length === 0,
      thirdRecips.error ? thirdRecips.error.message : `${thirdRecips.data?.length}건 보임`,
    );

    /*
     * 수신자끼리의 to/cc 명단은 mail_recipient_list()(definer, 상태 컬럼
     * 없음)로만 본다. 행 직접 조회를 열어 두면 동료 수신자의
     * read_at(수신확인)·starred·folder까지 같이 새기 때문에 정책이 본인
     * 행 + 발신자로 좁혀져 있다 — 두 면을 다 찌른다.
     */
    const peerRoster = await toUser.sb.rpc("mail_recipient_list", {
      p_message_id: mailMain,
    });
    const peerRows = (peerRoster.data ?? []) as {
      recipient_id: string;
      kind: string;
      name: string | null;
    }[];
    check(
      "★ 수신자는 to/cc 명단을 mail_recipient_list()로 본다 (받는사람·참조 메타 표시)",
      peerRows.length === 2 &&
        peerRows.some((r) => r.recipient_id === ccEmp.id && r.kind === "cc"),
      peerRoster.error ? peerRoster.error.message : JSON.stringify(peerRows),
    );

    const peerDirect = await toUser.sb
      .from("mail_recipients")
      .select("recipient_id, read_at, starred, folder")
      .eq("message_id", mailMain);
    const peerDirectRows = (peerDirect.data ?? []) as { recipient_id: string }[];
    check(
      "★ 수신자 행 직접 조회는 본인 행만 준다 (동료의 read_at·별표·폴더가 새지 않는다)",
      !peerDirect.error &&
        peerDirectRows.length === 1 &&
        peerDirectRows[0].recipient_id === receiver.id,
      peerDirect.error ? peerDirect.error.message : `${peerDirectRows.length}행 보임`,
    );

    const thirdRoster = await thirdUser.sb.rpc("mail_recipient_list", {
      p_message_id: mailMain,
    });
    check(
      "제3자에게는 명단 함수도 빈 목록이다",
      !thirdRoster.error && (thirdRoster.data ?? []).length === 0,
      thirdRoster.error
        ? thirdRoster.error.message
        : `${(thirdRoster.data ?? []).length}건 보임`,
    );

    /*
     * mail_messages → employees 임베드는 처음부터 모호하다 — sender_id FK 하나에
     * mail_recipients가 (message_id, recipient_id) 복합 PK 순수 조인 테이블이라
     * PostgREST가 다대다 관계를 한 벌 더 추론한다. 이름만 적은 임베드가
     * PGRST201(후보 2)로 떨어지는 현재 상태를 못박는다 — 규약 4(FK 명시)가
     * 취향이 아니라 필수라는 근거이고, 후보가 셋이 되면 여기가 먼저 터진다.
     */
    const bareEmbed = await senderUser.sb
      .from("mail_messages")
      .select("id, employees(id, name)")
      .eq("id", mailMain)
      .limit(1);
    const bareDetails = bareEmbed.error?.details as unknown;
    const bareCandidates = Array.isArray(bareDetails) ? bareDetails.length : -1;
    check(
      "★ 이름만 적은 employees 임베드는 PGRST201(후보 2)로 떨어진다 — FK 명시가 필수인 이유",
      bareEmbed.error?.code === "PGRST201" && bareCandidates === 2,
      bareEmbed.error
        ? `code=${bareEmbed.error.code} 후보=${bareCandidates}`
        : "모호하지 않다 — employees 참조 구성이 바뀌었다",
    );

    const forgeRecip = await thirdUser.sb
      .from("mail_recipients")
      .insert({ message_id: mailMain, recipient_id: third.id, kind: "to" })
      .select("message_id");
    check(
      "★ 수신자 행 직접 INSERT는 막힌다 (자기를 남의 메일 수신자로 위조)",
      blocked(forgeRecip.error, "수신자 등록은 send_mail()로만") &&
        (await recipCount(mailMain)) === 2,
      forgeRecip.error ? forgeRecip.error.message : "위조 수신자가 들어갔다",
    );

    const directSend = await thirdUser.sb
      .from("mail_messages")
      .insert({
        sender_id: third.id,
        subject: `[e2e] 직접 발송 ${stamp}`,
        body: "RPC 우회",
        is_draft: false,
        sent_at: new Date().toISOString(),
      })
      .select("id");
    check(
      "★ is_draft=false 직접 INSERT는 막힌다 (발송은 send_mail() 한 곳)",
      blocked(directSend.error, "메일 발송은 send_mail()로만"),
      directSend.error ? directSend.error.message : "RPC를 우회해 발송됐다",
    );

    const forgeSender = await thirdUser.sb
      .from("mail_messages")
      .insert({
        sender_id: sender.id,
        subject: `[e2e] 발신자 사칭 ${stamp}`,
        body: "남의 이름으로",
      })
      .select("id");
    check(
      "남의 sender_id로는 임시저장도 못 만든다 (발신자 사칭)",
      denied(forgeSender.error),
      forgeSender.error ? `code=${forgeSender.error.code}` : "남의 이름으로 저장됐다",
    );

    // ── [3] 읽음 — read_at 무결성 ───────────────────────────────────
    console.log("\n[3] read_at — 수신확인 무결성");

    // 위조 값(2000년)을 보내 본다 — 가드가 서버 시각으로 덮어야 한다
    const markRead = await toUser.sb
      .from("mail_recipients")
      .update({ read_at: "2000-01-01T00:00:00Z" })
      .eq("message_id", mailMain)
      .eq("recipient_id", receiver.id)
      .select("read_at")
      .single();
    const readAt = (markRead.data as { read_at: string | null } | null)?.read_at;
    check(
      "★ 읽음 처리 시 read_at은 클라이언트 값이 아니라 서버 시각으로 찍힌다",
      Boolean(readAt) && new Date(readAt!).getFullYear() >= 2026,
      markRead.error ? markRead.error.message : `read_at=${readAt}`,
    );

    const receipt = await senderUser.sb
      .from("mail_recipients")
      .select("recipient_id, kind, read_at")
      .eq("message_id", mailMain);
    const receiptRows = (receipt.data ?? []) as {
      recipient_id: string;
      read_at: string | null;
    }[];
    check(
      "★ 발신자 수신확인에 반영된다 — 정도원 읽음·박민준 안읽음",
      receiptRows.find((r) => r.recipient_id === receiver.id)?.read_at != null &&
        receiptRows.find((r) => r.recipient_id === ccEmp.id)?.read_at == null,
      receipt.error ? receipt.error.message : JSON.stringify(receiptRows),
    );

    const forgeRead = await thirdUser.sb
      .from("mail_recipients")
      .update({ read_at: new Date().toISOString() })
      .eq("message_id", mailMain)
      .eq("recipient_id", ccEmp.id)
      .select("read_at");
    check(
      "제3자가 남의 read_at을 갱신하면 0행으로 끝난다",
      noRows(forgeRead) && (await recipRow(mailMain, ccEmp.id))?.read_at === null,
      forgeRead.error ? forgeRead.error.message : "남의 읽음이 조작됐다",
    );

    const unread = await toUser.sb
      .from("mail_recipients")
      .update({ read_at: null })
      .eq("message_id", mailMain)
      .eq("recipient_id", receiver.id)
      .select("read_at");
    check(
      "★ 한 번 찍힌 read_at은 본인도 되돌릴 수 없다 (수신확인이 거짓이 된다)",
      raised(unread.error, "읽음 확인은 되돌릴 수 없습니다") &&
        (await recipRow(mailMain, receiver.id))?.read_at !== null,
      unread.error ? unread.error.message : "읽음이 취소됐다",
    );

    // 장부: 정도원 +3에서 MAIN 읽음 → +2
    check(
      "읽고 나면 안읽음 배지가 줄어든다 — 정도원 +2",
      (await unreadCount(toUser.sb, receiver.id)) === baseTo + 2,
      `정도원=${await unreadCount(toUser.sb, receiver.id)}(기대 ${baseTo + 2})`,
    );

    // ── [4] 별표 · 휴지통 · 영구삭제 ────────────────────────────────
    console.log("\n[4] 별표 · 휴지통 이동/복원 · 영구삭제");

    const star = await toUser.sb
      .from("mail_recipients")
      .update({ starred: true })
      .eq("message_id", mailMain)
      .eq("recipient_id", receiver.id)
      .select("starred");
    const starList = await toUser.sb
      .from("mail_recipients")
      .select("message_id")
      .eq("recipient_id", receiver.id)
      .eq("folder", "inbox")
      .eq("starred", true);
    check(
      "수신자는 별표를 켤 수 있고 별표 빠른검색에 잡힌다",
      (star.data as { starred: boolean }[] | null)?.[0]?.starred === true &&
        (starList.data ?? []).some(
          (r: { message_id: string }) => r.message_id === mailMain,
        ),
      star.error?.message ?? starList.error?.message ?? "",
    );

    const toTrash = await toUser.sb
      .from("mail_recipients")
      .update({ folder: "trash" })
      .eq("message_id", mailTrash)
      .eq("recipient_id", receiver.id)
      .select("folder");
    const inboxAfterTrash = await inboxOf(toUser.sb, receiver.id);
    const trashBox = await inboxOf(toUser.sb, receiver.id, "trash");
    check(
      "★ 휴지통 이동 — 받은메일함에서 빠지고 휴지통 목록에 나타난다",
      !toTrash.error &&
        inboxRowOf(inboxAfterTrash.rows, SUBJ_TRASH) === null &&
        inboxRowOf(trashBox.rows, SUBJ_TRASH) !== null,
      toTrash.error?.message ?? "휴지통 이동이 목록에 반영되지 않았다",
    );

    // 장부: 안읽은 TRASH가 휴지통으로 → 배지에서 빠져 +1
    check(
      "휴지통의 안읽음 메일은 배지에서 빠진다 — 정도원 +1",
      (await unreadCount(toUser.sb, receiver.id)) === baseTo + 1,
      `정도원=${await unreadCount(toUser.sb, receiver.id)}(기대 ${baseTo + 1})`,
    );

    const purgeInbox = await toUser.sb
      .from("mail_recipients")
      .delete()
      .eq("message_id", mailMain)
      .eq("recipient_id", receiver.id)
      .select("message_id");
    check(
      "★ 휴지통 밖(받은메일함) 영구삭제는 0행으로 막힌다",
      noRows(purgeInbox) && (await recipRow(mailMain, receiver.id)) !== null,
      purgeInbox.error ? purgeInbox.error.message : "받은메일함에서 바로 지워졌다",
    );

    const restore = await toUser.sb
      .from("mail_recipients")
      .update({ folder: "inbox" })
      .eq("message_id", mailTrash)
      .eq("recipient_id", receiver.id)
      .select("folder");
    const inboxAfterRestore = await inboxOf(toUser.sb, receiver.id);
    check(
      "휴지통 복원 — 받은메일함으로 돌아온다",
      !restore.error && inboxRowOf(inboxAfterRestore.rows, SUBJ_TRASH) !== null,
      restore.error?.message ?? "복원이 목록에 반영되지 않았다",
    );

    await toUser.sb
      .from("mail_recipients")
      .update({ folder: "trash" })
      .eq("message_id", mailTrash)
      .eq("recipient_id", receiver.id);
    const purgeTrash = await toUser.sb
      .from("mail_recipients")
      .delete()
      .eq("message_id", mailTrash)
      .eq("recipient_id", receiver.id)
      .select("message_id");
    check(
      "★ 휴지통에서는 영구삭제된다 — 수신자 행만 지워지고 메시지 행은 남는다",
      purgeTrash.data?.length === 1 &&
        (await recipRow(mailTrash, receiver.id)) === null &&
        (await msgRow(mailTrash)) !== null,
      purgeTrash.error ? purgeTrash.error.message : "0행 삭제이거나 메시지까지 지워졌다",
    );

    // 발신자 쪽 — 보낸메일함 → 휴지통 → 영구삭제(스탬프)
    const senderTrash = await senderUser.sb
      .from("mail_messages")
      .update({ sender_trashed: true })
      .eq("id", mailTrash)
      .select("sender_trashed");
    const senderSentBox = await senderUser.sb
      .from("mail_messages")
      .select("id")
      .eq("sender_id", sender.id)
      .eq("is_draft", false)
      .eq("sender_trashed", false)
      .is("sender_deleted_at", null);
    const senderTrashBox = await senderUser.sb
      .from("mail_messages")
      .select("id")
      .eq("sender_id", sender.id)
      .eq("sender_trashed", true)
      .is("sender_deleted_at", null);
    check(
      "발신자 휴지통 이동 — 보낸메일함에서 빠지고 발신자 휴지통에 나타난다",
      !senderTrash.error &&
        !(senderSentBox.data ?? []).some((r: { id: string }) => r.id === mailTrash) &&
        (senderTrashBox.data ?? []).some((r: { id: string }) => r.id === mailTrash),
      senderTrash.error?.message ?? "발신자 휴지통 이동이 반영되지 않았다",
    );

    const purgeNotTrashed = await senderUser.sb
      .from("mail_messages")
      .update({ sender_deleted_at: new Date().toISOString() })
      .eq("id", mailMain)
      .select("id");
    check(
      "★ 발신자도 휴지통 밖에서는 영구삭제할 수 없다",
      raised(purgeNotTrashed.error, "휴지통에 있는 메일만") &&
        (await msgRow(mailMain))?.sender_deleted_at === null,
      purgeNotTrashed.error ? purgeNotTrashed.error.message : "보낸메일함에서 바로 지워졌다",
    );

    // 위조 값(2000년)을 보낸다 — 스탬프는 서버 시각이어야 한다
    const senderPurge = await senderUser.sb
      .from("mail_messages")
      .update({ sender_deleted_at: "2000-01-01T00:00:00Z" })
      .eq("id", mailTrash)
      .select("sender_deleted_at")
      .single();
    const purgedAt = (senderPurge.data as { sender_deleted_at: string | null } | null)
      ?.sender_deleted_at;
    check(
      "★ 발신자 영구삭제는 서버 시각 스탬프이고, 메시지 행은 그대로 남는다 (수신자 메일함 보존)",
      Boolean(purgedAt) &&
        new Date(purgedAt!).getFullYear() >= 2026 &&
        (await msgRow(mailTrash)) !== null,
      senderPurge.error ? senderPurge.error.message : `sender_deleted_at=${purgedAt}`,
    );

    const unPurge = await senderUser.sb
      .from("mail_messages")
      .update({ sender_deleted_at: null })
      .eq("id", mailTrash)
      .select("id");
    check(
      "영구삭제는 되돌릴 수 없다",
      raised(unPurge.error, "영구삭제는 되돌릴 수 없습니다") &&
        (await msgRow(mailTrash))?.sender_deleted_at !== null,
      unPurge.error ? unPurge.error.message : "영구삭제가 취소됐다",
    );

    // ── [5] 임시저장 — draft 생성 → 발송 승격 ───────────────────────
    console.log("\n[5] 임시저장 — 생성 · 격리 · 승격 · 실제 DELETE");

    const beforeDraft = await unreadCount(toUser.sb, receiver.id);

    const draftIns = await senderUser.sb
      .from("mail_messages")
      .insert({
        sender_id: sender.id,
        subject: SUBJ_DRAFT,
        body: "아직 보내지 않은 본문",
        draft_to: [receiver.id],
      })
      .select("id, is_draft, sent_at")
      .single();
    const draftId = (draftIns.data as { id: string } | null)?.id;
    check(
      "임시저장을 만들 수 있다 (is_draft=true · sent_at=null · draft_to에 받는사람 보관)",
      Boolean(draftId) &&
        (draftIns.data as { is_draft: boolean } | null)?.is_draft === true &&
        (await msgRow(draftId!))?.draft_to.includes(receiver.id) === true,
      draftIns.error?.message,
    );
    if (!draftId) throw new Error("임시저장 생성 실패로 이후 검증을 할 수 없습니다.");

    const draftPeek = await toUser.sb
      .from("mail_messages")
      .select("id")
      .eq("id", draftId)
      .maybeSingle();
    check(
      "★ draft_to에 적힌 수신자에게도 임시저장은 보이지 않는다",
      !draftPeek.error && draftPeek.data === null,
      draftPeek.error ? draftPeek.error.message : "남의 임시저장이 보인다",
    );

    check(
      "★ 임시저장은 안읽음 배지에 새지 않는다 (draft_to가 메시지 쪽 배열인 이유)",
      (await unreadCount(toUser.sb, receiver.id)) === beforeDraft,
      `정도원=${await unreadCount(toUser.sb, receiver.id)}(기대 ${beforeDraft})`,
    );

    const draftEdit = await senderUser.sb
      .from("mail_messages")
      .update({ subject: SUBJ_DRAFT_EDIT, body: "수정한 본문" })
      .eq("id", draftId)
      .select("subject");
    check(
      "발신자는 임시저장의 제목·본문을 고칠 수 있다",
      (draftEdit.data as { subject: string }[] | null)?.[0]?.subject === SUBJ_DRAFT_EDIT,
      draftEdit.error?.message,
    );

    const selfPromote = await senderUser.sb
      .from("mail_messages")
      .update({ is_draft: false, sent_at: new Date().toISOString() })
      .eq("id", draftId)
      .select("id");
    check(
      "★ UPDATE로 직접 발송 승격은 막힌다 (수신자 행 없는 '보낸 메일'이 생긴다)",
      raised(selfPromote.error, "메일 발송은 send_mail()로만") &&
        (await msgRow(draftId))?.is_draft === true,
      selfPromote.error ? selfPromote.error.message : "수신자 없는 발송 메일이 생겼다",
    );

    const stealPromote = await thirdUser.sb.rpc("send_mail", {
      p_subject: `[e2e] 남의 임시저장 승격 ${stamp}`,
      p_body: "가로채기",
      p_to: [third.id],
      p_draft_id: draftId,
    });
    check(
      "제3자는 남의 임시저장을 승격할 수 없다",
      raised(stealPromote.error, "임시보관 메일을 찾을 수 없습니다") &&
        (await msgRow(draftId))?.is_draft === true,
      stealPromote.error ? stealPromote.error.message : "남의 임시저장이 발송됐다",
    );

    const promote = await senderUser.sb.rpc("send_mail", {
      p_subject: SUBJ_DRAFT_SENT,
      p_body: "임시저장에서 발송된 최종 본문",
      p_to: [receiver.id],
      p_cc: [],
      p_draft_id: draftId,
    });
    const promoted = await msgRow(draftId);
    check(
      "★ send_mail(p_draft_id)로 승격 — 같은 id로 발송되고 draft_to는 비워진다",
      promote.data === draftId &&
        promoted?.is_draft === false &&
        promoted.sent_at !== null &&
        promoted.draft_to.length === 0 &&
        (await recipRow(draftId, receiver.id))?.kind === "to",
      promote.error ? promote.error.message : JSON.stringify(promoted ?? null),
    );

    const inboxAfterPromote = await inboxOf(toUser.sb, receiver.id);
    check(
      "승격된 메일이 받는사람 받은메일함에 등장한다",
      inboxRowOf(inboxAfterPromote.rows, SUBJ_DRAFT_SENT) !== null,
      inboxAfterPromote.error?.message ?? "받은메일함에 없다",
    );

    const draft2 = await senderUser.sb
      .from("mail_messages")
      .insert({ sender_id: sender.id, subject: SUBJ_DRAFT_DROP, body: "버릴 초안" })
      .select("id")
      .single();
    const draft2Id = (draft2.data as { id: string } | null)?.id;
    const dropDraft = draft2Id
      ? await senderUser.sb
          .from("mail_messages")
          .delete()
          .eq("id", draft2Id)
          .select("id")
      : null;
    check(
      "임시저장은 실제 DELETE로 지워진다 (수신자 행이 없어 잃을 것이 없다)",
      Boolean(draft2Id) &&
        dropDraft?.data?.length === 1 &&
        (await msgRow(draft2Id!)) === null,
      draft2.error?.message ?? dropDraft?.error?.message ?? "삭제가 0행으로 끝났다",
    );

    const dropSent = await senderUser.sb
      .from("mail_messages")
      .delete()
      .eq("id", mailMain)
      .select("id");
    check(
      "★ 발송된 메일은 발신자도 DELETE할 수 없다 (cascade로 수신자 메일함이 증발한다)",
      noRows(dropSent) && (await msgRow(mailMain)) !== null,
      dropSent.error ? dropSent.error.message : "발송 메일이 DELETE됐다",
    );

    // ── [6] 컬럼 가드 — 변조 시도 ───────────────────────────────────
    console.log("\n[6] 컬럼 가드 — 본문·수신정보·남의 상태 변조");

    const recipEditSubject = await toUser.sb
      .from("mail_messages")
      .update({ subject: "[e2e] 수신자가 바꾼 제목" })
      .eq("id", mailMain)
      .select("id");
    check(
      "★ 수신자는 메시지 제목·본문을 변조할 수 없다 (0행)",
      noRows(recipEditSubject) && (await msgRow(mailMain))?.subject === SUBJ_MAIN,
      recipEditSubject.error ? recipEditSubject.error.message : "수신자가 제목을 바꿨다",
    );

    const senderEditSent = await senderUser.sb
      .from("mail_messages")
      .update({ subject: "[e2e] 발신자가 바꾼 제목" })
      .eq("id", mailMain)
      .select("id");
    check(
      "★ 발신자도 발송된 메일의 본문은 못 바꾼다 (수신자가 이미 읽은 내용)",
      raised(senderEditSent.error, "발송된 메일은 수정할 수 없습니다") &&
        (await msgRow(mailMain))?.subject === SUBJ_MAIN,
      senderEditSent.error ? senderEditSent.error.message : "발송 후 제목이 바뀌었다",
    );

    const kindFlip = await toUser.sb
      .from("mail_recipients")
      .update({ kind: "cc" })
      .eq("message_id", mailMain)
      .eq("recipient_id", receiver.id)
      .select("kind");
    check(
      "수신자 본인도 kind(to/cc)를 바꿀 수 없다 (수신 사실은 기록이다)",
      raised(kindFlip.error, "수신 정보는 변경할 수 없습니다") &&
        (await recipRow(mailMain, receiver.id))?.kind === "to",
      kindFlip.error ? kindFlip.error.message : "kind가 바뀌었다",
    );

    const starForge = await senderUser.sb
      .from("mail_recipients")
      .update({ starred: false })
      .eq("message_id", mailMain)
      .eq("recipient_id", receiver.id)
      .select("starred");
    check(
      "★ 발신자가 수신자의 별표를 변조하면 0행으로 끝난다",
      noRows(starForge) && (await recipRow(mailMain, receiver.id))?.starred === true,
      starForge.error ? starForge.error.message : "남의 별표가 꺼졌다",
    );

    // 규약 2의 요점 — upsert는 INSERT 경로로 가드를 우회하려는 고전 수법이다
    const upsertForge = await thirdUser.sb
      .from("mail_recipients")
      .upsert(
        { message_id: mailMain, recipient_id: third.id, kind: "to", starred: true },
        { onConflict: "message_id,recipient_id" },
      )
      .select("message_id");
    check(
      "★ upsert의 INSERT 경로로도 수신자 위조가 안 된다 (before insert or update 가드)",
      blocked(upsertForge.error, "수신자 등록은 send_mail()로만") &&
        (await recipRow(mailMain, third.id)) === null,
      upsertForge.error ? upsertForge.error.message : "upsert로 수신자가 위조됐다",
    );

    // ── [7] 안읽음 배지 최종 대차 ───────────────────────────────────
    console.log("\n[7] 안읽음 배지 — 최종 대차 대조");

    /*
     * 정도원 장부: +MAIN(발송) +DUP +TRASH → MAIN 읽음(-1) → TRASH 영구삭제(-1)
     *             → 승격 메일(+1) = 기준 +2 (DUP·승격 메일이 안읽음으로 남는다)
     * 박민준 장부: +MAIN(cc) +DUP(cc) = 기준 +2 (아무도 못 건드렸어야 한다)
     */
    const finalTo = await unreadCount(toUser.sb, receiver.id);
    const finalCc = await unreadCount(ccUser.sb, ccEmp.id);
    check(
      "★ 정도원 최종 안읽음 = 기준 +2 (읽음·휴지통·영구삭제·승격이 전부 정확히 반영)",
      finalTo === baseTo + 2,
      `정도원=${finalTo}(기대 ${baseTo + 2})`,
    );
    check(
      "★ 박민준 최종 안읽음 = 기준 +2 (제3자·발신자의 조작 시도가 하나도 새지 않았다)",
      finalCc === baseCc + 2,
      `박민준=${finalCc}(기대 ${baseCc + 2})`,
    );

    // 사용자 관점 배지(RLS 질의)가 admin 실측과 같은지 — RLS가 배지를 부풀리거나
    // 깎아 먹으면 여기서 어긋난다
    const { count: adminTo } = await admin
      .from("mail_recipients")
      .select("message_id", { count: "exact", head: true })
      .eq("recipient_id", receiver.id)
      .eq("folder", "inbox")
      .is("read_at", null);
    check(
      "배지 질의가 RLS 아래에서도 실측(admin)과 같은 수를 센다",
      finalTo === (adminTo ?? -1),
      `RLS=${finalTo} admin=${adminTo}`,
    );
  } finally {
    console.log("\n[정리]");

    // [e2e] 메일을 제목으로 지운다 — 수신자·첨부 행은 cascade로 따라 지워진다
    const { count: mailCount } = await admin
      .from("mail_messages")
      .delete({ count: "exact" })
      .like("subject", "[e2e]%");
    console.log(`  · [e2e] 메일 ${mailCount ?? 0}건 삭제 (수신자·첨부 cascade)`);

    if (termChanged) {
      await admin
        .from("employees")
        .update({ employment_status: termEmp.employment_status })
        .eq("id", termEmp.id);
      console.log(`  · 서현우 재직 상태 원복 (${termEmp.employment_status})`);
    }

    for (const id of authIds) {
      await admin.from("employees").update({ auth_user_id: null }).eq("auth_user_id", id);
      await admin.auth.admin.deleteUser(id);
    }
    console.log(`  · 임시 auth 계정 ${authIds.length}개 삭제`);
  }

  console.log(`\n결과: ${pass}건 통과 / ${fail}건 실패`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error("\n예외:", error.message ?? error);
  process.exit(1);
});
