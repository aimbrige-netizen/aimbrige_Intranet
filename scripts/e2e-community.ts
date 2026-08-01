/**
 * 스펙 16 동호회 RLS·트리거·트랜잭션 e2e 검증 (마이그레이션 24).
 *
 *   npm run e2e:community -- --yes
 *
 * 이 모듈은 새 도메인이 아니라 "가입이 필요한 게시판"이라, 검증해야 하는 자리도
 * 새 테이블보다 **기존 게시판 규칙을 넓히면서 생긴 틈**에 몰려 있다. 셋이다.
 *
 *  (1) can_post_to_board()의 community 분기. 이 분기가 없으면 권한이 정확히
 *      뒤집힌다 — 가입한 사람은 자기 동호회에 글을 못 쓰고, 가입하지도 않은
 *      팀장·관리자는 아무 동호회에나 쓴다. 그래서 "막혀야 하는 방향"만이 아니라
 *      **열려야 하는 방향(가입자가 쓸 수 있는가)도 반드시 찌른다**. 여기서
 *      관리자 우회를 일부러 넣지 않았으므로, 가입 안 한 관리자가 막히는 것도
 *      버그가 아니라 사양이다 — 나중에 "관리자인데 왜 안 되죠"로 되돌아올 때
 *      이 검증이 근거가 된다.
 *
 *  (2) boards INSERT를 전 임직원에게 열었다. 통째로 열면 일반 직원이 '전사공지'
 *      게시판을 만들 수 있다. 그래서 community 타입에만, 그것도 department_id·
 *      archived_at·created_by까지 묶어서 연다. 정책 한 줄이 네 가지를 동시에
 *      막고 있으므로 네 가지를 따로 찔러야 한다 — 하나만 빠져도 화면에는
 *      아무 증상이 없다.
 *
 *  (3) posts.board_id / comments.post_id 바꿔치기. 원본 UPDATE 정책은 작성자만
 *      보고 대상 보드·글을 보지 않는다. 자유게시판에 글을 쓴 뒤 board_id만
 *      남의 동호회로 바꾸면 INSERT의 can_post_to_board() 검사를 통째로 우회한다.
 *      댓글도 같은 모양의 구멍이 있었다. 이 셋은 화면에 그런 버튼이 없어서
 *      눌러봐서는 절대 안 걸리고, PostgREST로는 한 줄이면 된다.
 *
 * 데모 시딩(동호회 4개·가입 13건·글 4건)은 화면 검증에 쓰므로 건드리지 않는다.
 * 이 스크립트가 만든 것만 이름·제목에 [e2e] 접두사를 붙이고 finally에서 지운다.
 */
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
      "이 스크립트는 실제 DB에 [e2e] 동호회·게시글·댓글을 만들고 데모 직원 역할을",
      "잠시 바꿉니다(끝나면 전부 원복). 시딩된 동호회 데이터는 건드리지 않습니다.",
      "실행하려면: npm run e2e:community -- --yes",
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
 * RLS에 걸린 UPDATE·DELETE는 오류가 아니라 **0행 처리**로 끝난다. 권한 자체가
 * 없으면 오류로 오므로 둘 다 받는다. 다만 "막혔다"는 것만으로는 부족해서,
 * 호출한 쪽에서 값이 그대로인지 함께 본다.
 */
const noRows = (res: { data: unknown[] | null; error: unknown | null }) =>
  Boolean(res.error) || res.data?.length === 0;

/**
 * WITH CHECK에 막힌 INSERT.
 *
 * 코드까지 본다. 동호회 INSERT는 유니크 인덱스(같은 이름)·CHECK 제약(60자)·
 * FK가 함께 걸려 있어서, "오류가 났다"만 보면 정책이 아니라 제약에 막힌 것을
 * 정책이 막았다고 읽게 된다 — 정책을 지워도 이 검증이 계속 통과한다.
 */
const denied = (error: { code?: string } | null | undefined) =>
  error?.code === "42501";

const stamp = Date.now();

/**
 * 동호회 이름.
 *
 * 운영 중인 동호회끼리 이름이 유일해야 하므로(boards_community_name_uniq)
 * 이전 실행이 중간에 끊겨 남았을 때를 대비해 실행마다 다른 이름을 쓴다.
 * 정리는 접두사로 하므로 stamp가 달라도 전부 지워진다.
 */
const NAME_A = `[e2e] 등산모임 ${stamp}`;
const NAME_ARCHIVED = `[e2e] 보관대상 ${stamp}`;
const NAME_DUP = `[e2e] 이름중복 ${stamp}`;
const NAME_DIRECT = `[e2e] 직접개설 ${stamp}`;
const NAME_LEAVE = `[e2e] 탈퇴검증 ${stamp}`;

/** 존재하지 않는 대상 — 보관이 0행으로 조용히 끝나는지 보는 데 쓴다 */
const GHOST_ID = "00000000-0000-4000-8000-000000000000";

/**
 * 앱이 쓰는 boards 컬럼 목록.
 * src/features/boards/data.ts의 BOARD_COLUMNS와 **글자 그대로** 같아야 한다 —
 * 아래 [7]절이 이 문자열을 그대로 쏘는 것이 검증의 요점이다.
 */
const BOARD_COLUMNS =
  "id, name, board_type, department_id, sort_order, created_at, description, created_by, archived_at";

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

interface BoardRow {
  id: string;
  name: string;
  board_type: string;
  department_id: string | null;
  created_by: string | null;
  archived_at: string | null;
}

async function boardRow(id: string): Promise<BoardRow | null> {
  const { data } = await admin
    .from("boards")
    .select("id, name, board_type, department_id, created_by, archived_at")
    .eq("id", id)
    .maybeSingle();
  return (data as BoardRow | null) ?? null;
}

async function isMember(boardId: string, employeeId: string) {
  const { count } = await admin
    .from("community_members")
    .select("board_id", { count: "exact", head: true })
    .eq("board_id", boardId)
    .eq("employee_id", employeeId);
  return (count ?? 0) === 1;
}

async function postBoardOf(postId: string) {
  const { data } = await admin
    .from("posts")
    .select("board_id")
    .eq("id", postId)
    .maybeSingle();
  return (data as { board_id: string } | null)?.board_id ?? null;
}

async function commentPostOf(commentId: string) {
  const { data } = await admin
    .from("comments")
    .select("post_id")
    .eq("id", commentId)
    .maybeSingle();
  return (data as { post_id: string } | null)?.post_id ?? null;
}

