import type { Config } from "tailwindcss";

/**
 * 에임브릿지 인트라넷 디자인 토큰
 * 출처: aimbridge_intranet_design_system.md v1.0
 * 색상값을 바꿀 때는 이 파일과 globals.css의 CSS 변수를 함께 수정한다.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
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
