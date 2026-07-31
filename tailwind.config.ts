import type { Config } from "tailwindcss";

/**
 * 에임브릿지 인트라넷 디자인 토큰 — SEED Design(당근) 기반
 * 출처: aimbridge_intranet_design_system.md v2.0
 *
 * SEED의 시맨틱 색을 그대로 가져오되, 인트라넷 특성상 필요한 것만 더한다.
 * 핵심 원칙(SEED §12):
 *   1. 오렌지는 희소하게 — 한 화면에 주요 오렌지 요소는 하나
 *   2. 콘텐츠가 주인공, 크롬은 조용하게
 *   3. 모든 치수는 4px 그리드
 *   4. 액센트는 하나. 두 번째 브랜드 색을 만들지 않는다
 */
const config: Config = {
  /*
   * src 전체를 스캔한다.
   * create-next-app 기본값은 app/components/pages 세 폴더만 훑기 때문에
   * src/features 같은 폴더를 추가하면 그 안의 클래스가 CSS로 생성되지 않는다.
   */
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // SEED semantic primary (carrot-500). 마케팅용 #ff6600과 구분해서 쓴다.
        primary: {
          DEFAULT: "#ff6f0f",
          hover: "#ff9e66",
          pressed: "#ff9e66",
          light: "#fff5f0", // carrot-50 / paper-accent
        },
        // 사이드바는 canvas(흰색). 경계선과 활성 상태로만 구분한다.
        sidebar: {
          DEFAULT: "#ffffff",
          hover: "#f7f8fa",
          text: "#868b94",
          active: "#ff6f0f",
        },
        // 선택형 카드처럼 의도적으로 대비를 주는 다크 블록
        pick: "#212124",
        ink: "#212124", // gray-900 / ink-text
        muted: "#868b94", // gray-600 / ink-text-low
        canvas: "#f2f3f6", // gray-100 / paper-background — 페이지 배경
        surface: "#ffffff", // gray-00 / paper-default — 카드 면
        subtle: "#f7f8fa", // gray-50 / paper-contents — 옅은 면
        line: "#eaebee", // gray-200 / divider-2
        "line-strong": "#dcdee3",
        /*
         * 시맨틱 상태색.
         *
         * warn은 한때 primary와 같은 값(#ff6f0f)이었는데, 그러면 진행바에서
         * "정상 / 48h 경고 / 52h 초과" 3구간을 색으로 나눌 수 없다.
         * 액센트(primary)와 경고(warn)는 역할이 다르므로 분리한다 —
         * 앰버는 브랜드색이 아니라 계기판 색이고, 면적을 넓게 쓰지 않는다.
         */
        success: "#1aa174", // green-500
        info: "#009ceb", // blue-500
        warn: "#f59f0a", // amber — primary보다 노랑 쪽이라 나란히 놔도 구분된다
        danger: "#fa2314", // red-600
        /*
         * 각 상태의 옅은 면.
         * /10 투명도 대신 solid 틴트를 쓰는 이유: 진행바 트랙이나 칩이
         * 이미 색이 있는 면 위에 올라가면 알파 합성 결과가 배경마다 달라진다.
         */
        "success-light": "#e8f7f1",
        "info-light": "#e5f5fd",
        "warn-light": "#fef6e7",
        "danger-light": "#feecea",
        /* 옅은 면 위에 얹는 글자색 — 4.5:1 대비 확보용 */
        "success-ink": "#0f7355",
        "info-ink": "#0077b0",
        "warn-ink": "#96590a",
        "danger-ink": "#c4190f",
        /*
         * 캘린더 이벤트 색상 (스펙 02 · 3.4)
         * SEED는 브랜드 색을 하나만 두므로, 이벤트 구분은 브랜드가 아니라
         * 유틸리티(semantic) 색으로 처리한다.
         */
        event: {
          company: "#009ceb", // info
          "company-ink": "#0077b0",
          resource: "#868b94", // muted
          "resource-ink": "#5c6068",
        },
      },
      fontFamily: {
        /*
         * SEED §3: 시스템 폰트를 쓴다. 커스텀 웹폰트를 얹지 않는 이유는
         * "콘텐츠가 브랜드"이기 때문 — UI가 콘텐츠 뒤로 물러나야 한다.
         * Pretendard는 선언된 폴백으로만 남긴다.
         */
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "Segoe UI",
          "var(--font-pretendard)",
          "Pretendard",
          "Apple SD Gothic Neo",
          "Malgun Gothic",
          "sans-serif",
        ],
      },
      fontSize: {
        // SEED 타이포 스케일 (§3). 인트라넷은 밀도가 높아 h1/h2를 실사용 크기로 조정.
        h1: ["24px", { lineHeight: "1.35", fontWeight: "700" }],
        h2: ["19px", { lineHeight: "1.35", fontWeight: "700" }],
        h3: ["17px", { lineHeight: "1.35", fontWeight: "700" }],
        title: ["24px", { lineHeight: "1.35", fontWeight: "700" }],
        body: ["15px", { lineHeight: "1.5", fontWeight: "400", letterSpacing: "-0.02em" }],
        "body-sm": ["14px", { lineHeight: "1.5", fontWeight: "400", letterSpacing: "-0.02em" }],
        label: ["13px", { lineHeight: "1.5", fontWeight: "400", letterSpacing: "-0.02em" }],
        /*
         * 12px 아래는 SEED 스케일에 없지만 인트라넷에는 필요하다 —
         * 76px 레일 라벨, 진행바 눈금 캡션, 칩 안의 보조 시각처럼
         * "읽는 글"이 아니라 "표식"인 자리. 임의값 text-[11px]가 이미
         * 5곳에 흩어져 있어 토큰으로 승격한다.
         */
        micro: ["12px", { lineHeight: "1.4", fontWeight: "400", letterSpacing: "-0.01em" }],
        nano: ["11px", { lineHeight: "1.35", fontWeight: "400", letterSpacing: "0" }],
      },
      borderRadius: {
        // SEED §5: sm 6 / md 8 / full 9999
        sm: "6px",
        card: "8px",
        pick: "8px",
        pill: "9999px",
      },
      boxShadow: {
        /*
         * SEED §6: 면을 나누는 기본 수단은 hairline이다. 카드는 여전히 flat.
         *
         * 다만 "선택된 날짜가 회색 스트립 위로 튀어나온다"(R5)처럼
         * 같은 흰색 면이 겹칠 때는 경계선만으로 층이 구분되지 않는다.
         * 그래서 raised 한 단계만 되살린다 — 장식이 아니라 층 표시용이고,
         * 상시 노출되는 카드에는 쓰지 않는다.
         */
        card: "none",
        raised: "0 1px 3px rgba(33,33,36,0.08), 0 1px 2px rgba(33,33,36,0.04)",
        pop: "0 4px 16px rgba(33,33,36,0.10)",
      },
      spacing: {
        // SEED §5: 4px 그리드. 레이아웃 고정값만 별도 토큰으로.
        topbar: "56px",
        rail: "76px",
        panel: "224px", // 모듈 사이드 패널 (2뎁스 셸)
        shell: "300px", // rail + panel — 패널이 있는 화면의 본문 들여쓰기
        drawer: "248px",
      },
      transitionTimingFunction: {
        // SEED §15. 스프링·오버슈트는 금지.
        enter: "cubic-bezier(0, 0, 0.2, 1)",
        exit: "cubic-bezier(0.4, 0, 1, 1)",
        standard: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      transitionDuration: {
        fast: "150ms",
        standard: "250ms",
        slow: "350ms",
      },
      screens: {
        md: "768px",
      },
    },
  },
  plugins: [],
};
export default config;
