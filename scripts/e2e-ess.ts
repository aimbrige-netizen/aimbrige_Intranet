/**
 * 스펙 13 ESS 3종(인사·급여·계약) RLS·가드·admin_save_payroll_slip() e2e 검증 (마이그레이션 30).
 *
 * ⚠ **마이그레이션 30(20260803000030_ess.sql) 적용 후 실행할 것** —
 *   적용 전에는 payroll_* / certificate_requests / employment_contracts 테이블이 없어 전부 실패한다.
 *
 *   npm run e2e:ess -- --yes
 *
 * 급여는 이 프로젝트의 최민감 데이터라 찔러야 하는 자리가 다섯 갈래로 갈린다.
 *
 *  (1) 급여 격리. payroll_* 세 테이블의 정책은 "본인 select + system_admin all"
 *      뿐이고 manager 정책은 의도적으로 없다 — 팀장(직속 부서장 포함)도 팀원
 *      급여를 못 본다. 직접 select·count 집계·items 조인(부모 slip exists)·
 *      employees 임베드까지 샐 수 있는 경로를 전부 0행으로 확인하고, 본인
 *      화면의 전제인 "항목 합계 = 명세 합계"도 수치로 맞춘다.
 *
 *  (2) 명세 등록 관문. 쓰기는 admin_save_payroll_slip()(definer) 한 곳이고
 *      첫 줄의 is_system_admin() 검사가 곧 권한이다. 비관리자 호출 차단·
 *      같은 달 재등록의 upsert 갱신·항목 하나가 틀리면 명세까지 통으로
 *      말리는 원자성(항목 전체 교체가 한 트랜잭션인 이유)을 본다.
 *
 *  (3) 증명서. 신청은 본인 명의로만(가드가 upsert의 INSERT 경로까지 이중),
 *      신청 시 실어 보낸 처리 정보는 무시되고 requested로 시작한다. 취소는
 *      requested만 DELETE, 상태 전이는 관리자의 requested→issued/rejected뿐
 *      이고 processed_at·processed_by는 서버 값으로 강제된다 — issued에서
 *      되돌리는 역전이는 가드가 막는다.
 *
 *  (4) 계약. 본인 select + 관리자 all. 파일 경로 첫 세그먼트가 스토리지 열람
 *      판정이라 경로가 남을 가리키면 가드가 거부하고, 대상 직원 변경도 불가.
 *
 *  (5) 컬럼 가드. 합계 3종은 항목에서 재계산되는 파생값 — 본인 UPDATE는
 *      0행, upsert의 INSERT 경로는 42501, 관리자의 직접 지정도 가드가 막고
 *      직접 INSERT는 0으로 강제된다. 항목을 직접 고치면 재계산 트리거가
 *      부모 합계를 따라 맞추는 것까지 수치로 본다.
 *
 * 이 스크립트가 만든 데이터는 전부 표식이 있다 — 증명서 purpose·계약 title은
 * [e2e] 접두사, 급여명세는 2099년 급여월 — finally에서 전부 지운다(항목은
 * cascade). 박민준을 잠시 system_admin으로 올렸다가 원복한다.
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
      "이 스크립트는 실제 DB에 [e2e] 증명서·계약과 2099년 급여명세를 만들고",
      "데모 직원 한 명(박민준)을 잠시 system_admin으로 올립니다(끝나면 전부 원복·삭제).",
      "마이그레이션 30 적용 후에만 동작합니다.",
      "실행하려면: npm run e2e:ess -- --yes",
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

/** 서버 시각으로 덮였는지 — 5분 안쪽이면 now()로 본다 */
const isFresh = (ts: string | null) =>
  Boolean(ts) && Math.abs(Date.now() - Date.parse(ts!)) < 5 * 60 * 1000;

/** 임베드가 비었는지 — 일대일(payroll_profiles)은 null, 일대다는 []로 온다 */
const embedEmpty = (v: unknown) =>
  v == null || (Array.isArray(v) && v.length === 0);

const stamp = Date.now();

/** 존재하지 않는 직원 — admin_save_payroll_slip()의 실재 검증을 찌르는 데 쓴다 */
const GHOST_ID = "00000000-0000-4000-8000-000000000000";

/** 급여월은 실데이터와 절대 안 겹치는 2099년으로 몬다 — 정리도 이 축으로 한다 */
const MONTH_A = "2099-01-01"; // 준비 단계에서 만드는 격리 검증용 명세
const MONTH_B = "2099-02-01"; // RPC 등록·재등록·원자성 검증용 명세
const MONTH_C_INPUT = "2099-03-15"; // 월 정규화 검증 — 15일을 넣어 1일로 접히는지
const MONTH_C = "2099-03-01";
const MONTH_D = "2099-04-01"; // 관리자 직접 INSERT 시 합계 0 강제 검증용

const PURPOSE_MAIN = `[e2e] 재직증명 ${stamp}`;
const PURPOSE_FORGE = `[e2e] 위조 신청 ${stamp}`;
const PURPOSE_FORGED_STATUS = `[e2e] 상태 위조 ${stamp}`;
const PURPOSE_ISSUE = `[e2e] 발급 흐름 ${stamp}`;
const PURPOSE_REJECT = `[e2e] 반려 흐름 ${stamp}`;

const TITLE_MAIN = `[e2e] 근로계약서 ${stamp}`;
const TITLE_BADPATH = `[e2e] 경로 위반 ${stamp}`;
const TITLE_NOSIGN = `[e2e] 서명일 누락 ${stamp}`;

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

interface SlipRow {
  id: string;
  employee_id: string;
  pay_month: string;
  pay_date: string;
  gross_total: number;
  deduction_total: number;
  net_total: number;
  memo: string | null;
}