/** 객체의 컬럼 구성을 비교 가능한 문자열로 */
const keysOf = (row: unknown) =>
  Object.keys((row ?? {}) as object)
    .sort()
    .join(", ");

const sortedList = (columns: string[]) => [...columns].sort().join(", ");

async function main() {
  // 이수연(일반직원 · 동호회 개설자) · 정도원(무관한 다른 팀 일반직원)
  const MEMBER = "sylee@demo.aimbrige.kr";
  const OUTSIDER = "dwjung@demo.aimbrige.kr";
  // 김지훈 — 아래에서 잠시 system_admin으로 올렸다가 원복한다.
  // 원래도 팀장이라 공지 게시판 검증(팀장 이상)의 '되는 쪽'도 이 계정이 맡는다.
  const ADMIN = "jhkim@demo.aimbrige.kr";

  const emp = async (email: string) => {
    const { data } = await admin
      .from("employees")
      .select("id, name, role_id")
      .eq("email", email)
      .single();
    if (!data) throw new Error(`${email} 직원 행이 없습니다. npm run seed:demo 먼저.`);
    return data as { id: string; name: string; role_id: string };
  };

  const member = await emp(MEMBER);
  const outsider = await emp(OUTSIDER);
  const adminEmp = await emp(ADMIN);

  const { data: roles } = await admin.from("roles").select("id, name");
  const roleId = (name: string) => {
    const found = (roles ?? []).find((r: { name: string }) => r.name === name);
    if (!found) throw new Error(`역할 '${name}' 이 없습니다.`);
    return (found as { id: string }).id;
  };

  const authIds: string[] = [];

  try {
    // ── 준비 ────────────────────────────────────────────────────────
    // 관리자 승격은 클라이언트를 만들기 전에 (e2e-assets.ts와 같은 순서)
    await admin
      .from("employees")
      .update({ role_id: roleId("system_admin") })
      .eq("email", ADMIN);

    const memberUser = await clientFor(MEMBER);
    const outsiderUser = await clientFor(OUTSIDER);
    const adminUser = await clientFor(ADMIN);
    authIds.push(memberUser.authId, outsiderUser.authId, adminUser.authId);

    // 시딩된 공지·자유게시판. 여기에 만드는 [e2e] 글은 finally에서 제목으로 지운다.
    const { data: baseBoards } = await admin
      .from("boards")
      .select("id, name, board_type")
      .in("board_type", ["notice", "discussion"])
      .order("sort_order");
    const boardOfType = (type: string) => {
      const found = (baseBoards ?? []).find(
        (b: { board_type: string }) => b.board_type === type,
      );
      if (!found) throw new Error(`${type} 게시판이 없습니다. npm run seed 먼저.`);
      return (found as { id: string }).id;
    };
    const noticeBoard = boardOfType("notice");
    const freeBoard = boardOfType("discussion");

    const { data: dept } = await admin
      .from("departments")
      .select("id")
      .limit(1)
      .maybeSingle();
    const deptId = (dept as { id: string } | null)?.id ?? null;

    // 검증용 동호회 둘 — 개설은 이수연 본인이 한다(개설자 = 첫 멤버)
    const createA = await memberUser.sb.rpc("create_community", {
      p_name: NAME_A,
      p_description: "e2e 검증용 동호회입니다.",
    });
    const comA = createA.data as string | null;
    if (!comA) throw new Error(`검증용 동호회 개설 실패: ${createA.error?.message}`);

    const createArchived = await memberUser.sb.rpc("create_community", {
      p_name: NAME_ARCHIVED,
      p_description: "보관 검증용",
    });
    const comArchived = createArchived.data as string | null;
    if (!comArchived) {
      throw new Error(`보관 검증용 동호회 개설 실패: ${createArchived.error?.message}`);
    }

    // 보관되기 **전에** 글을 하나 남긴다 — 보관이 글을 지우지 않는다는 것을
    // 나중에 확인하려면 보관 시점에 이미 글이 있어야 한다
    const archivedPost = await memberUser.sb
      .from("posts")
      .insert({
        board_id: comArchived,
        title: "[e2e] 보관 전에 쓴 글",
        content: "보관해도 이 글은 남아 있어야 한다.",
        author_id: member.id,
      })
      .select("id")
      .single();
    const postInArchived = (archivedPost.data as { id: string } | null)?.id;
    if (!postInArchived) {
      throw new Error(`보관 검증용 글 작성 실패: ${archivedPost.error?.message}`);
    }

    const archiveSetup = await adminUser.sb.rpc("archive_community", {
      p_board_id: comArchived,
    });
    if (archiveSetup.error) {
      throw new Error(`보관 준비 실패: ${archiveSetup.error.message}`);
    }

    // ── [1] can_post_to_board() — 이 스펙에서 제일 중요한 함수 ───────
    //
    // 판정 함수와 실제 INSERT를 함께 찌른다. 함수만 보면 정책이 그 함수를
    // 부르지 않는 경우를 놓치고, INSERT만 보면 왜 막혔는지(작성자 검사인지
    // 보드 검사인지)를 구분할 수 없다.
    console.log("\n[1] can_post_to_board() — 동호회 분기");

    const canMember = await memberUser.sb.rpc("can_post_to_board", {
      p_board_id: comA,
    });
    const memberPost = await memberUser.sb
      .from("posts")
      .insert({
        board_id: comA,
        title: "[e2e] 동호회 첫 글",
        content: "가입한 사람은 자기 동호회에 글을 쓸 수 있어야 한다.",
        author_id: member.id,
      })
      .select("id")
      .single();
    const postInA = (memberPost.data as { id: string } | null)?.id;
    check(
      "★ 가입한 일반 직원은 자기 동호회에 글을 쓸 수 있다 (막히는 것도 버그다)",
      canMember.data === true && Boolean(postInA),
      `can_post_to_board=${canMember.data} ${memberPost.error?.message ?? ""}`,
    );
    if (!postInA) throw new Error("동호회 글이 없어 이후 검증을 할 수 없습니다.");

    const canOutsider = await outsiderUser.sb.rpc("can_post_to_board", {
      p_board_id: comA,
    });
    const outsiderPost = await outsiderUser.sb
      .from("posts")
      .insert({
        board_id: comA,
        title: "[e2e] 비가입자 글",
        content: "가입하지 않았다",
        author_id: outsider.id,
      })
      .select("id");
    check(
      "가입하지 않은 일반 직원은 동호회에 글을 쓸 수 없다",
      canOutsider.data === false && denied(outsiderPost.error),
      `can_post_to_board=${canOutsider.data} ${
        outsiderPost.error ? `code=${outsiderPost.error.code}` : "글이 들어갔다"
      }`,
    );

    const canAdmin = await adminUser.sb.rpc("can_post_to_board", {
      p_board_id: comA,
    });
    const adminPost = await adminUser.sb
      .from("posts")
      .insert({
        board_id: comA,
        title: "[e2e] 관리자 글",
        content: "관리자지만 가입하지 않았다",
        author_id: adminEmp.id,
      })
      .select("id");
    check(
      "★ 가입하지 않은 시스템 관리자도 동호회에 글을 쓸 수 없다 (관리자 우회를 일부러 넣지 않았다)",
      canAdmin.data === false && denied(adminPost.error),
      `can_post_to_board=${canAdmin.data} ${
        adminPost.error ? `code=${adminPost.error.code}` : "관리자 우회가 살아 있다"
      }`,
    );

    const canArchived = await memberUser.sb.rpc("can_post_to_board", {
      p_board_id: comArchived,
    });
    const archivedWrite = await memberUser.sb
      .from("posts")
      .insert({
        board_id: comArchived,
        title: "[e2e] 보관된 동호회 글",
        content: "보관된 뒤에는 멤버도 쓸 수 없어야 한다",
        author_id: member.id,
      })
      .select("id");
    check(
      "보관된 동호회에는 멤버도 글을 쓸 수 없다",
      canArchived.data === false && denied(archivedWrite.error),
      `can_post_to_board=${canArchived.data} ${
        archivedWrite.error ? `code=${archivedWrite.error.code}` : "글이 들어갔다"
      }`,
    );

    // 기존 두 타입의 규칙이 그대로인지 — community 분기를 끼워 넣으면서
    // else 쪽을 건드렸는지가 여기서 드러난다
    const canNoticeOutsider = await outsiderUser.sb.rpc("can_post_to_board", {
      p_board_id: noticeBoard,
    });
    const noticeByOutsider = await outsiderUser.sb
      .from("posts")
      .insert({
        board_id: noticeBoard,
        title: "[e2e] 일반 직원 공지",
        content: "공지는 팀장 이상만",
        author_id: outsider.id,
      })
      .select("id");
    check(
      "공지 게시판은 여전히 일반 직원이 쓸 수 없다",
      canNoticeOutsider.data === false && denied(noticeByOutsider.error),
      `can_post_to_board=${canNoticeOutsider.data} ${
        noticeByOutsider.error ? `code=${noticeByOutsider.error.code}` : "글이 들어갔다"
      }`,
    );

    const canNoticeAdmin = await adminUser.sb.rpc("can_post_to_board", {
      p_board_id: noticeBoard,
    });
    const noticePost = await adminUser.sb
      .from("posts")
      .insert({
        board_id: noticeBoard,
        title: "[e2e] 공지 글",
        content: "팀장 이상은 공지를 쓸 수 있어야 한다.",
        author_id: adminEmp.id,
      })
      .select("id")
      .single();
    const postInNotice = (noticePost.data as { id: string } | null)?.id;
    check(
      "공지 게시판은 여전히 팀장 이상이 쓸 수 있다",
      canNoticeAdmin.data === true && Boolean(postInNotice),
      `can_post_to_board=${canNoticeAdmin.data} ${noticePost.error?.message ?? ""}`,
    );
    if (!postInNotice) throw new Error("공지 글이 없어 댓글 검증을 할 수 없습니다.");

    const canFree = await outsiderUser.sb.rpc("can_post_to_board", {
      p_board_id: freeBoard,
    });
    const freePost = await outsiderUser.sb
      .from("posts")
      .insert({
        board_id: freeBoard,
        title: "[e2e] 자유게시판 글",
        content: "자유게시판은 전 직원이 쓸 수 있어야 한다.",
        author_id: outsider.id,
      })
      .select("id")
      .single();
    const postInFree = (freePost.data as { id: string } | null)?.id;
    check(
      "자유게시판은 여전히 전 직원이 쓸 수 있다",
      canFree.data === true && Boolean(postInFree),
      `can_post_to_board=${canFree.data} ${freePost.error?.message ?? ""}`,
    );
    if (!postInFree) throw new Error("자유게시판 글이 없어 이후 검증을 할 수 없습니다.");

    // ── [2] boards INSERT — 통째로 열지 않았는지 ────────────────────
    console.log("\n[2] boards INSERT — community만 열려 있는지");

    const directCreate = await memberUser.sb
      .from("boards")
      .insert({
        name: NAME_DIRECT,
        board_type: "community",
        created_by: member.id,
        description: "PostgREST로 직접 만든 동호회",
      })
      .select("id")
      .single();
    const comDirect = (directCreate.data as { id: string } | null)?.id;
    check(
      "일반 직원이 community 보드를 만들 수 있다 (스펙 3.1 — 개설은 전 임직원)",
      Boolean(comDirect),
      directCreate.error?.message,
    );
    if (!comDirect) throw new Error("직접 개설이 실패해 이후 검증을 할 수 없습니다.");

    check(
      "★ RPC를 거치지 않고 만들어도 개설자가 멤버로 들어간다 (멤버 0명짜리 유령 동호회가 없다)",
      await isMember(comDirect, member.id),
      "개설자가 멤버가 아니다 — boards_community_autojoin 확인",
    );

    const makeNotice = await memberUser.sb
      .from("boards")
      .insert({ name: `[e2e] 사칭공지 ${stamp}`, board_type: "notice" })
      .select("id");
    check(
      "★ 일반 직원이 notice 보드를 만들 수 없다",
      denied(makeNotice.error),
      makeNotice.error ? `code=${makeNotice.error.code}` : "공지 게시판이 만들어졌다",
    );

    const makeDiscussion = await memberUser.sb
      .from("boards")
      .insert({ name: `[e2e] 사칭자유 ${stamp}`, board_type: "discussion" })
      .select("id");
    check(
      "★ 일반 직원이 discussion 보드를 만들 수 없다",
      denied(makeDiscussion.error),
      makeDiscussion.error
        ? `code=${makeDiscussion.error.code}`
        : "자유게시판이 만들어졌다",
    );

    const forgeCreator = await memberUser.sb
      .from("boards")
      .insert({
        name: `[e2e] 개설자사칭 ${stamp}`,
        board_type: "community",
        created_by: outsider.id,
      })
      .select("id");
    check(
      "created_by를 남의 id로 적어 만들 수 없다",
      denied(forgeCreator.error),
      forgeCreator.error ? `code=${forgeCreator.error.code}` : "남의 이름으로 개설됐다",
    );

    const forgeArchived = await memberUser.sb
      .from("boards")
      .insert({
        name: `[e2e] 처음부터보관 ${stamp}`,
        board_type: "community",
        created_by: member.id,
        archived_at: new Date().toISOString(),
      })
      .select("id");
    check(
      "archived_at을 채운 채로 만들 수 없다",
      denied(forgeArchived.error),
      forgeArchived.error
        ? `code=${forgeArchived.error.code}`
        : "보관된 상태로 만들어졌다",
    );

    if (deptId) {
      const forgeDept = await memberUser.sb
        .from("boards")
        .insert({
          name: `[e2e] 부서전용 ${stamp}`,
          board_type: "community",
          created_by: member.id,
          department_id: deptId,
        })
        .select("id");
      check(
        "department_id를 채운 채로 만들 수 없다 (부서 전용 동호회 개념은 스펙에 없다)",
        denied(forgeDept.error),
        forgeDept.error ? `code=${forgeDept.error.code}` : "부서 전용 동호회가 생겼다",
      );
    } else {
      check("department_id 검증 — 부서 데이터가 없어 건너뜀", false, "npm run seed 먼저");
    }

    const renameBoard = await memberUser.sb
      .from("boards")
      .update({ name: `[e2e] 이름바꾸기 ${stamp}` })
      .eq("id", comDirect)
      .select("id");
    check(
      "일반 직원은 자기가 만든 동호회도 UPDATE할 수 없다 (수정 화면이 없다)",
      noRows(renameBoard) && (await boardRow(comDirect))?.name === NAME_DIRECT,
      renameBoard.error ? renameBoard.error.message : "이름이 바뀌었다",
    );

    const dropBoard = await memberUser.sb
      .from("boards")
      .delete()
      .eq("id", comDirect)
      .select("id");
    check(
      "일반 직원은 boards를 DELETE할 수 없다 (글까지 cascade로 날아간다)",
      noRows(dropBoard) && (await boardRow(comDirect)) !== null,
      dropBoard.error ? dropBoard.error.message : "동호회가 지워졌다",
    );

    // ── [3] create_community() ──────────────────────────────────────
    console.log("\n[3] create_community() — 개설과 가입이 한 트랜잭션");

    const createDup = await memberUser.sb.rpc("create_community", {
      p_name: NAME_DUP,
      p_description: null,
    });
    const comDup = createDup.data as string | null;
    check(
      "★ 개설과 동시에 개설자가 멤버로 들어간다 (한 트랜잭션)",
      Boolean(comDup) && (await isMember(comDup!, member.id)),
      createDup.error ? createDup.error.message : "개설은 됐는데 멤버가 아니다",
    );
    if (!comDup) throw new Error("중복 검증용 동호회 개설 실패");

    const blankName = await memberUser.sb.rpc("create_community", {
      p_name: "",
      p_description: null,
    });
    check(
      "빈 이름은 거부된다",
      raised(blankName.error, "동호회 이름을 입력하세요"),
      blankName.error ? blankName.error.message : "이름 없는 동호회가 생겼다",
    );

    const spaceName = await memberUser.sb.rpc("create_community", {
      p_name: "   ",
      p_description: null,
    });
    check(
      "공백만 있는 이름은 거부된다 (목록에서 클릭할 수 없는 빈 줄이 된다)",
      raised(spaceName.error, "동호회 이름을 입력하세요"),
      spaceName.error ? spaceName.error.message : "공백 이름이 통과했다",
    );

    const longName = await memberUser.sb.rpc("create_community", {
      p_name: "가".repeat(61),
      p_description: null,
    });
    check(
      "60자를 넘는 이름은 거부된다 (카드 레이아웃이 무너진다)",
      raised(longName.error, "60자 이내"),
      longName.error ? longName.error.message : "61자 이름이 통과했다",
    );

    const sameName = await memberUser.sb.rpc("create_community", {
      p_name: NAME_DUP,
      p_description: null,
    });
    check(
      "운영 중인 같은 이름은 거부된다 (카드에서 이름이 유일한 식별자다)",
      raised(sameName.error, "같은 이름의 동호회가 이미 있습니다"),
      sameName.error ? sameName.error.message : "같은 이름이 둘 생겼다",
    );

    // 보관한 뒤 같은 이름을 다시 쓴다. 아래 [5]의 '해제 거부' 검증도 이 상태를 쓴다.
    const archiveDup = await adminUser.sb.rpc("archive_community", {
      p_board_id: comDup,
    });
    if (archiveDup.error) throw new Error(`중복 검증용 보관 실패: ${archiveDup.error.message}`);

    const reuseName = await memberUser.sb.rpc("create_community", {
      p_name: NAME_DUP,
      p_description: null,
    });
    const comDupReused = reuseName.data as string | null;
    check(
      "보관된 것과 같은 이름은 다시 쓸 수 있다 (목록에 없으므로)",
      Boolean(comDupReused),
      reuseName.error?.message,
    );

    // ── [4] community_members ───────────────────────────────────────
    console.log("\n[4] community_members — 본인 명의로만");

    const join = await outsiderUser.sb
      .from("community_members")
      .insert({ board_id: comDirect, employee_id: outsider.id })
      .select("board_id");
    check(
      "본인 명의로 가입할 수 있다",
      join.data?.length === 1 && (await isMember(comDirect, outsider.id)),
      join.error?.message,
    );

    const joinOther = await memberUser.sb
      .from("community_members")
      .insert({ board_id: comA, employee_id: outsider.id })
      .select("board_id");
    check(
      "★ 남을 가입시킬 수 없다",
      denied(joinOther.error) && !(await isMember(comA, outsider.id)),
      joinOther.error ? `code=${joinOther.error.code}` : "남이 가입됐다",
    );

    const kickByPeer = await memberUser.sb
      .from("community_members")
      .delete()
      .eq("board_id", comDirect)
      .eq("employee_id", outsider.id)
      .select("board_id");
    check(
      "★ 남을 탈퇴시킬 수 없다",
      noRows(kickByPeer) && (await isMember(comDirect, outsider.id)),
      kickByPeer.error ? kickByPeer.error.message : "남이 탈퇴당했다",
    );

    const kickByAdmin = await adminUser.sb
      .from("community_members")
      .delete()
      .eq("board_id", comDirect)
      .eq("employee_id", outsider.id)
      .select("board_id");
    check(
      "관리자는 부적절한 가입을 정리할 수 있다",
      kickByAdmin.data?.length === 1 && !(await isMember(comDirect, outsider.id)),
      kickByAdmin.error ? kickByAdmin.error.message : "0행 삭제",
    );

    const joinArchived = await outsiderUser.sb
      .from("community_members")
      .insert({ board_id: comArchived, employee_id: outsider.id })
      .select("board_id");
    check(
      "보관된 동호회에는 가입할 수 없다",
      denied(joinArchived.error),
      joinArchived.error ? `code=${joinArchived.error.code}` : "보관된 곳에 가입됐다",
    );

    /*
     * 탈퇴는 보관된 뒤에도 되어야 한다 — 가입과 같은 잣대로 막으면 이미 가입한
     * 사람이 영영 나가지 못하고 "내 동호회" 목록에 남는다. 이수연은 보관본
     * comArchived의 멤버 자격을 아래 [6]에서 써야 하므로, 여기서는 정도원이
     * 자기 이름으로 만든 동호회를 보관해 검증한다.
     */
    const createLeave = await outsiderUser.sb.rpc("create_community", {
      p_name: NAME_LEAVE,
      p_description: null,
    });
    const comLeave = createLeave.data as string | null;
    if (!comLeave) throw new Error(`탈퇴 검증용 개설 실패: ${createLeave.error?.message}`);
    const archiveLeave = await adminUser.sb.rpc("archive_community", {
      p_board_id: comLeave,
    });
    if (archiveLeave.error) {
      throw new Error(`탈퇴 검증용 보관 실패: ${archiveLeave.error.message}`);
    }

    const leaveArchived = await outsiderUser.sb
      .from("community_members")
      .delete()
      .eq("board_id", comLeave)
      .eq("employee_id", outsider.id)
      .select("board_id");
    check(
      "★ 보관된 동호회에서 탈퇴는 된다 (막으면 영영 못 나온다)",
      leaveArchived.data?.length === 1 && !(await isMember(comLeave, outsider.id)),
      leaveArchived.error ? leaveArchived.error.message : "0행 삭제 — 갇혔다",
    );

    const roster = await outsiderUser.sb
      .from("community_members")
      .select("board_id, employee_id, joined_at")
      .eq("board_id", comA);
    check(
      "멤버 명단은 가입하지 않은 직원도 볼 수 있다 (카드의 가입 인원수)",
      (roster.data ?? []).length >= 1 &&
        (roster.data ?? []).some(
          (r: { employee_id: string }) => r.employee_id === member.id,
        ),
      roster.error ? roster.error.message : `보임 ${roster.data?.length ?? 0}건`,
    );

    const rosterRpc = await outsiderUser.sb.rpc("community_member_list", {
      p_board_id: comA,
    });
    const rosterRows = (rosterRpc.data ?? []) as {
      employee_id: string;
      is_owner: boolean;
    }[];
    check(
      "community_member_list()도 비가입자에게 열려 있고 개설자를 맨 위에 둔다",
      rosterRows.length >= 1 &&
        rosterRows[0].employee_id === member.id &&
        rosterRows[0].is_owner === true,
      rosterRpc.error ? rosterRpc.error.message : JSON.stringify(rosterRows[0] ?? null),
    );

    // ── [5] 보관 / 해제 ─────────────────────────────────────────────
    console.log("\n[5] archive_community · unarchive_community");

    const archiveByMember = await memberUser.sb.rpc("archive_community", {
      p_board_id: comDirect,
    });
    check(
      "★ 일반 직원은 archive_community를 호출할 수 없다",
      raised(archiveByMember.error, "시스템 관리자만") &&
        (await boardRow(comDirect))?.archived_at === null,
      archiveByMember.error ? archiveByMember.error.message : "보관됐다",
    );

    const archiveOk = await adminUser.sb.rpc("archive_community", {
      p_board_id: comDirect,
    });
    const firstArchivedAt = (await boardRow(comDirect))?.archived_at ?? null;
    check(
      "관리자는 동호회를 보관할 수 있다",
      !archiveOk.error && Boolean(firstArchivedAt),
      archiveOk.error ? archiveOk.error.message : `archived_at=${firstArchivedAt}`,
    );

    const archiveTwice = await adminUser.sb.rpc("archive_community", {
      p_board_id: comDirect,
    });
    check(
      "두 번 보관해도 처음 내린 시각을 덮어쓰지 않는다 (언제 내렸는지가 남아야 한다)",
      !archiveTwice.error &&
        (await boardRow(comDirect))?.archived_at === firstArchivedAt,
      archiveTwice.error
        ? archiveTwice.error.message
        : `archived_at=${(await boardRow(comDirect))?.archived_at}`,
    );

    const archiveGhost = await adminUser.sb.rpc("archive_community", {
      p_board_id: GHOST_ID,
    });
    check(
      "없는 대상을 보관하면 예외가 난다 (0행 조용한 실패 금지)",
      raised(archiveGhost.error, "동호회를 찾을 수 없습니다"),
      archiveGhost.error ? archiveGhost.error.message : "0행인데 성공으로 끝났다",
    );

    const archiveNotice = await adminUser.sb.rpc("archive_community", {
      p_board_id: noticeBoard,
    });
    check(
      "공지 게시판을 보관하려 하면 예외가 난다 (보관은 동호회 전용이다)",
      raised(archiveNotice.error, "동호회를 찾을 수 없습니다") &&
        (await boardRow(noticeBoard))?.archived_at === null,
      archiveNotice.error ? archiveNotice.error.message : "공지 게시판이 보관됐다",
    );

    const unarchiveByMember = await memberUser.sb.rpc("unarchive_community", {
      p_board_id: comDirect,
    });
    check(
      "일반 직원은 unarchive_community를 호출할 수 없다",
      raised(unarchiveByMember.error, "시스템 관리자만"),
      unarchiveByMember.error ? unarchiveByMember.error.message : "해제됐다",
    );

    const unarchiveOk = await adminUser.sb.rpc("unarchive_community", {
      p_board_id: comDirect,
    });
    check(
      "관리자는 보관을 해제할 수 있다",
      !unarchiveOk.error && (await boardRow(comDirect))?.archived_at === null,
      unarchiveOk.error
        ? unarchiveOk.error.message
        : `archived_at=${(await boardRow(comDirect))?.archived_at}`,
    );

    // comDup은 보관돼 있고, 같은 이름의 comDupReused가 운영 중이다
    const unarchiveConflict = await adminUser.sb.rpc("unarchive_community", {
      p_board_id: comDup,
    });
    check(
      "해제 시 같은 이름의 운영 중 동호회가 있으면 거부된다 (카드가 두 장 뜬다)",
      raised(unarchiveConflict.error, "같은 이름의 동호회가 운영 중이라") &&
        (await boardRow(comDup))?.archived_at !== null,
      unarchiveConflict.error ? unarchiveConflict.error.message : "이름이 겹친 채 복구됐다",
    );

    const survivor = await memberUser.sb
      .from("posts")
      .select("id, board_id, title")
      .eq("id", postInArchived)
      .maybeSingle();
    check(
      "★ 보관해도 글은 그대로 남아 있다 (해산 = 삭제가 아니다)",
      (survivor.data as { id: string } | null)?.id === postInArchived,
      survivor.error ? survivor.error.message : "보관과 함께 글이 사라졌다",
    );

    const survivorRoster = await memberUser.sb
      .from("community_members")
      .select("employee_id")
      .eq("board_id", comArchived);
    check(
      "보관해도 가입 명단은 남는다 (누가 있던 모임인지 되짚을 수 있다)",
      (survivorRoster.data ?? []).length >= 1,
      `남은 명단 ${survivorRoster.data?.length ?? 0}건`,
    );

    // ── [6] 이번에 막은 구멍 셋 — 회귀 방지 ─────────────────────────
    console.log("\n[6] posts.board_id · comments.post_id · 댓글/반응 권한");

    const moveBoard = await outsiderUser.sb
      .from("posts")
      .update({ board_id: comA })
      .eq("id", postInFree)
      .select("id");
    check(
      "★ 자유게시판 글의 board_id를 동호회로 바꿔치기할 수 없다 (posts_guard_board_id)",
      raised(moveBoard.error, "글을 다른 게시판으로 옮길 수 없습니다") &&
        (await postBoardOf(postInFree)) === freeBoard,
      moveBoard.error ? moveBoard.error.message : "비가입자 글이 동호회로 넘어갔다",
    );

    const moveToNotice = await outsiderUser.sb
      .from("posts")
      .update({ board_id: noticeBoard })
      .eq("id", postInFree)
      .select("id");
    check(
      "공지 게시판으로 옮기는 것도 같은 트리거가 막는다",
      raised(moveToNotice.error, "글을 다른 게시판으로 옮길 수 없습니다") &&
        (await postBoardOf(postInFree)) === freeBoard,
      moveToNotice.error ? moveToNotice.error.message : "자유글이 공지에 끼어들었다",
    );

    const outsiderComment = await outsiderUser.sb
      .from("comments")
      .insert({
        post_id: postInA,
        author_id: outsider.id,
        content: "[e2e] 비가입자 댓글",
      })
      .select("id");
    check(
      "★ 비가입자는 동호회 글에 댓글을 달 수 없다",
      denied(outsiderComment.error),
      outsiderComment.error
        ? `code=${outsiderComment.error.code}`
        : "비가입자 댓글이 붙었다",
    );

    const outsiderReaction = await outsiderUser.sb
      .from("reactions")
      .insert({ post_id: postInA, employee_id: outsider.id, emoji: "👍" })
      .select("post_id");
    check(
      "★ 비가입자는 동호회 글에 반응을 남길 수 없다",
      denied(outsiderReaction.error),
      outsiderReaction.error
        ? `code=${outsiderReaction.error.code}`
        : "비가입자 반응이 붙었다",
    );

    const memberComment = await memberUser.sb
      .from("comments")
      .insert({
        post_id: postInA,
        author_id: member.id,
        content: "[e2e] 가입자 댓글",
      })
      .select("id");
    check(
      "가입자는 동호회 글에 댓글을 달 수 있다 (막히면 그것도 버그다)",
      memberComment.data?.length === 1,
      memberComment.error?.message,
    );

    const noticeComment = await outsiderUser.sb
      .from("comments")
      .insert({
        post_id: postInNotice,
        author_id: outsider.id,
        content: "[e2e] 공지 댓글",
      })
      .select("id");
    check(
      "★ 공지 게시판 댓글은 여전히 전 직원이 달 수 있다 (글쓰기 권한을 재사용하지 않은 이유)",
      noticeComment.data?.length === 1,
      noticeComment.error?.message,
    );

    const freeComment = await outsiderUser.sb
      .from("comments")
      .insert({
        post_id: postInFree,
        author_id: outsider.id,
        content: "[e2e] 자유게시판 댓글",
      })
      .select("id")
      .single();
    const freeCommentId = (freeComment.data as { id: string } | null)?.id;
    check(
      "★ 자유게시판 댓글도 그대로다",
      Boolean(freeCommentId),
      freeComment.error?.message,
    );

    const archivedComment = await memberUser.sb
      .from("comments")
      .insert({
        post_id: postInArchived,
        author_id: member.id,
        content: "[e2e] 보관된 동호회 댓글",
      })
      .select("id");
    check(
      "★ 보관된 동호회 글에는 멤버도 댓글을 달 수 없다",
      denied(archivedComment.error),
      archivedComment.error
        ? `code=${archivedComment.error.code}`
        : "보관된 모임이 댓글로 계속 살아 있다",
    );

    if (freeCommentId) {
      const moveComment = await outsiderUser.sb
        .from("comments")
        .update({ post_id: postInA })
        .eq("id", freeCommentId)
        .select("id");
      check(
        "★ 댓글의 post_id를 남의 동호회 글로 옮길 수 없다 (comments_guard_post_id)",
        raised(moveComment.error, "댓글을 다른 글로 옮길 수 없습니다") &&
          (await commentPostOf(freeCommentId)) === postInFree,
        moveComment.error ? moveComment.error.message : "비가입자 댓글이 동호회 글에 붙었다",
      );

      const editComment = await outsiderUser.sb
        .from("comments")
        .update({ content: "[e2e] 자유게시판 댓글 (수정)" })
        .eq("id", freeCommentId)
        .select("id");
      check(
        "가드가 걸려도 작성자는 자기 댓글 내용을 고칠 수 있다",
        editComment.data?.length === 1,
        editComment.error?.message,
      );
    }

    // ── [7] 앱 조회 계층 ────────────────────────────────────────────
    /*
     * e2e-assets.ts [11]절과 같은 취지다.
     *
     * 위 검증들은 테이블을 컬럼 목록으로만 조회해서 PostgREST 임베드를 거의
     * 안 탔다. 자산 모듈에서는 그 탓에 employees를 두 갈래로 참조하는 테이블의
     * `employees(...)` 임베드가 51건이 전부 통과하는 동안 살아남았다가 화면에서
     * 터졌다. 이번 마이그레이션은 boards에 created_by를 새로 달았다 —
     * boards → employees 참조가 생겼다는 뜻이라, 같은 사고가 날 자리가 하나
     * 늘었다. 조회 계층의 문자열은 조회 계층대로 찔러야 한다.
     */
    console.log("\n[7] 앱 조회 계층 (features/boards/data.ts와 같은 select)");

    const communityList = await memberUser.sb.rpc("list_communities", {
      p_include_archived: false,
    });
    const listRows = (communityList.data ?? []) as Record<string, unknown>[];
    check(
      "list_communities()가 돈다 (getCommunities)",
      !communityList.error && listRows.length > 0,
      communityList.error ? communityList.error.message : "0건",
    );

    const SUMMARY_KEYS = sortedList([
      "id",
      "name",
      "description",
      "created_by",
      "created_by_name",
      "created_at",
      "archived_at",
      "member_count",
      "post_count",
      "is_member",
    ]);
    check(
      "★ list_communities()의 반환 컬럼이 화면(CommunitySummary)이 기대하는 것과 정확히 같다",
      listRows.length > 0 && keysOf(listRows[0]) === SUMMARY_KEYS,
      `받은 컬럼: ${keysOf(listRows[0] ?? {})}`,
    );

    const cardA = listRows.find((r) => r.id === comA);
    check(
      "카드에 멤버수·글수·내 가입 여부가 함께 온다 (동호회 수만큼 질의가 늘지 않는다)",
      Number(cardA?.member_count) === 1 &&
        Number(cardA?.post_count) === 1 &&
        cardA?.is_member === true &&
        cardA?.created_by_name === member.name,
      JSON.stringify(cardA ?? null),
    );

    const listNonMember = await outsiderUser.sb.rpc("list_communities", {
      p_include_archived: false,
    });
    const cardForOutsider = (
      (listNonMember.data ?? []) as Record<string, unknown>[]
    ).find((r) => r.id === comA);
    check(
      "is_member는 부르는 사람마다 다르게 판정된다 (비가입자에게는 false)",
      cardForOutsider?.is_member === false,
      `is_member=${cardForOutsider?.is_member}`,
    );

    const archivedHidden = listRows.some((r) => r.id === comArchived);
    const listAll = await adminUser.sb.rpc("list_communities", {
      p_include_archived: true,
    });
    const archivedShown = ((listAll.data ?? []) as Record<string, unknown>[]).some(
      (r) => r.id === comArchived,
    );
    check(
      "보관본은 기본 목록에서 빠지고 관리 화면(includeArchived)에서만 보인다",
      !archivedHidden && archivedShown,
      `기본목록노출=${archivedHidden} 관리화면노출=${archivedShown}`,
    );

    const MEMBER_KEYS = sortedList([
      "employee_id",
      "employee_name",
      "employee_position",
      "department_name",
      "profile_image_url",
      "joined_at",
      "is_owner",
    ]);
    check(
      "community_member_list()의 반환 컬럼이 CommunityMember와 같다",
      keysOf(rosterRows[0] ?? {}) === MEMBER_KEYS,
      `받은 컬럼: ${keysOf(rosterRows[0] ?? {})}`,
    );

    // getBoards() — 동호회를 걸러내는 목록. 임베드가 하나 붙어 있다
    const boardsSelect = await memberUser.sb
      .from("boards")
      .select(`${BOARD_COLUMNS}, department:departments!department_id(id, name)`)
      .neq("board_type", "community")
      .order("board_type")
      .order("sort_order")
      .order("name");
    check(
      "★ 게시판 목록 select가 그대로 돈다 (getBoards)",
      !boardsSelect.error,
      boardsSelect.error?.message ?? "",
    );
    check(
      "게시판 목록에 동호회가 섞이지 않는다 (/board 인덱스가 남의 동호회로 떨어진다)",
      !(boardsSelect.data ?? []).some(
        (b: { board_type: string }) => b.board_type === "community",
      ),
      "community가 섞여 있다",
    );

    const boardSelect = await memberUser.sb
      .from("boards")
      .select(BOARD_COLUMNS)
      .eq("id", comA)
      .maybeSingle();
    check(
      "동호회 상세도 같은 컬럼 목록으로 읽힌다 (getBoard — 새 컬럼 셋이 전부 있다)",
      !boardSelect.error && keysOf(boardSelect.data) === sortedList(
        BOARD_COLUMNS.split(",").map((c) => c.trim()),
      ),
      boardSelect.error ? boardSelect.error.message : `받은 컬럼: ${keysOf(boardSelect.data)}`,
    );

    /*
     * boards → employees 임베드는 이 마이그레이션 시점에 **이미 모호하다**.
     * 참조가 created_by 하나뿐이라고 세면 안 된다 — community_members가
     * (board_id, employee_id) 복합 PK를 가진 순수 조인 테이블이라, PostgREST가
     * boards↔employees 다대다 관계를 한 벌 더 추론한다. 즉 이번 마이그레이션이
     * 컬럼 하나(created_by)와 관계 하나(조인 테이블)를 동시에 만들었다.
     * data.ts가 테이블 이름만 적은 임베드를 쓰지 않는 이유가 그것이다
     * (isCommunityMember의 주석이 같은 말을 한다).
     *
     * 그래서 "아직 모호하지 않다"가 아니라 지금 상태를 그대로 못박는다.
     *  (1) 이름만 적은 임베드는 PGRST201로 떨어지고, PostgREST가 세는 후보가
     *      정확히 둘이다. 나중에 employees를 가리키는 컬럼이 하나 더 붙으면
     *      (예: archived_by) 후보가 셋이 되어 여기가 먼저 터진다.
     *  (2) FK를 못박은 형태는 실제로 돈다 — data.ts가 개설자를 임베드로
     *      물어야 할 때 쓸 수 있는 경로가 살아 있다는 뜻이다.
     */
    const boardCreatorEmbed = await memberUser.sb
      .from("boards")
      .select("id, name, employees(id, name)")
      .eq("id", comA)
      .limit(1);
    const embedDetails = boardCreatorEmbed.error?.details as unknown;
    const embedCandidates = Array.isArray(embedDetails) ? embedDetails.length : -1;
    const embedHint = `${boardCreatorEmbed.error?.hint ?? ""} ${JSON.stringify(
      embedDetails ?? null,
    )}`;
    check(
      "★ boards→employees 임베드 후보가 정확히 둘이다 (created_by FK · community_members 조인)",
      boardCreatorEmbed.error?.code === "PGRST201" &&
        embedCandidates === 2 &&
        embedHint.includes("boards_created_by_fkey") &&
        embedHint.includes("community_members"),
      boardCreatorEmbed.error
        ? `code=${boardCreatorEmbed.error.code} 후보=${embedCandidates} — boards의 employees 참조가 늘었다면 data.ts의 임베드를 전부 FK로 못박아야 한다`
        : "모호하지 않다 — community_members 조인 테이블이나 created_by가 사라졌다",
    );

    const boardCreatorPinned = await memberUser.sb
      .from("boards")
      .select("id, name, creator:employees!boards_created_by_fkey(id, name)")
      .eq("id", comA)
      .maybeSingle();
    const pinnedCreator = (
      (boardCreatorPinned.data ?? {}) as { creator?: { id: string } | null }
    ).creator;
    check(
      "★ FK를 못박은 개설자 임베드는 돈다 (data.ts가 개설자를 물어야 할 때 쓸 형태)",
      !boardCreatorPinned.error && pinnedCreator?.id === member.id,
      boardCreatorPinned.error
        ? boardCreatorPinned.error.message
        : `creator=${JSON.stringify(pinnedCreator ?? null)}`,
    );

    // getPosts() — 동호회 상세의 글 목록
    const postsSelect = await memberUser.sb
      .from("posts")
      .select(
        `id, board_id, title, content, category, is_pinned, author_id, view_count,
       created_at, updated_at,
       author:employees!author_id(id, name, profile_image_url),
       comments:comments(count)`,
        { count: "exact" },
      )
      .eq("board_id", comA)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .range(0, 19);
    check(
      "★ 글 목록 select가 동호회 보드에서도 그대로 돈다 (getPosts)",
      !postsSelect.error && (postsSelect.data ?? []).length === 1,
      postsSelect.error ? postsSelect.error.message : `${postsSelect.data?.length}건`,
    );

    // getPostDetail() — 임베드가 네 겹이라 가장 잘 터지는 자리
    const detailSelect = await memberUser.sb
      .from("posts")
      .select(
        `id, board_id, title, content, category, is_pinned, author_id, view_count,
       created_at, updated_at,
       author:employees!author_id(id, name, position, profile_image_url),
       board:boards!board_id(${BOARD_COLUMNS}),
       comments:comments(
         id, post_id, author_id, content, created_at, updated_at,
         author:employees!author_id(id, name, profile_image_url)
       ),
       attachments:post_attachments(
         id, post_id, file_url, file_name, file_size, uploaded_at
       )`,
      )
      .eq("id", postInA)
      .maybeSingle();
    check(
      "★ 게시글 상세 임베드가 모호하지 않다 (getPostDetail — board 임베드가 새로 생긴 자리다)",
      !detailSelect.error && Boolean(detailSelect.data),
      detailSelect.error?.message ?? "행이 없다",
    );

    const detail = (detailSelect.data ?? {}) as Record<string, unknown>;
    const boardEmbed = (detail.board ?? {}) as Record<string, unknown>;
    check(
      "상세의 board 임베드가 boards 컬럼만 담는다 (posts 배열이 딸려 오지 않는다)",
      keysOf(boardEmbed) ===
        sortedList(BOARD_COLUMNS.split(",").map((c) => c.trim())),
      `받은 컬럼: ${keysOf(boardEmbed)}`,
    );

    /*
     * 카드 목록에 본문이 실리지 않는지.
     *
     * 동호회 목록은 카드 N장을 한 번에 그리는 화면이라 행마다 붙는 값이
     * 그대로 응답 크기가 된다. list_communities()가 언젠가 편의를 위해 최근 글
     * 본문 같은 걸 물고 오기 시작하면, 화면에는 아무 변화가 없고 목록만 느려진다.
     */
    const heavy = ["content", "file_url", "body", "posts", "members"];
    const carriesHeavy = listRows.some((row) =>
      heavy.some((key) => key in row),
    );
    const widest = listRows.reduce(
      (max, row) => Math.max(max, JSON.stringify(row).length),
      0,
    );
    check(
      "동호회 카드 목록에 본문 같은 대용량 컬럼이 실려오지 않는다",
      !carriesHeavy && widest < 2048,
      `대용량 컬럼=${carriesHeavy} 가장 큰 행=${widest}바이트`,
    );
  } finally {
    console.log("\n[정리]");

    /*
     * 순서가 있다. [e2e] 글은 시딩된 공지·자유게시판에도 들어가 있으므로
     * 보드를 지우는 것만으로는 정리되지 않는다. 제목으로 먼저 지운다
     * (댓글·반응·첨부는 글에서 cascade로 따라 지워진다).
     */
    const { count: postCount } = await admin
      .from("posts")
      .delete({ count: "exact" })
      .like("title", "[e2e]%");
    console.log(`  · [e2e] 게시글 ${postCount ?? 0}건 삭제 (댓글·반응 cascade)`);

    // 동호회는 이름으로 지운다 — 남은 글·가입 명단이 cascade로 함께 정리된다.
    // 시딩된 동호회(러닝크루·사진 동호회 등)는 [e2e] 접두사가 없어 걸리지 않는다.
    const { count: boardCount } = await admin
      .from("boards")
      .delete({ count: "exact" })
      .eq("board_type", "community")
      .like("name", "[e2e]%");
    console.log(`  · [e2e] 동호회 ${boardCount ?? 0}개 삭제 (가입 명단 cascade)`);

    await admin
      .from("employees")
      .update({ role_id: adminEmp.role_id })
      .eq("email", ADMIN);
    console.log("  · 역할 원복");

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
