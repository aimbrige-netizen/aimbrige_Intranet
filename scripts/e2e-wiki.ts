/**
 * 스펙 14 위키 e2e 검증 (마이그레이션 23).
 *
 *   npm run e2e:wiki -- --yes
 *
 * 이 마이그레이션은 wiki_pages의 INSERT·UPDATE 정책을 **의도적으로 지웠다**.
 * 쓰기 통로는 save_wiki_page()(security definer) 하나뿐이다. 그래서 확인할 것이
 * 정확히 두 방향으로 갈린다.
 *
 *   (1) 정책을 지웠는데 정상 저장이 여전히 되는가.
 *       안 되면 이 모듈은 화면만 있고 아무것도 저장되지 않는다.
 *   (2) PostgREST로 직접 쓰는 길이 정말 막혔는가.
 *       뚫려 있으면 "이력 없이 내용만 바뀐 문서"가 생기는데, 스냅샷은 트리거가
 *       아니라 함수 안의 명령문이라 그 경로에서는 실행되지 않는다. 수정 이력이
 *       본체인 모듈에서 그건 기능이 없는 것과 같다.
 *
 * 검증의 무게는 (2)에 있다. 정상 흐름 한 건보다 우회 시도 한 건이 더 가치 있다.
 * 그래서 "막혔다"를 오류 유무로만 보지 않고, 막힌 뒤 행이 정말 그대로인지까지
 * 다시 읽어서 확인한다 — UPDATE는 정책이 없으면 오류 없이 0건으로 조용히
 * 지나가기 때문에 오류만 보면 통과처럼 보인다.
 *
 * 마지막 [H]는 DB 없이 도는 순수 함수 구간이다.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyWikiLink } from "../src/features/wiki/link";
import { buildParentOptions } from "../src/features/wiki/options";
import {
  buildWikiTree,
  type WikiNode,
  type WikiTreeNode,
} from "../src/features/wiki/tree";

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
      "이 스크립트는 실제 DB에 위키 문서를 만들고 끝나면 지웁니다.",
      "데모 직원 한 명의 역할을 잠시 system_admin으로 올렸다가 원복합니다.",
      "실행하려면: npm run e2e:wiki -- --yes",
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

/** 만든 문서는 전부 이 접두사를 단다 — 정리가 이걸 기준으로 지운다 */
const TAG = "[e2e]";

