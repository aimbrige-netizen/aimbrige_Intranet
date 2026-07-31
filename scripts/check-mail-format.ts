/**
 * From 헤더 파싱 점검 (스펙 11)
 *
 * 발신자 표시는 순수 함수라 DB도 세션도 필요 없다. 그런데 메일 헤더는
 * 형식이 제각각이라(따옴표, 표시이름 없음, 이름 안에 쉼표) 눈으로 훑고
 * 넘어가면 위젯에서 이상한 값이 뜨는 걸 나중에 발견하게 된다.
 *
 *   npx tsx scripts/check-mail-format.ts
 */
import {
  senderName,
  gmailInboxUrl,
  gmailMessageUrl,
} from "../src/features/mail/format";

const cases: [string, string][] = [
  ['"홍길동" <hong@aimbrige.kr>', "홍길동"],
  ["김지훈 <jhkim@demo.aimbrige.kr>", "김지훈"],
  // 표시이름이 없는 자동발신 주소 — 로컬파트로 떨어져야 한다
  ["<noreply@github.com>", "noreply"],
  ["billing@stripe.com", "billing"],
  ["Google <no-reply@accounts.google.com>", "Google"],
  // 빈 따옴표는 표시이름이 있는 것처럼 보이지만 실제로는 없다
  ['"" <bare@x.com>', "bare"],
  // 주소가 아예 없는 값(잘린 헤더)은 그대로 둔다
  ["구글 알림", "구글 알림"],
  // 이름 안의 쉼표를 주소 구분자로 오해하면 안 된다
  ['"Lee, Sumin" <sumin@aimbrige.kr>', "Lee, Sumin"],
];

let failed = 0;
for (const [input, want] of cases) {
  const got = senderName(input);
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${JSON.stringify(input)} → ${JSON.stringify(got)}${
      ok ? "" : ` (기대 ${JSON.stringify(want)})`
    }`,
  );
}

// 주소에 +가 들어가도 URL이 깨지지 않아야 한다
const inbox = gmailInboxUrl("a+b@x.kr");
const message = gmailMessageUrl("a@x.kr", "18f2c1a9b0");
const urlOk =
  inbox === "https://mail.google.com/mail/u/a%2Bb%40x.kr/#inbox" &&
  message === "https://mail.google.com/mail/u/a%40x.kr/#inbox/18f2c1a9b0";
if (!urlOk) failed += 1;
console.log(`${urlOk ? "PASS" : "FAIL"}  URL 인코딩 — ${inbox} / ${message}`);

console.log(failed === 0 ? `\n${cases.length + 1}건 전부 통과` : `\n${failed}건 실패`);
process.exit(failed ? 1 : 0);
