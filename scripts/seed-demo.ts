/**
 * 데모 데이터 시딩
 *
 * 왜 필요한가: scripts/seed.ts는 관리자 계정 1개만 만들고 hire_date를 시딩 당일로
 * 넣는다. 그래서 근속 0개월 → 발생 연차 0일, 근태 기록 0건 → 주간·월간 시간 0,
 * 부서·팀이 없어 manages_employee()가 항상 false → 승인 대상 팀원 0명이 된다.
 * 화면이 전부 "0"으로 보이던 직접 원인이 이것이다.
 *
 * 이 스크립트는 화면 품질을 눈으로 판단할 수 있을 만큼의 조직·근태·문서를 채운다.
 * 여러 번 실행해도 안전하다(이메일·자연키 기준으로 존재하면 건너뛴다).
 *
 * 실행:  npm run seed:demo
 * 되돌리기: npm run seed:demo -- --clean
 *
 * 주의: 데모 임직원의 이메일은 전부 @demo.aimbrige.kr 이다.
 * 실제 계정과 섞이지 않고, --clean이 이 도메인만 지운다.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();

/** 데모 계정 전용 도메인 — --clean의 삭제 기준이기도 하다 */
const DEMO_DOMAIN = "demo.aimbrige.kr";

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

if (!url) fail("NEXT_PUBLIC_SUPABASE_URL 이 없습니다.");
if (!serviceKey) fail("SUPABASE_SERVICE_ROLE_KEY 이 없습니다.");

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const clean = process.argv.includes("--clean");

// ── 날짜 유틸 (Asia/Seoul 기준 YYYY-MM-DD) ────────────────────────────
const TODAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
}).format(new Date());

