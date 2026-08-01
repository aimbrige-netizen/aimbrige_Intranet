/**
 * 스펙 13 자산·복지포인트 RLS·트리거·트랜잭션 e2e 검증 (마이그레이션 22).
 *
 *   npm run e2e:assets -- --yes
 *
 * 이 모듈에는 화면만 눌러봐서는 절대 안 걸리는 자리가 세 종류 있다.
 *
 *  (1) asset_loans는 status 컬럼이 없고 시각 컬럼의 조합으로 상태를 읽는다.
 *      그래서 본인이 loaned_at 한 칸만 채워 넣으면 "관리자가 승인한 대여"가
 *      그대로 만들어진다. RLS는 열 단위를 말하지 못하므로 컬럼 가드 트리거가
 *      유일한 방어선이고, 그 트리거가 INSERT·UPDATE 양쪽에 걸려 있어야 한다.
 *
 *  (2) 신청 취소. 처음 정책은 DELETE를 관리자 전용으로 뒀는데, 그러면 화면의
 *      '취소' 버튼이 오류가 아니라 **0행 삭제로 조용히 실패**한다 — 사용자에게는
 *      "이미 처리된 신청입니다"라는 엉뚱한 안내가 뜨고 신청은 그대로 남는다.
 *      그래서 '되어야 하는 방향'인데도 여기서 반드시 찌른다.
 *
 *  (3) 승인은 두 곳을 함께 바꾼다(대여↔자산상태, 신청↔잔액). 한쪽만 바뀐 상태는
 *      화면 어디를 봐도 정상으로 보인다. 특히 **실패했을 때 아무것도 안 바뀌었는지**를
 *      확인해야 한다 — 부분 적용이 남으면 잔액이 왜 그 값인지 설명할 수 없다.
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
      "이 스크립트는 실제 DB에 자산·대여·복지포인트 행을 만들고 데모 직원 역할을",
      "잠시 바꿉니다(끝나면 전부 원복).",
      "실행하려면: npm run e2e:assets -- --yes",
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

/** 트리거가 raise한 우리 문장인지까지 본다. 제약 위반으로 우연히 막힌 것과 구분된다 */
const raised = (error: { message: string } | null | undefined, needle: string) =>
  Boolean(error && error.message.includes(needle));

/**
 * 정책에 막힌 쓰기.
 *
 * RLS에 걸린 UPDATE·DELETE는 오류가 아니라 **0행 처리**로 끝난다(그게 이 모듈에서
 * 취소 버튼이 조용히 실패했던 이유다). 권한 자체가 없으면 오류로 오므로 둘 다 받는다.
 * 다만 "막혔다"는 것만으로는 부족해서, 호출한 쪽에서 값이 그대로인지 함께 본다.
 */
const noRows = (res: { data: unknown[] | null; error: unknown | null }) =>
  Boolean(res.error) || res.data?.length === 0;

/**
 * 복지포인트 검증용 연도.
 *
 * grant_welfare_points()는 전 재직자에게 행을 만들기 때문에 실사용 연도를 쓰면
 * 실제 지급액을 덮어쓴다. 1900년은 어떤 화면도 조회하지 않고, 정리할 때
 * "이 연도 전체"를 지워도 남의 데이터를 건드리지 않는다.
 */
const YEAR = 1900;
/** 지급 내역이 없는 해 — 승인이 실패해야 하는 쪽 */
const MISSING_YEAR = 1899;

const stamp = Date.now();
const INACTIVE_EMAIL = "e2e-inactive@demo.aimbrige.kr";

