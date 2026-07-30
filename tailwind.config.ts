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
        sidebar: {
          DEFAULT: "#1A1D24",
          hover: "#242832",
          text: "#C7CBD4",
          active: "#FFFFFF",
        },
        ink: "#1F2430",
        muted: "#6B7280",
        surface: "#FFFFFF",
        canvas: "#F7F8FA",
        line: "#E2E5EA",
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
        card: "8px",
        pick: "12px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.06)",
        pop: "0 4px 16px rgba(0,0,0,0.10)",
      },
      spacing: {
        topbar: "60px",
        rail: "72px",
        railopen: "240px",
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
