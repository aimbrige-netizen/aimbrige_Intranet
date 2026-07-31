/**
 * 개발용 로그인 세션 발급 (검증 전용, 프로덕션 코드 아님)
 *
 * 로그인이 Google OAuth 하나뿐이라 자동화된 화면 검증에서 세션을 만들 방법이
 * 없다. 그래서 임시 이메일/비밀번호 계정을 만들어 세션을 받고, @supabase/ssr가
 * 읽는 쿠키 형태로 찍어준다. 브라우저 콘솔에 붙여넣으면 그 계정으로 로그인된다.
 *
 * 반드시 --cleanup으로 지울 것. 이 계정은 비밀번호로 로그인되므로
 * 남겨두면 OAuth 도메인 제한을 우회하는 뒷문이 된다.
 *
 *   npx tsx scripts/dev-session.ts <employee-email>
 *   npx tsx scripts/dev-session.ts --cleanup
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const PASSWORD = "dev-verify-" + url.slice(-8);
/** 이 접두사가 붙은 계정만 정리 대상으로 삼는다 */
const TAG = "dev_session_script";

async function cleanup() {
  const { data } = await admin.auth.admin.listUsers();
  let removed = 0;
  for (const user of data.users) {
    if (user.user_metadata?.origin !== TAG) continue;
    await admin.from("employees").update({ auth_user_id: null }).eq("auth_user_id", user.id);
    await admin.auth.admin.deleteUser(user.id);
    removed += 1;
  }
  console.log(`임시 계정 ${removed}개 삭제`);
}

async function issue(email: string) {
  const { data: employee } = await admin
    .from("employees")
    .select("id, name, employment_status")
    .eq("email", email)
    .maybeSingle();

  if (!employee) throw new Error(`employees에 ${email} 없음`);
  if (employee.employment_status !== "active")
    throw new Error(`${email}은 재직 상태가 아니라 로그인이 거부된다`);

  await cleanup();

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { origin: TAG },
  });
  if (error) throw error;

  await admin.from("employees").update({ auth_user_id: created.user.id }).eq("id", employee.id);

  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: signed, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw signInError;

  // @supabase/ssr 쿠키: sb-<ref>-auth-token = "base64-" + base64(JSON)
  // 3180자를 넘으면 .0 .1 로 쪼개 저장한다(브라우저 쿠키 크기 제한).
  const ref = new URL(url).hostname.split(".")[0];
  const encoded =
    "base64-" + Buffer.from(JSON.stringify(signed.session)).toString("base64");

  const chunks: string[] = [];
  for (let i = 0; i < encoded.length; i += 3180) chunks.push(encoded.slice(i, i + 3180));

  const assignments =
    chunks.length === 1
      ? [`sb-${ref}-auth-token=${chunks[0]}`]
      : chunks.map((chunk, i) => `sb-${ref}-auth-token.${i}=${chunk}`);

  console.log(`\n// ${employee.name} <${email}> 세션`);
  console.log(
    assignments
      .map((a) => `document.cookie=${JSON.stringify(`${a}; path=/; max-age=3600`)};`)
      .join("\n"),
  );
}

const arg = process.argv[2];
if (!arg) {
  console.error("사용법: npx tsx scripts/dev-session.ts <email> | --cleanup");
  process.exit(1);
}

(arg === "--cleanup" ? cleanup() : issue(arg)).catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