function addDays(delta: number) {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

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

interface LoanRow {
  id: string;
  employee_id: string;
  requested_at: string;
  loaned_at: string | null;
  expected_return_date: string | null;
  return_requested_at: string | null;
  returned_at: string | null;
  rejected_at: string | null;
  note: string | null;
}

async function loanRow(id: string): Promise<LoanRow | null> {
  const { data } = await admin
    .from("asset_loans")
    .select(
      "id, employee_id, requested_at, loaned_at, expected_return_date, return_requested_at, returned_at, rejected_at, note",
    )
    .eq("id", id)
    .maybeSingle();
  return (data as LoanRow | null) ?? null;
}

async function assetStatus(id: string): Promise<string | null> {
  const { data } = await admin
    .from("assets")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  return (data as { status: string } | null)?.status ?? null;
}

async function balanceOf(employeeId: string, year: number) {
  const { data } = await admin
    .from("welfare_point_balances")
    .select("granted_points, used_points")
    .eq("employee_id", employeeId)
    .eq("year", year)
    .maybeSingle();
  if (!data) return null;
  const row = data as { granted_points: number | string; used_points: number | string };
  return { granted: Number(row.granted_points), used: Number(row.used_points) };
}

/** 서버 시각으로 덮였는지 — 5분 안쪽이면 now()로 본다 */
const isFresh = (ts: string | null) =>
  Boolean(ts) && Math.abs(Date.now() - Date.parse(ts!)) < 5 * 60 * 1000;

async function main() {
  // 이수연(일반직원) · 정도원(무관한 다른 팀 일반직원)
  const MEMBER = "sylee@demo.aimbrige.kr";
  const OTHER = "dwjung@demo.aimbrige.kr";
  // 김지훈 — 아래에서 잠시 system_admin으로 올렸다가 원복한다
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
  const other = await emp(OTHER);
  const adminEmp = await emp(ADMIN);

  const { data: roles } = await admin.from("roles").select("id, name");
  const roleId = (name: string) => {
    const found = (roles ?? []).find((r: { name: string }) => r.name === name);
    if (!found) throw new Error(`역할 '${name}' 이 없습니다.`);
    return (found as { id: string }).id;
  };

  const authIds: string[] = [];
  const assetIds: string[] = [];
  let inactiveId: string | null = null;

  try {
    // ── 준비 ────────────────────────────────────────────────────────
    const { data: assets, error: assetError } = await admin
      .from("assets")
      .insert([
        { name: "[e2e] 노트북 A", asset_type: "노트북", serial_number: `E2E-A-${stamp}` },
        { name: "[e2e] 모니터 B", asset_type: "모니터", serial_number: `E2E-B-${stamp}` },
        { name: "[e2e] 검사장비 C", asset_type: "기타", serial_number: `E2E-C-${stamp}` },
      ])
      .select("id, name");
    if (assetError || !assets) throw new Error(`자산 생성 실패: ${assetError?.message}`);

    const assetOf = (name: string) => {
      const found = (assets as { id: string; name: string }[]).find((a) => a.name === name);
      if (!found) throw new Error(`자산 '${name}' 생성 결과가 없습니다.`);
      assetIds.push(found.id);
      return found.id;
    };
    const assetA = assetOf("[e2e] 노트북 A");
    const assetB = assetOf("[e2e] 모니터 B");
    const assetC = assetOf("[e2e] 검사장비 C");

    // 일괄 지급이 재직자만 고르는지 보려면 재직자가 아닌 사람이 하나 필요하다.
    // 이전 실행이 중간에 끊겼을 수 있어 먼저 지우고 만든다.
    await admin.from("employees").delete().eq("email", INACTIVE_EMAIL);
    const { data: inactive, error: inactiveError } = await admin
      .from("employees")
      .insert({
        email: INACTIVE_EMAIL,
        name: "[e2e] 퇴사자",
        role_id: roleId("employee"),
        employment_status: "terminated",
      })
      .select("id")
      .single();
    if (inactiveError || !inactive) {
      throw new Error(`퇴사자 계정 생성 실패: ${inactiveError?.message}`);
    }
    inactiveId = (inactive as { id: string }).id;

    // 관리자 승격은 클라이언트를 만들기 전에 — is_system_admin()은 호출 시점에
    // DB를 읽지만, 순서를 헷갈리지 않도록 여기서 한 번에 끝낸다
    await admin
      .from("employees")
      .update({ role_id: roleId("system_admin") })
      .eq("email", ADMIN);

    const memberUser = await clientFor(MEMBER);
    const otherUser = await clientFor(OTHER);
    const adminUser = await clientFor(ADMIN);
    authIds.push(memberUser.authId, otherUser.authId, adminUser.authId);

    // ── [1] 대여 신청 — 컬럼 가드 (INSERT) ──────────────────────────
    console.log("\n[1] asset_loans 컬럼 가드 — INSERT");

    const forgeLoaned = await memberUser.sb
      .from("asset_loans")
      .insert({
        asset_id: assetA,
        employee_id: member.id,
        loaned_at: new Date().toISOString(),
      })
      .select("id");
    check(
      "★ 신청하면서 loaned_at을 채워 '승인된 대여'를 지어낼 수 없다",
      raised(forgeLoaned.error, "대여 신청에는 승인·반납 정보를 넣을 수 없습니다"),
      forgeLoaned.error ? forgeLoaned.error.message : "그대로 들어갔다",
    );

    const forgeReturned = await memberUser.sb
      .from("asset_loans")
      .insert({
        asset_id: assetA,
        employee_id: member.id,
        returned_at: new Date().toISOString(),
      })
      .select("id");
    check(
      "신청에 returned_at을 넣을 수 없다",
      raised(forgeReturned.error, "대여 신청에는 승인·반납 정보를 넣을 수 없습니다"),
      forgeReturned.error ? forgeReturned.error.message : "그대로 들어갔다",
    );

    const forgeRejected = await memberUser.sb
      .from("asset_loans")
      .insert({
        asset_id: assetA,
        employee_id: member.id,
        rejected_at: new Date().toISOString(),
      })
      .select("id");
    check(
      "신청에 rejected_at을 넣을 수 없다",
      raised(forgeRejected.error, "대여 신청에는 승인·반납 정보를 넣을 수 없습니다"),
      forgeRejected.error ? forgeRejected.error.message : "그대로 들어갔다",
    );

    const forgeReturnReq = await memberUser.sb
      .from("asset_loans")
      .insert({
        asset_id: assetA,
        employee_id: member.id,
        return_requested_at: new Date().toISOString(),
      })
      .select("id");
    check(
      "신청에 return_requested_at을 넣을 수 없다",
      raised(forgeReturnReq.error, "대여 신청에는 승인·반납 정보를 넣을 수 없습니다"),
      forgeReturnReq.error ? forgeReturnReq.error.message : "그대로 들어갔다",
    );

    // 정상 신청 — 신청 시각을 과거로, 메모를 임의로 적어 보낸다
    const requestA = await memberUser.sb
      .from("asset_loans")
      .insert({
        asset_id: assetA,
        employee_id: member.id,
        requested_at: "2000-01-01T00:00:00Z",
        expected_return_date: addDays(14),
        note: "관리자 메모 자리를 내가 채운다",
      })
      .select("id")
      .single();
    check("본인 이름으로 대여를 신청한다", !requestA.error, requestA.error?.message);
    const loanA = (requestA.data as { id: string } | null)?.id;
    if (!loanA) throw new Error("대여 신청이 만들어지지 않아 이후 검증을 할 수 없습니다.");

    const afterRequest = await loanRow(loanA);
    check(
      "★ 신청 시각을 과거로 적어도 서버 시각으로 덮인다",
      isFresh(afterRequest?.requested_at ?? null),
      `저장된 값 ${afterRequest?.requested_at}`,
    );
    check(
      "신청에 적어 보낸 note는 남지 않는다 (관리자 반려 사유 칸이다)",
      afterRequest?.note === null,
      `저장된 값 ${afterRequest?.note}`,
    );

    // ── [2] 대여 신청 — 컬럼 가드 (UPDATE) ──────────────────────────
    console.log("\n[2] asset_loans 컬럼 가드 — UPDATE");

    const selfApprove = await memberUser.sb
      .from("asset_loans")
      .update({ loaned_at: new Date().toISOString() })
      .eq("id", loanA)
      .select("id");
    check(
      "★ 본인이 자기 신청을 loaned_at으로 승인할 수 없다",
      raised(selfApprove.error, "대여 승인·반납 처리는 관리자만 할 수 있습니다"),
      selfApprove.error ? selfApprove.error.message : "승인됐다",
    );

    const selfReturn = await memberUser.sb
      .from("asset_loans")
      .update({ returned_at: new Date().toISOString() })
      .eq("id", loanA)
      .select("id");
    check(
      "본인이 returned_at을 직접 채울 수 없다",
      raised(selfReturn.error, "대여 승인·반납 처리는 관리자만 할 수 있습니다"),
      selfReturn.error ? selfReturn.error.message : "저장됐다",
    );

    const selfReject = await memberUser.sb
      .from("asset_loans")
      .update({ rejected_at: new Date().toISOString() })
      .eq("id", loanA)
      .select("id");
    check(
      "본인이 rejected_at을 직접 채울 수 없다",
      raised(selfReject.error, "대여 승인·반납 처리는 관리자만 할 수 있습니다"),
      selfReject.error ? selfReject.error.message : "저장됐다",
    );

    const selfExtend = await memberUser.sb
      .from("asset_loans")
      .update({ expected_return_date: addDays(400) })
      .eq("id", loanA)
      .select("id");
    check(
      "본인이 반납 예정일을 늘려 잡을 수 없다",
      raised(selfExtend.error, "대여 승인·반납 처리는 관리자만 할 수 있습니다"),
      selfExtend.error ? selfExtend.error.message : "연장됐다",
    );

    const selfNote = await memberUser.sb
      .from("asset_loans")
      .update({ note: "반려 사유를 내가 고쳐 쓴다" })
      .eq("id", loanA)
      .select("id");
    check(
      "★ 본인이 note를 바꿀 수 없다 (관리자 반려 사유 칸)",
      raised(selfNote.error, "대여 승인·반납 처리는 관리자만 할 수 있습니다"),
      selfNote.error ? selfNote.error.message : "덮어썼다",
    );

    const earlyReturn = await memberUser.sb
      .from("asset_loans")
      .update({ return_requested_at: new Date().toISOString() })
      .eq("id", loanA)
      .select("id");
    check(
      "승인 전에는 반납 요청을 남길 수 없다",
      raised(earlyReturn.error, "대여 승인 전에는 반납 요청을 할 수 없습니다"),
      earlyReturn.error ? earlyReturn.error.message : "저장됐다",
    );

    // ── [3] 부분 유니크 인덱스 ──────────────────────────────────────
    console.log("\n[3] 부분 유니크 인덱스");

    const doubleRequest = await memberUser.sb
      .from("asset_loans")
      .insert({ asset_id: assetA, employee_id: member.id })
      .select("id");
    check(
      "같은 사람이 같은 자산에 대기 신청을 둘 쌓을 수 없다 (one_pending_per_person)",
      doubleRequest.error?.code === "23505",
      doubleRequest.error ? doubleRequest.error.message : "두 건이 쌓였다",
    );

    const otherRequest = await otherUser.sb
      .from("asset_loans")
      .insert({ asset_id: assetA, employee_id: other.id })
      .select("id")
      .single();
    check(
      "다른 사람은 같은 자산에 신청할 수 있다 (여럿 신청하고 관리자가 고른다)",
      !otherRequest.error,
      otherRequest.error?.message,
    );
    const loanAOther = (otherRequest.data as { id: string } | null)?.id ?? null;

    // ── [4] 승인 RPC ───────────────────────────────────────────────
    console.log("\n[4] 승인 RPC (approve_asset_loan)");

    const memberApprove = await memberUser.sb.rpc("approve_asset_loan", {
      p_loan_id: loanA,
      p_expected_return_date: null,
    });
    check(
      "일반직원은 approve_asset_loan을 호출할 수 없다",
      raised(memberApprove.error, "시스템 관리자만"),
      memberApprove.error ? memberApprove.error.message : "승인됐다",
    );

    const approve = await adminUser.sb.rpc("approve_asset_loan", {
      p_loan_id: loanA,
      p_expected_return_date: addDays(14),
    });
    check("관리자는 대여를 승인한다", !approve.error, approve.error?.message);

    const approved = await loanRow(loanA);
    const statusAfterApprove = await assetStatus(assetA);
    check(
      "★ 승인은 loaned_at과 assets.status='loaned'를 함께 바꾼다",
      Boolean(approved?.loaned_at) && statusAfterApprove === "loaned",
      `loaned_at=${approved?.loaned_at} status=${statusAfterApprove}`,
    );

    if (loanAOther) {
      const secondApprove = await adminUser.sb.rpc("approve_asset_loan", {
        p_loan_id: loanAOther,
        p_expected_return_date: null,
      });
      check(
        "이미 대여중인 자산의 두 번째 신청은 승인되지 않는다",
        raised(secondApprove.error, "지금 대여할 수 없는 자산입니다"),
        secondApprove.error ? secondApprove.error.message : "둘 다 승인됐다",
      );

      const stillPending = await loanRow(loanAOther);
      check(
        "승인 실패한 신청은 대기 상태 그대로다",
        stillPending?.loaned_at === null && stillPending?.rejected_at === null,
        JSON.stringify(stillPending),
      );
    }

    /*
     * 인덱스 자체를 찌른다. RPC를 우회해 '대여중' 행을 하나 더 만들려는 시도라
     * 트리거를 통과할 수 있는 관리자로 넣어야 인덱스까지 도달한다.
     * (asset_loans_insert 정책은 관리자에게도 남의 이름으로 넣는 것을 허용하지
     *  않으므로 관리자 본인 이름으로 넣는다)
     */
    const dupActive = await adminUser.sb
      .from("asset_loans")
      .insert({
        asset_id: assetA,
        employee_id: adminEmp.id,
        loaned_at: new Date().toISOString(),
      })
      .select("id");
    check(
      "한 자산에 '대여중'인 행이 둘 생길 수 없다 (asset_loans_one_active)",
      dupActive.error?.code === "23505",
      dupActive.error ? dupActive.error.message : "대여자가 둘인 자산이 만들어졌다",
    );

    // ── [5] 반납 ───────────────────────────────────────────────────
    console.log("\n[5] 반납 요청과 반납 확인");

    const returnRequest = await memberUser.sb
      .from("asset_loans")
      .update({ return_requested_at: "2000-01-01T00:00:00Z" })
      .eq("id", loanA)
      .select("id");
    check(
      "승인된 뒤에는 본인이 반납 요청을 남길 수 있다 (스펙 3.2)",
      returnRequest.data?.length === 1,
      returnRequest.error?.message,
    );

    const returnRequested = await loanRow(loanA);
    check(
      "반납 요청 시각도 서버 시각으로 덮인다",
      isFresh(returnRequested?.return_requested_at ?? null),
      `저장된 값 ${returnRequested?.return_requested_at}`,
    );

    const confirm = await adminUser.sb.rpc("confirm_asset_return", { p_loan_id: loanA });
    const returned = await loanRow(loanA);
    const statusAfterReturn = await assetStatus(assetA);
    check(
      "★ 반납 확인은 returned_at과 assets.status='available'을 함께 바꾼다",
      !confirm.error && Boolean(returned?.returned_at) && statusAfterReturn === "available",
      `${confirm.error?.message ?? ""} returned_at=${returned?.returned_at} status=${statusAfterReturn}`,
    );

    // 고장나서 빼둔 장비 — 반납 확인이 이 상태를 되돌리면 안 된다
    const loanCRequest = await memberUser.sb
      .from("asset_loans")
      .insert({ asset_id: assetC, employee_id: member.id })
      .select("id")
      .single();
    const loanC = (loanCRequest.data as { id: string } | null)?.id;
    if (!loanC) throw new Error(`검사장비 신청 실패: ${loanCRequest.error?.message}`);

    const approveC = await adminUser.sb.rpc("approve_asset_loan", {
      p_loan_id: loanC,
      p_expected_return_date: null,
    });
    if (approveC.error) throw new Error(`검사장비 승인 실패: ${approveC.error.message}`);

    const toMaintenance = await adminUser.sb
      .from("assets")
      .update({ status: "maintenance" })
      .eq("id", assetC)
      .select("id");
    check(
      "관리자는 자산을 수리중으로 표시할 수 있다",
      toMaintenance.data?.length === 1,
      toMaintenance.error?.message,
    );

    const confirmC = await adminUser.sb.rpc("confirm_asset_return", { p_loan_id: loanC });
    const returnedC = await loanRow(loanC);
    const statusC = await assetStatus(assetC);
    check(
      "★ 수리중 자산은 반납 확인해도 대여가능으로 돌아오지 않는다",
      !confirmC.error && Boolean(returnedC?.returned_at) && statusC === "maintenance",
      `${confirmC.error?.message ?? ""} status=${statusC}`,
    );

    // ── [6] 신청 취소 (DELETE 정책) ────────────────────────────────
    console.log("\n[6] 신청 취소 — DELETE 정책");

    const cancelable = await memberUser.sb
      .from("asset_loans")
      .insert({ asset_id: assetB, employee_id: member.id })
      .select("id")
      .single();
    const loanB = (cancelable.data as { id: string } | null)?.id;
    if (!loanB) throw new Error(`취소 검증용 신청 실패: ${cancelable.error?.message}`);

    const cancel = await memberUser.sb
      .from("asset_loans")
      .delete()
      .eq("id", loanB)
      .select("id");
    const cancelGone = (await loanRow(loanB)) === null;
    check(
      "★ 본인은 대기 중인 자기 신청을 취소할 수 있다 (0행 삭제로 조용히 실패하면 안 된다)",
      cancel.data?.length === 1 && cancelGone,
      cancel.error
        ? cancel.error.message
        : `삭제 ${cancel.data?.length ?? 0}행 / 남아있음=${!cancelGone}`,
    );

    const cancelApproved = await memberUser.sb
      .from("asset_loans")
      .delete()
      .eq("id", loanA)
      .select("id");
    check(
      "승인된 대여는 본인이 지울 수 없다 (이력이다)",
      noRows(cancelApproved) && (await loanRow(loanA)) !== null,
      cancelApproved.error ? cancelApproved.error.message : "지워졌다",
    );

    if (loanAOther) {
      const cancelOther = await memberUser.sb
        .from("asset_loans")
        .delete()
        .eq("id", loanAOther)
        .select("id");
      check(
        "남의 신청은 지울 수 없다",
        noRows(cancelOther) && (await loanRow(loanAOther)) !== null,
        cancelOther.error ? cancelOther.error.message : "지워졌다",
      );
    }

    // ── [7] list_assets() — 대여자 이름 공개 범위 ──────────────────
    console.log("\n[7] list_assets() — 스펙 3.1 현재 대여자");

    const loanBOther = await otherUser.sb
      .from("asset_loans")
      .insert({ asset_id: assetB, employee_id: other.id })
      .select("id")
      .single();
    const loanBId = (loanBOther.data as { id: string } | null)?.id;
    if (!loanBId) throw new Error(`대여자 표시 검증용 신청 실패: ${loanBOther.error?.message}`);

    const approveB = await adminUser.sb.rpc("approve_asset_loan", {
      p_loan_id: loanBId,
      p_expected_return_date: addDays(7),
    });
    if (approveB.error) throw new Error(`모니터 승인 실패: ${approveB.error.message}`);

    const listed = await memberUser.sb.rpc("list_assets");
    const rowB = ((listed.data ?? []) as { id: string; holder_name: string | null }[]).find(
      (r) => r.id === assetB,
    );
    check(
      "일반직원도 남의 대여자 이름을 볼 수 있다 (스펙 3.1)",
      rowB?.holder_name === other.name,
      listed.error ? listed.error.message : `holder_name=${rowB?.holder_name}`,
    );

    const peekLoan = await memberUser.sb
      .from("asset_loans")
      .select("id")
      .eq("id", loanBId);
    check(
      "그래도 asset_loans에서 남의 대여 행은 보이지 않는다",
      peekLoan.data?.length === 0,
      `보임 ${peekLoan.data?.length ?? 0}건`,
    );

    // ── [8] 복지포인트 잔액 ────────────────────────────────────────
    console.log("\n[8] welfare_point_balances — 쓰기 정책이 없다");

    const memberGrant = await memberUser.sb.rpc("grant_welfare_points", {
      p_year: YEAR,
      p_points: 100000,
    });
    check(
      "일반직원은 grant_welfare_points를 호출할 수 없다",
      raised(memberGrant.error, "시스템 관리자만"),
      memberGrant.error ? memberGrant.error.message : "지급됐다",
    );

    const grant1 = await adminUser.sb.rpc("grant_welfare_points", {
      p_year: YEAR,
      p_points: 100000,
    });
    check(
      "관리자는 연초 일괄 지급을 할 수 있다",
      !grant1.error && Number(grant1.data ?? 0) > 0,
      grant1.error ? grant1.error.message : `${grant1.data}명`,
    );

    const grant2 = await adminUser.sb.rpc("grant_welfare_points", {
      p_year: YEAR,
      p_points: 100000,
    });
    const afterTwice = await balanceOf(member.id, YEAR);
    check(
      "★ 일괄 지급을 두 번 눌러도 지급액이 두 배가 되지 않는다 (더하기가 아니라 설정)",
      !grant2.error && afterTwice?.granted === 100000,
      grant2.error ? grant2.error.message : `granted=${afterTwice?.granted}`,
    );

    check(
      "일괄 지급 대상은 재직자뿐이다 (퇴사자에게는 잔액 행이 생기지 않는다)",
      (await balanceOf(inactiveId, YEAR)) === null,
      "퇴사자에게도 지급됐다",
    );

    const selfBalance = await memberUser.sb
      .from("welfare_point_balances")
      .update({ granted_points: 9999999 })
      .eq("employee_id", member.id)
      .eq("year", YEAR)
      .select("employee_id");
    const afterSelfWrite = await balanceOf(member.id, YEAR);
    check(
      "★ 일반직원은 자기 잔액을 직접 고칠 수 없다 (쓰기 정책이 없다)",
      noRows(selfBalance) && afterSelfWrite?.granted === 100000,
      selfBalance.error
        ? selfBalance.error.message
        : `granted=${afterSelfWrite?.granted}`,
    );

    const adminBalance = await adminUser.sb
      .from("welfare_point_balances")
      .update({ granted_points: 9999999 })
      .eq("employee_id", member.id)
      .eq("year", YEAR)
      .select("employee_id");
    const afterAdminWrite = await balanceOf(member.id, YEAR);
    check(
      "★ 관리자도 잔액을 직접 고칠 수 없다 (함수로만 움직인다)",
      noRows(adminBalance) && afterAdminWrite?.granted === 100000,
      adminBalance.error
        ? adminBalance.error.message
        : `granted=${afterAdminWrite?.granted}`,
    );

    const peekBalance = await otherUser.sb
      .from("welfare_point_balances")
      .select("employee_id")
      .eq("employee_id", member.id)
      .eq("year", YEAR);
    check(
      "남의 잔액은 조회할 수 없다",
      peekBalance.data?.length === 0,
      `보임 ${peekBalance.data?.length ?? 0}건`,
    );

    // ── [9] 복지포인트 신청 ────────────────────────────────────────
    console.log("\n[9] welfare_point_requests");

    /*
     * CHECK(welfare_requests_processed_consistent)까지 만족시켜 보낸다.
     * 그래야 막는 주체가 with check (status='pending')임이 분명해진다 —
     * 제약 위반으로 우연히 막힌 것과 구분한다.
     */
    const forgeApproved = await memberUser.sb
      .from("welfare_point_requests")
      .insert({
        employee_id: member.id,
        year: YEAR,
        amount: 10000,
        purpose: "승인 상태로 밀어넣기",
        status: "approved",
        processed_at: new Date().toISOString(),
        processed_by: member.id,
      })
      .select("id");
    check(
      "★ 일반직원은 status='approved'로 신청을 넣을 수 없다",
      Boolean(forgeApproved.error),
      forgeApproved.error
        ? `code=${forgeApproved.error.code}`
        : "승인된 신청이 그대로 들어갔다",
    );

    const request = await memberUser.sb
      .from("welfare_point_requests")
      .insert({
        employee_id: member.id,
        year: YEAR,
        amount: 30000,
        purpose: "e2e 도서 구입",
      })
      .select("id")
      .single();
    check("본인 이름으로 사용 신청을 넣는다", !request.error, request.error?.message);
    const requestId = (request.data as { id: string } | null)?.id;
    if (!requestId) throw new Error("사용 신청이 만들어지지 않아 이후 검증을 할 수 없습니다.");

    const selfApproveReq = await memberUser.sb
      .from("welfare_point_requests")
      .update({
        status: "approved",
        processed_at: new Date().toISOString(),
        processed_by: member.id,
      })
      .eq("id", requestId)
      .select("id");
    const { data: stillPendingReq } = await admin
      .from("welfare_point_requests")
      .select("status")
      .eq("id", requestId)
      .single();
    check(
      "★ 본인이 자기 신청을 승인 상태로 바꿀 수 없다 (UPDATE 정책이 없다)",
      noRows(selfApproveReq) &&
        (stillPendingReq as { status: string } | null)?.status === "pending",
      selfApproveReq.error
        ? selfApproveReq.error.message
        : `status=${(stillPendingReq as { status: string } | null)?.status}`,
    );

    const peekRequest = await otherUser.sb
      .from("welfare_point_requests")
      .select("id")
      .eq("id", requestId);
    check(
      "남의 신청은 조회할 수 없다",
      peekRequest.data?.length === 0,
      `보임 ${peekRequest.data?.length ?? 0}건`,
    );

    const throwaway = await memberUser.sb
      .from("welfare_point_requests")
      .insert({
        employee_id: member.id,
        year: YEAR,
        amount: 5000,
        purpose: "취소할 신청",
      })
      .select("id")
      .single();
    const throwawayId = (throwaway.data as { id: string } | null)?.id;
    if (!throwawayId) throw new Error(`취소 검증용 신청 실패: ${throwaway.error?.message}`);

    const cancelRequest = await memberUser.sb
      .from("welfare_point_requests")
      .delete()
      .eq("id", throwawayId)
      .select("id");
    check(
      "대기 중인 자기 신청은 취소할 수 있다",
      cancelRequest.data?.length === 1,
      cancelRequest.error ? cancelRequest.error.message : "0행 삭제",
    );

    // ── [10] 승인 트랜잭션 ─────────────────────────────────────────
    console.log("\n[10] 승인 트랜잭션 (approve_welfare_request · grant_welfare_points)");

    const memberApproveReq = await memberUser.sb.rpc("approve_welfare_request", {
      p_request_id: requestId,
    });
    check(
      "일반직원은 approve_welfare_request를 호출할 수 없다",
      raised(memberApproveReq.error, "시스템 관리자만"),
      memberApproveReq.error ? memberApproveReq.error.message : "승인됐다",
    );

    const approveReq = await adminUser.sb.rpc("approve_welfare_request", {
      p_request_id: requestId,
    });
    const { data: approvedReq } = await admin
      .from("welfare_point_requests")
      .select("status, processed_by")
      .eq("id", requestId)
      .single();
    const afterApprove = await balanceOf(member.id, YEAR);
    check(
      "★ 승인은 신청 status와 잔액 used_points를 함께 바꾼다",
      !approveReq.error &&
        (approvedReq as { status: string } | null)?.status === "approved" &&
        afterApprove?.used === 30000,
      `${approveReq.error?.message ?? ""} status=${
        (approvedReq as { status: string } | null)?.status
      } used=${afterApprove?.used}`,
    );

    const deleteProcessed = await memberUser.sb
      .from("welfare_point_requests")
      .delete()
      .eq("id", requestId)
      .select("id");
    const { count: survived } = await admin
      .from("welfare_point_requests")
      .select("id", { count: "exact", head: true })
      .eq("id", requestId);
    check(
      "처리된 신청은 지울 수 없다 (이력이다)",
      noRows(deleteProcessed) && survived === 1,
      deleteProcessed.error ? deleteProcessed.error.message : "지워졌다",
    );

    const overRequest = await memberUser.sb
      .from("welfare_point_requests")
      .insert({
        employee_id: member.id,
        year: YEAR,
        amount: 500000,
        purpose: "잔액을 넘는 신청",
      })
      .select("id")
      .single();
    const overId = (overRequest.data as { id: string } | null)?.id;
    if (!overId) throw new Error(`초과 신청 생성 실패: ${overRequest.error?.message}`);

    const approveOver = await adminUser.sb.rpc("approve_welfare_request", {
      p_request_id: overId,
    });
    check(
      "잔액을 넘는 신청은 승인되지 않는다",
      raised(approveOver.error, "잔여 포인트가 부족합니다"),
      approveOver.error ? approveOver.error.message : "승인됐다",
    );

    const { data: overAfter } = await admin
      .from("welfare_point_requests")
      .select("status")
      .eq("id", overId)
      .single();
    const afterFailure = await balanceOf(member.id, YEAR);
    check(
      "★ 승인이 실패하면 used_points도 status도 그대로다 (부분 적용이 남지 않는다)",
      afterFailure?.used === 30000 &&
        (overAfter as { status: string } | null)?.status === "pending",
      `used=${afterFailure?.used} status=${(overAfter as { status: string } | null)?.status}`,
    );

    const ghostYear = await memberUser.sb
      .from("welfare_point_requests")
      .insert({
        employee_id: member.id,
        year: MISSING_YEAR,
        amount: 1000,
        purpose: "지급 내역 없는 해",
      })
      .select("id")
      .single();
    const ghostId = (ghostYear.data as { id: string } | null)?.id;
    if (!ghostId) throw new Error(`미지급 연도 신청 생성 실패: ${ghostYear.error?.message}`);

    const approveGhost = await adminUser.sb.rpc("approve_welfare_request", {
      p_request_id: ghostId,
    });
    check(
      "지급 내역이 없는 해의 신청은 승인되지 않는다",
      raised(approveGhost.error, "지급 내역이 없어"),
      approveGhost.error ? approveGhost.error.message : "승인됐다",
    );

    const lowerGrant = await adminUser.sb.rpc("grant_welfare_points", {
      p_year: YEAR,
      p_points: 10000,
    });
    check(
      "이미 쓴 포인트보다 적게 지급할 수 없다 (잔여가 음수가 된다)",
      raised(lowerGrant.error, "지급액을 낮출 수 없습니다"),
      lowerGrant.error ? lowerGrant.error.message : "지급됐다",
    );

    const afterLowerGrant = await balanceOf(member.id, YEAR);
    check(
      "★ 실패한 일괄 지급은 기존 지급액을 건드리지 않는다",
      afterLowerGrant?.granted === 100000 && afterLowerGrant?.used === 30000,
      `granted=${afterLowerGrant?.granted} used=${afterLowerGrant?.used}`,
    );

    /*
     * 앱이 실제로 쓰는 select 문자열을 그대로 쏴 본다.
     *
     * 위 검증들은 테이블을 컬럼 목록으로만 조회해서 PostgREST 임베드를 한 번도
     * 안 탔다. 그래서 welfare_point_requests가 employees를 employee_id와
     * processed_by 두 갈래로 참조해 `employees!inner(name)`이
     *   Could not embed because more than one relationship was found
     * 로 죽는 걸, 51건이 전부 통과하는 동안 아무도 못 잡았다. 화면을 열어보고서야
     * 나왔다. 조회 계층의 문자열은 조회 계층대로 찔러야 한다.
     */
    console.log("\n[11] 앱 조회 계층의 임베드 (features/assets/data.ts와 같은 select)");

    const loanSelect = await memberUser.sb
      .from("asset_loans")
      .select(
        "id, asset_id, employee_id, requested_at, loaned_at, expected_return_date, return_requested_at, returned_at, rejected_at, note, assets!asset_id(name, asset_type), employees!employee_id(name)",
      )
      .limit(1);
    check(
      "★ 대여 목록 임베드가 모호하지 않다 (getLoans)",
      !loanSelect.error,
      loanSelect.error?.message ?? "",
    );

    const requestSelect = await memberUser.sb
      .from("welfare_point_requests")
      .select(
        "id, employee_id, year, amount, purpose, status, requested_at, processed_at, processed_by, reject_reason, employees:employee_id(name)",
      )
      .limit(1);
    check(
      "★ 복지포인트 신청 임베드가 모호하지 않다 (getWelfareRequests)",
      !requestSelect.error,
      requestSelect.error?.message ?? "",
    );

    // 고치기 전 형태가 여전히 죽는지도 본다 — 함정이 사라진 게 아님을 남겨둔다
    const ambiguous = await memberUser.sb
      .from("welfare_point_requests")
      .select("id, employees!inner(name)")
      .limit(1);
    check(
      "테이블 이름만 적은 임베드는 여전히 거부된다",
      Boolean(ambiguous.error),
      ambiguous.error ? "" : "모호한 임베드가 통과했다 — FK 구성이 바뀌었는지 확인 필요",
    );
  } finally {
    console.log("\n[정리]");

    // 자산을 지우면 asset_loans가 cascade로 함께 지워진다
    if (assetIds.length > 0) await admin.from("assets").delete().in("id", assetIds);
    await admin.from("assets").delete().like("name", "[e2e]%");
    console.log(`  · 자산·대여 이력 ${assetIds.length}건 삭제`);

    // 이 스크립트가 쓴 연도만 지운다 — 실사용 연도와 겹치지 않는다
    await admin
      .from("welfare_point_requests")
      .delete()
      .in("year", [MISSING_YEAR, YEAR]);
    await admin
      .from("welfare_point_balances")
      .delete()
      .in("year", [MISSING_YEAR, YEAR]);
    console.log(`  · ${YEAR}·${MISSING_YEAR}년 복지포인트 행 삭제`);

    if (inactiveId) await admin.from("employees").delete().eq("id", inactiveId);
    await admin.from("employees").delete().eq("email", INACTIVE_EMAIL);
    console.log("  · 임시 퇴사자 계정 삭제");

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
