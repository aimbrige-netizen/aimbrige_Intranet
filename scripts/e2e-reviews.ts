/**
 * 스펙 12 RLS·트리거 e2e 검증 (마이그레이션 21).
 *
 *   npm run e2e:reviews -- --yes
 *
 * 이 스크립트가 존재하는 이유가 분명하다. 처음 작성한 마이그레이션은 컬럼
 * 가드 트리거를 `before update`에만 걸었는데, 화면이 upsert로 쓰기 때문에
 * **행이 처음 만들어지는 INSERT 경로가 통째로 무방비**였다. 그 상태에서
 * 본인이 자기 manager_submitted_at을 채우면 "팀장평가 완료"를 스스로
 * 위조할 수 있었고, 팀장은 팀원의 자기평가를 대신 써서 제출 상태로 못박을
 * 수 있었다(그 뒤에는 잠금 규칙이 정작 본인의 수정을 막는다).
 * 화면만 눌러봐서는 절대 안 걸리는 종류라 여기서 직접 찌른다.
 *
 * 검증의 핵심은 **막혀 있어야 하는 방향**이다.
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
      "이 스크립트는 실제 DB에 평가 사이클·목표·평가 행을 만들고 끝나면 지웁니다.",
      "실행하려면: npm run e2e:reviews -- --yes",
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

async function main() {
  // 이수연(일반직원, 인사총무팀) — 팀장은 김지훈. 정도원은 무관한 다른 팀
  const MEMBER = "sylee@demo.aimbrige.kr";
  const MANAGER = "jhkim@demo.aimbrige.kr";
  const OUTSIDER = "dwjung@demo.aimbrige.kr";

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
  const managerId = await emp(MANAGER);
  const outsiderId = await emp(OUTSIDER);

  const authIds: string[] = [];
  const cleanupCycles: string[] = [];

  try {
    // 사이클은 service role로 만든다 — 관리자 권한 경로는 별도로 검증한다
    const { data: cycle, error: cycleError } = await admin
      .from("review_cycles")
      .insert({
        name: `[e2e] 검증 사이클 ${Date.now()}`,
        start_date: "2026-01-01",
        end_date: "2026-06-30",
        status: "goal_setting",
      })
      .select("id")
      .single();
    if (cycleError || !cycle) throw new Error(`사이클 생성 실패: ${cycleError?.message}`);
    cleanupCycles.push(cycle.id);

    const member = await clientFor(MEMBER);
    const manager = await clientFor(MANAGER);
    const outsider = await clientFor(OUTSIDER);
    authIds.push(member.authId, manager.authId, outsider.authId);

    console.log("\n[1] 사이클 조회·수정");

    const cycleRead = await member.sb
      .from("review_cycles")
      .select("id")
      .eq("id", cycle.id);
    check("일반직원이 사이클을 볼 수 있다", cycleRead.data?.length === 1);

    const cycleWrite = await member.sb
      .from("review_cycles")
      .update({ status: "completed" })
      .eq("id", cycle.id)
      .select("id");
    check(
      "일반직원은 사이클 단계를 바꿀 수 없다",
      Boolean(cycleWrite.error) || cycleWrite.data?.length === 0,
    );

    console.log("\n[2] 목표 — 등록과 승인");

    const goalInsert = await member.sb
      .from("review_goals")
      .insert({ cycle_id: cycle.id, employee_id: memberId, content: "e2e 목표 1" })
      .select("id")
      .single();
    check("본인 목표를 등록할 수 있다", !goalInsert.error, goalInsert.error?.message);
    const goalId = goalInsert.data?.id as string | undefined;

    const forOther = await member.sb
      .from("review_goals")
      .insert({ cycle_id: cycle.id, employee_id: managerId, content: "남의 목표" })
      .select("id");
    check("남의 목표는 등록할 수 없다", Boolean(forOther.error));

    // ── INSERT 경로 위조 (원래 뚫려 있던 자리) ──────────────────────
    const selfApprove = await member.sb
      .from("review_goals")
      .insert({
        cycle_id: cycle.id,
        employee_id: memberId,
        content: "자가승인 시도",
        approved_by: memberId,
        approved_at: new Date().toISOString(),
      })
      .select("id");
    check(
      "★ 목표를 등록하면서 스스로 승인할 수 없다 (INSERT 가드)",
      Boolean(selfApprove.error),
      selfApprove.error ? "" : "승인된 목표가 그대로 들어갔다",
    );

    const fakeApprover = await member.sb
      .from("review_goals")
      .insert({
        cycle_id: cycle.id,
        employee_id: memberId,
        content: "남의 이름 승인 시도",
        approved_by: managerId,
        approved_at: new Date().toISOString(),
      })
      .select("id");
    check(
      "★ 남의 이름으로 승인 기록을 남길 수 없다 (INSERT 가드)",
      Boolean(fakeApprover.error),
    );

    if (goalId) {
      const managerEdit = await manager.sb
        .from("review_goals")
        .update({ content: "팀장이 고친 목표" })
        .eq("id", goalId)
        .select("id");
      check(
        "팀장은 팀원의 목표 내용을 고칠 수 없다",
        Boolean(managerEdit.error) || managerEdit.data?.length === 0,
      );

      const outsiderRead = await outsider.sb
        .from("review_goals")
        .select("id")
        .eq("id", goalId);
      check("무관한 직원은 남의 목표를 볼 수 없다", outsiderRead.data?.length === 0);

      const approve = await manager.sb
        .from("review_goals")
        .update({ approved_by: managerId, approved_at: new Date().toISOString() })
        .eq("id", goalId)
        .select("id");
      check("팀장은 팀원의 목표를 승인할 수 있다", approve.data?.length === 1, approve.error?.message);

      const editApproved = await member.sb
        .from("review_goals")
        .update({ content: "승인 후 몰래 수정" })
        .eq("id", goalId)
        .select("id");
      check(
        "승인된 목표는 본인도 수정할 수 없다",
        Boolean(editApproved.error) || editApproved.data?.length === 0,
      );
    }

    console.log("\n[3] 평가 — INSERT 경로 위조 (핵심)");

    const forgeManager = await member.sb
      .from("reviews")
      .insert({
        cycle_id: cycle.id,
        employee_id: memberId,
        self_review: "자기평가",
        manager_review: "내가 쓴 팀장평가",
        manager_id: managerId,
        manager_submitted_at: new Date().toISOString(),
      })
      .select("id");
    check(
      "★ 본인이 팀장평가를 위조해 넣을 수 없다 (INSERT 가드)",
      Boolean(forgeManager.error),
      forgeManager.error ? "" : "팀장평가 완료 상태가 그대로 들어갔다",
    );

    const forgeSelf = await manager.sb
      .from("reviews")
      .insert({
        cycle_id: cycle.id,
        employee_id: memberId,
        self_review: "팀장이 대신 쓴 자기평가",
        self_submitted_at: new Date().toISOString(),
      })
      .select("id");
    check(
      "★ 팀장이 팀원의 자기평가를 대신 제출할 수 없다 (INSERT 가드)",
      Boolean(forgeSelf.error),
      forgeSelf.error ? "" : "팀원이 쓰지도 않은 자기평가가 제출됐다",
    );

    console.log("\n[4] 평가 — 정상 흐름과 UPDATE 잠금");

    const selfDraft = await member.sb
      .from("reviews")
      .upsert(
        { cycle_id: cycle.id, employee_id: memberId, self_review: "초안" },
        { onConflict: "cycle_id,employee_id" },
      )
      .select("id")
      .single();
    check("본인 자기평가 임시저장", !selfDraft.error, selfDraft.error?.message);

    const managerPeek = await manager.sb
      .from("reviews")
      .select("self_review")
      .eq("cycle_id", cycle.id)
      .eq("employee_id", memberId);
    check("팀장은 팀원의 평가 행을 조회할 수 있다", managerPeek.data?.length === 1);

    const outsiderPeek = await outsider.sb
      .from("reviews")
      .select("id")
      .eq("cycle_id", cycle.id)
      .eq("employee_id", memberId);
    check("무관한 직원은 남의 평가를 볼 수 없다", outsiderPeek.data?.length === 0);

    const managerOverwrite = await manager.sb
      .from("reviews")
      .update({ self_review: "팀장이 갈아치운 자기평가" })
      .eq("cycle_id", cycle.id)
      .eq("employee_id", memberId)
      .select("id");
    check(
      "팀장은 팀원의 자기평가를 수정할 수 없다 (UPDATE 가드)",
      Boolean(managerOverwrite.error) || managerOverwrite.data?.length === 0,
    );

    const selfWritesManager = await member.sb
      .from("reviews")
      .update({ manager_review: "내가 쓴 팀장평가" })
      .eq("cycle_id", cycle.id)
      .eq("employee_id", memberId)
      .select("id");
    check(
      "본인은 팀장평가 칸을 수정할 수 없다 (UPDATE 가드)",
      Boolean(selfWritesManager.error) || selfWritesManager.data?.length === 0,
    );

    const selfSubmit = await member.sb
      .from("reviews")
      .update({
        self_review: "제출본",
        self_submitted_at: new Date().toISOString(),
      })
      .eq("cycle_id", cycle.id)
      .eq("employee_id", memberId)
      .select("id");
    check("본인 자기평가 제출", selfSubmit.data?.length === 1, selfSubmit.error?.message);

    const editAfterSubmit = await member.sb
      .from("reviews")
      .update({ self_review: "제출 후 수정" })
      .eq("cycle_id", cycle.id)
      .eq("employee_id", memberId)
      .select("id");
    check(
      "제출한 자기평가는 수정할 수 없다",
      Boolean(editAfterSubmit.error) || editAfterSubmit.data?.length === 0,
    );

    const managerSubmit = await manager.sb
      .from("reviews")
      .update({
        manager_review: "팀장평가 본문",
        manager_id: managerId,
        manager_submitted_at: new Date().toISOString(),
      })
      .eq("cycle_id", cycle.id)
      .eq("employee_id", memberId)
      .select("id");
    check("팀장평가 제출", managerSubmit.data?.length === 1, managerSubmit.error?.message);

    const managerReedit = await manager.sb
      .from("reviews")
      .update({ manager_review: "제출 후 수정" })
      .eq("cycle_id", cycle.id)
      .eq("employee_id", memberId)
      .select("id");
    check(
      "제출한 팀장평가는 수정할 수 없다",
      Boolean(managerReedit.error) || managerReedit.data?.length === 0,
    );

    console.log("\n[5] CHECK 제약");

    const emptySubmit = await admin
      .from("reviews")
      .insert({
        cycle_id: cycle.id,
        employee_id: outsiderId,
        self_review: "   ",
        self_submitted_at: new Date().toISOString(),
      })
      .select("id");
    check(
      "내용 없이 제출 상태로 만들 수 없다 (reviews_self_submitted_has_content)",
      Boolean(emptySubmit.error),
    );

    const authorless = await admin
      .from("reviews")
      .insert({
        cycle_id: cycle.id,
        employee_id: outsiderId,
        manager_review: "본문",
        manager_submitted_at: new Date().toISOString(),
      })
      .select("id");
    check(
      "작성자 없이 팀장평가를 완료로 남길 수 없다 (reviews_manager_submitted_has_author)",
      Boolean(authorless.error),
    );

    const badPeriod = await admin
      .from("review_cycles")
      .insert({ name: "[e2e] 거꾸로", start_date: "2026-06-30", end_date: "2026-01-01" })
      .select("id");
    check("기간이 거꾸로인 사이클은 만들 수 없다", Boolean(badPeriod.error));
    if (badPeriod.data?.[0]) cleanupCycles.push(badPeriod.data[0].id);

    console.log("\n[6] 집계 RPC 권한");

    const memberProgress = await member.sb.rpc("review_cycle_progress", {
      p_cycle_id: cycle.id,
    });
    check(
      "일반직원은 전사 진행 현황을 조회할 수 없다",
      Boolean(memberProgress.error),
    );

    const teamStatus = await manager.sb.rpc("review_team_status", {
      p_cycle_id: cycle.id,
    });
    check(
      "팀장은 팀원 현황을 조회할 수 있다",
      !teamStatus.error && Array.isArray(teamStatus.data),
      teamStatus.error?.message,
    );
    check(
      "팀원 현황에 본인은 포함되지 않는다",
      !(teamStatus.data ?? []).some(
        (row: { employee_id: string }) => row.employee_id === managerId,
      ),
    );

    const outsiderTeam = await outsider.sb.rpc("review_team_status", {
      p_cycle_id: cycle.id,
    });
    check(
      "일반직원의 팀원 현황은 비어 있다",
      !outsiderTeam.error && (outsiderTeam.data ?? []).length === 0,
    );
  } finally {
    // 사이클을 지우면 review_goals·reviews가 cascade로 함께 지워진다
    for (const id of cleanupCycles) {
      await admin.from("review_cycles").delete().eq("id", id);
    }
    await admin.from("review_cycles").delete().like("name", "[e2e]%");
    for (const authId of authIds) {
      await admin.from("employees").update({ auth_user_id: null }).eq("auth_user_id", authId);
      await admin.auth.admin.deleteUser(authId);
    }
  }

  console.log(`\n결과: ${pass}건 통과 / ${fail}건 실패`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error("\n예외:", error.message ?? error);
  process.exit(1);
});
