/** @type {import('next').NextConfig} */
const nextConfig = {
  /*
   * 빌드 산출물 위치를 환경변수로 뺀다.
   *
   * dev 서버가 켜진 채로 `next build`를 돌리면 둘 다 .next에 쓴다. 빌드가
   * .next/server를 갈아엎는 순간 dev 서버는 자기 청크를 잃고
   * `__webpack_modules__[moduleId] is not a function`으로 죽는다. 그런데 SSR HTML은
   * 그대로 나와서 화면은 멀쩡해 보이고 하이드레이션만 안 된다 —
   * 클릭이 전부 안 먹는 상태를 코드 버그로 착각하기 딱 좋은 자리다.
   *
   *   npm run build:check   (dev 서버 켜둔 채로 안전하게 빌드 검사)
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