function addDays(ymd: string, delta: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function weekdayOf(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** KST HH:MM을 그 날짜의 timestamptz로 (KST = UTC+9) */
function kstAt(ymd: string, hhmm: string) {
  return `${ymd}T${hhmm}:00+09:00`;
}

/**
 * 시드 고정 난수.
 * Math.random()을 쓰면 실행할 때마다 데이터가 달라져서 "어제와 뭐가 바뀌었는지"를
 * 판단할 수 없다. 같은 입력이면 같은 결과가 나오도록 고정한다.
 */
function rand(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ── 조직 정의 ─────────────────────────────────────────────────────────
const DEPARTMENTS = ["경영지원본부", "개발본부", "사업본부"] as const;

const TEAMS: { name: string; dept: (typeof DEPARTMENTS)[number] }[] = [
  { name: "인사총무팀", dept: "경영지원본부" },
  { name: "재무회계팀", dept: "경영지원본부" },
  { name: "플랫폼개발팀", dept: "개발본부" },
  { name: "프로덕트팀", dept: "개발본부" },
  { name: "영업1팀", dept: "사업본부" },
];

interface DemoPerson {
  slug: string;
  name: string;
  position: string;
  dept: (typeof DEPARTMENTS)[number];
  team: string;
  role: "manager" | "employee";
  /** 오늘로부터 며칠 전 입사 */
  hireDaysAgo: number;
  /** 부서장이면 부서 이름, 팀장이면 팀 이름 */
  leads?: { department?: string; team?: string };
}

/**
 * 입사일을 6개월~4년 전으로 흩뿌린다.
 * 근로기준법 제60조상 1년 미만·1년차·3년차 이상이 모두 섞여야
 * 연차 발생 로직과 소진율 게이지가 의미 있는 값을 보여준다.
 */
const PEOPLE: DemoPerson[] = [
  {
    slug: "jhkim",
    name: "김지훈",
    position: "본부장",
    dept: "경영지원본부",
    team: "인사총무팀",
    role: "manager",
    hireDaysAgo: 1490, // 약 4년 1개월 → 연차 16일
    leads: { department: "경영지원본부", team: "인사총무팀" },
  },
  {
    slug: "sylee",
    name: "이수연",
    position: "책임",
    dept: "경영지원본부",
    team: "인사총무팀",
    role: "employee",
    hireDaysAgo: 820, // 약 2년 3개월 → 15일
  },
  {
    slug: "mjpark",
    name: "박민준",
    position: "매니저",
    dept: "경영지원본부",
    team: "재무회계팀",
    role: "manager",
    hireDaysAgo: 1130,
    leads: { team: "재무회계팀" },
  },
  {
    slug: "hjchoi",
    name: "최현정",
    position: "선임",
    dept: "개발본부",
    team: "플랫폼개발팀",
    role: "manager",
    hireDaysAgo: 1620,
    leads: { department: "개발본부", team: "플랫폼개발팀" },
  },
  {
    slug: "dwjung",
    name: "정도원",
    position: "선임",
    dept: "개발본부",
    team: "플랫폼개발팀",
    role: "employee",
    hireDaysAgo: 610,
  },
  {
    slug: "eskang",
    name: "강은서",
    position: "주니어",
    dept: "개발본부",
    team: "플랫폼개발팀",
    role: "employee",
    hireDaysAgo: 200, // 1년 미만 → 개근 월수만큼(최대 11일)
  },
  {
    slug: "thyoon",
    name: "윤태호",
    position: "책임",
    dept: "개발본부",
    team: "프로덕트팀",
    role: "manager",
    hireDaysAgo: 980,
    leads: { team: "프로덕트팀" },
  },
  {
    slug: "jwlim",
    name: "임재원",
    position: "매니저",
    dept: "개발본부",
    team: "프로덕트팀",
    role: "employee",
    hireDaysAgo: 430,
  },
  {
    slug: "arshin",
    name: "신아름",
    position: "팀장",
    dept: "사업본부",
    team: "영업1팀",
    role: "manager",
    hireDaysAgo: 1280,
    leads: { department: "사업본부", team: "영업1팀" },
  },
  {
    slug: "sboh",
    name: "오승비",
    position: "매니저",
    dept: "사업본부",
    team: "영업1팀",
    role: "employee",
    hireDaysAgo: 340,
  },
  {
    slug: "hwseo",
    name: "서현우",
    position: "주니어",
    dept: "사업본부",
    team: "영업1팀",
    role: "employee",
    hireDaysAgo: 175,
  },
];

async function main() {
  if (clean) return cleanUp();

  // ── 0) 역할 ────────────────────────────────────────────────────────
  const { data: roles } = await supabase.from("roles").select("id, name");
  const roleId = (name: string) => {
    const found = roles?.find((r) => r.name === name);
    if (!found) fail(`역할 '${name}' 이 없습니다. 마이그레이션을 먼저 실행하세요.`);
    return found.id as string;
  };

  // ── 1) 부서 ────────────────────────────────────────────────────────
  const deptIds = new Map<string, string>();
  for (const name of DEPARTMENTS) {
    const { data: existing } = await supabase
      .from("departments")
      .select("id")
      .eq("name", name)
      .maybeSingle();
    if (existing) {
      deptIds.set(name, existing.id);
      continue;
    }
    const { data, error } = await supabase
      .from("departments")
      .insert({ name })
      .select("id")
      .single();
    if (error) fail(`부서 생성 실패(${name}): ${error.message}`);
    deptIds.set(name, data.id);
  }
  console.log(`· 부서 ${deptIds.size}개`);

  // ── 2) 팀 ──────────────────────────────────────────────────────────
  const teamIds = new Map<string, string>();
  for (const team of TEAMS) {
    const { data: existing } = await supabase
      .from("teams")
      .select("id")
      .eq("name", team.name)
      .maybeSingle();
    if (existing) {
      teamIds.set(team.name, existing.id);
      continue;
    }
    const { data, error } = await supabase
      .from("teams")
      .insert({ name: team.name, department_id: deptIds.get(team.dept) })
      .select("id")
      .single();
    if (error) fail(`팀 생성 실패(${team.name}): ${error.message}`);
    teamIds.set(team.name, data.id);
  }
  console.log(`· 팀 ${teamIds.size}개`);

  // ── 3) 임직원 ──────────────────────────────────────────────────────
  const empIds = new Map<string, string>();
  for (const person of PEOPLE) {
    const email = `${person.slug}@${DEMO_DOMAIN}`;
    const payload = {
      email,
      name: person.name,
      position: person.position,
      department_id: deptIds.get(person.dept),
      team_id: teamIds.get(person.team),
      role_id: roleId(person.role),
      employment_status: "active" as const,
      hire_date: addDays(TODAY, -person.hireDaysAgo),
      phone: `010-${1000 + person.hireDaysAgo % 9000}-${
        1000 + (person.slug.charCodeAt(0) * 37) % 9000
      }`,
    };

    const { data: existing } = await supabase
      .from("employees")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      await supabase.from("employees").update(payload).eq("id", existing.id);
      empIds.set(person.slug, existing.id);
    } else {
      const { data, error } = await supabase
        .from("employees")
        .insert(payload)
        .select("id")
        .single();
      if (error) fail(`임직원 생성 실패(${person.name}): ${error.message}`);
      empIds.set(person.slug, data.id);
    }
  }
  console.log(`· 임직원 ${empIds.size}명`);

  // ── 4) 부서장·팀장 지정 ────────────────────────────────────────────
  // manages_employee()가 이걸 못 찾으면 승인 대상 팀원이 0명이 된다
  for (const person of PEOPLE) {
    if (!person.leads) continue;
    const managerId = empIds.get(person.slug);
    if (person.leads.department) {
      await supabase
        .from("departments")
        .update({ manager_id: managerId })
        .eq("id", deptIds.get(person.leads.department as never));
    }
    if (person.leads.team) {
      await supabase
        .from("teams")
        .update({ manager_id: managerId })
        .eq("id", teamIds.get(person.leads.team));
    }
  }
  console.log("· 부서장·팀장 지정 완료");

  // ── 5) 실제 로그인 계정 배치 ───────────────────────────────────────
  /*
   * SEED_ADMIN_EMAIL만 챙기면 안 된다. 실제로 로그인하는 계정이 그것과
   * 다를 수 있고(구글 계정이 여러 개면 흔하다), 부서·팀이 비어 있으면
   *  - 조직도의 "내 부서/내 팀"이 disabled로 떨어지고
   *  - manages_employee()가 false라 승인 대상이 0명이 되고
   *  - hire_date가 오늘이면 연차가 0일로 나온다.
   * auth_user_id가 연결된 계정 전부를 대상으로 한다.
   */
  const { data: linked } = await supabase
    .from("employees")
    .select("id, email, hire_date, department_id, team_id, position")
    .or(
      adminEmail
        ? `auth_user_id.not.is.null,email.eq.${adminEmail}`
        : "auth_user_id.not.is.null",
    );

  const backdated = addDays(TODAY, -900); // 약 2년 6개월 → 연차 15일
  for (const account of linked ?? []) {
    // 최근 2주 안에 찍힌 입사일은 세팅 중 생긴 자리표시로 보고 소급한다.
    // 실제 입사일이 들어 있으면 건드리지 않는다.
    const placeholderHire =
      !account.hire_date || (account.hire_date as string) > addDays(TODAY, -14);

    const patch: Record<string, unknown> = {};
    if (!account.department_id) patch.department_id = deptIds.get("경영지원본부");
    if (!account.team_id) patch.team_id = teamIds.get("인사총무팀");
    if (!account.position) patch.position = "대표";
    if (placeholderHire) patch.hire_date = backdated;

    if (Object.keys(patch).length > 0) {
      await supabase.from("employees").update(patch).eq("id", account.id);
      console.log(
        `· 로그인 계정 배치: ${account.email} — ${Object.keys(patch).join(", ")}` +
          (patch.hire_date ? ` (입사일 ${backdated})` : ""),
      );
    }
    empIds.set(`__account__${account.email}`, account.id as string);
  }
  // 결재 최종승인자로 쓸 대표 계정 하나
  const primary = (linked ?? [])[0];
  if (primary) empIds.set("__admin__", primary.id as string);

  const allIds = Array.from(empIds.values());

  // ── 6) 근태 기록 (최근 9주) ────────────────────────────────────────
  await seedAttendance(empIds);

  // ── 7) 연차·초과근무 신청 ──────────────────────────────────────────
  await seedRequests(empIds);

  // ── 8) 공지·게시글 ────────────────────────────────────────────────
  await seedPosts(empIds);

  // ── 9) 결재 문서 ──────────────────────────────────────────────────
  await seedApprovals(empIds);

  console.log(
    `\n✔ 데모 시딩 완료 (임직원 ${allIds.length}명).` +
      `\n  되돌리려면: npm run seed:demo -- --clean\n`,
  );
}

/**
 * 최근 9주치 근태.
 * 주말·공휴일은 건너뛰고, 사람마다 다른 패턴(정시/야근형/재택형)을 준다 —
 * 전원이 09:00-18:00이면 스트립과 게이지가 전부 똑같아 보인다.
 */
async function seedAttendance(empIds: Map<string, string>) {
  const { data: holidays } = await supabase
    .from("holidays")
    .select("date")
    .eq("is_non_working", true);
  const nonWorking = new Set((holidays ?? []).map((h) => h.date as string));

  const rows: Record<string, unknown>[] = [];
  const slugs = Array.from(empIds.keys());

  slugs.forEach((slug, personIndex) => {
    const employeeId = empIds.get(slug)!;
    const next = rand(personIndex * 7919 + 13);

    for (let back = 62; back >= 0; back -= 1) {
      const date = addDays(TODAY, -back);
      const weekday = weekdayOf(date);
      if (weekday === 0 || weekday === 6) continue;
      if (nonWorking.has(date)) continue;

      const roll = next();
      // 5%는 기록 없음(연차·결근) — 스트립에 빈 칸이 있어야 골격이 보인다
      if (roll < 0.05) continue;

      const late = roll > 0.92;
      const early = roll > 0.88 && roll <= 0.92;
      const remote = roll > 0.78 && roll <= 0.88;

      const inHour = late ? "09:2" + Math.floor(next() * 9) : "08:5" + Math.floor(next() * 9);
      const outHour = early
        ? "16:4" + Math.floor(next() * 9)
        : personIndex % 3 === 0
          ? "19:1" + Math.floor(next() * 9)
          : "18:1" + Math.floor(next() * 9);

      // 오늘은 아직 퇴근 전 — 퇴근 기록이 없는데 조퇴로 찍으면 상태가 모순된다
      const isToday = date === TODAY;

      rows.push({
        employee_id: employeeId,
        work_date: date,
        check_in_at: kstAt(date, inHour),
        check_out_at: isToday ? null : kstAt(date, outHour),
        work_status: remote ? "remote" : "normal_office",
        status: late ? "late" : early && !isToday ? "early_leave" : "normal",
      });
    }
  });

  // unique(employee_id, work_date) 이므로 중복은 무시하고 넘어간다
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error, count } = await supabase
      .from("attendance_records")
      .upsert(rows.slice(i, i + CHUNK), {
        onConflict: "employee_id,work_date",
        ignoreDuplicates: true,
        count: "exact",
      });
    if (error) fail(`근태 기록 생성 실패: ${error.message}`);
    inserted += count ?? 0;
  }
  console.log(`· 근태 기록 ${rows.length}건 (신규 ${inserted}건)`);
}

