/**
 * 스펙 18 관리자 대시보드 집계 e2e 검증 (마이그레이션 25).
 *
 *   npm run e2e:admin -- --yes
 *
 * ── 이 스크립트는 다른 e2e와 성격이 다르다 ──────────────────────────────
 *
 * 지금까지의 e2e는 "막혀야 하는 것이 막히는가"를 봤다. 이번 것은 집계 화면이라
 * 제일 중요한 질문이 **"숫자가 맞는가"**다. 함수가 행을 돌려준다는 것은
 * 아무것도 증명하지 않는다 — 틀린 숫자도 행으로 돌아온다.
 *
 * 그래서 이 파일의 본체는 **독립 재계산 후 대조**다. 집계 함수가 낸 값을,
 * service_role로 받아온 원본 테이블 행에서 **TypeScript로 손수 다시 세어**
 * 같은지 본다. 함수가 쓴 SQL을 복사해 오면 검증이 아니라 동어반복이다.
 *
 * 특히 세 자리가 갈라지기 쉽다:
 *
 *  (1) 연차 발생일수. 같은 규칙이 src/features/attendance/leave-accrual.ts(TS)와
 *      leave_year_of(SQL) 두 곳에 있다. 갈라지면 직원 화면과 관리자 화면이
 *      같은 사람에 대해 다른 숫자를 보여주고, 문의가 들어와도 어느 쪽이 맞는지
 *      아무도 모른다. 여기서는 SQL 결과를 TS 함수 결과와 한 사람씩 대조한다.
 *
 *  (2) 오늘의 출근 4분할. 한 사람이 두 칸에 세어지면 합이 재직 인원과 어긋나고,
 *      그러면 분모 없는 숫자 네 개가 된다. 반차·종일휴가·출근기록을 동시에
 *      가진 사람을 일부러 만들어 우선순위가 실제로 배타적인지 찌른다.
 *
 *  (3) 결재 시각의 출처. 상신은 approval_documents.created_at이 아니라
 *      approval_steps.created_at, 처리 소요는 updated_at이 아니라
 *      approval_steps.processed_at이어야 한다. 문서의 created_at을 과거로
 *      조작하고 updated_at을 나중으로 밀어서, 집계가 정말 단계 쪽을 보는지 본다.
 *
 * 데이터 원칙: 시딩된 데모 데이터는 지우지도 고치지도 않는다(화면 검증에 쓴다).
 * 필요한 것은 전부 임시 계정·임시 팀으로 새로 만들고 finally에서 되돌린다.
 * 관리자 권한이 필요한 곳은 역할을 잠시 올렸다가 원복한다(e2e-assets.ts 방식).
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  accrualForLeaveYear,
  leaveYearWindow,
} from "../src/features/attendance/leave-accrual";

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
      "이 스크립트는 실제 DB에 임시 직원·팀·휴가·근태·결재 문서를 만들고",
      "데모 직원 역할을 잠시 바꿉니다(끝나면 전부 원복).",
      "시딩된 데모 데이터는 건드리지 않습니다.",
      "실행하려면: npm run e2e:admin -- --yes",
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

/** 함수가 raise한 우리 문장인지까지 본다. 권한 부족으로 우연히 막힌 것과 구분된다 */
const raised = (error: { message: string } | null | undefined, needle: string) =>
  Boolean(error && error.message.includes(needle));

/** numeric은 드라이버에 따라 문자열로 온다. 비교 전에 항상 맞춘다 */
const n = (v: number | string | null | undefined) => Number(v ?? 0);
/** 0.5일 단위가 섞이므로 정수 비교로 두면 안 된다 */
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/* ── 임시 데이터 식별자 ───────────────────────────────────────────────
 * 정리할 때 "이 접두사인 것만" 지우면 되도록 한 곳에 모아 둔다.
 * 이전 실행이 중간에 끊겼을 수 있어 만들기 전에도 같은 조건으로 지운다. */
const EMAIL_PREFIX = "e2e-admin-";
const EMAIL_DOMAIN = "demo.aimbrige.kr";
const TEAM_PREFIX = "[e2e-admin]";
/** 어떤 화면도 조회하지 않는 구간 — 결재 집계를 '빈 기간'에서 정확히 셀 수 있다 */
const APPROVAL_FROM = "2001-03-01";
const APPROVAL_TO = "2001-03-31";

/* ── 날짜 유틸 (전부 문자열 연산 — 스크립트 실행 환경의 타임존과 무관하다) ── */

const seoulFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** DB 함수들이 쓰는 기준일과 같은 값 — (now() at time zone 'Asia/Seoul')::date */
const seoulToday = () => seoulFormatter.format(new Date());

