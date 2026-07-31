/**
 * 마이그레이션 13 결재 워크플로 e2e 검증.
 *
 * 실제 사용자 토큰으로 호출해야 current_employee_id()가 동작하므로
 * 데모 계정에 임시 auth 사용자를 붙였다가 끝나면 전부 되돌린다.
 *
 * 실제 DB에 문서를 만들고 결재라인 설정을 잠시 바꾼다(끝나면 원복).
 * 그래서 실행에 --yes를 요구한다.
 *
 *   npm run e2e:approval -- --yes
 *
 * 검증 항목: 임시저장 / 남의 draft 보호 / 상신 / 회수 / 승인 후 회수 차단 /
 *            상신 문서 삭제 차단 / 결재선 미지정 시 상신 차단
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, service, { auth: { persistSession: false } });

if (!process.argv.includes("--yes")) {
  console.error(
    [
      "",
      "이 스크립트는 실제 DB에 테스트 문서를 만들고 결재라인 설정을 잠시 바꿉니다(끝나면 원복).",
      "실행하려면: npm run e2e:approval -- --yes",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ✔ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✖ ${label}${detail ? " — " + detail : ""}`);
  }
}

/** 데모 직원에 임시 auth 사용자를 붙이고 그 사용자로 인증된 클라이언트를 만든다 */
async function clientFor(email: string): Promise<{ sb: SupabaseClient; authId: string }> {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) throw new Error(`generateLink(${email}): ${linkError.message}`);

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
    }),
    authId,
  };
}

