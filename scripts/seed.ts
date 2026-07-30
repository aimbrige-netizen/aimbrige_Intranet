/**
 * 초기 시딩 스크립트
 * 근거: 스펙 01 · 5장 "초기 시스템 관리자 시딩"
 *
 * UI로는 최초 관리자를 만들 수 없으므로(닭과 달걀) 이 스크립트로 등록한다.
 * 여러 번 실행해도 안전하다(이메일 기준 upsert).
 *
 * 실행:  npm run seed
 * 필요 환경변수(.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SEED_ADMIN_EMAIL        예) rnjsxogud@sding.kr
 *   SEED_ADMIN_NAME         예) 권태형
 *   SEED_DEPARTMENTS        (선택) 콤마 구분. 미지정 시 부서를 만들지 않는다.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const adminName = process.env.SEED_ADMIN_NAME?.trim();

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

if (!url) fail("NEXT_PUBLIC_SUPABASE_URL 이 없습니다.");
if (!serviceKey) fail("SUPABASE_SERVICE_ROLE_KEY 이 없습니다.");
if (!adminEmail) fail("SEED_ADMIN_EMAIL 이 없습니다. (.env.local 에 추가)");
if (!adminName) fail("SEED_ADMIN_NAME 이 없습니다. (.env.local 에 추가)");

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1) 역할 확인 — 마이그레이션이 넣어둔 3종이 있어야 한다
  const { data: roles, error: rolesError } = await supabase
    .from("roles")
    .select("id, name, label");

  if (rolesError) {
    fail(
      `roles 테이블을 읽지 못했습니다: ${rolesError.message}\n` +
        `마이그레이션(supabase/migrations/*.sql)을 먼저 실행했는지 확인하세요.`,
    );
  }

  const adminRole = roles?.find((r) => r.name === "system_admin");
  if (!adminRole) fail("system_admin 역할이 없습니다. 마이그레이션을 먼저 실행하세요.");
  console.log(`· 역할 ${roles?.length ?? 0}종 확인 완료`);

  // 2) 부서 시딩 (선택)
  const deptNames = (process.env.SEED_DEPARTMENTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const name of deptNames) {
    const { data: existing } = await supabase
      .from("departments")
      .select("id")
      .eq("name", name)
      .maybeSingle();

    if (existing) {
      console.log(`· 부서 "${name}" 이미 존재`);
      continue;
    }
    const { error } = await supabase.from("departments").insert({ name });
    if (error) fail(`부서 "${name}" 생성 실패: ${error.message}`);
    console.log(`· 부서 "${name}" 생성`);
  }

  // 3) 시스템 관리자 계정
  const { data: existingEmployee } = await supabase
    .from("employees")
    .select("id, email, name, role_id, employment_status")
    .ilike("email", adminEmail!)
    .maybeSingle();

  if (existingEmployee) {
    const { error } = await supabase
      .from("employees")
      .update({
        name: adminName,
        role_id: adminRole.id,
        employment_status: "active",
      })
      .eq("id", existingEmployee.id);
    if (error) fail(`관리자 계정 갱신 실패: ${error.message}`);
    console.log(`· 기존 계정을 시스템 관리자로 갱신: ${adminEmail}`);
  } else {
    const { error } = await supabase.from("employees").insert({
      email: adminEmail,
      name: adminName,
      role_id: adminRole.id,
      employment_status: "active",
      hire_date: new Date().toISOString().slice(0, 10),
    });
    if (error) fail(`관리자 계정 생성 실패: ${error.message}`);
    console.log(`· 시스템 관리자 생성: ${adminName} <${adminEmail}>`);
  }

  console.log(
    `\n✔ 시딩 완료. 이제 ${adminEmail} 구글 계정으로 로그인하면 됩니다.` +
      `\n  (최초 로그인 시 auth 계정이 자동으로 이 레코드에 연결됩니다)\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
