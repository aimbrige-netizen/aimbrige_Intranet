/**
 * 마이그레이션 15 스토리지 정책 검증.
 *
 * 확인하려는 것은 두 방향이다:
 *   (1) 관리자는 남의 첨부를 지울 수 있어야 한다  ← 15가 연 것
 *   (2) 일반 직원은 여전히 남의 첨부를 못 지운다   ← 15가 깨지 않았는지
 *
 * (2)가 더 중요하다. 정책을 넓히다가 실수로 전부 열어버리는 게 진짜 위험이다.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!process.argv.includes("--yes")) {
  console.error(
    [
      "",
      "이 스크립트는 실제 스토리지에 파일을 올리고 데모 직원 역할을 잠시 바꿉니다(끝나면 원복).",
      "실행하려면: npm run e2e:storage -- --yes",
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
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const pub = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: v } = await pub.auth.verifyOtp({
    token_hash: link.properties!.hashed_token,
    type: "email",
  });
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
  const OWNER = "sylee@demo.aimbrige.kr";
  const PEER = "dwjung@demo.aimbrige.kr"; // 일반 직원
  const ADMIN = "jhkim@demo.aimbrige.kr"; // 아래에서 잠시 system_admin으로 올린다

  const { data: roles } = await admin.from("roles").select("id, name");
  const adminRole = roles!.find((r) => r.name === "system_admin")!.id;
  const { data: adminEmp } = await admin
    .from("employees")
    .select("id, role_id")
    .eq("email", ADMIN)
    .single();
  const originalRole = adminEmp!.role_id;

  const authIds: string[] = [];
  const paths: string[] = [];

  try {
    const owner = await clientFor(OWNER);
    const peer = await clientFor(PEER);
    authIds.push(owner.authId, peer.authId);

    const body = new Blob(["e2e"], { type: "application/pdf" });

    // 1) 소유자 업로드 — 경로 첫 세그먼트가 본인 uid여야 통과한다
    const ownPath = `${owner.authId}/e2e/${Date.now()}-own.pdf`;
    const up1 = await owner.sb.storage
      .from("post-attachments")
      .upload(ownPath, body, { contentType: "application/pdf" });
    check("소유자가 자기 경로에 업로드한다", !up1.error, up1.error?.message);
    if (!up1.error) paths.push(ownPath);

    // 2) 남의 uid 경로로 업로드 시도 — 막혀야 한다
    const stolenPath = `${owner.authId}/e2e/${Date.now()}-stolen.pdf`;
    const up2 = await peer.sb.storage
      .from("post-attachments")
      .upload(stolenPath, body, { contentType: "application/pdf" });
    check(
      "남의 uid 경로로는 업로드할 수 없다",
      !!up2.error,
      up2.error ? "" : "차단되지 않음!",
    );
    if (!up2.error) paths.push(stolenPath);

    // 3) 일반 직원이 남의 파일 삭제 시도 — 여전히 막혀야 한다 (핵심)
    const del1 = await peer.sb.storage.from("post-attachments").remove([ownPath]);
    const stillThere = await admin.storage
      .from("post-attachments")
      .list(`${owner.authId}/e2e`);
    const survived = (stillThere.data ?? []).some((f) =>
      ownPath.endsWith(f.name),
    );
    check(
      "일반 직원은 남의 첨부를 지울 수 없다",
      survived,
      survived ? "" : `파일이 지워졌다! ${del1.error?.message ?? ""}`,
    );

    // 4) 관리자는 지울 수 있어야 한다 (마이그레이션 15가 연 것)
    await admin.from("employees").update({ role_id: adminRole }).eq("email", ADMIN);
    const adminUser = await clientFor(ADMIN);
    authIds.push(adminUser.authId);

    await adminUser.sb.storage.from("post-attachments").remove([ownPath]);
    const after = await admin.storage
      .from("post-attachments")
      .list(`${owner.authId}/e2e`);
    const gone = !(after.data ?? []).some((f) => ownPath.endsWith(f.name));
    check("시스템 관리자는 남의 첨부를 지울 수 있다", gone,
      gone ? "" : "삭제되지 않음 — 마이그레이션 15가 반영되지 않았을 수 있다");
    if (gone) paths.splice(paths.indexOf(ownPath), 1);
  } finally {
    console.log("\n[정리]");
    if (paths.length > 0) {
      await admin.storage.from("post-attachments").remove(paths);
      console.log(`  · 테스트 파일 ${paths.length}건 삭제`);
    }
    await admin.from("employees").update({ role_id: originalRole }).eq("email", ADMIN);
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