function ymdParts(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

function ymdAdd(ymd: string, delta: number): string {
  const { y, m, d } = ymdParts(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** 연 단위 가산. 말일은 그 달의 마지막 날로 당긴다(2/29 → 2/28) */
function ymdAddYears(ymd: string, delta: number): string {
  const { y, m, d } = ymdParts(ymd);
  const year = y + delta;
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 0=일 … 6=토 */
function ymdDow(ymd: string): number {
  const { y, m, d } = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 서울 자정 기준 timestamptz 문자열 — 경계를 오프셋으로 못박는다 */
const seoulTs = (ymd: string, hhmmss = "09:00:00") => `${ymd}T${hhmmss}+09:00`;

/* ── 세션 ─────────────────────────────────────────────────────────── */

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

/* ── 원본 테이블 (독립 재계산의 재료) ─────────────────────────────────
 * 집계 함수가 읽는 것과 **같은 테이블**을 읽되, 세는 일은 전부 TS에서 한다.
 * SQL을 복사해 오면 같은 실수를 두 번 하고 통과한다. */

interface EmployeeRow {
  id: string;
  email: string;
  name: string;
  employment_status: string;
  hire_date: string | null;
  department_id: string | null;
  team_id: string | null;
  auth_user_id: string | null;
}

async function allEmployees(): Promise<EmployeeRow[]> {
  const { data, error } = await admin
    .from("employees")
    .select(
      "id, email, name, employment_status, hire_date, department_id, team_id, auth_user_id",
    )
    .limit(10000);
  if (error) throw new Error(`employees 조회 실패: ${error.message}`);
  return (data ?? []) as EmployeeRow[];
}

interface LeaveRow {
  employee_id: string;
  leave_type: string;
  leave_category: string;
  status: string;
  start_date: string;
  end_date: string;
  days: number | string;
}

async function allApprovedLeaves(): Promise<LeaveRow[]> {
  const { data, error } = await admin
    .from("leave_requests")
    .select("employee_id, leave_type, leave_category, status, start_date, end_date, days")
    .eq("status", "approved")
    .limit(50000);
  if (error) throw new Error(`leave_requests 조회 실패: ${error.message}`);
  return (data ?? []) as LeaveRow[];
}

/* ── 집계 함수 호출 래퍼 ──────────────────────────────────────────────
 * 전부 security definer + is_system_admin() 가드다. service_role 클라이언트는
 * auth.uid()가 없어 가드에 걸리므로, 반드시 관리자 세션으로 호출해야 한다. */

interface Headcount {
  total: number;
  active: number;
  onLeave: number;
  terminated: number;
  unlinked: number;
  departments: number;
  teams: number;
}

interface DeptRow {
  department_id: string | null;
  department_name: string | null;
  active_count: number | string;
  on_leave_count: number | string;
  terminated_count: number | string;
}

interface AttendanceSummary {
  activeTotal: number;
  checkedIn: number;
  partial: number;
  fullDay: number;
  absent: number;
  nonWorking: boolean;
  label: string | null;
}

interface TeamUsageRow {
  team_id: string | null;
  team_name: string | null;
  department_name: string | null;
  member_count: number | string;
  computed_count: number | string;
  uncomputed_count: number | string;
  granted_days: number | string;
  used_days: number | string;
}

interface ApprovalRow {
  submitted_count: number | string;
  approved_count: number | string;
  rejected_count: number | string;
  decided_count: number | string;
  avg_decision_days: number | string | null;
  pending_count: number | string;
  oldest_pending_days: number | string;
}

interface HireRow {
  employee_id: string;
  employee_name: string;
  position: string | null;
  department_name: string | null;
  team_name: string | null;
  hired_on: string;
  days_since: number | string;
  is_unlinked: boolean;
}

interface LeaveYearRow {
  year_index: number | string;
  period_start: string;
  period_end: string;
  granted_days: number | string;
}

async function main() {
  // 이수연(일반직원) · 박민준(팀장 — manager도 막혀야 한다)
  const MEMBER = "sylee@demo.aimbrige.kr";
  const MANAGER = "mjpark@demo.aimbrige.kr";
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

  // 이 셋은 세션을 만들 대상이다. 직원 행이 없으면 여기서 바로 멈춘다
  await emp(MEMBER);
  await emp(MANAGER);
  const adminEmp = await emp(ADMIN);

  const { data: roles } = await admin.from("roles").select("id, name");
  const roleId = (name: string) => {
    const found = (roles ?? []).find((r: { name: string }) => r.name === name);
    if (!found) throw new Error(`역할 '${name}' 이 없습니다.`);
    return (found as { id: string }).id;
  };

  const authIds: string[] = [];
  const docIds: string[] = [];
  const teamIds: string[] = [];
  const holidayDates: string[] = [];

  try {
    // ── 준비: 이전 실행 잔재 정리 → 임시 계정·팀 생성 ────────────────
    await admin.from("approval_documents").delete().like("title", "[e2e]%");
    await admin.from("employees").delete().like("email", `${EMAIL_PREFIX}%`);
    await admin.from("teams").delete().like("name", `${TEAM_PREFIX}%`);

    await admin
      .from("employees")
      .update({ role_id: roleId("system_admin") })
      .eq("email", ADMIN);

    const memberUser = await clientFor(MEMBER);
    const managerUser = await clientFor(MANAGER);
    const adminUser = await clientFor(ADMIN);
    authIds.push(memberUser.authId, managerUser.authId, adminUser.authId);

    /* 집계 호출 래퍼 — 관리자 세션에 묶여 있어야 해서 여기서 정의한다 */

    const headcount = async (): Promise<Headcount> => {
      const { data, error } = await adminUser.sb.rpc("headcount_summary");
      if (error) throw new Error(`headcount_summary: ${error.message}`);
      const r = (data ?? [])[0];
      if (!r) throw new Error("headcount_summary가 행을 돌려주지 않았습니다.");
      return {
        total: n(r.total_count),
        active: n(r.active_count),
        onLeave: n(r.on_leave_count),
        terminated: n(r.terminated_count),
        unlinked: n(r.unlinked_count),
        departments: n(r.department_count),
        teams: n(r.team_count),
      };
    };

    const byDepartment = async (): Promise<DeptRow[]> => {
      const { data, error } = await adminUser.sb.rpc("headcount_by_department");
      if (error) throw new Error(`headcount_by_department: ${error.message}`);
      return (data ?? []) as DeptRow[];
    };

    const attendance = async (date: string): Promise<AttendanceSummary> => {
      const { data, error } = await adminUser.sb.rpc("today_attendance_summary", {
        p_date: date,
      });
      if (error) throw new Error(`today_attendance_summary(${date}): ${error.message}`);
      const r = (data ?? [])[0];
      if (!r) throw new Error(`today_attendance_summary(${date})가 비었습니다.`);
      return {
        activeTotal: n(r.active_total),
        checkedIn: n(r.checked_in_count),
        partial: n(r.partial_leave_count),
        fullDay: n(r.full_day_leave_count),
        absent: n(r.absent_count),
        nonWorking: r.non_working === true,
        label: r.non_working_label,
      };
    };

    const usageByTeam = async (asOf: string): Promise<TeamUsageRow[]> => {
      const { data, error } = await adminUser.sb.rpc("annual_leave_usage_by_team", {
        p_as_of: asOf,
      });
      if (error) throw new Error(`annual_leave_usage_by_team: ${error.message}`);
      return (data ?? []) as TeamUsageRow[];
    };

    const approvals = async (from: string, to: string): Promise<ApprovalRow> => {
      const { data, error } = await adminUser.sb.rpc("approval_activity", {
        p_from: from,
        p_to: to,
      });
      if (error) throw new Error(`approval_activity: ${error.message}`);
      const r = (data ?? [])[0];
      if (!r) throw new Error("approval_activity가 행을 돌려주지 않았습니다.");
      return r as ApprovalRow;
    };

    const recentHires = async (days = 90): Promise<HireRow[]> => {
      const { data, error } = await adminUser.sb.rpc("recent_hires", { p_days: days });
      if (error) throw new Error(`recent_hires: ${error.message}`);
      return (data ?? []) as HireRow[];
    };

    /** 순수 헬퍼라 일반직원 세션으로 부른다 — 그 자체가 케이스 9의 확인이다 */
    const leaveYearOf = async (
      hire: string | null,
      asOf: string,
    ): Promise<LeaveYearRow | null> => {
      const { data, error } = await memberUser.sb.rpc("leave_year_of", {
        p_hire_date: hire,
        p_as_of: asOf,
      });
      if (error) throw new Error(`leave_year_of(${hire}, ${asOf}): ${error.message}`);
      return ((data ?? []) as LeaveYearRow[])[0] ?? null;
    }

    /** 임시 직원 하나. 부서는 비워 둔다 — '부서 미지정' 행이 반드시 생기게 한다 */
    const makeEmployee = async (opts: {
      slug: string;
      name: string;
      hireDate: string | null;
      teamId?: string | null;
      status?: string;
    }): Promise<string> => {
      const { data, error } = await admin
        .from("employees")
        .insert({
          email: `${EMAIL_PREFIX}${opts.slug}@${EMAIL_DOMAIN}`,
          name: `[e2e] ${opts.name}`,
          role_id: roleId("employee"),
          employment_status: opts.status ?? "active",
          hire_date: opts.hireDate,
          team_id: opts.teamId ?? null,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`임시 직원 생성 실패(${opts.slug}): ${error?.message}`);
      }
      return (data as { id: string }).id;
    }

    const makeTeam = async (name: string): Promise<string> => {
      const { data, error } = await admin
        .from("teams")
        .insert({ name: `${TEAM_PREFIX} ${name}` })
        .select("id")
        .single();
      if (error || !data) throw new Error(`임시 팀 생성 실패(${name}): ${error?.message}`);
      const id = (data as { id: string }).id;
      teamIds.push(id);
      return id;
    };

    const addLeave = async (opts: {
      employeeId: string;
      start: string;
      end?: string;
      type?: string;
      category?: string;
      status?: string;
      days?: number;
      hours?: number;
    }) => {
      const type = opts.type ?? "full_day";
      const days = opts.days ?? 1;
      // leave_days_consistent(마이그레이션 08): hourly는 hours가 있어야 하고
      // days ≒ round(hours/8, 2) 여야 한다. 8시간 = 1일 환산으로 되돌려 넣는다
      const hours = type === "hourly" ? (opts.hours ?? days * 8) : null;
      const { error } = await admin.from("leave_requests").insert({
        employee_id: opts.employeeId,
        leave_type: type,
        leave_category: opts.category ?? "annual",
        start_date: opts.start,
        end_date: opts.end ?? opts.start,
        status: opts.status ?? "approved",
        days,
        hours,
      });
      if (error) throw new Error(`휴가 생성 실패: ${error.message}`);
    }

    // ── 기준일 고르기 ───────────────────────────────────────────────
    const today = seoulToday();

    const { data: holidayRows } = await admin
      .from("holidays")
      .select("date, is_non_working")
      .gte("date", ymdAdd(today, -60))
      .lte("date", today);
    const offDays = new Set(
      ((holidayRows ?? []) as { date: string; is_non_working: boolean }[])
        .filter((h) => h.is_non_working)
        .map((h) => h.date),
    );

    /** 출근 4분할을 찌를 근무일 — 평일이면서 비근무 공휴일이 아닌 날 */
    let PROBE = today;
    for (let i = 0; i < 60; i += 1) {
      const dow = ymdDow(PROBE);
      if (dow >= 1 && dow <= 5 && !offDays.has(PROBE)) break;
      PROBE = ymdAdd(PROBE, -1);
    }
    /** 주말 판정을 찌를 토요일 */
    let SATURDAY = today;
    for (let i = 0; i < 8; i += 1) {
      if (ymdDow(SATURDAY) === 6) break;
      SATURDAY = ymdAdd(SATURDAY, -1);
    }
    console.log(`\n기준일: 오늘=${today} · 근무일 PROBE=${PROBE} · 토요일=${SATURDAY}`);

    // ═══════════════════════════════════════════════════════════════
    // A. 권한 — 하나라도 뚫리면 전 직원이 전사 통계를 본다
    // ═══════════════════════════════════════════════════════════════
    console.log("\n[A] 권한 — 전사 집계는 관리자만");

    const guarded: { name: string; args: Record<string, unknown> }[] = [
      { name: "headcount_summary", args: {} },
      { name: "headcount_by_department", args: {} },
      { name: "today_attendance_summary", args: { p_date: PROBE } },
      { name: "annual_leave_usage_by_team", args: { p_as_of: today } },
      { name: "approval_activity", args: { p_from: APPROVAL_FROM, p_to: APPROVAL_TO } },
      { name: "recent_hires", args: { p_days: 90 } },
    ];

    for (const fn of guarded) {
      const res = await memberUser.sb.rpc(fn.name, fn.args);
      check(
        `★ 일반직원은 ${fn.name}()를 호출할 수 없다`,
        raised(res.error, "시스템 관리자만"),
        res.error ? res.error.message : `${(res.data as unknown[])?.length ?? 0}행 조회됨`,
      );
    }

    // 팀장은 팀원 근태·휴가를 보지만 전사 집계는 다른 권한이다
    let managerBlocked = 0;
    for (const fn of guarded) {
      const res = await managerUser.sb.rpc(fn.name, fn.args);
      if (raised(res.error, "시스템 관리자만")) managerBlocked += 1;
    }
    check(
      "★ 팀장(manager)도 전사 집계 6종을 전부 거부당한다 — 관리자 전용이다",
      managerBlocked === guarded.length,
      `막힌 함수 ${managerBlocked}/${guarded.length}개`,
    );

    let adminPassed = 0;
    for (const fn of guarded) {
      const res = await adminUser.sb.rpc(fn.name, fn.args);
      if (!res.error) adminPassed += 1;
      else console.log(`      · ${fn.name} 실패: ${res.error.message}`);
    }
    check(
      "★ 관리자는 전사 집계 6종이 전부 통과한다",
      adminPassed === guarded.length,
      `통과 ${adminPassed}/${guarded.length}개`,
    );

    /*
     * approval_activity_core()는 가드가 없는 집계 본문이다(마이그레이션 26).
     * 안전 장치가 "아무에게도 EXECUTE를 남기지 않는다" 하나뿐이라, grant가
     * 되살아나면 위의 approval_activity() 가드가 통째로 무의미해진다 —
     * p_requester=null이면 전사, 남의 uuid를 넣으면 그 사람의 개인 통계다.
     * 그래서 '관리자조차 직접 호출할 수 없어야 한다'로 확인한다.
     */
    let coreBlocked = 0;
    const coreArgs = {
      p_from_ts: "2001-03-01T00:00:00+09:00",
      p_to_ts: "2001-04-01T00:00:00+09:00",
      p_requester: null,
    };
    for (const user of [memberUser, managerUser, adminUser]) {
      const res = await user.sb.rpc("approval_activity_core", coreArgs);
      if (res.error) coreBlocked += 1;
    }
    check(
      "★ approval_activity_core()는 PostgREST로 노출되지 않는다 — 일반직원·팀장·관리자 모두 호출 불가",
      coreBlocked === 3,
      `막힌 역할 ${coreBlocked}/3 — revoke가 anon·authenticated까지 걸렸는지 확인할 것`,
    );

    const pureHelper = await memberUser.sb.rpc("leave_year_of", {
      p_hire_date: "2023-05-01",
      p_as_of: today,
    });
    check(
      "leave_year_of()는 테이블을 안 읽는 순수 헬퍼라 누구나 호출할 수 있다",
      !pureHelper.error && ((pureHelper.data as unknown[]) ?? []).length === 1,
      pureHelper.error ? pureHelper.error.message : "행이 없다",
    );

    // ═══════════════════════════════════════════════════════════════
    // B. 집계 정확성 — 독립 재계산 대조
    // ═══════════════════════════════════════════════════════════════

    // ── 임시 직원 만들기 ────────────────────────────────────────────
    // 근무일 PROBE 기준으로 전원 재직·입사완료 상태다. 부서는 비워 둔다.
    const HIRE_OLD = ymdAdd(PROBE, -800);
    const attFull = await makeEmployee({ slug: "att-full", name: "종일휴가+출근", hireDate: HIRE_OLD });
    const attHalf = await makeEmployee({ slug: "att-half", name: "오전반차", hireDate: HIRE_OLD });
    const attHourly = await makeEmployee({ slug: "att-hourly", name: "시간연차", hireDate: HIRE_OLD });
    const attPending = await makeEmployee({ slug: "att-pending", name: "대기휴가", hireDate: HIRE_OLD });
    const attCheckedIn = await makeEmployee({ slug: "att-in", name: "출근기록", hireDate: HIRE_OLD });
    const attNullIn = await makeEmployee({ slug: "att-nullin", name: "출근시각없음", hireDate: HIRE_OLD });

    console.log("\n[B-1] headcount_summary — employees에서 직접 세어 대조");

    const hc = await headcount();
    const emps1 = await allEmployees();
    const handTotal = emps1.length;
    const handActive = emps1.filter((e) => e.employment_status === "active").length;
    const handLeave = emps1.filter((e) => e.employment_status === "leave").length;
    const handTerm = emps1.filter((e) => e.employment_status === "terminated").length;
    const handUnlinked = emps1.filter(
      (e) => e.auth_user_id === null && e.employment_status !== "terminated",
    ).length;

    check(
      "★ active/on_leave/terminated가 employees를 직접 센 값과 같다",
      hc.active === handActive && hc.onLeave === handLeave && hc.terminated === handTerm,
      `함수 ${hc.active}/${hc.onLeave}/${hc.terminated} · 직접 ${handActive}/${handLeave}/${handTerm}`,
    );
    check(
      "★ 세 상태의 합 = total_count (어느 상태에도 안 잡히는 행이 없다)",
      hc.active + hc.onLeave + hc.terminated === hc.total && hc.total === handTotal,
      `합 ${hc.active + hc.onLeave + hc.terminated} · total ${hc.total} · 직접 ${handTotal}`,
    );
    check(
      "unlinked_count는 퇴사자를 빼고 센다 (조치 대상이 0명인 경고가 상시 켜지면 안 된다)",
      hc.unlinked === handUnlinked,
      `함수 ${hc.unlinked} · 직접 ${handUnlinked}`,
    );

    console.log("\n[B-2] headcount_by_department — 부서별로 손수 센 값과 대조");

    const deptRows = await byDepartment();
    const handByDept = new Map<string | null, { a: number; l: number; t: number }>();
    for (const e of emps1) {
      const key = e.department_id;
      const cur = handByDept.get(key) ?? { a: 0, l: 0, t: 0 };
      if (e.employment_status === "active") cur.a += 1;
      else if (e.employment_status === "leave") cur.l += 1;
      else if (e.employment_status === "terminated") cur.t += 1;
      handByDept.set(key, cur);
    }

    const deptKeysMatch =
      deptRows.length === handByDept.size &&
      deptRows.every((r) => handByDept.has(r.department_id));
    check(
      "부서 그룹이 employees의 department_id 분포와 정확히 같다 (빠진 그룹이 없다)",
      deptKeysMatch,
      `함수 ${deptRows.length}행 · 직접 ${handByDept.size}그룹`,
    );

    const deptCountsMatch = deptRows.every((r) => {
      const h = handByDept.get(r.department_id);
      return (
        !!h &&
        n(r.active_count) === h.a &&
        n(r.on_leave_count) === h.l &&
        n(r.terminated_count) === h.t
      );
    });
    check(
      "부서별 재직·휴직·퇴사 인원이 직접 센 값과 전부 같다",
      deptCountsMatch,
      JSON.stringify(deptRows.map((r) => [r.department_name, n(r.active_count)])),
    );

    const nullDeptRow = deptRows.find((r) => r.department_id === null);
    check(
      "부서 미지정 인원도 한 행으로 돌아온다 (빼면 막대 합이 재직 인원과 안 맞는다)",
      !!nullDeptRow && n(nullDeptRow.active_count) > 0,
      nullDeptRow ? `active=${n(nullDeptRow.active_count)}` : "null 행이 없다",
    );

    const deptActiveSum = deptRows.reduce((s, r) => s + n(r.active_count), 0);
    check(
      "★ 부서별 재직 합 = headcount_summary.active",
      deptActiveSum === hc.active,
      `막대 합 ${deptActiveSum} · 재직 ${hc.active}`,
    );

    console.log("\n[B-3] today_attendance_summary — 4분할이 배타적인가");

    const S1 = await attendance(PROBE);
    const emps2 = await allEmployees();
    const handDenominator = emps2.filter(
      (e) =>
        e.employment_status === "active" && (e.hire_date === null || e.hire_date <= PROBE),
    ).length;

    check(
      "★ 네 칸의 합 = active_total (한 사람이 정확히 한 칸)",
      S1.checkedIn + S1.partial + S1.fullDay + S1.absent === S1.activeTotal,
      `합 ${S1.checkedIn + S1.partial + S1.fullDay + S1.absent} · active_total ${S1.activeTotal}`,
    );
    check(
      "★ active_total = 그날 기준 재직자 수 (직접 센 값과 같다)",
      S1.activeTotal === handDenominator,
      `함수 ${S1.activeTotal} · 직접 ${handDenominator}`,
    );

    // 입사 예정자 — 이 한 명을 더한 뒤 분모가 그대로여야 한다
    await makeEmployee({
      slug: "att-future",
      name: "입사예정",
      hireDate: ymdAdd(today, 30),
    });
    const S2 = await attendance(PROBE);
    check(
      "★ 입사 예정자(미래 hire_date)는 분모에도 미출근에도 들어가지 않는다",
      S2.activeTotal === S1.activeTotal && S2.absent === S1.absent,
      `active_total ${S1.activeTotal}→${S2.activeTotal} · absent ${S1.absent}→${S2.absent}`,
    );

    // 출근 기록 — 여기가 통과해야 아래 '출근으로 안 센다'가 의미를 가진다
    await admin.from("attendance_records").insert({
      employee_id: attCheckedIn,
      work_date: PROBE,
      check_in_at: seoulTs(PROBE),
    });
    const S3 = await attendance(PROBE);
    check(
      "check_in_at이 있는 출근 기록은 출근완료로 센다 (대조군)",
      S3.checkedIn === S2.checkedIn + 1 && S3.absent === S2.absent - 1,
      `checked_in ${S2.checkedIn}→${S3.checkedIn} · absent ${S2.absent}→${S3.absent}`,
    );

    // 보정 승인이 만드는 행 — 퇴근만 채워진 행은 출근이 아니다
    await admin.from("attendance_records").insert({
      employee_id: attNullIn,
      work_date: PROBE,
      check_in_at: null,
      check_out_at: seoulTs(PROBE, "18:00:00"),
    });
    const S4 = await attendance(PROBE);
    check(
      "★ check_in_at이 null인 attendance_records 행은 출근으로 세지 않는다",
      S4.checkedIn === S3.checkedIn && S4.absent === S3.absent,
      `checked_in ${S3.checkedIn}→${S4.checkedIn} · absent ${S3.absent}→${S4.absent}`,
    );

    // 같은 사람에게 출근 기록과 종일휴가를 함께 준다 —
    // 두 칸에 세어지면 여기서 합이 깨진다
    await admin.from("attendance_records").insert({
      employee_id: attFull,
      work_date: PROBE,
      check_in_at: seoulTs(PROBE),
    });
    const S5 = await attendance(PROBE);
    await addLeave({
      employeeId: attFull,
      start: ymdAdd(PROBE, -1),
      end: ymdAdd(PROBE, 1),
      type: "full_day",
      days: 3,
    });
    const S6 = await attendance(PROBE);
    check(
      "★ 종일휴가+출근기록을 함께 가진 사람은 종일휴가 칸에만 세어진다",
      S6.fullDay === S5.fullDay + 1 &&
        S6.checkedIn === S5.checkedIn - 1 &&
        S6.absent === S5.absent,
      `full_day ${S5.fullDay}→${S6.fullDay} · checked_in ${S5.checkedIn}→${S6.checkedIn}`,
    );
    check(
      "그때도 네 칸의 합은 여전히 active_total과 같다",
      S6.checkedIn + S6.partial + S6.fullDay + S6.absent === S6.activeTotal,
      `합 ${S6.checkedIn + S6.partial + S6.fullDay + S6.absent} · ${S6.activeTotal}`,
    );

    await addLeave({ employeeId: attHalf, start: PROBE, type: "half_day_am", days: 0.5 });
    const S7 = await attendance(PROBE);
    check(
      "★ 반차(half_day_am)는 partial_leave_count만 늘린다 (checked_in·absent는 안 는다)",
      S7.partial === S6.partial + 1 &&
        S7.checkedIn === S6.checkedIn &&
        S7.absent === S6.absent - 1,
      `partial ${S6.partial}→${S7.partial} · checked_in ${S6.checkedIn}→${S7.checkedIn} · absent ${S6.absent}→${S7.absent}`,
    );

    await addLeave({ employeeId: attHourly, start: PROBE, type: "hourly", days: 0.25 });
    const S8 = await attendance(PROBE);
    check(
      "★ 시간연차(hourly)도 partial로 센다 (종일휴가로 새면 자리에 없는 사람이 된다)",
      S8.partial === S7.partial + 1 && S8.fullDay === S7.fullDay,
      `partial ${S7.partial}→${S8.partial} · full_day ${S7.fullDay}→${S8.fullDay}`,
    );

    await addLeave({ employeeId: attPending, start: PROBE, type: "full_day", status: "pending", days: 1 });
    const S9 = await attendance(PROBE);
    check(
      "★ 대기(pending) 휴가는 어느 칸에도 영향을 주지 않는다 (승인된 것만 센다)",
      S9.fullDay === S8.fullDay &&
        S9.partial === S8.partial &&
        S9.checkedIn === S8.checkedIn &&
        S9.absent === S8.absent,
      `${JSON.stringify(S8)} → ${JSON.stringify(S9)}`,
    );
    check(
      "모든 조작을 끝낸 뒤에도 네 칸의 합 = active_total",
      S9.checkedIn + S9.partial + S9.fullDay + S9.absent === S9.activeTotal,
      `합 ${S9.checkedIn + S9.partial + S9.fullDay + S9.absent} · ${S9.activeTotal}`,
    );

    console.log("\n[B-4] 비근무일 판정 — 미출근을 경고로 그릴 날인가");

    const sat = await attendance(SATURDAY);
    check(
      "★ 토요일은 non_working=true",
      sat.nonWorking === true,
      `non_working=${sat.nonWorking}`,
    );
    check(
      "토요일의 이유 라벨이 비어 있지 않다",
      // 그 토요일이 공휴일과 겹치면 더 구체적인 공휴일 이름이 온다
      sat.label !== null && (offDays.has(SATURDAY) || sat.label === "주말"),
      `label=${sat.label}`,
    );
    check(
      "★ 평일(공휴일 아님)은 non_working=false이고 라벨이 null이다",
      S9.nonWorking === false && S9.label === null,
      `non_working=${S9.nonWorking} label=${S9.label}`,
    );

    // 공휴일 분기 — is_non_working이 켜진 날만 비근무일이다
    let holidayOff = "2099-06-01";
    while (ymdDow(holidayOff) === 0 || ymdDow(holidayOff) === 6) {
      holidayOff = ymdAdd(holidayOff, 1);
    }
    let holidayOn = ymdAdd(holidayOff, 1);
    while (ymdDow(holidayOn) === 0 || ymdDow(holidayOn) === 6) {
      holidayOn = ymdAdd(holidayOn, 1);
    }
    await admin.from("holidays").delete().in("date", [holidayOff, holidayOn]);
    await admin.from("holidays").insert([
      { date: holidayOff, name: "[e2e] 임시공휴일", kind: "temporary", is_non_working: true },
      { date: holidayOn, name: "[e2e] 창립기념일", kind: "temporary", is_non_working: false },
    ]);
    holidayDates.push(holidayOff, holidayOn);

    const hOff = await attendance(holidayOff);
    check(
      "평일이라도 holidays.is_non_working이면 non_working=true이고 공휴일 이름이 라벨이 된다",
      hOff.nonWorking === true && hOff.label === "[e2e] 임시공휴일",
      `non_working=${hOff.nonWorking} label=${hOff.label}`,
    );
    const hOn = await attendance(holidayOn);
    check(
      "is_non_working=false인 휴일(기념일 등)은 근무일이다",
      hOn.nonWorking === false && hOn.label === null,
      `non_working=${hOn.nonWorking} label=${hOn.label}`,
    );

    // ═══════════════════════════════════════════════════════════════
    // C. 연차 사용률 — 직원 화면과 같은 숫자여야 한다
    //    이 스펙에서 제일 중요한 검증이다. 같은 규칙이 TS(leave-accrual.ts)와
    //    SQL(leave_year_of)에 두 벌 있어서, 갈라지면 관리자와 직원이 서로
    //    다른 숫자를 보고도 아무도 알아채지 못한다.
    // ═══════════════════════════════════════════════════════════════
    console.log("\n[C-1] leave_year_of(SQL) ↔ leave-accrual.ts(TS) 1:1 대조");

    const accrualCases: { label: string; hire: string; asOf: string }[] = [
      { label: "신입(3개월)", hire: "2026-04-15", asOf: "2026-07-31" },
      { label: "입사 당일", hire: "2026-07-31", asOf: "2026-07-31" },
      { label: "11개월(월 발생 상한 직전)", hire: "2025-09-01", asOf: "2026-07-31" },
      { label: "정확히 1년", hire: "2025-07-31", asOf: "2026-07-31" },
      { label: "1주년 하루 전", hire: "2025-08-01", asOf: "2026-07-31" },
      { label: "3년차(가산 시작)", hire: "2023-07-31", asOf: "2026-07-31" },
      { label: "말일 입사 1/31 — 2월 기념일", hire: "2020-01-31", asOf: "2020-02-28" },
      { label: "말일 입사 1/31 — 기념일 하루 전", hire: "2020-01-31", asOf: "2020-02-27" },
      { label: "말일 입사 1/31 — 6년차", hire: "2020-01-31", asOf: "2026-02-28" },
      { label: "윤일 입사 2/29 — 평년 기념일", hire: "2020-02-29", asOf: "2021-02-28" },
      { label: "장기근속(상한 25일)", hire: "2000-06-15", asOf: "2026-07-31" },
      { label: "오늘 기준 데모 근속", hire: ymdAdd(ymdAddYears(today, -2), -40), asOf: today },
    ];

    for (const c of accrualCases) {
      const sql = await leaveYearOf(c.hire, c.asOf);
      const ts = accrualForLeaveYear(c.hire, c.asOf);
      const win = leaveYearWindow(c.hire, c.asOf);
      const ok =
        !!sql &&
        !!win &&
        near(n(sql.granted_days), ts.days) &&
        n(sql.year_index) === win.yearIndex &&
        sql.period_start === win.start &&
        sql.period_end === win.end;
      check(
        `★ ${c.label} — SQL과 TS의 부여일수·연차연도 구간이 같다`,
        ok,
        sql
          ? `SQL ${n(sql.granted_days)}일 ${sql.period_start}~${sql.period_end}(y${n(sql.year_index)}) · TS ${ts.days}일 ${win?.start}~${win?.end}(y${win?.yearIndex})`
          : "SQL이 행을 돌려주지 않았다",
      );
    }

    // 두 구현이 같은 방향으로 틀렸을 수도 있다. 법정 수치를 몇 개 못박아 둔다.
    const legal = await Promise.all([
      leaveYearOf("2025-07-31", "2026-07-31"),
      leaveYearOf("2023-07-31", "2026-07-31"),
      leaveYearOf("2025-08-15", "2026-07-31"),
      leaveYearOf("2000-06-15", "2026-07-31"),
    ]);
    check(
      "근로기준법 수치가 그대로 나온다 (1년=15일 · 3년=16일 · 1년미만 상한 11일 · 상한 25일)",
      near(n(legal[0]?.granted_days), 15) &&
        near(n(legal[1]?.granted_days), 16) &&
        near(n(legal[2]?.granted_days), 11) &&
        near(n(legal[3]?.granted_days), 25),
      legal.map((r) => n(r?.granted_days)).join(" / "),
    );

    const noRow = await Promise.all([
      leaveYearOf(null, today),
      leaveYearOf(ymdAdd(today, 10), today),
    ]);
    check(
      "★ 입사일이 없거나 입사 전이면 행을 돌려주지 않는다 (0일로 주면 분모가 오염된다)",
      noRow[0] === null && noRow[1] === null,
      JSON.stringify(noRow),
    );

    console.log("\n[C-2] annual_leave_usage_by_team — 팀 단위 재계산 대조");

    // 산정 케이스를 팀별로 갈라 둔다. 한 팀에 섞으면 어느 입사일이 어긋났는지
    // 알 수 없고, 무엇보다 uncomputed가 분모를 오염시키는지를 못 본다.
    const teamA = await makeTeam("A-3년차와입사일없음");
    const teamB = await makeTeam("B-신입과말일입사");
    const teamC = await makeTeam("C-입사예정자만");

    const HIRE_3Y = ymdAdd(ymdAddYears(today, -3), -10);
    const HIRE_NEW = ymdAdd(today, -100);
    const HIRE_EOM = "2020-01-31";

    const usr3y = await makeEmployee({ slug: "leave-3y", name: "3년차", hireDate: HIRE_3Y, teamId: teamA });
    await makeEmployee({ slug: "leave-nohire", name: "입사일없음", hireDate: null, teamId: teamA });
    await makeEmployee({ slug: "leave-new", name: "신입", hireDate: HIRE_NEW, teamId: teamB });
    await makeEmployee({ slug: "leave-eom", name: "말일입사", hireDate: HIRE_EOM, teamId: teamB });
    await makeEmployee({ slug: "leave-future", name: "입사예정", hireDate: ymdAdd(today, 45), teamId: teamC });

    const U0 = await usageByTeam(today);
    const rowOf = (rows: TeamUsageRow[], id: string) => rows.find((r) => r.team_id === id);

    check(
      "★ 모든 팀 행에서 member_count = computed_count + uncomputed_count",
      U0.every(
        (r) => n(r.member_count) === n(r.computed_count) + n(r.uncomputed_count),
      ),
      U0.filter((r) => n(r.member_count) !== n(r.computed_count) + n(r.uncomputed_count))
        .map((r) => `${r.team_name}:${n(r.member_count)}≠${n(r.computed_count)}+${n(r.uncomputed_count)}`)
        .join(", "),
    );

    const rowA = rowOf(U0, teamA);
    check(
      "★ hire_date가 없는 직원은 uncomputed로 빠지고 부여일수 분모를 오염시키지 않는다",
      !!rowA &&
        n(rowA.member_count) === 2 &&
        n(rowA.computed_count) === 1 &&
        n(rowA.uncomputed_count) === 1 &&
        near(n(rowA.granted_days), accrualForLeaveYear(HIRE_3Y, today).days),
      rowA
        ? `member ${n(rowA.member_count)} computed ${n(rowA.computed_count)} granted ${n(rowA.granted_days)} (기대 ${accrualForLeaveYear(HIRE_3Y, today).days})`
        : "팀 A 행이 없다",
    );

    const rowB = rowOf(U0, teamB);
    const expectB =
      accrualForLeaveYear(HIRE_NEW, today).days + accrualForLeaveYear(HIRE_EOM, today).days;
    check(
      "★ 신입·말일입사가 섞인 팀의 부여합이 TS 계산 합과 같다",
      !!rowB && n(rowB.computed_count) === 2 && near(n(rowB.granted_days), expectB),
      rowB ? `granted ${n(rowB.granted_days)} · 기대 ${expectB}` : "팀 B 행이 없다",
    );

    const rowC = rowOf(U0, teamC);
    check(
      "★ 입사 예정자만 있는 팀은 computed 0 · 부여 0으로 나온다 (사용률 0%인 사람으로 평균에 섞이면 안 된다)",
      !!rowC &&
        n(rowC.member_count) === 1 &&
        n(rowC.computed_count) === 0 &&
        near(n(rowC.granted_days), 0) &&
        near(n(rowC.used_days), 0),
      rowC ? JSON.stringify(rowC) : "팀 C 행이 없다",
    );

    // 전사 재계산 — 데모 직원의 실제 입사일 분포까지 전부 대조한다
    const empsForUsage = await allEmployees();
    const activeByTeam = new Map<string | null, EmployeeRow[]>();
    for (const e of empsForUsage) {
      if (e.employment_status !== "active") continue;
      const key = e.team_id;
      const list = activeByTeam.get(key) ?? [];
      list.push(e);
      activeByTeam.set(key, list);
    }

    const grantedMismatch = U0.filter((r) => {
      const list = activeByTeam.get(r.team_id) ?? [];
      const expectGranted = list.reduce(
        (s, e) => s + accrualForLeaveYear(e.hire_date, today).days,
        0,
      );
      const expectComputed = list.filter(
        (e) => e.hire_date !== null && e.hire_date <= today,
      ).length;
      return (
        n(r.member_count) !== list.length ||
        n(r.computed_count) !== expectComputed ||
        !near(n(r.granted_days), expectGranted)
      );
    });
    check(
      "★ 전 팀의 member/computed/granted가 employees에서 손수 계산한 값과 같다",
      grantedMismatch.length === 0 && U0.length === activeByTeam.size,
      grantedMismatch.length > 0
        ? grantedMismatch.map((r) => r.team_name ?? "팀 미지정").join(", ")
        : `함수 ${U0.length}행 · 직접 ${activeByTeam.size}그룹`,
    );

    console.log("\n[C-3] used_days — 무엇이 사용률에 섞이고 무엇이 안 섞이는가");

    const winA = leaveYearWindow(HIRE_3Y, today)!;
    const usedA = () => n(rowOf(U0, teamA)?.used_days);
    let prev = usedA();
    const reread = async () => {
      const rows = await usageByTeam(today);
      return n(rowOf(rows, teamA)?.used_days);
    };

    await addLeave({ employeeId: usr3y, start: today, days: 1.5 });
    let cur = await reread();
    check(
      "★ 연차연도 안의 승인된 연차는 used_days에 그대로 더해진다",
      near(cur, prev + 1.5),
      `${prev} → ${cur} (기대 ${prev + 1.5})`,
    );
    prev = cur;

    await addLeave({ employeeId: usr3y, start: ymdAdd(winA.start, -5), days: 3 });
    cur = await reread();
    check(
      "★ 연차연도 시작 전의 연차는 세지 않는다 (구간 경계)",
      near(cur, prev),
      `${prev} → ${cur} · 구간 ${winA.start}~${winA.end}`,
    );
    prev = cur;

    await addLeave({ employeeId: usr3y, start: ymdAdd(winA.end, 5), days: 2 });
    cur = await reread();
    check(
      "연차연도 종료 후의 연차도 세지 않는다",
      near(cur, prev),
      `${prev} → ${cur}`,
    );
    prev = cur;

    await addLeave({ employeeId: usr3y, start: today, days: 4, status: "rejected" });
    await addLeave({ employeeId: usr3y, start: today, days: 4, status: "pending" });
    await addLeave({ employeeId: usr3y, start: today, days: 4, status: "cancelled" });
    cur = await reread();
    check(
      "★ 승인되지 않은 휴가(반려·대기·취소)는 used_days에 안 들어간다",
      near(cur, prev),
      `${prev} → ${cur}`,
    );
    prev = cur;

    await addLeave({
      employeeId: usr3y,
      start: ymdAdd(today, 1),
      days: 2,
      category: "industrial_accident",
    });
    await addLeave({
      employeeId: usr3y,
      start: ymdAdd(today, 2),
      days: 1,
      category: "congratulation_condolence",
    });
    cur = await reread();
    check(
      "★ 법정휴가(산재·경조)는 연차 잔여를 깎지 않으므로 사용률에도 안 섞인다",
      near(cur, prev),
      `${prev} → ${cur}`,
    );

    // 전사 재계산 — 위 조작까지 반영된 최종 상태를 손으로 다시 센다
    const U1 = await usageByTeam(today);
    const approvedLeaves = await allApprovedLeaves();
    const leavesByEmp = new Map<string, LeaveRow[]>();
    for (const l of approvedLeaves) {
      const list = leavesByEmp.get(l.employee_id) ?? [];
      list.push(l);
      leavesByEmp.set(l.employee_id, list);
    }

    const usedMismatch = U1.filter((r) => {
      const list = activeByTeam.get(r.team_id) ?? [];
      const expectUsed = list.reduce((sum, e) => {
        const win = leaveYearWindow(e.hire_date, today);
        if (!win) return sum; // 산정 불가 인원은 분자에도 넣지 않는다
        const mine = leavesByEmp.get(e.id) ?? [];
        return (
          sum +
          mine
            .filter(
              (l) =>
                l.leave_category === "annual" &&
                l.start_date >= win.start &&
                l.start_date <= win.end,
            )
            .reduce((s, l) => s + n(l.days), 0)
        );
      }, 0);
      return !near(n(r.used_days), expectUsed);
    });
    check(
      "★ 전 팀의 used_days가 leave_requests에서 손수 센 값과 같다 (승인+연차+연차연도 안)",
      usedMismatch.length === 0,
      usedMismatch.map((r) => `${r.team_name ?? "팀 미지정"}=${n(r.used_days)}`).join(", "),
    );

    // ═══════════════════════════════════════════════════════════════
    // D. 결재 집계 — 시각의 출처를 옮긴 것이 실제로 맞는지
    //    2001년 3월은 어떤 화면도 조회하지 않는 빈 구간이라, 여기서는
    //    증감이 아니라 절대값으로 못박을 수 있다.
    // ═══════════════════════════════════════════════════════════════
    console.log("\n[D] approval_activity — 상신·결재 시각은 approval_steps에서 잰다");

    const A0 = await approvals(APPROVAL_FROM, APPROVAL_TO);
    check(
      `검증 구간(${APPROVAL_FROM}~${APPROVAL_TO})이 비어 있다 — 아래 절대값 비교의 전제`,
      n(A0.submitted_count) === 0 && n(A0.decided_count) === 0,
      `submitted=${n(A0.submitted_count)} decided=${n(A0.decided_count)}`,
    );
    const pendingBase = n(A0.pending_count);

    const makeDoc = async (opts: {
      title: string;
      status: string;
      createdAt: string;
      currentStep?: number;
      steps: { order: number; createdAt: string; processedAt: string | null; status: string }[];
    }) => {
      const { data, error } = await admin
        .from("approval_documents")
        .insert({
          document_type: "expense",
          title: `[e2e] ${opts.title}`,
          requester_id: usr3y,
          status: opts.status,
          current_step: opts.currentStep ?? (opts.status === "draft" ? 0 : 1),
          created_at: opts.createdAt,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`결재 문서 생성 실패: ${error?.message}`);
      const id = (data as { id: string }).id;
      docIds.push(id);
      if (opts.steps.length > 0) {
        const { error: stepError } = await admin.from("approval_steps").insert(
          opts.steps.map((s) => ({
            document_id: id,
            step_order: s.order,
            approver_id: adminEmp.id,
            status: s.status,
            processed_at: s.processedAt,
            created_at: s.createdAt,
          })),
        );
        if (stepError) throw new Error(`결재 단계 생성 실패: ${stepError.message}`);
      }
      return id;
    };

    /*
     * 문서를 하나씩 넣으며 그때마다 다시 센다. 여섯 건을 한꺼번에 넣고 합계만
     * 보면, 어느 문서가 어느 칸에 들어갔는지는 알 수 없다 — 두 건이 서로
     * 반대 방향으로 틀려도 합은 맞는다.
     */

    // 상신 시각을 approval_documents.created_at으로 재면 이 문서는 1999년 상신이 된다
    const doc1 = await makeDoc({
      title: "created_at은 1999년, 단계는 2001-03",
      status: "approved",
      createdAt: "1999-01-01T09:00:00+09:00",
      steps: [
        { order: 1, createdAt: "2001-03-10T09:00:00+09:00", processedAt: "2001-03-11T09:00:00+09:00", status: "approved" },
        { order: 2, createdAt: "2001-03-10T09:00:00+09:00", processedAt: "2001-03-12T09:00:00+09:00", status: "approved" },
      ],
    });
    const A1 = await approvals(APPROVAL_FROM, APPROVAL_TO);
    check(
      "★ 상신 시각은 approval_steps.created_at이다 (문서 created_at이 1999년이어도 3월 상신으로 잡힌다)",
      n(A1.submitted_count) === 1 && n(A1.decided_count) === 1 && n(A1.approved_count) === 1,
      `submitted=${n(A1.submitted_count)} decided=${n(A1.decided_count)} approved=${n(A1.approved_count)}`,
    );

    // 임시저장 — 단계가 없다. 문서 created_at은 구간 한가운데다
    await makeDoc({
      title: "임시저장(단계 없음)",
      status: "draft",
      createdAt: "2001-03-15T09:00:00+09:00",
      steps: [],
    });
    const A2 = await approvals(APPROVAL_FROM, APPROVAL_TO);
    check(
      "★ 임시저장(단계 없음)은 상신 건수에 안 잡힌다",
      n(A2.submitted_count) === n(A1.submitted_count),
      `submitted ${n(A1.submitted_count)} → ${n(A2.submitted_count)}`,
    );

    // 문서 created_at은 구간 안, 단계는 구간 밖 — 상신으로 잡히면 안 된다
    await makeDoc({
      title: "문서는 3월 생성 · 상신은 4월",
      status: "approved",
      createdAt: "2001-03-15T09:00:00+09:00",
      steps: [
        { order: 1, createdAt: "2001-04-01T00:30:00+09:00", processedAt: "2001-04-02T09:00:00+09:00", status: "approved" },
      ],
    });
    const A3 = await approvals(APPROVAL_FROM, APPROVAL_TO);
    check(
      "★ 문서 created_at이 구간 안이어도 단계가 구간 밖이면 상신·결재 어느 쪽에도 안 잡힌다",
      n(A3.submitted_count) === n(A2.submitted_count) &&
        n(A3.decided_count) === n(A2.decided_count),
      `submitted ${n(A2.submitted_count)} → ${n(A3.submitted_count)} · decided ${n(A2.decided_count)} → ${n(A3.decided_count)}`,
    );

    // 시행완료 — 승인을 거친 문서다
    await makeDoc({
      title: "시행완료",
      status: "completed",
      createdAt: "2001-03-05T09:00:00+09:00",
      steps: [
        { order: 1, createdAt: "2001-03-05T09:00:00+09:00", processedAt: "2001-03-06T09:00:00+09:00", status: "approved" },
      ],
    });
    const A4 = await approvals(APPROVAL_FROM, APPROVAL_TO);
    check(
      "★ approved_count에 시행완료(completed)가 포함된다 (빼면 승인 건수가 시간이 갈수록 줄어든다)",
      n(A4.approved_count) === n(A3.approved_count) + 1 &&
        n(A4.decided_count) === n(A3.decided_count) + 1,
      `approved ${n(A3.approved_count)} → ${n(A4.approved_count)}`,
    );

    await makeDoc({
      title: "반려",
      status: "rejected",
      createdAt: "2001-03-20T09:00:00+09:00",
      steps: [
        { order: 1, createdAt: "2001-03-20T09:00:00+09:00", processedAt: "2001-03-21T09:00:00+09:00", status: "rejected" },
      ],
    });
    const A5 = await approvals(APPROVAL_FROM, APPROVAL_TO);
    check(
      "반려는 rejected_count와 decided_count에만 들어간다",
      n(A5.rejected_count) === n(A4.rejected_count) + 1 &&
        n(A5.approved_count) === n(A4.approved_count) &&
        n(A5.decided_count) === n(A4.decided_count) + 1,
      `rejected ${n(A4.rejected_count)} → ${n(A5.rejected_count)} · approved ${n(A4.approved_count)} → ${n(A5.approved_count)}`,
    );

    // 종료일 당일 23:30 상신 → 다음 달 결재. 구간은 종료일 당일을 포함한다
    await makeDoc({
      title: "종료일 당일 상신 · 다음달 결재",
      status: "approved",
      createdAt: "2001-03-31T23:30:00+09:00",
      steps: [
        { order: 1, createdAt: "2001-03-31T23:30:00+09:00", processedAt: "2001-04-10T09:00:00+09:00", status: "approved" },
      ],
    });
    const A6 = await approvals(APPROVAL_FROM, APPROVAL_TO);
    check(
      "종료일 당일(23:30) 상신은 구간에 포함되고, 결재가 다음 달이면 결재 건수에는 안 들어간다",
      n(A6.submitted_count) === n(A5.submitted_count) + 1 &&
        n(A6.decided_count) === n(A5.decided_count),
      `submitted ${n(A5.submitted_count)} → ${n(A6.submitted_count)} · decided ${n(A5.decided_count)} → ${n(A6.decided_count)}`,
    );
    check(
      "빈 구간에서 시작해 넣은 여섯 건의 최종 합계가 예상과 정확히 같다",
      n(A6.submitted_count) === 4 &&
        n(A6.decided_count) === 3 &&
        n(A6.approved_count) === 2 &&
        n(A6.rejected_count) === 1,
      `submitted=${n(A6.submitted_count)}/4 decided=${n(A6.decided_count)}/3 approved=${n(A6.approved_count)}/2 rejected=${n(A6.rejected_count)}/1`,
    );
    check(
      "평균 처리 소요는 min(단계 생성) ~ max(단계 처리)로 잰다",
      near(n(A6.avg_decision_days), 1.3),
      `avg=${A6.avg_decision_days} (기대 1.3 = (2.0+1.0+1.0)/3)`,
    );

    // updated_at을 지금으로 민다 — touch_updated_at 트리거가 알아서 밀어 준다
    const { data: beforeTouch } = await admin
      .from("approval_documents")
      .select("updated_at")
      .eq("id", doc1)
      .single();
    await admin
      .from("approval_documents")
      .update({ title: "[e2e] updated_at을 지금으로 민 문서" })
      .eq("id", doc1);
    const { data: afterTouch } = await admin
      .from("approval_documents")
      .select("updated_at")
      .eq("id", doc1)
      .single();
    const touched =
      (afterTouch as { updated_at: string } | null)?.updated_at !==
      (beforeTouch as { updated_at: string } | null)?.updated_at;

    const A7 = await approvals(APPROVAL_FROM, APPROVAL_TO);
    check(
      "★ 결재가 끝난 문서의 updated_at을 나중으로 밀어도 평균 처리 소요가 변하지 않는다",
      touched && near(n(A7.avg_decision_days), n(A6.avg_decision_days)),
      `updated_at 변경됨=${touched} · avg ${A6.avg_decision_days} → ${A7.avg_decision_days}`,
    );
    check(
      "그때 승인·결재완료 건수도 그대로다 (updated_at은 어디에도 안 쓰인다)",
      n(A7.approved_count) === n(A6.approved_count) &&
        n(A7.decided_count) === n(A6.decided_count),
      `${n(A6.approved_count)}/${n(A6.decided_count)} → ${n(A7.approved_count)}/${n(A7.decided_count)}`,
    );

    // 지금 대기 중인 문서 — 기간과 무관해야 한다
    const pendingStepAt = new Date(Date.now() - 40 * 86400 * 1000).toISOString();
    await makeDoc({
      title: "40일째 대기",
      status: "pending",
      createdAt: pendingStepAt,
      steps: [{ order: 1, createdAt: pendingStepAt, processedAt: null, status: "pending" }],
    });

    const A8 = await approvals(APPROVAL_FROM, APPROVAL_TO);
    const thisMonth = `${today.slice(0, 7)}-01`;
    const A9 = await approvals(thisMonth, today);
    check(
      "★ pending_count와 oldest_pending_days는 기간과 무관한 '지금' 값이다",
      n(A8.pending_count) === pendingBase + 1 &&
        n(A8.pending_count) === n(A9.pending_count) &&
        n(A8.oldest_pending_days) === n(A9.oldest_pending_days),
      `2001구간 ${n(A8.pending_count)}건/${n(A8.oldest_pending_days)}일 · 이번달 ${n(A9.pending_count)}건/${n(A9.oldest_pending_days)}일`,
    );
    check(
      "가장 오래된 대기 문서의 경과일이 상신 시각(단계 생성)에서 계산된다",
      n(A8.oldest_pending_days) >= 40,
      `oldest=${n(A8.oldest_pending_days)}일 (기대 ≥40)`,
    );
    check(
      "대기 문서가 생겨도 기간 집계(상신·결재 건수)는 흔들리지 않는다",
      n(A8.submitted_count) === n(A7.submitted_count) &&
        n(A8.decided_count) === n(A7.decided_count),
      `submitted ${n(A7.submitted_count)} → ${n(A8.submitted_count)}`,
    );

    // ═══════════════════════════════════════════════════════════════
    // E. 최근 입사자
    // ═══════════════════════════════════════════════════════════════
    console.log("\n[E] recent_hires — 90일 창의 경계");

    const hireToday = await makeEmployee({ slug: "hire-d0", name: "오늘입사", hireDate: today });
    const hire89 = await makeEmployee({ slug: "hire-d89", name: "89일전", hireDate: ymdAdd(today, -89) });
    const hire90 = await makeEmployee({ slug: "hire-d90", name: "정확히90일전", hireDate: ymdAdd(today, -90) });
    const hire91 = await makeEmployee({ slug: "hire-d91", name: "91일전", hireDate: ymdAdd(today, -91) });
    const hireFuture = await makeEmployee({ slug: "hire-future", name: "입사예정", hireDate: ymdAdd(today, 10) });
    const hireTerm = await makeEmployee({
      slug: "hire-term",
      name: "최근입사후퇴사",
      hireDate: ymdAdd(today, -5),
      status: "terminated",
    });

    const hires = await recentHires(90);
    const hireIds = new Set(hires.map((h) => h.employee_id));

    check(
      "★ 창은 (오늘-90일, 오늘] — 정확히 90일 전 입사자는 제외되고 89일 전은 포함된다",
      hireIds.has(hire89) && !hireIds.has(hire90) && !hireIds.has(hire91),
      `89일=${hireIds.has(hire89)} 90일=${hireIds.has(hire90)} 91일=${hireIds.has(hire91)}`,
    );
    check(
      "오늘 입사자는 포함되고 days_since=0이다",
      hireIds.has(hireToday) &&
        n(hires.find((h) => h.employee_id === hireToday)?.days_since) === 0,
      `days_since=${hires.find((h) => h.employee_id === hireToday)?.days_since}`,
    );
    check(
      "★ 입사 예정자(미래 hire_date)는 최근 입사자에 들어가지 않는다",
      !hireIds.has(hireFuture),
      "입사 예정자가 명단 맨 위에 섰다",
    );
    check(
      "★ 퇴사자는 최근 입사자에 들어가지 않는다",
      !hireIds.has(hireTerm),
      "퇴사자가 들어갔다",
    );

    const empsForHires = await allEmployees();
    const handHires = empsForHires
      .filter(
        (e) =>
          e.employment_status === "active" &&
          e.hire_date !== null &&
          e.hire_date <= today &&
          e.hire_date > ymdAdd(today, -90),
      )
      .map((e) => e.id)
      .sort();
    const fnHires = Array.from(hireIds).sort();
    check(
      "★ 명단이 employees에서 같은 조건으로 직접 고른 집합과 정확히 같다",
      handHires.length === fnHires.length &&
        handHires.every((id, i) => id === fnHires[i]),
      `함수 ${fnHires.length}명 · 직접 ${handHires.length}명`,
    );
    check(
      "days_since가 오늘 - hire_date와 같다",
      hires.every((h) => {
        const expect = Math.round(
          (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${h.hired_on}T00:00:00Z`)) /
            86400000,
        );
        return n(h.days_since) === expect;
      }),
      hires.map((h) => `${h.hired_on}:${n(h.days_since)}`).join(", "),
    );
    check(
      "정렬이 입사일 최신순이다",
      hires.every((h, i) => i === 0 || hires[i - 1].hired_on >= h.hired_on),
      hires.map((h) => h.hired_on).join(" > "),
    );

    // ═══════════════════════════════════════════════════════════════
    // F. 앱 조회 계층 — 함수가 맞아도 화면이 못 부르면 소용이 없다
    //    (e2e-assets에서 51건이 전부 통과하는 동안 임베드 모호성 하나를
    //     아무도 못 잡았던 자리다. 조회 계층의 문자열은 따로 찔러야 한다)
    // ═══════════════════════════════════════════════════════════════
    console.log("\n[F] src/features/admin/data.ts가 쓰는 호출 형태");

    const dataLayerCalls: { label: string; name: string; args: Record<string, unknown> }[] = [
      { label: "getHeadcountSummary", name: "headcount_summary", args: {} },
      { label: "getHeadcountByDepartment", name: "headcount_by_department", args: {} },
      { label: "getTodayAttendanceSummary", name: "today_attendance_summary", args: { p_date: today } },
      { label: "getAnnualLeaveUsageByTeam", name: "annual_leave_usage_by_team", args: { p_as_of: today } },
      { label: "getApprovalActivity", name: "approval_activity", args: { p_from: thisMonth, p_to: today } },
      { label: "getRecentHires", name: "recent_hires", args: { p_days: 90 } },
    ];
    const argFailures: string[] = [];
    for (const c of dataLayerCalls) {
      const res = await adminUser.sb.rpc(c.name, c.args);
      if (res.error) argFailures.push(`${c.label}: ${res.error.message}`);
    }
    check(
      "★ data.ts가 넘기는 RPC 인자 이름이 함수 시그니처와 전부 맞는다",
      argFailures.length === 0,
      argFailures.join(" | "),
    );

    const wrongArg = await adminUser.sb.rpc("recent_hires", { days: 90 });
    check(
      "인자 이름이 틀리면 실제로 실패한다 (위 검증이 헛돌지 않는다)",
      Boolean(wrongArg.error),
      "틀린 인자 이름이 통과했다 — 위 검증이 아무것도 보증하지 못한다",
    );

    const auditEmbed = await adminUser.sb
      .from("audit_logs")
      .select(
        "id, action, target_id, detail, created_at, actor_id, actor:employees!actor_id(id, name, email)",
      )
      .order("created_at", { ascending: false })
      .limit(1);
    check(
      "★ audit_logs 임베드가 FK를 명시해 모호하지 않다 (actor:employees!actor_id)",
      !auditEmbed.error,
      auditEmbed.error?.message ?? "",
    );

    const memberAudit = await memberUser.sb.from("audit_logs").select("id").limit(1);
    check(
      "감사 로그는 함수 없이도 관리자에게만 보인다 (audit_logs SELECT 정책이 권한 경계)",
      (memberAudit.data ?? []).length === 0,
      `일반직원에게 ${(memberAudit.data ?? []).length}건 보임`,
    );
  } finally {
    console.log("\n[정리]");

    if (docIds.length > 0) {
      // 문서를 지우면 approval_steps가 cascade로 함께 지워진다
      await admin.from("approval_documents").delete().in("id", docIds);
    }
    await admin.from("approval_documents").delete().like("title", "[e2e]%");
    console.log(`  · 결재 문서 ${docIds.length}건 삭제`);

    // 직원을 지우면 attendance_records·leave_requests가 cascade로 함께 지워진다
    await admin.from("employees").delete().like("email", `${EMAIL_PREFIX}%`);
    console.log("  · 임시 직원(근태·휴가 포함) 삭제");

    if (teamIds.length > 0) await admin.from("teams").delete().in("id", teamIds);
    await admin.from("teams").delete().like("name", `${TEAM_PREFIX}%`);
    console.log(`  · 임시 팀 ${teamIds.length}개 삭제`);

    if (holidayDates.length > 0) {
      await admin.from("holidays").delete().in("date", holidayDates);
      console.log(`  · 임시 휴일 ${holidayDates.length}건 삭제`);
    }

    // 데모 계정은 하나도 고치지 않았다. 역할만 원복하면 된다
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