/** 명세 행의 현재 상태 (admin — RLS 밖의 실측값) */
async function slipRow(id: string): Promise<SlipRow | null> {
  const { data } = await admin
    .from("payroll_slips")
    .select(
      "id, employee_id, pay_month, pay_date, gross_total, deduction_total, net_total, memo",
    )
    .eq("id", id)
    .maybeSingle();
  return (data as SlipRow | null) ?? null;
}

/** 직원·급여월로 명세 실측 (admin) — RPC의 월 정규화·upsert 검증에 쓴다 */
async function slipByMonth(employeeId: string, month: string): Promise<SlipRow | null> {
  const { data } = await admin
    .from("payroll_slips")
    .select(
      "id, employee_id, pay_month, pay_date, gross_total, deduction_total, net_total, memo",
    )
    .eq("employee_id", employeeId)
    .eq("pay_month", month)
    .maybeSingle();
  return (data as SlipRow | null) ?? null;
}

interface ItemRow {
  id: string;
  slip_id: string;
  kind: string;
  name: string;
  amount: number;
  sort: number;
}

/** 명세의 항목 실측 (admin) */
async function itemsOf(slipId: string): Promise<ItemRow[]> {
  const { data } = await admin
    .from("payroll_slip_items")
    .select("id, slip_id, kind, name, amount, sort")
    .eq("slip_id", slipId)
    .order("sort");
  return (data ?? []) as ItemRow[];
}

const sumBy = (items: { kind: string; amount: number }[], kind: string) =>
  items.filter((i) => i.kind === kind).reduce((acc, i) => acc + Number(i.amount), 0);

interface CertRow {
  id: string;
  employee_id: string;
  cert_type: string;
  purpose: string;
  status: string;
  requested_at: string;
  processed_at: string | null;
  processed_by: string | null;
  reject_reason: string | null;
}

/** 증명서 신청 행의 현재 상태 (admin) */
async function certRow(id: string): Promise<CertRow | null> {
  const { data } = await admin
    .from("certificate_requests")
    .select(
      "id, employee_id, cert_type, purpose, status, requested_at, processed_at, processed_by, reject_reason",
    )
    .eq("id", id)
    .maybeSingle();
  return (data as CertRow | null) ?? null;
}

interface ProfileRow {
  employee_id: string;
  pay_type: string;
  annual_salary: number | null;
  monthly_salary: number | null;
  fixed_allowance: number;
  note: string | null;
}