async function main() {
  // 이수연·정도원은 서로 다른 팀의 일반직원이다. 위키는 팀과 무관하게
  // "누구나 기여"라서, 남의 문서를 고치는 경로를 이 둘로 찌른다.
  const MEMBER = "sylee@demo.aimbrige.kr";
  const PEER = "dwjung@demo.aimbrige.kr";
  const ADMIN = "jhkim@demo.aimbrige.kr"; // 아래에서 잠시 system_admin으로 올린다

  const emp = async (email: string) => {
    const { data } = await admin
      .from("employees")
      .select("id")
      .eq("email", email)
      .single();
    if (!data) throw new Error(`${email} 직원 행이 없습니다. npm run seed:demo 먼저.`);
    return data.id as string;
  };

  const memberId = await emp(MEMBER);
  const peerId = await emp(PEER);

  const { data: roles } = await admin.from("roles").select("id, name");
  const adminRoleId = roles?.find((r) => r.name === "system_admin")?.id as string;
  if (!adminRoleId) throw new Error("system_admin 역할이 없습니다.");
  const { data: adminEmp } = await admin
    .from("employees")
    .select("id, role_id")
    .eq("email", ADMIN)
    .single();
  const originalRole = adminEmp!.role_id as string;

  const authIds: string[] = [];
  const pageIds: string[] = [];

  // ── 헬퍼 ───────────────────────────────────────────────────────────
  const save = (
    sb: SupabaseClient,
    args: {
      pageId?: string | null;
      title: string;
      content?: string;
      parentId?: string | null;
    },
  ) =>
    sb.rpc("save_wiki_page", {
      p_page_id: args.pageId ?? null,
      p_title: args.title,
      p_content: args.content ?? "",
      p_parent_id: args.parentId ?? null,
    });

  /** 새 문서를 만들고 정리 목록에 등록한다 */
  const create = async (
    sb: SupabaseClient,
    title: string,
    content: string,
    parentId?: string | null,
  ) => {
    const { data, error } = await save(sb, { title, content, parentId });
    if (error || !data) throw new Error(`문서 생성 실패(${title}): ${error?.message}`);
    const id = String(data);
    pageIds.push(id);
    return id;
  };

  const pageRow = async (pageId: string) => {
    const { data } = await admin
      .from("wiki_pages")
      .select("id, title, content, parent_id, created_by, updated_by")
      .eq("id", pageId)
      .maybeSingle();
    return data;
  };

  /** 최신순 — 화면(getWikiRevisions)이 보는 순서와 같게 맞춘다 */
  const revisionsOf = async (pageId: string) => {
    const { data } = await admin
      .from("wiki_page_revisions")
      .select("id, title, content, edited_by, edited_at")
      .eq("page_id", pageId)
      .order("edited_at", { ascending: false });
    return data ?? [];
  };

  try {
    const member = await clientFor(MEMBER);
    const peer = await clientFor(PEER);
    authIds.push(member.authId, peer.authId);

    // ================================================================
    console.log("\n[A] 저장 경로 — 정책을 지웠는데 정상 저장이 되는가");
    // ================================================================

    const createA = await save(member.sb, {
      title: `${TAG} 사내 매뉴얼`,
      content: "처음 쓴 내용",
    });
    check(
      "★ 일반직원이 save_wiki_page로 새 문서를 만든다",
      !createA.error && Boolean(createA.data),
      createA.error?.message ?? "id가 돌아오지 않았다",
    );
    if (!createA.data) {
      // 여기가 죽으면 아래 전부가 의미를 잃는다 — 더 진행하지 않는다
      throw new Error("문서 생성이 실패해 이후 검증을 진행할 수 없습니다.");
    }
    const pageA = String(createA.data);
    pageIds.push(pageA);

    const afterCreate = await pageRow(pageA);
    check(
      "새 문서의 created_by·updated_by가 만든 사람으로 기록된다",
      afterCreate?.created_by === memberId && afterCreate?.updated_by === memberId,
      `created_by=${afterCreate?.created_by} updated_by=${afterCreate?.updated_by}`,
    );

    const editByPeer = await save(peer.sb, {
      pageId: pageA,
      title: `${TAG} 사내 매뉴얼`,
      content: "남이 고친 내용",
    });
    check(
      "★ 일반직원이 남이 만든 문서를 수정한다 (위키는 누구나 기여)",
      !editByPeer.error,
      editByPeer.error?.message,
    );

    const afterEdit = await pageRow(pageA);
    check(
      "수정하면 created_by는 그대로고 updated_by만 수정한 사람으로 바뀐다",
      afterEdit?.created_by === memberId && afterEdit?.updated_by === peerId,
      `created_by=${afterEdit?.created_by} updated_by=${afterEdit?.updated_by}`,
    );

    // ================================================================
    console.log("\n[B] 직접 쓰기 — 이력 우회 차단");
    // ================================================================

    const directInsert = await member.sb
      .from("wiki_pages")
      .insert({ title: `${TAG} 정책 없이 넣은 문서`, content: "함수를 거치지 않았다" })
      .select("id");
    check(
      "★ PostgREST로 wiki_pages를 직접 INSERT할 수 없다",
      Boolean(directInsert.error),
      directInsert.error ? "" : "INSERT 정책이 없는데 행이 들어갔다",
    );
    for (const row of directInsert.data ?? []) pageIds.push(row.id as string);

    const beforeDirect = await pageRow(pageA);
    const revsBeforeDirect = (await revisionsOf(pageA)).length;
    const directUpdate = await member.sb
      .from("wiki_pages")
      .update({ content: "이력 없이 갈아치운 내용", updated_by: memberId })
      .eq("id", pageA)
      .select("id");
    const afterDirect = await pageRow(pageA);
    const revsAfterDirect = (await revisionsOf(pageA)).length;
    check(
      "★ PostgREST로 wiki_pages를 직접 UPDATE할 수 없다 (이력 없이 내용만 바뀌는 경로)",
      (Boolean(directUpdate.error) || directUpdate.data?.length === 0) &&
        afterDirect?.content === beforeDirect?.content &&
        revsAfterDirect === revsBeforeDirect,
      afterDirect?.content === beforeDirect?.content
        ? ""
        : "본문이 바뀌었는데 이력에는 아무 흔적도 없다",
    );

    const revRows = await revisionsOf(pageA);
    const targetRev = revRows[0];
    if (!targetRev) throw new Error("수정 이력이 없어 이력 보호를 검증할 수 없습니다.");

    const revInsert = await member.sb
      .from("wiki_page_revisions")
      .insert({
        page_id: pageA,
        title: `${TAG} 있지도 않았던 버전`,
        content: "위조한 이력",
      })
      .select("id");
    check(
      "★ wiki_page_revisions를 직접 INSERT할 수 없다 (없던 버전 끼워넣기)",
      Boolean(revInsert.error),
      revInsert.error ? "" : "있지도 않았던 버전이 이력에 들어갔다",
    );

    const revUpdate = await member.sb
      .from("wiki_page_revisions")
      .update({ content: "이력을 고쳤다" })
      .eq("id", targetRev.id)
      .select("id");
    const revAfterUpdate = (await revisionsOf(pageA)).find(
      (r) => r.id === targetRev.id,
    );
    check(
      "★ wiki_page_revisions를 직접 UPDATE할 수 없다 (고칠 수 있으면 이력이 아니다)",
      (Boolean(revUpdate.error) || revUpdate.data?.length === 0) &&
        revAfterUpdate?.content === targetRev.content,
      revAfterUpdate?.content === targetRev.content ? "" : "이력 내용이 바뀌었다",
    );

    const revDelete = await member.sb
      .from("wiki_page_revisions")
      .delete()
      .eq("id", targetRev.id)
      .select("id");
    const revSurvived = (await revisionsOf(pageA)).some((r) => r.id === targetRev.id);
    check(
      "★ wiki_page_revisions를 직접 DELETE할 수 없다 (불리한 버전 지우기)",
      (Boolean(revDelete.error) || revDelete.data?.length === 0) && revSurvived,
      revSurvived ? "" : "이력이 지워졌다",
    );

    // ================================================================
    console.log("\n[C] 스냅샷 정확성 — 이 모듈의 본체");
    // ================================================================

    const pageC = await create(member.sb, `${TAG} C 원본 제목`, "원본 내용");

    const revsAtBirth = await revisionsOf(pageC);
    check(
      "새 문서를 만들 때는 revision이 생기지 않는다 (덮어쓴 게 없다)",
      revsAtBirth.length === 0,
      `${revsAtBirth.length}건이 생겼다`,
    );

    const c1 = await save(member.sb, {
      pageId: pageC,
      title: `${TAG} C 수정1 제목`,
      content: "수정1 내용",
    });
    if (c1.error) throw new Error(`C 수정1 실패: ${c1.error.message}`);

    const afterFirstEdit = await revisionsOf(pageC);
    check(
      "수정 1회 후 revision이 정확히 1건 생긴다",
      afterFirstEdit.length === 1,
      `${afterFirstEdit.length}건`,
    );
    check(
      "★ revision의 내용이 수정 '전' 내용이다 (수정 후면 이력이 무의미하다)",
      afterFirstEdit[0]?.content === "원본 내용",
      `저장된 내용: ${JSON.stringify(afterFirstEdit[0]?.content)}`,
    );
    check(
      "revision의 title도 수정 전 제목이다",
      afterFirstEdit[0]?.title === `${TAG} C 원본 제목`,
      `저장된 제목: ${JSON.stringify(afterFirstEdit[0]?.title)}`,
    );

    const c2 = await save(member.sb, {
      pageId: pageC,
      title: `${TAG} C 수정2 제목`,
      content: "수정2 내용",
    });
    if (c2.error) throw new Error(`C 수정2 실패: ${c2.error.message}`);

    // 마지막 한 번은 다른 사람이 고친다 — edited_by가 누구로 남는지 보려면
    // 만든 사람과 수정한 사람이 달라야 한다
    const c3 = await save(peer.sb, {
      pageId: pageC,
      title: `${TAG} C 수정3 제목`,
      content: "수정3 내용",
    });
    if (c3.error) throw new Error(`C 수정3 실패: ${c3.error.message}`);

    const afterThree = await revisionsOf(pageC);
    check(
      "수정 3회 후 revision이 3건이고 시간 역순으로 최신→원본 순서다",
      afterThree.length === 3 &&
        afterThree[0]?.content === "수정2 내용" &&
        afterThree[1]?.content === "수정1 내용" &&
        afterThree[2]?.content === "원본 내용",
      afterThree.map((r) => r.content).join(" / "),
    );
    check(
      "revision의 edited_by가 그 저장을 한 사람이다",
      afterThree[0]?.edited_by === peerId,
      `edited_by=${afterThree[0]?.edited_by} (기대: ${peerId})`,
    );

    // ================================================================
    console.log("\n[D] 순환 참조 (guard_wiki_cycle)");
    // ================================================================

    const dTop = await create(member.sb, `${TAG} D 최상위`, "최상위 본문");
    const dMid = await create(member.sb, `${TAG} D 중간`, "중간 본문");
    const dLeaf = await create(member.sb, `${TAG} D 말단`, "말단 본문");

    const selfParent = await save(member.sb, {
      pageId: dTop,
      title: `${TAG} D 최상위`,
      content: "최상위 본문",
      parentId: dTop,
    });
    const topAfterSelf = await pageRow(dTop);
    check(
      "자기 자신을 상위 문서로 지정할 수 없다",
      Boolean(selfParent.error) && topAfterSelf?.parent_id === null,
      selfParent.error ? "" : "자기 자신이 상위로 들어갔다",
    );

    const linkMid = await save(member.sb, {
      pageId: dMid,
      title: `${TAG} D 중간`,
      content: "중간 본문",
      parentId: dTop,
    });
    const linkLeaf = await save(member.sb, {
      pageId: dLeaf,
      title: `${TAG} D 말단`,
      content: "말단 본문",
      parentId: dMid,
    });
    const midRow = await pageRow(dMid);
    const leafRow = await pageRow(dLeaf);
    check(
      "정상적인 계층(최상위→중간→말단)은 만들어진다",
      !linkMid.error &&
        !linkLeaf.error &&
        midRow?.parent_id === dTop &&
        leafRow?.parent_id === dMid,
      linkMid.error?.message ?? linkLeaf.error?.message,
    );

    const revsBeforeCycle = (await revisionsOf(dTop)).length;

    // 2단계: 최상위의 상위를 자기 직계 하위로 → 최상위↔중간이 서로를 가리킨다
    const cycle2 = await save(member.sb, {
      pageId: dTop,
      title: `${TAG} D 최상위`,
      content: "최상위 본문",
      parentId: dMid,
    });
    const topAfterCycle2 = await pageRow(dTop);
    const revsAfterCycle = (await revisionsOf(dTop)).length;
    check(
      "★ 2단계 순환(A→B, B→A)을 만들 수 없다",
      Boolean(cycle2.error) && topAfterCycle2?.parent_id === null,
      cycle2.error ? "" : "순환이 그대로 저장됐다",
    );
    check(
      "막힌 저장은 이력도 남기지 않는다 (스냅샷과 갱신이 한 트랜잭션)",
      revsAfterCycle === revsBeforeCycle,
      `이력 ${revsBeforeCycle}건 → ${revsAfterCycle}건`,
    );

    // 3단계: 최상위의 상위를 손자로 → 최상위→중간→말단→최상위
    const cycle3 = await save(member.sb, {
      pageId: dTop,
      title: `${TAG} D 최상위`,
      content: "최상위 본문",
      parentId: dLeaf,
    });
    const topAfterCycle3 = await pageRow(dTop);
    check(
      "★ 3단계 순환(A→B→C, C→A)을 만들 수 없다",
      Boolean(cycle3.error) && topAfterCycle3?.parent_id === null,
      cycle3.error ? "" : "행 하나만 봐서는 안 보이는 순환이 통과했다",
    );

    // ================================================================
    console.log("\n[E] 삭제");
    // ================================================================

    const memberDelete = await member.sb
      .from("wiki_pages")
      .delete()
      .eq("id", dLeaf)
      .select("id");
    const leafAlive = Boolean(await pageRow(dLeaf));
    check(
      "일반직원은 문서를 지울 수 없다",
      (Boolean(memberDelete.error) || memberDelete.data?.length === 0) && leafAlive,
      leafAlive ? "" : "일반직원이 문서를 지웠다",
    );

    await admin.from("employees").update({ role_id: adminRoleId }).eq("email", ADMIN);
    const sysAdmin = await clientFor(ADMIN);
    authIds.push(sysAdmin.authId);

    const adminDelete = await sysAdmin.sb
      .from("wiki_pages")
      .delete()
      .eq("id", dLeaf)
      .select("id");
    check(
      "관리자는 문서를 지울 수 있다",
      !adminDelete.error && adminDelete.data?.length === 1,
      adminDelete.error?.message ?? "0건이 지워졌다",
    );

    const parentDelete = await sysAdmin.sb
      .from("wiki_pages")
      .delete()
      .eq("id", dTop)
      .select("id");
    const midAfter = await pageRow(dMid);
    check(
      "상위 문서를 지워도 하위는 함께 지워지지 않고 parent_id만 null이 된다",
      !parentDelete.error && Boolean(midAfter) && midAfter?.parent_id === null,
      midAfter ? `parent_id=${midAfter.parent_id}` : "하위 문서가 통째로 사라졌다",
    );

    const revsBeforeCascade = (await revisionsOf(pageC)).length;
    const cascadeDelete = await sysAdmin.sb
      .from("wiki_pages")
      .delete()
      .eq("id", pageC)
      .select("id");
    const revsAfterCascade = (await revisionsOf(pageC)).length;
    check(
      "문서를 지우면 그 문서의 수정 이력도 함께 지워진다 (cascade)",
      !cascadeDelete.error && revsBeforeCascade === 3 && revsAfterCascade === 0,
      `이력 ${revsBeforeCascade}건 → ${revsAfterCascade}건`,
    );

    // ================================================================
    console.log("\n[F] 검색 (search_wiki · like_escape)");
    // ================================================================

    /*
     * 실행할 때마다 다른 표식을 쓴다. 고정 문자열이면 앞선 실행이 남긴 문서나
     * 실제 사내 문서가 함께 걸려서, 통과했는지 우연인지 구분할 수 없다.
     */
    const STAMP = Date.now().toString(36);
    const MIX = `공용표식${STAMP}`;

    // 제목이 맞은 문서를 먼저 만든다 — 나중에 만든 쪽이 updated_at이 더 최신이라
    // 제목 우선 정렬이 없으면 본문 문서가 앞으로 온다(그래야 이 검증이 의미 있다)
    const fTitle = await create(
      member.sb,
      `${TAG} ${MIX} 제목이 맞은 문서`,
      "본문에는 표식이 없다",
    );
    const fBody = await create(
      member.sb,
      `${TAG} 본문이 맞은 문서`,
      `앞부분 잡담입니다. 여기 본문 안에 ${MIX} 가 들어 있습니다.`,
    );

    const mixHit = await member.sb.rpc("search_wiki", { p_query: MIX });
    const mixIds = ((mixHit.data ?? []) as { id: string }[]).map((r) => r.id);
    check("제목으로 검색된다", mixIds.includes(fTitle), mixHit.error?.message);
    check("본문으로 검색된다", mixIds.includes(fBody), mixHit.error?.message);
    check(
      "제목이 맞은 문서가 본문만 맞은 문서보다 먼저 온다",
      mixIds.indexOf(fTitle) >= 0 &&
        mixIds.indexOf(fTitle) < mixIds.indexOf(fBody),
      `제목 ${mixIds.indexOf(fTitle)}번째 / 본문 ${mixIds.indexOf(fBody)}번째`,
    );

    // %가 와일드카드로 새면 "50그리고할인"까지 끌려온다
    const pctBase = `${STAMP}50`;
    const pctHit = await create(
      member.sb,
      `${TAG} 퍼센트 일치`,
      `${pctBase}%할인 안내입니다.`,
    );
    const pctMiss = await create(
      member.sb,
      `${TAG} 퍼센트 불일치`,
      `${pctBase}그리고할인 안내입니다.`,
    );
    const pctResult = await member.sb.rpc("search_wiki", {
      p_query: `${pctBase}%할`,
    });
    const pctIds = ((pctResult.data ?? []) as { id: string }[]).map((r) => r.id);
    check(
      "★ 검색어의 %가 와일드카드로 해석되지 않는다",
      pctIds.includes(pctHit) && !pctIds.includes(pctMiss),
      pctIds.includes(pctMiss)
        ? "%가 와일드카드로 먹어 엉뚱한 문서까지 걸렸다"
        : "정작 일치하는 문서가 안 나왔다",
    );

    // _는 한 글자 와일드카드다. 새면 "AXB"가 "A_B"로 잡힌다
    const undBase = `${STAMP}A`;
    const undHit = await create(
      member.sb,
      `${TAG} 언더스코어 일치`,
      `${undBase}_B 라고 적혀 있습니다.`,
    );
    const undMiss = await create(
      member.sb,
      `${TAG} 언더스코어 불일치`,
      `${undBase}XB 라고 적혀 있습니다.`,
    );
    const undResult = await member.sb.rpc("search_wiki", {
      p_query: `${undBase}_B`,
    });
    const undIds = ((undResult.data ?? []) as { id: string }[]).map((r) => r.id);
    check(
      "★ 검색어의 _가 와일드카드로 해석되지 않는다",
      undIds.includes(undHit) && !undIds.includes(undMiss),
      undIds.includes(undMiss)
        ? "_가 한 글자 와일드카드로 먹었다"
        : "정작 일치하는 문서가 안 나왔다",
    );

    const emptyQuery = await member.sb.rpc("search_wiki", { p_query: "" });
    const blankQuery = await member.sb.rpc("search_wiki", { p_query: "   " });
    check(
      "빈 검색어는 아무것도 반환하지 않는다 (전체 문서가 쏟아지지 않는다)",
      !emptyQuery.error &&
        (emptyQuery.data ?? []).length === 0 &&
        !blankQuery.error &&
        (blankQuery.data ?? []).length === 0,
      `빈 문자열 ${(emptyQuery.data ?? []).length}건 / 공백 ${(blankQuery.data ?? []).length}건`,
    );

    // ================================================================
    console.log("\n[G] 트리 목록 (list_wiki_pages)");
    // ================================================================

    const gParent = await create(member.sb, `${TAG} G 상위`, "상위 본문");
    const gChild1 = await create(member.sb, `${TAG} G 하위1`, "하위1 본문", gParent);
    await create(member.sb, `${TAG} G 하위2`, "하위2 본문", gParent);

    type ListedRow = Record<string, unknown> & { id: string; child_count: number };
    const listed = await member.sb.rpc("list_wiki_pages");
    const rows = (listed.data ?? []) as ListedRow[];
    const parentRow = rows.find((r) => r.id === gParent);
    const childRow = rows.find((r) => r.id === gChild1);

    check(
      "child_count가 실제 하위 문서 수와 맞는다",
      parentRow?.child_count === 2,
      `child_count=${parentRow?.child_count} (기대: 2)`,
    );
    check(
      "하위가 없는 문서의 child_count는 0이다",
      childRow?.child_count === 0,
      `child_count=${childRow?.child_count}`,
    );
    check(
      "트리 응답에 본문(content)이 실려 오지 않는다",
      rows.length > 0 && rows.every((r) => !("content" in r)),
      rows.length === 0 ? "목록이 비어 판정할 수 없다" : "content가 함께 왔다",
    );
  } finally {
    console.log("\n[정리]");
    // 상위를 먼저 지워도 하위는 parent_id만 null이 되므로 순서를 신경 쓸 필요가 없다.
    // 이력은 cascade로 함께 지워진다.
    for (const id of pageIds) {
      await admin.from("wiki_pages").delete().eq("id", id);
    }
    const { data: leftover } = await admin
      .from("wiki_pages")
      .delete()
      .like("title", `${TAG}%`)
      .select("id");
    console.log(
      `  · 위키 문서 ${pageIds.length}건 삭제` +
        (leftover?.length ? ` (접두사로 ${leftover.length}건 추가 정리)` : ""),
    );

    await admin.from("employees").update({ role_id: originalRole }).eq("email", ADMIN);
    console.log("  · 역할 원복");

    for (const authId of authIds) {
      await admin.from("employees").update({ auth_user_id: null }).eq("auth_user_id", authId);
      await admin.auth.admin.deleteUser(authId);
    }
    console.log(`  · 임시 auth 계정 ${authIds.length}개 삭제`);
  }

  // ==================================================================
  console.log("\n[H] 순수 함수 (DB 없이)");
  // ==================================================================

  /*
   * 링크 스킴 판정 — Markdown.tsx의 Anchor에서 link.ts로 뽑아둔 함수다.
   * 전 직원이 편집하는 위키에서 주소는 신뢰할 수 없는 입력이라, 이 판정이
   * 한 글자만 틀려도 같은 탭에서 남의 사이트로 넘어가는 링크가 살아난다.
   */
  const linkCases: { href: string; expect: string; why: string }[] = [
    { href: "//evil.com", expect: "unsafe", why: "프로토콜 상대 URL은 링크가 되지 않는다" },
    { href: "/\\evil.com", expect: "unsafe", why: "백슬래시로 시작하는 경로는 링크가 되지 않는다" },
    { href: "javascript:alert(1)", expect: "unsafe", why: "javascript: 스킴은 링크가 되지 않는다" },
    { href: "JaVaScRiPt:alert(1)", expect: "unsafe", why: "대소문자를 섞은 JaVaScRiPt: 도 링크가 되지 않는다" },
    { href: "data:text/html,x", expect: "unsafe", why: "data: 스킴은 링크가 되지 않는다" },
    { href: "/wiki/abc", expect: "internal", why: "/wiki/abc 는 내부 링크가 된다" },
    { href: "https://example.com", expect: "external", why: "https://example.com 은 외부 링크가 된다" },
  ];

  for (const c of linkCases) {
    const got = classifyWikiLink(c.href);
    check(c.why, got === c.expect, `${c.href} → ${got}`);
  }

  const node = (
    id: string,
    title: string,
    parent_id: string | null,
  ): WikiNode => ({
    id,
    title,
    parent_id,
    updated_at: "2026-01-01T00:00:00+00:00",
    updated_by_name: null,
    child_count: 0,
  });

  // ── buildParentOptions ────────────────────────────────────────────
  const optionNodes = [
    node("p1", "제품", null),
    node("p2", "회의록", "p1"),
    node("p3", "2026-01", "p2"),
    node("p4", "인사", null),
  ];
  const optionIds = buildParentOptions(optionNodes, "p1").map((o) => o.id);

  check(
    "buildParentOptions가 편집 중인 문서 자신을 제외한다",
    !optionIds.includes("p1"),
    optionIds.join(", "),
  );
  check(
    "buildParentOptions가 자기 하위를 직계·손자까지 제외한다",
    !optionIds.includes("p2") && !optionIds.includes("p3"),
    optionIds.join(", "),
  );
  check(
    "무관한 문서는 선택지에 남는다",
    optionIds.length === 1 && optionIds[0] === "p4",
    optionIds.join(", "),
  );
  check(
    "선택지에 상위 경로가 붙는다 (같은 제목이 여럿일 때 구분된다)",
    buildParentOptions(optionNodes).find((o) => o.id === "p3")?.path ===
      "제품 › 회의록 › 2026-01",
    buildParentOptions(optionNodes).find((o) => o.id === "p3")?.path,
  );

  // ── buildWikiTree ─────────────────────────────────────────────────
  const flatten = (list: WikiTreeNode[]): string[] =>
    list.flatMap((n) => [n.id, ...flatten(n.children)]);

  const cyclic = flatten(
    buildWikiTree([node("a", "A", "b"), node("b", "B", "a")]),
  );
  check(
    "순환 데이터(A↔B)에서도 두 문서가 사라지지 않고 전부 나온다",
    cyclic.length === 2 && cyclic.includes("a") && cyclic.includes("b"),
    cyclic.join(", "),
  );

  const orphan = flatten(buildWikiTree([node("x", "X", "없는상위")]));
  check(
    "상위가 목록에 없는 문서는 최상위로 올라온다 (조용히 사라지지 않는다)",
    orphan.length === 1 && orphan[0] === "x",
    orphan.join(", "),
  );

  const selfRef = flatten(buildWikiTree([node("z", "Z", "z")]));
  check(
    "자기 자신을 상위로 가진 문서도 정확히 한 번만 나온다",
    selfRef.length === 1 && selfRef[0] === "z",
    selfRef.join(", "),
  );

  /*
   * 무한 루프는 "안 끝난다"라서 결과로 판정할 수 없다. 전부 순환인 큰 입력을
   * 넣고 시간과 개수를 함께 본다 — 끝나기만 하고 문서가 사라져도 실패다.
   */
  const big: WikiNode[] = [];
  for (let i = 0; i < 500; i += 1) {
    big.push(node(`n${i}`, `문서 ${i}`, `n${(i + 499) % 500}`));
  }
  const startedAt = Date.now();
  const bigResult = flatten(buildWikiTree(big));
  const elapsed = Date.now() - startedAt;
  check(
    "500개짜리 순환 데이터에서도 즉시 끝나고 한 건도 잃지 않는다",
    bigResult.length === 500 && new Set(bigResult).size === 500 && elapsed < 2000,
    `${bigResult.length}건 / ${elapsed}ms`,
  );

  console.log(`\n결과: ${pass}건 통과 / ${fail}건 실패`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error("\n예외:", error.message ?? error);
  process.exit(1);
});
