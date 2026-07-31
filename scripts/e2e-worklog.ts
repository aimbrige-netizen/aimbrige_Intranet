/**
 * 스펙 09·10 RLS·제약 e2e 검증 (마이그레이션 18·19).
 *
 * 실제 사용자 토큰으로 호출해야 current_employee_id()가 동작하므로
 * 데모 계정에 임시 auth 사용자를 붙였다가 끝나면 전부 되돌린다.
 *
 *   npm run e2e:worklog -- --yes
 *
 * 검증하려는 것 중 가장 중요한 건 **막혀 있어야 하는 방향**이다.
 * 특히 todos는 "완전 개인 데이터"라 관리자에게도 새면 안 된다.
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
      "이 스크립트는 실제 DB에 테스트 행을 만들고 데모 직원 역할을 잠시 바꿉니다(끝나면 원복).",
      "실행하려면: npm run e2e:worklog -- --yes",
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

const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(
  new Date(),
);

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
  // 이수연(일반직원, 인사총무팀) — 팀장은 김지훈
  const MEMBER = "sylee@demo.aimbrige.kr";
  const MANAGER = "jhkim@demo.aimbrige.kr";
  // 정도원은 다른 팀(플랫폼개발팀) 일반직원 — 아무 관계가 없다
  const OUTSIDER = "dwjung@demo.aimbrige.kr";

  const { data: memberEmp } = await admin
    .from("employees")
    .select("id")
    .eq("email", MEMBER)
    .single();
  const { data: managerEmp } = await admin
    .from("employees")
    .select("id, role_id")
    .eq("email", MANAGER)
    .single();
  const { data: outsiderEmp } = await admin
    .from("employees")
    .select("id, role_id")
    .eq("email", OUTSIDER)
    .single();

  const authIds: string[] = [];
  const cleanup: { table: string; id: string }[] = [];

  try {
    const member = await clientFor(MEMBER);
    const manager = await clientFor(MANAGER);
    const outsider = await clientFor(OUTSIDER);
    authIds.push(member.authId, manager.authId, outsider.authId);

    // ── 업무일지 ────────────────────────────────────────────────────
    console.log("\n[1] 업무일지 (work_logs)");

    const { data: log, error: e1 } = await member.sb
      .from("work_logs")
      .insert({
        employee_id: memberEmp!.id,
        log_date: TODAY,
        content: "e2e 업무일지",
      })
      .select("id")
      .single();
    check("본인 업무일지를 쓴다", !e1 && !!log, e1?.message);
    if (log) cleanup.push({ table: "work_logs", id: log.id });

    const { data: mgrRead } = await manager.sb
      .from("work_logs")
      .select("id")
      .eq("id", log!.id);
    check("팀장은 팀원 업무일지를 조회한다", (mgrRead ?? []).length === 1);

    const { data: outRead } = await outsider.sb
      .from("work_logs")
      .select("id")
      .eq("id", log!.id);
    check(
      "관계 없는 직원은 남의 업무일지를 못 본다",
      (outRead ?? []).length === 0,
      `보임 ${(outRead ?? []).length}건`,
    );

    const mgrEdit = await manager.sb
      .from("work_logs")
      .update({ content: "팀장이 고침" })
      .eq("id", log!.id)
      .select("id");
    check(
      "팀장도 팀원 업무일지를 고칠 수 없다",
      (mgrEdit.data ?? []).length === 0,
      "수정됨!",
    );

    const stolen = await member.sb
      .from("work_logs")
      .insert({
        employee_id: outsiderEmp!.id,
        log_date: TODAY,
        content: "남의 이름으로",
      })
      .select("id");
    check(
      "남의 이름으로 업무일지를 쓸 수 없다",
      !!stolen.error,
      stolen.error ? "" : "생성됨!",
    );
    if (stolen.data?.[0])
      cleanup.push({ table: "work_logs", id: stolen.data[0].id });

    const blank = await member.sb.from("work_logs").insert({
      employee_id: memberEmp!.id,
      log_date: TODAY,
      content: "   ",
    });
    check("공백만 있는 내용은 CHECK 제약이 막는다", !!blank.error);

    // ── 할일 ────────────────────────────────────────────────────────
    console.log("\n[2] 할일 (todos) — 완전 개인 데이터");

    const { data: todo, error: e2 } = await member.sb
      .from("todos")
      .insert({ employee_id: memberEmp!.id, content: "e2e 할일" })
      .select("id")
      .single();
    check("본인 할일을 만든다", !e2 && !!todo, e2?.message);
    if (todo) cleanup.push({ table: "todos", id: todo.id });

    const { data: mgrTodo } = await manager.sb
      .from("todos")
      .select("id")
      .eq("id", todo!.id);
    check(
      "팀장도 팀원 할일을 볼 수 없다",
      (mgrTodo ?? []).length === 0,
      `보임 ${(mgrTodo ?? []).length}건`,
    );

    // 관리자 권한으로도 막히는지 — 스펙 09가 "완전 개인"이라고 못박은 지점
    await admin
      .from("employees")
      .update({
        role_id: (await admin.from("roles").select("id").eq("name", "system_admin").single())
          .data!.id,
      })
      .eq("email", OUTSIDER);
    const adminUser = await clientFor(OUTSIDER);
    authIds.push(adminUser.authId);

    const { data: adminTodo } = await adminUser.sb
      .from("todos")
      .select("id")
      .eq("id", todo!.id);
    check(
      "시스템 관리자도 남의 할일을 볼 수 없다",
      (adminTodo ?? []).length === 0,
      `보임 ${(adminTodo ?? []).length}건`,
    );

    const badTodo = await member.sb
      .from("todos")
      .update({ is_completed: true })
      .eq("id", todo!.id)
      .select("id");
    check(
      "완료 표시만 하고 완료시각을 안 쓰면 CHECK가 막는다",
      !!badTodo.error,
      badTodo.error ? "" : "저장됨! (제약이 동작하지 않는다)",
    );

    const goodTodo = await member.sb
      .from("todos")
      .update({ is_completed: true, completed_at: new Date().toISOString() })
      .eq("id", todo!.id)
      .select("id");
    check("둘을 함께 쓰면 완료된다", (goodTodo.data ?? []).length === 1,
      goodTodo.error?.message);

    // ── 목표 ────────────────────────────────────────────────────────
    console.log("\n[3] 목표 (goals)");

    const { data: goal, error: e3 } = await member.sb
      .from("goals")
      .insert({ employee_id: memberEmp!.id, title: "e2e 목표" })
      .select("id")
      .single();
    check("본인 목표를 만든다", !e3 && !!goal, e3?.message);
    if (goal) cleanup.push({ table: "goals", id: goal.id });

    const { data: mgrGoal } = await manager.sb
      .from("goals")
      .select("id")
      .eq("id", goal!.id);
    check("팀장은 팀원 목표를 조회한다", (mgrGoal ?? []).length === 1);

    const badGoal = await member.sb
      .from("goals")
      .update({ status: "completed" })
      .eq("id", goal!.id)
      .select("id");
    check(
      "완료로 바꾸면서 closed_at을 안 쓰면 CHECK가 막는다",
      !!badGoal.error,
      badGoal.error ? "" : "저장됨!",
    );

    const goodGoal = await member.sb
      .from("goals")
      .update({ status: "completed", closed_at: new Date().toISOString() })
      .eq("id", goal!.id)
      .select("id");
    check("둘을 함께 쓰면 완료된다", (goodGoal.data ?? []).length === 1,
      goodGoal.error?.message);

    // ── 프로젝트 ────────────────────────────────────────────────────
    console.log("\n[4] 프로젝트 (projects)");

    const memberProject = await member.sb
      .from("projects")
      .insert({ name: "e2e 일반직원 프로젝트", owner_id: memberEmp!.id })
      .select("id");
    check(
      "일반 직원은 프로젝트를 만들 수 없다",
      !!memberProject.error,
      memberProject.error ? "" : "생성됨!",
    );
    if (memberProject.data?.[0])
      cleanup.push({ table: "projects", id: memberProject.data[0].id });

    const { data: project, error: e4 } = await manager.sb
      .from("projects")
      .insert({
        name: "e2e 프로젝트",
        owner_id: managerEmp!.id,
        status: "in_progress",
      })
      .select("id")
      .single();
    check("팀장은 프로젝트를 만든다", !e4 && !!project, e4?.message);
    if (project) cleanup.push({ table: "projects", id: project.id });

    const { data: anyoneRead } = await member.sb
      .from("projects")
      .select("id")
      .eq("id", project!.id);
    check("프로젝트는 전 임직원이 조회한다", (anyoneRead ?? []).length === 1);

    const notOwner = await member.sb
      .from("projects")
      .update({ status: "completed" })
      .eq("id", project!.id)
      .select("id");
    check(
      "담당자가 아니면 프로젝트를 수정할 수 없다",
      (notOwner.data ?? []).length === 0,
      "수정됨!",
    );

    const badDates = await manager.sb
      .from("projects")
      .update({ start_date: addDays(TODAY, 10), end_date: addDays(TODAY, 1) })
      .eq("id", project!.id)
      .select("id");
    check("종료일이 시작일보다 빠르면 CHECK가 막는다", !!badDates.error);

    // ── 마일스톤 ────────────────────────────────────────────────────
    console.log("\n[5] 마일스톤 · 산출물");

    const { data: milestone, error: e5 } = await manager.sb
      .from("project_milestones")
      .insert({ project_id: project!.id, title: "e2e 마일스톤" })
      .select("id")
      .single();
    check("담당자는 마일스톤을 만든다", !e5 && !!milestone, e5?.message);

    const notOwnerMs = await member.sb
      .from("project_milestones")
      .insert({ project_id: project!.id, title: "남이 만든 마일스톤" })
      .select("id");
    check(
      "담당자가 아니면 마일스톤을 만들 수 없다",
      !!notOwnerMs.error,
      notOwnerMs.error ? "" : "생성됨!",
    );

    const badMs = await manager.sb
      .from("project_milestones")
      .update({ is_completed: true })
      .eq("id", milestone!.id)
      .select("id");
    check(
      "마일스톤도 완료 표시와 완료시각이 함께 가야 한다",
      !!badMs.error,
      badMs.error ? "" : "저장됨!",
    );

    // ── 업무일지 ↔ 프로젝트 FK ──────────────────────────────────────
    console.log("\n[6] 업무일지 ↔ 프로젝트 연결");

    const tagged = await member.sb
      .from("work_logs")
      .insert({
        employee_id: memberEmp!.id,
        log_date: TODAY,
        content: "프로젝트 태깅 e2e",
        project_id: project!.id,
      })
      .select("id")
      .single();
    check("업무일지에 프로젝트를 태깅한다", !tagged.error, tagged.error?.message);
    if (tagged.data) cleanup.push({ table: "work_logs", id: tagged.data.id });

    const ghost = await member.sb.from("work_logs").insert({
      employee_id: memberEmp!.id,
      log_date: TODAY,
      content: "없는 프로젝트",
      project_id: "00000000-0000-0000-0000-000000000000",
    });
    check("없는 프로젝트로는 태깅할 수 없다 (FK)", !!ghost.error);

    // 프로젝트를 지우면 업무일지는 남고 태그만 풀린다 (on delete set null)
    await admin.from("projects").delete().eq("id", project!.id);
    const { data: after } = await admin
      .from("work_logs")
      .select("id, project_id")
      .eq("id", tagged.data!.id)
      .single();
    check(
      "프로젝트를 지워도 업무일지는 남고 태그만 풀린다",
      !!after && after.project_id === null,
      JSON.stringify(after),
    );
    cleanup.splice(
      cleanup.findIndex((c) => c.id === project!.id),
      1,
    );

    // ── 팀원 목록 RPC ───────────────────────────────────────────────
    console.log("\n[7] my_team_members()");

    const { data: mgrTeam } = await manager.sb.rpc("my_team_members");
    check(
      "팀장은 팀원 목록을 받는다",
      Array.isArray(mgrTeam) && mgrTeam.length > 0,
      `${(mgrTeam ?? []).length}명`,
    );

    const { data: memberTeam } = await member.sb.rpc("my_team_members");
    check(
      "일반 직원의 팀원 목록은 비어 있다",
      Array.isArray(memberTeam) && memberTeam.length === 0,
      `${(memberTeam ?? []).length}명`,
    );

    check(
      "position 컬럼이 예약어 충돌 없이 나온다",
      Array.isArray(mgrTeam) && (mgrTeam.length === 0 || "position" in mgrTeam[0]),
    );

    // ── 캘린더 병합 RPC ─────────────────────────────────────────────
    console.log("\n[8] list_calendar_milestones()");
    const { data: cal, error: e8 } = await member.sb.rpc(
      "list_calendar_milestones",
      { p_from: addDays(TODAY, -200), p_to: addDays(TODAY, 200) },
    );
    check("마일스톤 캘린더 병합 RPC가 동작한다", !e8, e8?.message);
    check(
      "데모 마일스톤이 조회된다",
      Array.isArray(cal) && cal.length > 0,
      `${(cal ?? []).length}건`,
    );
  } finally {
    console.log("\n[정리]");
    for (const row of cleanup) {
      await admin.from(row.table).delete().eq("id", row.id);
    }
    console.log(`  · 테스트 행 ${cleanup.length}건 삭제`);

    await admin
      .from("employees")
      .update({ role_id: outsiderEmp!.role_id })
      .eq("email", OUTSIDER);
    console.log("  · 역할 원복");

    for (const id of authIds) {
      await admin.from("employees").update({ auth_user_id: null }).eq("auth_user_id", id);
      await admin.auth.admin.deleteUser(id);
    }
    console.log(`  · 임시 auth 계정 ${authIds.length}개 삭제`);
  }

  console.log(`\n결과: ${pass}건 통과 / ${fail}건 실패`);
  if (fail > 0) process.exit(1);
}

function addDays(ymd: string, delta: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