async function seedRequests(empIds: Map<string, string>) {
  const { count: existing } = await supabase
    .from("leave_requests")
    .select("id", { count: "exact", head: true });
  if ((existing ?? 0) > 0) {
    console.log("· 연차·초과근무 신청 — 이미 있어 건너뜀");
    return;
  }

  const slugs = Array.from(empIds.keys()).filter((s) => s !== "__admin__");
  const managerId = empIds.get("jhkim") ?? empIds.get("__admin__");

  const leaves: Record<string, unknown>[] = [];
  slugs.slice(0, 8).forEach((slug, i) => {
    const employeeId = empIds.get(slug)!;
    const start = addDays(TODAY, -(40 - i * 4));
    leaves.push({
      employee_id: employeeId,
      leave_type: i % 3 === 0 ? "half_day_am" : "full_day",
      leave_category: "annual",
      start_date: start,
      end_date: i % 3 === 0 ? start : addDays(start, i % 2),
      days: i % 3 === 0 ? 0.5 : 1 + (i % 2),
      reason: ["개인 사유", "가족 행사", "병원 진료", "휴식"][i % 4],
      status: "approved",
      approver_id: managerId,
      approved_at: new Date().toISOString(),
    });
  });

  // 승인 대기 3건 — 승인함이 비어 있으면 그 화면을 평가할 수 없다
  slugs.slice(0, 3).forEach((slug, i) => {
    leaves.push({
      employee_id: empIds.get(slug)!,
      leave_type: "full_day",
      leave_category: "annual",
      start_date: addDays(TODAY, 5 + i * 3),
      end_date: addDays(TODAY, 5 + i * 3),
      days: 1,
      reason: ["여행", "경조사", "개인 사유"][i],
      status: "pending",
    });
  });

  const { error: leaveError } = await supabase
    .from("leave_requests")
    .insert(leaves);
  if (leaveError) fail(`연차 신청 생성 실패: ${leaveError.message}`);

  const overtimes = slugs.slice(0, 5).map((slug, i) => ({
    employee_id: empIds.get(slug)!,
    work_date: addDays(TODAY, -(7 + i * 2)),
    start_time: "18:00",
    end_time: i % 2 === 0 ? "21:00" : "20:00",
    reason: ["배포 대응", "월말 마감", "고객사 이슈", "긴급 수정", "정산"][i],
    compensate_as_leave: i % 3 === 0,
    status: i < 3 ? "approved" : "pending",
    approver_id: i < 3 ? managerId : null,
    approved_at: i < 3 ? new Date().toISOString() : null,
  }));

  const { error: otError } = await supabase
    .from("overtime_requests")
    .insert(overtimes);
  if (otError) fail(`초과근무 신청 생성 실패: ${otError.message}`);

  console.log(`· 연차 ${leaves.length}건 · 초과근무 ${overtimes.length}건`);
}