async function main() {
  const OWNER = "sylee@demo.aimbrige.kr"; // 이수연 — 급여 데이터의 당사자
  const MANAGER = "jhkim@demo.aimbrige.kr"; // 김지훈 — 이수연의 직속 부서장·팀장(role=manager)
  const PEER = "dwjung@demo.aimbrige.kr"; // 정도원 — 다른 본부의 무관한 동료
  const ADMIN = "mjpark@demo.aimbrige.kr"; // 박민준 — 아래에서 잠시 system_admin으로 올렸다가 원복

  const emp = async (email: string) => {
    const { data } = await admin
      .from("employees")
      .select("id, name, role_id")
      .eq("email", email)
      .single();
    if (!data) throw new Error(`${email} 직원 행이 없습니다. npm run seed:demo 먼저.`);
    return data as { id: string; name: string; role_id: string };
  };

  const owner = await emp(OWNER);
  await emp(MANAGER); // 직원 행 존재 확인 — 검증에는 managerUser 클라이언트만 쓴다
  const peer = await emp(PEER);
  const adminEmp = await emp(ADMIN);

  const { data: roles } = await admin.from("roles").select("id, name");
  const roleId = (name: string) => {
    const found = (roles ?? []).find((r: { name: string }) => r.name === name);
    if (!found) throw new Error(`역할 '${name}' 이 없습니다.`);
    return (found as { id: string }).id;
  };

  const authIds: string[] = [];
  let roleChanged = false;
  let prevProfile: ProfileRow | null = null;
  let profileTouched = false;

  try {
    // ── 준비 ────────────────────────────────────────────────────────
    // 이전 실행이 중간에 끊겼을 수 있어 표식이 있는 잔재를 먼저 지운다
    await admin
      .from("payroll_slips")
      .delete()
      .eq("employee_id", owner.id)
      .gte("pay_month", MONTH_A);
    await admin.from("certificate_requests").delete().like("purpose", "[e2e]%");
    await admin.from("employment_contracts").delete().like("title", "[e2e]%");

    // 급여상세 — 있으면 원복하려고 원본을 챙겨 두고 우리 값으로 덮는다
    const { data: existingProfile } = await admin
      .from("payroll_profiles")
      .select("employee_id, pay_type, annual_salary, monthly_salary, fixed_allowance, note")
      .eq("employee_id", owner.id)
      .maybeSingle();
    prevProfile = (existingProfile as ProfileRow | null) ?? null;
    const { error: profileError } = await admin.from("payroll_profiles").upsert({
      employee_id: owner.id,
      pay_type: "annual",
      annual_salary: 62000000,
      monthly_salary: null,
      fixed_allowance: 300000,
      note: "[e2e] 급여상세",
    });
    if (profileError) {
      throw new Error(
        `급여상세 준비 실패: ${profileError.message} — 마이그레이션 30이 적용됐는지 확인하세요.`,
      );
    }
    profileTouched = true;

    // 격리 검증용 명세 — service_role은 가드를 우회하지만 합계는 직접 쓰지
    // 않는다. 항목만 넣으면 재계산 트리거가 3종 합계를 만든다(그 자체가
    // service_role 경로의 재계산 검증이기도 하다).
    const { data: slipSeed, error: slipSeedError } = await admin
      .from("payroll_slips")
      .insert({ employee_id: owner.id, pay_month: MONTH_A, pay_date: "2099-01-25" })
      .select("id")
      .single();
    if (slipSeedError || !slipSeed) {
      throw new Error(`명세 준비 실패: ${slipSeedError?.message}`);
    }
    const slip1Id = (slipSeed as { id: string }).id;
    const { error: itemSeedError } = await admin.from("payroll_slip_items").insert([
      { slip_id: slip1Id, kind: "payment", name: "기본급", amount: 3000000, sort: 1 },
      { slip_id: slip1Id, kind: "payment", name: "식대", amount: 200000, sort: 2 },
      { slip_id: slip1Id, kind: "deduction", name: "소득세", amount: 150000, sort: 3 },
    ]);
    if (itemSeedError) throw new Error(`항목 준비 실패: ${itemSeedError.message}`);

    // 관리자 승격은 클라이언트를 만들기 전에 — is_system_admin()은 호출 시점에
    // DB를 읽지만, 순서를 헷갈리지 않도록 여기서 한 번에 끝낸다
    await admin
      .from("employees")
      .update({ role_id: roleId("system_admin") })
      .eq("email", ADMIN);
    roleChanged = true;

    const ownerUser = await clientFor(OWNER);
    const managerUser = await clientFor(MANAGER);
    const peerUser = await clientFor(PEER);
    const adminUser = await clientFor(ADMIN);
    authIds.push(ownerUser.authId, managerUser.authId, peerUser.authId, adminUser.authId);

    // ── [1] 급여 격리 — 본인만, manager도 불가 ──────────────────────
    console.log("\n[1] 급여 격리 — 본인 조회 · 동료/manager 0행 · 우회 경로 차단");

    const ownProfile = await ownerUser.sb
      .from("payroll_profiles")
      .select("employee_id, pay_type, annual_salary, monthly_salary, fixed_allowance")
      .eq("employee_id", owner.id)
      .maybeSingle();
    const ownProfileRow = ownProfile.data as ProfileRow | null;
    check(
      "★ 본인 급여상세가 보인다 (연봉제 6,200만·고정수당 30만)",
      !ownProfile.error &&
        ownProfileRow?.pay_type === "annual" &&
        Number(ownProfileRow.annual_salary) === 62000000 &&
        Number(ownProfileRow.fixed_allowance) === 300000,
      ownProfile.error ? ownProfile.error.message : JSON.stringify(ownProfileRow ?? null),
    );

    interface OwnerSlipRow {
      id: string;
      pay_month: string;
      gross_total: number;
      deduction_total: number;
      net_total: number;
      items: { id: string; kind: string; name: string; amount: number }[];
    }
    const ownSlip = await ownerUser.sb
      .from("payroll_slips")
      .select(
        `id, pay_month, pay_date, gross_total, deduction_total, net_total,
         items:payroll_slip_items!slip_id(id, kind, name, amount)`,
      )
      .eq("employee_id", owner.id)
      .eq("pay_month", MONTH_A)
      .maybeSingle();
    const ownSlipRow = ownSlip.data as unknown as OwnerSlipRow | null;
    check(
      "★ 본인 명세가 보이고 항목이 임베드로 따라온다 (payroll_slip_items!slip_id — 규약 4)",
      !ownSlip.error && ownSlipRow?.id === slip1Id && ownSlipRow.items.length === 3,
      ownSlip.error ? ownSlip.error.message : JSON.stringify(ownSlipRow ?? null),
    );

    const ownGross = sumBy(ownSlipRow?.items ?? [], "payment");
    const ownDed = sumBy(ownSlipRow?.items ?? [], "deduction");
    check(
      "★ 항목 합계와 명세 합계가 일치한다 (지급 320만 · 공제 15만 · 실지급 305만)",
      ownGross === 3200000 &&
        ownDed === 150000 &&
        Number(ownSlipRow?.gross_total) === ownGross &&
        Number(ownSlipRow?.deduction_total) === ownDed &&
        Number(ownSlipRow?.net_total) === ownGross - ownDed,
      `항목 지급=${ownGross} 공제=${ownDed} / 명세 ${ownSlipRow?.gross_total}·${ownSlipRow?.deduction_total}·${ownSlipRow?.net_total}`,
    );

    const peerProfile = await peerUser.sb
      .from("payroll_profiles")
      .select("employee_id, annual_salary")
      .eq("employee_id", owner.id)
      .maybeSingle();
    check(
      "★ 동료에게는 급여상세가 0행이다",
      !peerProfile.error && peerProfile.data === null,
      peerProfile.error ? peerProfile.error.message : "동료 급여상세가 보인다",
    );

    const mgrProfile = await managerUser.sb
      .from("payroll_profiles")
      .select("employee_id, annual_salary")
      .eq("employee_id", owner.id)
      .maybeSingle();
    check(
      "★ 직속 부서장(manager)에게도 급여상세가 0행이다 — manager 정책은 의도적으로 없다",
      !mgrProfile.error && mgrProfile.data === null,
      mgrProfile.error ? mgrProfile.error.message : "팀장에게 팀원 급여상세가 보인다",
    );

    const peerSlip = await peerUser.sb
      .from("payroll_slips")
      .select("id, gross_total")
      .eq("id", slip1Id)
      .maybeSingle();
    check(
      "★ 동료에게는 명세가 0행이다 (id를 알아도)",
      !peerSlip.error && peerSlip.data === null,
      peerSlip.error ? peerSlip.error.message : "동료 명세가 보인다",
    );

    const mgrSlipCount = await managerUser.sb
      .from("payroll_slips")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", owner.id);
    check(
      "★ manager의 count 집계도 0이다 — 행 수조차 새지 않는다",
      !mgrSlipCount.error && (mgrSlipCount.count ?? -1) === 0,
      mgrSlipCount.error ? mgrSlipCount.error.message : `count=${mgrSlipCount.count}`,
    );

    const mgrItems = await managerUser.sb
      .from("payroll_slip_items")
      .select("id, name, amount")
      .eq("slip_id", slip1Id);
    check(
      "★ manager의 항목 직접 조회(조인 경로)도 0행이다 — 부모 slip 소유 검사를 못 지난다",
      !mgrItems.error && (mgrItems.data ?? []).length === 0,
      mgrItems.error ? mgrItems.error.message : `${mgrItems.data?.length}행 보임`,
    );

    const peerItemsJoin = await peerUser.sb
      .from("payroll_slip_items")
      .select("id, slip:payroll_slips!slip_id!inner(employee_id)")
      .eq("slip.employee_id", owner.id);
    check(
      "동료의 inner 조인 필터 경로도 0행이다",
      !peerItemsJoin.error && (peerItemsJoin.data ?? []).length === 0,
      peerItemsJoin.error ? peerItemsJoin.error.message : `${peerItemsJoin.data?.length}행 보임`,
    );

    interface MgrEmbedRow {
      id: string;
      payroll_profile: unknown;
      slips: unknown[] | null;
    }
    const mgrEmbed = await managerUser.sb
      .from("employees")
      .select(
        `id, name,
         payroll_profile:payroll_profiles!employee_id(pay_type, annual_salary),
         slips:payroll_slips!employee_id(id, gross_total)`,
      )
      .eq("id", owner.id)
      .maybeSingle();
    const mgrEmbedRow = mgrEmbed.data as unknown as MgrEmbedRow | null;
    check(
      "★ employees 임베드 우회도 빈손이다 — 직원 행은 보여도 급여 임베드는 비어 있다",
      !mgrEmbed.error &&
        mgrEmbedRow?.id === owner.id &&
        embedEmpty(mgrEmbedRow.payroll_profile) &&
        embedEmpty(mgrEmbedRow.slips),
      mgrEmbed.error ? mgrEmbed.error.message : JSON.stringify(mgrEmbedRow ?? null),
    );

    // ── [2] admin_save_payroll_slip() — 등록 관문 ───────────────────
    console.log("\n[2] admin_save_payroll_slip() — 원자성 · 재등록 · 권한");

    const ITEMS_A = [
      { kind: "payment", name: "기본급", amount: 3200000, sort: 1 },
      { kind: "payment", name: "식대", amount: 200000, sort: 2 },
      { kind: "deduction", name: "국민연금", amount: 144000, sort: 3 },
      { kind: "deduction", name: "소득세", amount: 98000, sort: 4 },
    ];

    const saveByMgr = await managerUser.sb.rpc("admin_save_payroll_slip", {
      p_employee_id: owner.id,
      p_pay_month: MONTH_B,
      p_pay_date: "2099-02-25",
      p_items: ITEMS_A,
    });
    check(
      "★ 비관리자(manager) 호출은 첫 줄에서 거부된다 — definer라 이 검사가 곧 권한이다",
      raised(saveByMgr.error, "급여명세 등록은 시스템 관리자만") &&
        (await slipByMonth(owner.id, MONTH_B)) === null,
      saveByMgr.error ? saveByMgr.error.message : "비관리자가 명세를 등록했다",
    );

    const saveA = await adminUser.sb.rpc("admin_save_payroll_slip", {
      p_employee_id: owner.id,
      p_pay_month: MONTH_B,
      p_pay_date: "2099-02-25",
      p_memo: "[e2e] 최초 등록",
      p_items: ITEMS_A,
    });
    const slip2Id = saveA.data as string | null;
    const slip2A = slip2Id ? await slipRow(slip2Id) : null;
    check(
      "★ 관리자 등록 — 명세 id가 돌아오고 3종 합계는 트리거가 항목에서 만든다",
      Boolean(slip2Id) &&
        slip2A?.pay_month === MONTH_B &&
        Number(slip2A.gross_total) === 3400000 &&
        Number(slip2A.deduction_total) === 242000 &&
        Number(slip2A.net_total) === 3158000 &&
        (await itemsOf(slip2Id!)).length === 4,
      saveA.error ? saveA.error.message : JSON.stringify(slip2A ?? null),
    );
    if (!slip2Id) throw new Error("관리자 명세 등록 실패로 이후 검증을 할 수 없습니다.");

    const ITEMS_B = [
      { kind: "payment", name: "기본급", amount: 3300000 },
      { kind: "deduction", name: "소득세", amount: 101000 },
    ];
    const saveB = await adminUser.sb.rpc("admin_save_payroll_slip", {
      p_employee_id: owner.id,
      p_pay_month: MONTH_B,
      p_pay_date: "2099-02-28",
      p_items: ITEMS_B,
    });
    const slip2B = await slipRow(slip2Id);
    check(
      "★ 같은 달 재등록은 같은 id로 갱신된다 — 지급일 갱신·항목 전체 교체·합계 재계산",
      saveB.data === slip2Id &&
        slip2B?.pay_date === "2099-02-28" &&
        Number(slip2B.gross_total) === 3300000 &&
        Number(slip2B.deduction_total) === 101000 &&
        Number(slip2B.net_total) === 3199000 &&
        (await itemsOf(slip2Id)).length === 2,
      saveB.error ? saveB.error.message : JSON.stringify(slip2B ?? null),
    );

    // 원자성 — 2번째 항목의 소수 금액에서 raise되면 1번째 항목 insert와
    // 명세 upsert(지급일 변경)까지 통으로 말려야 한다
    const saveBad = await adminUser.sb.rpc("admin_save_payroll_slip", {
      p_employee_id: owner.id,
      p_pay_month: MONTH_B,
      p_pay_date: "2099-02-05",
      p_items: [
        { kind: "payment", name: "기본급", amount: 1000000 },
        { kind: "payment", name: "수당", amount: 12.5 },
      ],
    });
    const slip2After = await slipRow(slip2Id);
    check(
      "★ 항목 하나가 틀리면 전체가 말린다 (원자성) — 지급일·항목·합계가 그대로다",
      raised(saveBad.error, "금액이 올바르지 않습니다") &&
        slip2After?.pay_date === "2099-02-28" &&
        Number(slip2After.gross_total) === 3300000 &&
        (await itemsOf(slip2Id)).length === 2,
      saveBad.error ? saveBad.error.message : "소수 금액이 통과했다",
    );

    const saveEmpty = await adminUser.sb.rpc("admin_save_payroll_slip", {
      p_employee_id: owner.id,
      p_pay_month: MONTH_D,
      p_pay_date: "2099-04-25",
      p_items: [],
    });
    check(
      "항목 없는 명세는 거부된다",
      raised(saveEmpty.error, "1건 이상 입력하세요"),
      saveEmpty.error ? saveEmpty.error.message : "빈 명세가 등록됐다",
    );

    const saveNonArray = await adminUser.sb.rpc("admin_save_payroll_slip", {
      p_employee_id: owner.id,
      p_pay_month: MONTH_D,
      p_pay_date: "2099-04-25",
      p_items: { kind: "payment", name: "기본급", amount: 1 },
    });
    check(
      "배열이 아닌 항목 페이로드는 거부된다",
      raised(saveNonArray.error, "항목 형식이 올바르지 않습니다"),
      saveNonArray.error ? saveNonArray.error.message : "객체 페이로드가 통과했다",
    );

    const saveGhost = await adminUser.sb.rpc("admin_save_payroll_slip", {
      p_employee_id: GHOST_ID,
      p_pay_month: MONTH_D,
      p_pay_date: "2099-04-25",
      p_items: ITEMS_B,
    });
    check(
      "존재하지 않는 직원의 명세는 거부된다",
      raised(saveGhost.error, "대상 직원을 찾을 수 없습니다"),
      saveGhost.error ? saveGhost.error.message : "유령 직원 명세가 등록됐다",
    );

    const saveMid = await adminUser.sb.rpc("admin_save_payroll_slip", {
      p_employee_id: owner.id,
      p_pay_month: MONTH_C_INPUT,
      p_pay_date: "2099-03-25",
      p_items: [{ kind: "payment", name: "기본급", amount: 3300000 }],
    });
    check(
      "급여월은 그 달 1일로 정규화된다 (15일을 넣어도 pay_month=1일)",
      Boolean(saveMid.data) && (await slipByMonth(owner.id, MONTH_C)) !== null,
      saveMid.error ? saveMid.error.message : "정규화된 명세가 없다",
    );

    // ── [3] 증명서 — 신청·취소·처리 전이 ────────────────────────────
    console.log("\n[3] 증명서 — 본인 신청 · 위조 차단 · 상태 전이 가드");

    const certMain = await ownerUser.sb
      .from("certificate_requests")
      .insert({ employee_id: owner.id, cert_type: "employment", purpose: PURPOSE_MAIN })
      .select("id, status, processed_at")
      .single();
    const certMainId = (certMain.data as { id: string } | null)?.id;
    const ownCertList = await ownerUser.sb
      .from("certificate_requests")
      .select("id, cert_type, purpose, status")
      .eq("employee_id", owner.id)
      .order("requested_at", { ascending: false });
    check(
      "★ 본인 신청이 만들어지고 본인 목록에 requested로 보인다",
      Boolean(certMainId) &&
        (certMain.data as { status: string } | null)?.status === "requested" &&
        (ownCertList.data ?? []).some(
          (r: { id: string; purpose: string }) =>
            r.id === certMainId && r.purpose === PURPOSE_MAIN,
        ),
      certMain.error?.message ?? ownCertList.error?.message ?? "",
    );
    if (!certMainId) throw new Error("증명서 신청 실패로 이후 검증을 할 수 없습니다.");

    const certForge = await ownerUser.sb
      .from("certificate_requests")
      .insert({ employee_id: peer.id, cert_type: "employment", purpose: PURPOSE_FORGE })
      .select("id");
    const { count: forgeCount } = await admin
      .from("certificate_requests")
      .select("id", { count: "exact", head: true })
      .eq("purpose", PURPOSE_FORGE);
    check(
      "★ 남의 이름으로 신청 위조는 막힌다 (가드 + with check 이중)",
      blocked(certForge.error, "본인 명의로만") && (forgeCount ?? -1) === 0,
      certForge.error ? certForge.error.message : "남의 명의로 신청됐다",
    );

    // 신청하면서 처리 정보를 실어 보낸다 — 가드가 전부 무시하고 requested로 시작해야 한다
    const certForgedStatus = await ownerUser.sb
      .from("certificate_requests")
      .insert({
        employee_id: owner.id,
        cert_type: "career",
        purpose: PURPOSE_FORGED_STATUS,
        status: "issued",
        processed_at: "2000-01-01T00:00:00Z",
        processed_by: owner.id,
      })
      .select("id, status, processed_at, processed_by")
      .single();
    const forgedRow = certForgedStatus.data as {
      id: string;
      status: string;
      processed_at: string | null;
      processed_by: string | null;
    } | null;
    check(
      "★ 신청에 실어 보낸 처리 정보(status=issued·처리자·시각)는 무시된다 — 항상 requested로 시작",
      forgedRow?.status === "requested" &&
        forgedRow.processed_at === null &&
        forgedRow.processed_by === null,
      certForgedStatus.error ? certForgedStatus.error.message : JSON.stringify(forgedRow),
    );

    const cancelRequested = forgedRow
      ? await ownerUser.sb
          .from("certificate_requests")
          .delete()
          .eq("id", forgedRow.id)
          .select("id")
      : null;
    check(
      "requested 상태 신청은 본인이 취소(DELETE)할 수 있다",
      Boolean(forgedRow) &&
        cancelRequested?.data?.length === 1 &&
        (await certRow(forgedRow!.id)) === null,
      cancelRequested?.error?.message ?? "취소가 0행으로 끝났다",
    );

    const certIssue = await ownerUser.sb
      .from("certificate_requests")
      .insert({ employee_id: owner.id, cert_type: "career", purpose: PURPOSE_ISSUE })
      .select("id")
      .single();
    const certIssueId = (certIssue.data as { id: string } | null)?.id;
    if (!certIssueId) throw new Error(`발급 흐름용 신청 생성 실패: ${certIssue.error?.message}`);

    // 발급 전이 — 처리 시각·처리자를 위조 값으로 실어 보내도 서버 값으로 덮인다
    const issue = await adminUser.sb
      .from("certificate_requests")
      .update({
        status: "issued",
        processed_at: "2000-01-01T00:00:00Z",
        processed_by: peer.id,
      })
      .eq("id", certIssueId)
      .select("status, processed_at, processed_by")
      .single();
    const issuedRow = issue.data as {
      status: string;
      processed_at: string | null;
      processed_by: string | null;
    } | null;
    check(
      "★ 관리자 발급 전이 — processed_at은 서버 시각, processed_by는 처리한 관리자로 강제",
      issuedRow?.status === "issued" &&
        isFresh(issuedRow.processed_at) &&
        issuedRow.processed_by === adminEmp.id,
      issue.error ? issue.error.message : JSON.stringify(issuedRow),
    );

    const cancelIssued = await ownerUser.sb
      .from("certificate_requests")
      .delete()
      .eq("id", certIssueId)
      .select("id");
    check(
      "★ 발급된 신청은 본인도 취소할 수 없다 — 취소는 requested만 (0행)",
      noRows(cancelIssued) && (await certRow(certIssueId)) !== null,
      cancelIssued.error ? cancelIssued.error.message : "발급 기록이 지워졌다",
    );

    const revertIssued = await adminUser.sb
      .from("certificate_requests")
      .update({ status: "requested" })
      .eq("id", certIssueId)
      .select("status");
    check(
      "★ issued→requested 역전이는 관리자도 못 한다 (가드)",
      raised(revertIssued.error, "이미 처리된 신청입니다") &&
        (await certRow(certIssueId))?.status === "issued",
      revertIssued.error ? revertIssued.error.message : "발급이 신청 상태로 되돌아갔다",
    );

    const certReject = await ownerUser.sb
      .from("certificate_requests")
      .insert({ employee_id: owner.id, cert_type: "employment", purpose: PURPOSE_REJECT })
      .select("id")
      .single();
    const certRejectId = (certReject.data as { id: string } | null)?.id;
    if (!certRejectId) throw new Error(`반려 흐름용 신청 생성 실패: ${certReject.error?.message}`);

    const rejectNoReason = await adminUser.sb
      .from("certificate_requests")
      .update({ status: "rejected" })
      .eq("id", certRejectId)
      .select("status");
    check(
      "반려에는 사유가 필수다",
      raised(rejectNoReason.error, "반려 사유를 입력하세요") &&
        (await certRow(certRejectId))?.status === "requested",
      rejectNoReason.error ? rejectNoReason.error.message : "사유 없는 반려가 통과했다",
    );

    const reject = await adminUser.sb
      .from("certificate_requests")
      .update({ status: "rejected", reject_reason: "용도가 불분명합니다" })
      .eq("id", certRejectId)
      .select("status, reject_reason, processed_at")
      .single();
    const rejectedRow = reject.data as {
      status: string;
      reject_reason: string | null;
      processed_at: string | null;
    } | null;
    check(
      "관리자 반려 전이 — 사유가 저장되고 처리 시각이 찍힌다",
      rejectedRow?.status === "rejected" &&
        rejectedRow.reject_reason === "용도가 불분명합니다" &&
        isFresh(rejectedRow.processed_at),
      reject.error ? reject.error.message : JSON.stringify(rejectedRow),
    );

    const selfIssue = await ownerUser.sb
      .from("certificate_requests")
      .update({ status: "issued" })
      .eq("id", certMainId)
      .select("status");
    check(
      "★ 본인은 자기 신청을 발급 처리할 수 없다 (update 정책 없음 — 0행)",
      noRows(selfIssue) && (await certRow(certMainId))?.status === "requested",
      selfIssue.error ? selfIssue.error.message : "셀프 발급이 통과했다",
    );

    const editPurpose = await adminUser.sb
      .from("certificate_requests")
      .update({ purpose: "[e2e] 바꿔치기" })
      .eq("id", certMainId)
      .select("purpose");
    check(
      "신청 원본(용도)은 관리자도 못 바꾼다 — 신청 내용은 기록이다",
      raised(editPurpose.error, "신청 내용은 변경할 수 없습니다") &&
        (await certRow(certMainId))?.purpose === PURPOSE_MAIN,
      editPurpose.error ? editPurpose.error.message : "신청 내용이 바뀌었다",
    );

    const touchProcessed = await adminUser.sb
      .from("certificate_requests")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", certMainId)
      .select("processed_at");
    check(
      "상태 전이 없이 처리 정보만 만지는 경로는 막힌다",
      raised(touchProcessed.error, "처리 정보는 상태 전이와 함께만") &&
        (await certRow(certMainId))?.processed_at === null,
      touchProcessed.error ? touchProcessed.error.message : "처리 시각만 따로 찍혔다",
    );

    // ── [4] 계약 — 본인 조회 · 관리자 등록 · 제3자 차단 ─────────────
    console.log("\n[4] 계약 — 본인 조회 · 관리자 등록 · 제3자 차단");

    const contractIns = await adminUser.sb
      .from("employment_contracts")
      .insert({
        employee_id: owner.id,
        title: TITLE_MAIN,
        status: "signed",
        signed_at: "2026-01-02",
        file_path: `${owner.id}/e2e-contract.pdf`,
      })
      .select("id")
      .single();
    const contractId = (contractIns.data as { id: string } | null)?.id;
    const ownContracts = await ownerUser.sb
      .from("employment_contracts")
      .select("id, title, status, signed_at, file_path")
      .eq("employee_id", owner.id)
      .order("created_at", { ascending: false });
    const ownContractRow = (ownContracts.data ?? []).find(
      (r: { id: string }) => r.id === contractId,
    ) as { title: string; status: string; signed_at: string | null } | undefined;
    check(
      "★ 관리자가 등록한 계약이 당사자 목록에 보인다 (서명완료·체결일)",
      Boolean(contractId) &&
        ownContractRow?.title === TITLE_MAIN &&
        ownContractRow.status === "signed" &&
        ownContractRow.signed_at === "2026-01-02",
      contractIns.error?.message ?? ownContracts.error?.message ?? "목록에 없다",
    );
    if (!contractId) throw new Error("계약 등록 실패로 이후 검증을 할 수 없습니다.");

    const peerContract = await peerUser.sb
      .from("employment_contracts")
      .select("id, title")
      .eq("id", contractId)
      .maybeSingle();
    const mgrContract = await managerUser.sb
      .from("employment_contracts")
      .select("id, title")
      .eq("id", contractId)
      .maybeSingle();
    check(
      "★ 동료·manager에게는 남의 계약이 0행이다",
      !peerContract.error &&
        peerContract.data === null &&
        !mgrContract.error &&
        mgrContract.data === null,
      peerContract.error?.message ?? mgrContract.error?.message ?? "남의 계약이 보인다",
    );

    const selfContract = await ownerUser.sb
      .from("employment_contracts")
      .insert({ employee_id: owner.id, title: `[e2e] 셀프 계약 ${stamp}` })
      .select("id");
    check(
      "비관리자는 자기 계약도 등록할 수 없다 (insert 정책 없음 — 42501)",
      denied(selfContract.error),
      selfContract.error ? `code=${selfContract.error.code}` : "셀프 계약이 등록됐다",
    );

    const badPath = await adminUser.sb
      .from("employment_contracts")
      .insert({
        employee_id: owner.id,
        title: TITLE_BADPATH,
        file_path: `${peer.id}/e2e-leak.pdf`,
      })
      .select("id");
    check(
      "★ 파일 경로 첫 세그먼트가 대상 직원과 다르면 거부된다 (스토리지 열람 판정이 새는 경로)",
      raised(badPath.error, "계약 파일 경로가 올바르지 않습니다"),
      badPath.error ? badPath.error.message : "남의 폴더 경로가 통과했다",
    );

    const noSign = await adminUser.sb
      .from("employment_contracts")
      .insert({ employee_id: owner.id, title: TITLE_NOSIGN, status: "signed" })
      .select("id");
    check(
      "서명완료에는 체결일이 필수다 (CHECK)",
      Boolean(noSign.error),
      noSign.error ? "" : "체결일 없는 서명완료가 통과했다",
    );

    const moveContract = await adminUser.sb
      .from("employment_contracts")
      .update({ employee_id: peer.id })
      .eq("id", contractId)
      .select("id");
    check(
      "계약의 대상 직원은 관리자도 못 바꾼다 (파일 경로 판정이 남을 가리키게 된다)",
      raised(moveContract.error, "계약의 대상 직원은 변경할 수 없습니다"),
      moveContract.error ? moveContract.error.message : "계약이 다른 직원에게 넘어갔다",
    );

    // ── [5] 컬럼 가드 — 합계 변조·upsert 우회·재계산 ────────────────
    console.log("\n[5] 컬럼 가드 — 합계는 파생값 · upsert 우회 차단 · 재계산");

    const slip1Items = await itemsOf(slip1Id);
    const baseItem = slip1Items.find((i) => i.name === "기본급");
    if (!baseItem) throw new Error("준비 항목(기본급)을 찾을 수 없습니다.");

    const selfEditTotals = await ownerUser.sb
      .from("payroll_slips")
      .update({ gross_total: 99999999, net_total: 99849999 })
      .eq("id", slip1Id)
      .select("id");
    check(
      "★ 본인이 자기 명세 합계를 UPDATE하면 0행이다 (급여 테이블에 본인 쓰기 정책이 없다)",
      noRows(selfEditTotals) && Number((await slipRow(slip1Id))?.gross_total) === 3200000,
      selfEditTotals.error ? selfEditTotals.error.message : "본인이 합계를 바꿨다",
    );

    const selfEditItem = await ownerUser.sb
      .from("payroll_slip_items")
      .update({ amount: 99999999 })
      .eq("id", baseItem.id)
      .select("id");
    check(
      "본인이 자기 항목 금액을 UPDATE해도 0행이다",
      noRows(selfEditItem) &&
        Number((await itemsOf(slip1Id)).find((i) => i.id === baseItem.id)?.amount) === 3000000,
      selfEditItem.error ? selfEditItem.error.message : "본인이 항목 금액을 바꿨다",
    );

    // 규약 2의 요점 — upsert는 INSERT 경로로 가드를 우회하려는 고전 수법이다
    const upsertSlip = await ownerUser.sb
      .from("payroll_slips")
      .upsert(
        {
          employee_id: owner.id,
          pay_month: MONTH_A,
          pay_date: "2099-01-25",
          gross_total: 99999999,
          deduction_total: 0,
          net_total: 99999999,
        },
        { onConflict: "employee_id,pay_month" },
      )
      .select("id");
    check(
      "★ 명세 upsert의 INSERT 경로도 막힌다 (42501) — 합계가 그대로다",
      denied(upsertSlip.error) &&
        Number((await slipRow(slip1Id))?.gross_total) === 3200000,
      upsertSlip.error ? upsertSlip.error.message : "upsert로 합계가 위조됐다",
    );

    const upsertItem = await ownerUser.sb
      .from("payroll_slip_items")
      .upsert(
        {
          id: baseItem.id,
          slip_id: slip1Id,
          kind: "payment",
          name: "기본급",
          amount: 99999999,
        },
        { onConflict: "id" },
      )
      .select("id");
    check(
      "항목 upsert의 INSERT 경로도 막힌다 (42501)",
      denied(upsertItem.error) &&
        Number((await itemsOf(slip1Id)).find((i) => i.id === baseItem.id)?.amount) === 3000000,
      upsertItem.error ? upsertItem.error.message : "upsert로 항목이 위조됐다",
    );

    const adminEditTotals = await adminUser.sb
      .from("payroll_slips")
      .update({ gross_total: 1, deduction_total: 0, net_total: 1 })
      .eq("id", slip1Id)
      .select("id");
    check(
      "★ 관리자도 합계 3종을 직접 지정할 수 없다 — 합계는 항목에서 자동 계산 (가드)",
      raised(adminEditTotals.error, "합계는 항목에서 자동 계산됩니다") &&
        Number((await slipRow(slip1Id))?.gross_total) === 3200000,
      adminEditTotals.error ? adminEditTotals.error.message : "합계가 직접 수정됐다",
    );

    const adminForgeInsert = await adminUser.sb
      .from("payroll_slips")
      .insert({
        employee_id: owner.id,
        pay_month: MONTH_D,
        pay_date: "2099-04-25",
        gross_total: 5000000,
        deduction_total: 1000000,
        net_total: 4000000,
      })
      .select("gross_total, deduction_total, net_total")
      .single();
    const forgedTotals = adminForgeInsert.data as {
      gross_total: number;
      deduction_total: number;
      net_total: number;
    } | null;
    check(
      "★ 관리자의 직접 INSERT도 합계는 0에서 시작한다 — 어떤 값을 실어 보내든 무시",
      Number(forgedTotals?.gross_total) === 0 &&
        Number(forgedTotals?.deduction_total) === 0 &&
        Number(forgedTotals?.net_total) === 0,
      adminForgeInsert.error ? adminForgeInsert.error.message : JSON.stringify(forgedTotals),
    );

    const moveSlipOwner = await adminUser.sb
      .from("payroll_slips")
      .update({ employee_id: peer.id })
      .eq("id", slip1Id)
      .select("id");
    check(
      "명세의 대상 직원은 관리자도 못 바꾼다 — 급여 데이터의 소유는 불변",
      raised(moveSlipOwner.error, "명세의 대상 직원은 변경할 수 없습니다") &&
        (await slipRow(slip1Id))?.employee_id === owner.id,
      moveSlipOwner.error ? moveSlipOwner.error.message : "명세가 다른 직원에게 넘어갔다",
    );

    const moveItem = await adminUser.sb
      .from("payroll_slip_items")
      .update({ slip_id: slip2Id })
      .eq("id", baseItem.id)
      .select("id");
    check(
      "항목을 다른 명세로 옮길 수 없다 (원래 명세의 합계가 낡은 값으로 남는다)",
      raised(moveItem.error, "항목을 다른 명세로 옮길 수 없습니다"),
      moveItem.error ? moveItem.error.message : "항목이 다른 명세로 옮겨졌다",
    );

    // 관리자가 항목을 PostgREST로 직접 고쳐도 재계산 트리거가 합계를 따라 맞춘다 —
    // "합계 3종은 트리거 재계산" 결정의 핵심 근거를 수치로 확인한다
    const directItemEdit = await adminUser.sb
      .from("payroll_slip_items")
      .update({ amount: 3500000 })
      .eq("id", baseItem.id)
      .select("amount");
    const slip1Final = await slipRow(slip1Id);
    check(
      "★ 항목 직접 수정 시 부모 합계가 재계산된다 (기본급 +50만 → 지급 370만·실지급 355만)",
      !directItemEdit.error &&
        Number(slip1Final?.gross_total) === 3700000 &&
        Number(slip1Final?.deduction_total) === 150000 &&
        Number(slip1Final?.net_total) === 3550000,
      directItemEdit.error
        ? directItemEdit.error.message
        : `합계 ${slip1Final?.gross_total}·${slip1Final?.deduction_total}·${slip1Final?.net_total}`,
    );
  } finally {
    console.log("\n[정리]");

    const { count: certCount } = await admin
      .from("certificate_requests")
      .delete({ count: "exact" })
      .like("purpose", "[e2e]%");
    console.log(`  · [e2e] 증명서 신청 ${certCount ?? 0}건 삭제`);

    const { count: contractCount } = await admin
      .from("employment_contracts")
      .delete({ count: "exact" })
      .like("title", "[e2e]%");
    console.log(`  · [e2e] 계약 ${contractCount ?? 0}건 삭제`);

    const { count: slipCount } = await admin
      .from("payroll_slips")
      .delete({ count: "exact" })
      .eq("employee_id", owner.id)
      .gte("pay_month", MONTH_A);
    console.log(`  · 2099년 급여명세 ${slipCount ?? 0}건 삭제 (항목 cascade)`);

    if (profileTouched) {
      if (prevProfile) {
        await admin.from("payroll_profiles").upsert(prevProfile);
        console.log("  · 급여상세 원본 원복");
      } else {
        await admin.from("payroll_profiles").delete().eq("employee_id", owner.id);
        console.log("  · [e2e] 급여상세 삭제");
      }
    }

    if (roleChanged) {
      await admin
        .from("employees")
        .update({ role_id: adminEmp.role_id })
        .eq("id", adminEmp.id);
      console.log("  · 박민준 역할 원복");
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
