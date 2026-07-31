/**
 * dev 서버를 켜둔 채로 프로덕션 빌드를 검사한다.
 *
 * `next build`는 기본적으로 dev 서버와 같은 .next에 쓴다. 빌드가 .next/server를
 * 갈아엎으면 dev 서버는 자기 webpack 청크를 잃고 죽는데, SSR HTML은 계속 나와서
 * 화면은 멀쩡하고 클릭만 전부 안 먹는 상태가 된다. 원인을 코드에서 찾게 되는
 * 종류의 사고라 아예 다른 디렉터리에 빌드한다.
 *
 * 크로스플랫폼용이다 — Windows에서 `VAR=x cmd` 문법이 안 먹어서 스크립트로 뺐다.
 */
import { spawn } from "node:child_process";

const child = spawn("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_DIST_DIR: ".next-build" },
});

child.on("exit", (code) => process.exit(code ?? 1));