async function seedPosts(empIds: Map<string, string>) {
  const { data: boards } = await supabase
    .from("boards")
    .select("id, name, board_type");
  if (!boards?.length) {
    console.log("· 게시판이 없어 글 시딩을 건너뜀");
    return;
  }

  const { count: existing } = await supabase
    .from("posts")
    .select("id", { count: "exact", head: true });
  if ((existing ?? 0) > 0) {
    console.log("· 게시글 — 이미 있어 건너뜀");
    return;
  }

  const notice = boards.find((b) => b.board_type === "notice") ?? boards[0];
  const free = boards.find((b) => b.board_type !== "notice") ?? boards[0];
  const author = empIds.get("jhkim") ?? empIds.get("__admin__")!;
  const author2 = empIds.get("sylee") ?? author;

  const posts = [
    {
      board_id: notice.id,
      title: "2026년 하계휴가 운영 안내",
      content:
        "7월 21일부터 8월 31일까지 하계휴가 기간으로 운영합니다.\n부서별로 업무 공백이 생기지 않도록 팀장과 일정을 조율한 뒤 연차를 신청해 주세요.",
      category: "인사",
      is_pinned: true,
      author_id: author,
    },
    {
      board_id: notice.id,
      title: "사내 인트라넷 오픈 안내",
      content:
        "근태·전자결재·게시판을 하나로 모은 인트라넷을 오픈했습니다.\n출퇴근 체크는 좌측 근태 메뉴에서 할 수 있습니다.",
      category: "공지",
      is_pinned: true,
      author_id: author,
    },
    {
      board_id: notice.id,
      title: "4분기 전사 워크숍 일정",
      content: "10월 17일(금) 전사 워크숍이 예정돼 있습니다. 장소는 추후 공지합니다.",
      category: "행사",
      is_pinned: false,
      author_id: author2,
    },
    {
      board_id: notice.id,
      title: "정보보안 교육 이수 요청",
      content: "전 임직원 대상 정보보안 교육을 이달 말까지 이수해 주세요.",
      category: "교육",
      is_pinned: false,
      author_id: author2,
    },
    {
      board_id: free.id,
      title: "회사 근처 점심 맛집 정리",
      content: "1층 김밥집, 뒷골목 국수집, 건너편 백반집 추천합니다.",
      category: null,
      is_pinned: false,
      author_id: empIds.get("dwjung") ?? author,
    },
    {
      board_id: free.id,
      title: "사내 러닝 크루 모집합니다",
      content: "매주 수요일 저녁 한강에서 함께 뛰실 분 구합니다.",
      category: null,
      is_pinned: false,
      author_id: empIds.get("eskang") ?? author,
    },
  ];

  const { error } = await supabase.from("posts").insert(posts);
  if (error) fail(`게시글 생성 실패: ${error.message}`);
  console.log(`· 게시글 ${posts.length}건`);
}