async function main() {
  const REQUESTER = "sylee@demo.aimbrige.kr"; // 인사총무팀 일반직원, 팀장 = 김지훈
  const MANAGER = "jhkim@demo.aimbrige.kr"; // 1차 검토자
  const OTHER = "dwjung@demo.aimbrige.kr"; // 남의 draft를 건드려 보는 역할
  const TYPE = "expense";

  const { data: finalApprover } = await admin
    .from("employees")
    .select("id")
    .eq("email", "hjchoi@demo.aimbrige.kr")
    .single();

  // 원래 설정을 기억했다가 끝나면 되돌린다
  const { data: originalLine } = await admin
    .from("approval_line_configs")
    .select("step2_approver_id, use_team_review")
    .eq("document_type", TYPE)
    .single();

  /** 1차 팀장 검토 스위치 (마이그레이션 14) */
  const setTeamReview = (enabled: boolean) =>
    admin
      .from("approval_line_configs")
      .update({ use_team_review: enabled })
      .eq("document_type", TYPE);

  await admin
    .from("approval_line_configs")
    .update({ step2_approver_id: finalApprover!.id, use_team_review: false })
    .eq("document_type", TYPE);

  const createdDocs: string[] = [];
  const authIds: string[] = [];

  try {
    const requester = await clientFor(REQUESTER);
    const manager = await clientFor(MANAGER);
    const other = await clientFor(OTHER);
    authIds.push(requester.authId, manager.authId, other.authId);

    console.log("\n[1] 임시저장");
    const { data: draftId, error: e1 } = await requester.sb.rpc("save_approval_draft", {
      p_document_id: null,
      p_document_type: TYPE,
      p_title: "e2e 임시저장",
      p_form_data: { items: [{ name: "택시비", amount: 12000 }], total: 12000 },
    });
    check("미완성 폼도 저장된다", !e1 && !!draftId, e1?.message);
    if (draftId) createdDocs.push(draftId as string);

    const { data: d1 } = await admin
      .from("approval_documents")
      .select("status, current_step")
      .eq("id", draftId as string)
      .single();
    check("status=draft, current_step=0", d1?.status === "draft" && d1?.current_step === 0,
      JSON.stringify(d1));

    const { count: stepsAfterDraft } = await admin
      .from("approval_steps")
      .select("id", { count: "exact", head: true })
      .eq("document_id", draftId as string);
    check("임시저장에는 결재선이 없다", stepsAfterDraft === 0, `steps=${stepsAfterDraft}`);

    console.log("\n[2] 남의 임시저장 보호");
    const { error: e2 } = await other.sb.rpc("save_approval_draft", {
      p_document_id: draftId,
      p_document_type: TYPE,
      p_title: "가로채기",
      p_form_data: {},
    });
    check("타인은 내 임시저장을 수정할 수 없다", !!e2, e2 ? "" : "차단되지 않음!");

    console.log("\n[3] 상신 — 2단계 모드 (1차 팀장 검토 꺼짐)");
    const { error: e3 } = await requester.sb.rpc("submit_approval_draft", {
      p_document_id: draftId,
    });
    check("임시저장을 상신한다", !e3, e3?.message);

    const { data: d3 } = await admin
      .from("approval_documents")
      .select("status, current_step")
      .eq("id", draftId as string)
      .single();
    check(
      "팀장 검토를 건너뛰고 최종 단계에서 시작한다 (current_step=2)",
      d3?.status === "pending" && d3?.current_step === 2,
      JSON.stringify(d3),
    );

    const { data: steps3 } = await admin
      .from("approval_steps")
      .select("step_order, approver_id, status")
      .eq("document_id", draftId as string)
      .order("step_order");
    check("결재선이 최종 1단계만 생성된다", steps3?.length === 1, `steps=${steps3?.length}`);
    check(
      "그 단계 담당자가 최종 결재자다",
      steps3?.[0]?.approver_id === finalApprover!.id,
    );

    console.log("\n[4] 회수");
    const { error: e4 } = await requester.sb.rpc("withdraw_approval_document", {
      p_document_id: draftId,
    });
    check("승인 전이면 회수된다", !e4, e4?.message);

    const { data: d4 } = await admin
      .from("approval_documents")
      .select("status, current_step")
      .eq("id", draftId as string)
      .single();
    check("회수하면 draft로 돌아간다", d4?.status === "draft" && d4?.current_step === 0,
      JSON.stringify(d4));

    const { count: stepsAfterWithdraw } = await admin
      .from("approval_steps")
      .select("id", { count: "exact", head: true })
      .eq("document_id", draftId as string);
    check("회수하면 결재선이 지워진다", stepsAfterWithdraw === 0, `steps=${stepsAfterWithdraw}`);

    console.log("\n[5] 3단계 모드 (1차 팀장 검토 켬) → 1차 승인 → 회수 차단");
    await setTeamReview(true);
    const { error: e5 } = await requester.sb.rpc("submit_approval_draft", {
      p_document_id: draftId,
    });
    check("회수한 문서를 다시 상신한다", !e5, e5?.message);

    const { data: d5 } = await admin
      .from("approval_documents")
      .select("current_step")
      .eq("id", draftId as string)
      .single();
    check(
      "팀장 검토를 켜면 1차부터 시작한다 (current_step=1)",
      d5?.current_step === 1,
      JSON.stringify(d5),
    );

    const { count: steps5 } = await admin
      .from("approval_steps")
      .select("id", { count: "exact", head: true })
      .eq("document_id", draftId as string);
    check("결재선이 2단계로 생성된다", steps5 === 2, `steps=${steps5}`);

    const { error: e5b } = await manager.sb.rpc("process_approval_step", {
      p_document_id: draftId,
      p_approve: true,
      p_comment: null,
    });
    check("1차 검토자가 승인한다", !e5b, e5b?.message);

    const { error: e5c } = await requester.sb.rpc("withdraw_approval_document", {
      p_document_id: draftId,
    });
    check(
      "이미 승인된 문서는 회수할 수 없다",
      !!e5c && e5c.message.includes("이미 결재가 진행된"),
      e5c ? e5c.message : "차단되지 않음!",
    );

    console.log("\n[6] 삭제 가드");
    const { error: e6 } = await requester.sb.rpc("delete_approval_draft", {
      p_document_id: draftId,
    });
    check("상신된 문서는 삭제할 수 없다", !!e6, e6 ? "" : "차단되지 않음!");

    const { data: draft2 } = await requester.sb.rpc("save_approval_draft", {
      p_document_id: null,
      p_document_type: TYPE,
      p_title: "삭제될 임시저장",
      p_form_data: {},
    });
    if (draft2) createdDocs.push(draft2 as string);
    const { error: e6b } = await requester.sb.rpc("delete_approval_draft", {
      p_document_id: draft2,
    });
    check("임시저장은 삭제된다", !e6b, e6b?.message);
    if (!e6b) createdDocs.pop();

    console.log("\n[7] 최종승인자 미지정 시 상신 차단");
    await admin
      .from("approval_line_configs")
      .update({ step2_approver_id: null })
      .eq("document_type", TYPE);
    const { data: draft3 } = await requester.sb.rpc("save_approval_draft", {
      p_document_id: null,
      p_document_type: TYPE,
      p_title: "결재선 없는 임시저장",
      p_form_data: {},
    });
    check("결재선이 없어도 임시저장은 된다", !!draft3);
    if (draft3) createdDocs.push(draft3 as string);
    const { error: e7 } = await requester.sb.rpc("submit_approval_draft", {
      p_document_id: draft3,
    });
    check(
      "결재선이 없으면 상신에서 막힌다",
      !!e7 && e7.message.includes("최종 승인자"),
      e7 ? e7.message : "차단되지 않음!",
    );
  } finally {
    console.log("\n[정리]");
    if (createdDocs.length > 0) {
      await admin.from("approval_documents").delete().in("id", createdDocs);
      console.log(`  · 테스트 문서 ${createdDocs.length}건 삭제`);
    }
    await admin
      .from("approval_line_configs")
      .update({
        step2_approver_id: originalLine?.step2_approver_id ?? null,
        use_team_review: originalLine?.use_team_review ?? false,
      })
      .eq("document_type", TYPE);
    console.log("  · 결재라인 설정 원복 (승인자·팀장검토 스위치)");
    for (const id of authIds) {
      await admin.from("employees").update({ auth_user_id: null }).eq("auth_user_id", id);
      await admin.auth.admin.deleteUser(id);
    }
    console.log(`  · 임시 auth 계정 ${authIds.length}개 삭제`);
  }

  console.log(`\n결과: ${pass}건 통과 / ${fail}건 실패`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
