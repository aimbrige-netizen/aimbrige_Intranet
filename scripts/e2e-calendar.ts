/**
 * 캘린더 참석자 가시성 e2e.
 *
 *   npm run e2e:calendar -- --yes
 *
 * 이 스크립트가 존재하는 이유가 분명하다.
 *
 * 마이그레이션 27이 calendar_events.attendee_ids 배열을 지운다. 그 전에
 * calendar_events_select 정책과 can_view_event()에서 `= any (attendee_ids)`
 * 조건을 빼는데, 그러면 "남의 personal 일정에 초대받은 사람"의 가시성이
 * 오로지 is_event_attendee()(= event_attendees 테이블) 하나에 걸리게 된다.
 *
 * 이 경로는 이 프로젝트에서 이미 한 번 깨진 적이 있다 — 마이그레이션 16에서
 * can_view_event()에 참석자 조건을 빠뜨려서, 초대받은 사람에게 일정은 보이는데
 * 참석자 목록이 "나 1명"으로 접히는 상태가 됐다(17에서 수정).
 *
 * 그런데 캘린더를 지나는 e2e가 하나도 없었다. 되돌릴 수 없는 컬럼 삭제를
 * 테스트 없는 경로에 하는 셈이라, 삭제 전에 이 검증을 먼저 세운다.
 *
 * ★ 이 스크립트는 마이그레이션 27 **적용 전과 후에 똑같이 통과해야 한다.**
 *   전에 통과하고 후에 깨지면, 배열을 지우면서 잃은 가시성이 있다는 뜻이다.
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
      "이 스크립트는 실제 DB에 일정·참석자를 만들고 끝나면 지웁니다.",
      "실행하려면: npm run e2e:calendar -- --yes",
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

/** attendee_ids 컬럼이 아직 있는지 — 마이그레이션 27 적용 여부 */
async function hasAttendeeIds(): Promise<boolean> {
  const { error } = await admin.from("calendar_events").select("attendee_ids").limit(1);
  return !error;
}

const TAG = "[e2e-cal]";

