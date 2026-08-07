import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Pretendard Variable — 디자인시스템 지정 폰트. node_modules/pretendard에서 복사해 셀프호스팅.
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "에임브릿지 인트라넷",
    template: "%s · 에임브릿지 인트라넷",
  },
  description: "에임브릿지 임직원 통합 사내 시스템",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // tailwind.config.ts의 colors.ink.DEFAULT와 같은 값. Next.js Viewport 메타데이터는
  // Tailwind 클래스를 못 읽어 리터럴로 둔다 — ink.DEFAULT를 바꾸면 이 값도 함께 바꿀 것
  // (2026-08-07 UI/UX 감사 — 두 값이 갈라질 수 있는 유일한 자리로 기록).
  themeColor: "#1c1c1c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