async function seedApprovals(empIds: Map<string, string>) {
  const { count: existing } = await supabase
    .from("approval_documents")
    .select("id", { count: "exact", head: true });
  if ((existing ?? 0) > 0) {
    console.log("· 결재 문서 — 이미 있어 건너뜀");
    return;
  }

  const approver = empIds.get("jhkim");
  const finalApprover = empIds.get("__admin__") ?? empIds.get("hjchoi");
  if (!approver || !finalApprover) {
    console.log("· 결재자 후보가 없어 결재 문서 시딩을 건너뜀");
    return;
  }

  const docs = [
    {
      document_type: "business_trip",
      title: "부산 고객사 방문 출장",
      requester: "sboh",
      form_data: {
        destination: "부산 해운대",
        purpose: "고객사 정기 미팅",
        startDate: addDays(TODAY, 6),
        endDate: addDays(TODAY, 7),
      },
      status: "pending" as const,
      approvedSteps: 0,
    },
    {
      document_type: "expense",
      title: "9월 팀 회식비 정산",
      requester: "dwjung",
      form_data: { amount: 320000, category: "복리후생", date: addDays(TODAY, -9) },
      status: "pending" as const,
      approvedSteps: 1,
    },
    {
      document_type: "remote_work",
      title: "재택근무 신청 (자녀 돌봄)",
      requester: "jwlim",
      form_data: {
        startDate: addDays(TODAY, 2),
        endDate: addDays(TODAY, 4),
        reason: "자녀 돌봄",
      },
      status: "completed" as const,
      approvedSteps: 2,
    },
    {
      document_type: "purchase_request",
      title: "개발팀 모니터 4대 구매",
      requester: "hjchoi",
      form_data: { amount: 1800000, item: "27인치 4K 모니터", quantity: 4 },
      status: "completed" as const,
      approvedSteps: 2,
    },
  ];

  for (const doc of docs) {
    const requesterId = empIds.get(doc.requester);
    if (!requesterId) continue;

    const { data: created, error } = await supabase
      .from("approval_documents")
      .insert({
        document_type: doc.document_type,
        title: doc.title,
        form_data: doc.form_data,
        requester_id: requesterId,
        status: doc.status,
        current_step: Math.min(doc.approvedSteps + 1, 2),
      })
      .select("id")
      .single();
    if (error) fail(`결재 문서 생성 실패(${doc.title}): ${error.message}`);

    const steps = [approver, finalApprover].map((approverId, index) => ({
      document_id: created.id,
      step_order: index + 1,
      approver_id: approverId,
      status: index < doc.approvedSteps ? "approved" : "pending",
      processed_at:
        index < doc.approvedSteps ? new Date().toISOString() : null,
    }));

    const { error: stepError } = await supabase
      .from("approval_steps")
      .insert(steps);
    if (stepError) fail(`결재선 생성 실패: ${stepError.message}`);
  }

  console.log(`· 결재 문서 ${docs.length}건`);
}

/** 데모 도메인 계정과 그에 딸린 데이터만 지운다 */
async function cleanUp() {
  const { data: demo } = await supabase
    .from("employees")
    .select("id")
    .like("email", `%@${DEMO_DOMAIN}`);

  const ids = (demo ?? []).map((d) => d.id as string);
  if (ids.length === 0) {
    console.log("· 삭제할 데모 계정이 없습니다.");
    return;
  }

  // 부서장·팀장 참조를 먼저 끊는다 (FK on delete가 restrict일 수 있음)
  await supabase.from("departments").update({ manager_id: null }).in("manager_id", ids);
  await supabase.from("teams").update({ manager_id: null }).in("manager_id", ids);
  // employees on delete cascade가 근태·연차·결재를 함께 지운다
  const { error } = await supabase.from("employees").delete().in("id", ids);
  if (error) fail(`데모 계정 삭제 실패: ${error.message}`);

  console.log(`✔ 데모 계정 ${ids.length}명과 관련 데이터를 삭제했습니다.`);
  console.log("  (부서·팀·게시글은 남습니다 — 실제 데이터와 섞일 수 있어 수동 확인)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