async function main() {
  // 서로 다른 팀이어야 team 가시성으로 새어 통과하는 일이 없다
  const OWNER = "sylee@demo.aimbrige.kr"; // 인사총무팀
  const GUEST = "dwjung@demo.aimbrige.kr"; // 플랫폼개발팀 — 남
  const OUTSIDER = "sboh@demo.aimbrige.kr"; // 영업1팀 — 초대받지 않은 남

  const emp = async (email: string) => {
    const { data } = await admin
      .from("employees")
      .select("id, name, team_id")
      .eq("email", email)
      .single();
    if (!data) throw new Error(`${email} 없음. npm run seed:demo 먼저.`);
    return data as { id: string; name: string; team_id: string | null };
  };

  const owner = await emp(OWNER);
  const guest = await emp(GUEST);
  await emp(OUTSIDER); // 존재 검증만 — 이후 접근은 전부 outsiderUser(sb) 경유

  const legacyColumn = await hasAttendeeIds();
  console.log(
    `\n  attendee_ids 컬럼: ${legacyColumn ? "아직 있음 (마이그레이션 27 적용 전)" : "없음 (적용 후)"}`,
  );

  const authIds: string[] = [];
  const eventIds: string[] = [];

  try {
    const ownerUser = await clientFor(OWNER);
    const guestUser = await clientFor(GUEST);
    const outsiderUser = await clientFor(OUTSIDER);
    authIds.push(ownerUser.authId, guestUser.authId, outsiderUser.authId);

    /* ── 준비: 남에게 안 보여야 정상인 personal 일정 ────────────────── */

    const base = {
      title: `${TAG} 1:1 면담`,
      start_at: "2026-09-10T01:00:00Z",
      end_at: "2026-09-10T02:00:00Z",
      all_day: false,
      visibility: "personal",
      owner_id: owner.id,
      // 컬럼이 남아 있는 동안에는 NOT NULL이라 값을 줘야 한다.
      // 일부러 **빈 배열**을 넣는다 — 가시성이 배열이 아니라 테이블에서
      // 나오는지 보려는 것이고, 컬럼이 사라진 뒤와 같은 조건이 된다.
      ...(legacyColumn ? { attendee_ids: [] } : {}),
    };

    const { data: created, error: createError } = await admin
      .from("calendar_events")
      .insert(base)
      .select("id")
      .single();
    if (createError || !created) throw new Error(`일정 생성 실패: ${createError?.message}`);
    eventIds.push(created.id);

    console.log("\n[1] 초대 전 — 남의 personal 일정은 안 보인다");

    const before = await guestUser.sb
      .from("calendar_events")
      .select("id")
      .eq("id", created.id);
    check(
      "초대받지 않은 사람에게 남의 personal 일정이 보이지 않는다",
      (before.data ?? []).length === 0,
      before.data?.length ? "보였다" : "",
    );

    const beforeFn = await guestUser.sb.rpc("can_view_event", { p_event_id: created.id });
    check("can_view_event()도 false다", beforeFn.data === false, `반환 ${beforeFn.data}`);

    console.log("\n[2] 초대 후 — event_attendees 하나로 가시성이 열린다");

    const invite = await admin
      .from("event_attendees")
      .insert({ event_id: created.id, employee_id: guest.id, response: "pending" })
      .select("event_id");
    check("참석자 추가", !invite.error, invite.error?.message ?? "");

    const after = await guestUser.sb
      .from("calendar_events")
      .select("id, title")
      .eq("id", created.id);
    check(
      "★ 초대받은 사람에게 남의 personal 일정이 보인다 (배열 없이 테이블만으로)",
      (after.data ?? []).length === 1,
      after.data?.length === 0 ? "안 보였다 — 배열을 지우면서 가시성을 잃었다" : "",
    );

    const afterFn = await guestUser.sb.rpc("can_view_event", { p_event_id: created.id });
    check(
      "★ can_view_event()가 true다",
      afterFn.data === true,
      `반환 ${afterFn.data}`,
    );

    console.log("\n[3] 참석자 명단 — '나 1명'으로 접히지 않는다");

    // 소유자도 참석자로 넣어 2명짜리 명단을 만든다
    await admin
      .from("event_attendees")
      .insert({ event_id: created.id, employee_id: owner.id, response: "accepted" });

    const list = await guestUser.sb
      .from("event_attendees")
      .select("employee_id, response")
      .eq("event_id", created.id);
    check(
      "★ 초대받은 사람이 참석자 명단 전체를 본다 (과거에 '나 1명'으로 접혔던 자리)",
      (list.data ?? []).length === 2,
      `${list.data?.length ?? 0}명 보임`,
    );

    const ownerList = await ownerUser.sb
      .from("event_attendees")
      .select("employee_id")
      .eq("event_id", created.id);
    check("소유자도 명단 전체를 본다", (ownerList.data ?? []).length === 2);

    console.log("\n[4] 초대받지 않은 제3자는 여전히 막힌다");

    const third = await outsiderUser.sb
      .from("calendar_events")
      .select("id")
      .eq("id", created.id);
    check("제3자에게 일정이 보이지 않는다", (third.data ?? []).length === 0);

    const thirdList = await outsiderUser.sb
      .from("event_attendees")
      .select("employee_id")
      .eq("event_id", created.id);
    check("제3자에게 참석자 명단도 보이지 않는다", (thirdList.data ?? []).length === 0);

    console.log("\n[5] RSVP — 초대받은 사람만 응답할 수 있다");

    const rsvp = await guestUser.sb.rpc("respond_to_event", {
      p_event_id: created.id,
      p_response: "accepted",
    });
    check("초대받은 사람이 참석 응답을 남긴다", !rsvp.error, rsvp.error?.message ?? "");

    const { data: myRow } = await admin
      .from("event_attendees")
      .select("response")
      .eq("event_id", created.id)
      .eq("employee_id", guest.id)
      .single();
    check("응답이 저장됐다", (myRow as { response: string } | null)?.response === "accepted");

    const thirdRsvp = await outsiderUser.sb.rpc("respond_to_event", {
      p_event_id: created.id,
      p_response: "accepted",
    });
    check("★ 초대받지 않은 사람은 응답할 수 없다", Boolean(thirdRsvp.error));

    console.log("\n[6] 전사·팀 일정의 기존 규칙은 그대로다");

    const { data: companyEvent } = await admin
      .from("calendar_events")
      .insert({
        title: `${TAG} 전사 워크숍`,
        start_at: "2026-09-11T01:00:00Z",
        end_at: "2026-09-11T02:00:00Z",
        all_day: false,
        visibility: "company",
        owner_id: owner.id,
        ...(legacyColumn ? { attendee_ids: [] } : {}),
      })
      .select("id")
      .single();
    if (companyEvent) eventIds.push(companyEvent.id);

    const companySeen = await outsiderUser.sb
      .from("calendar_events")
      .select("id")
      .eq("id", companyEvent!.id);
    check(
      "전사 일정은 초대 없이도 전 직원에게 보인다",
      (companySeen.data ?? []).length === 1,
    );

    console.log("\n[7] 컬럼이 아직 있다면 — 배열은 이제 비어 있어야 한다");

    if (legacyColumn) {
      const { data: rows } = await admin
        .from("calendar_events")
        .select("id, attendee_ids")
        .in("id", eventIds);
      const stale = (rows ?? []).filter(
        (r) => ((r as { attendee_ids: string[] }).attendee_ids ?? []).length > 0,
      );
      check(
        "코드가 배열에 더 이상 쓰지 않는다 (dual-write 제거 확인)",
        stale.length === 0,
        `${stale.length}건에 값이 남았다`,
      );
    } else {
      check("컬럼이 이미 없다 — 배열 검증 건너뜀", true);
    }
  } finally {
    console.log("\n[정리]");
    for (const id of eventIds) {
      // event_attendees는 cascade로 함께 지워진다
      await admin.from("calendar_events").delete().eq("id", id);
    }
    await admin.from("calendar_events").delete().like("title", `${TAG}%`);
    console.log(`  · 일정 ${eventIds.length}건 삭제 (참석자는 cascade)`);

    for (const authId of authIds) {
      await admin.from("employees").update({ auth_user_id: null }).eq("auth_user_id", authId);
      await admin.auth.admin.deleteUser(authId);
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
