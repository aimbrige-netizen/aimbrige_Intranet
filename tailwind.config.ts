import type { Config } from "tailwindcss";

/**
 * 에임브릿지 인트라넷 디자인 토큰
 * 출처: aimbridge_intranet_design_system.md v1.0
 * 색상값을 바꿀 때는 이 파일과 globals.css의 CSS 변수를 함께 수정한다.
 */
const config: Config = {
  /*
   * src 전체를 스캔한다.
   * create-next-app 기본값은 app/components/pages 세 폴더만 훑기 때문에
   * src/features 같은 폴더를 추가하면 그 안의 클래스가 CSS로 생성되지 않는다.
   * (실제로 캘린더의 grid-cols-7이 누락돼 월간 격자가 1열로 무너졌다)
   */
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#1D4E8F",
          hover: "#17406F",
          light: "#EAF1FB",
        },
        // 사이드바는 라이트(화이트) — 메인 콘텐츠와 톤을 통일하고 경계선으로만 구분한다
        sidebar: {
          DEFAULT: "#FFFFFF",
          hover: "#F3F6FB",
          text: "#5B6270",
          active: "#1D4E8F",
        },
        // 선택형 카드(연차 유형 등)처럼 의도적으로 대비를 주는 다크 블록 전용
        pick: "#1A1D24",
        ink: "#1F2430",
        muted: "#6B7280",
        surface: "#FFFFFF",
        canvas: "#F5F7FA",
        line: "#E7EAF0",
        "line-strong": "#DDE1E8",
        success: "#2FA36B",
        warn: "#E0A72E",
        danger: "#DB4C4C",
        /*
         * 캘린더 이벤트 색상 (스펙 02 · 3.4)
         * 개인=primary, 팀=success는 기존 토큰을 재사용하고 전사·리소스만 신규.
         * hex를 클래스에 직접 쓰지 않고 토큰으로 두는 이유: `bg-[#7C5CBF]/12` 처럼
         * 임의 hex에 투명도 수식자를 붙이면 Tailwind가 클래스를 생성하지 못한다.
         */
        event: {
          company: "#7C5CBF",
          "company-ink": "#5F44A0",
          resource: "#D97C3C",
          "resource-ink": "#B25F26",
        },
        /*
         * 지표 카드용 파스텔 톤.
         * 숫자를 나열만 하면 무엇이 중요한지 안 보인다. 항목 성격별로
         * 옅은 배경 + 진한 글자 한 쌍을 묶어 두고 StatCard에서 골라 쓴다.
         * 배경은 아주 옅게(가독성), 글자는 충분히 진하게(대비) 잡았다.
         */
        tint: {
          sky: "#EAF1FB",
          "sky-ink": "#1D4E8F",
          mint: "#E6F6EF",
          "mint-ink": "#1F8A5B",
          peach: "#FDF0E6",
          "peach-ink": "#C26A28",
          lavender: "#F1ECFB",
          "lavender-ink": "#5F44A0",
          rose: "#FDECEC",
          "rose-ink": "#C13B3B",
          slate: "#F1F3F7",
          "slate-ink": "#5B6270",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-pretendard)",
          "Pretendard",
          "system-ui",
          "sans-serif",
        ],
      },
      fontSize: {
        // 디자인시스템 타이포 스케일
        h1: ["24px", { lineHeight: "1.35", fontWeight: "700" }],
        h2: ["18px", { lineHeight: "1.4", fontWeight: "600" }],
        body: ["14px", { lineHeight: "1.6", fontWeight: "400" }],
        label: ["12px", { lineHeight: "1.5", fontWeight: "400" }],
      },
      borderRadius: {
        card: "12px",
        pick: "12px",
      },
      boxShadow: {
        // 테두리로 가두기보다 옅은 그림자로 띄운다
        card: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.05)",
        pop: "0 8px 24px rgba(16,24,40,0.12)",
      },
      spacing: {
        topbar: "60px",
        rail: "76px",
        drawer: "248px",
      },
      screens: {
        // 디자인시스템: 모바일 브레이크포인트 768px
        md: "768px",
      },
    },
  },
  plugins: [],
};
export default config;
