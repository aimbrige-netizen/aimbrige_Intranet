import { cn } from "@/lib/utils";

/**
 * 에임브릿지 자체 로고 — 출처: daou-survey/08-shell-extra.md "로고/워드마크".
 *
 * 원본(다우오피스)은 검정 심볼 + 본문보다 무거운 로고체 워드마크다.
 * 원본 에셋을 가져오지 않는 규칙에 따라 심볼은 자체 제작 SVG다:
 * 24×24 안에 다리(bridge) 상판(직선) + 아치(호) + 행어 2개(직선) +
 * 정점 위 점(원). 아치와 두 행어가 A의 실루엣을, 상판 아래 두 칸이
 * B의 속공간을 암시한다 — 원·호·직선만 쓴 독자 기하이며 색은
 * currentColor 하나라 부모의 text-ink(#1c1c1c 먹색)를 그대로 받는다.
 *
 * 워드마크: Pretendard 17px / -0.02em / 굵기 700.
 * 이 디자인의 글자 굵기는 400/500/600 세 단뿐이고 tailwind의 font-bold도
 * 500으로 낮춰 두었다(tailwind.config.ts fontWeight — 원본 코드에 700이
 * 없기 때문). 700은 **로고 한정 예외**라 유틸리티를 만들지 않고
 * inline style로만 쓴다. 17px도 본문 스케일에서 걷어낸 단이라 임의값이다.
 */
export function LogoSymbol({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      {/* 상판 */}
      <path
        d="M2 19h20"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
      {/* 아치 — (4,19)→정점(12,8)→(20,19) */}
      <path
        d="M4 19c0-7.3 3.6-11 8-11s8 3.7 8 11"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
      {/* 행어 2개 — 아치에서 상판으로 */}
      <path
        d="M8 10.5v8.5M16 10.5v8.5"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
      {/* 정점 위 점 */}
      <circle cx={12} cy={3.9} r={1.6} fill="currentColor" />
    </svg>
  );
}

/** 심볼 + "에임브릿지" 워드마크. 상단바 좌측 브랜드 자리에 쓴다. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 text-ink", className)}>
      <LogoSymbol />
      <span
        className="text-[17px] leading-none tracking-[-0.02em]"
        style={{ fontWeight: 700 }}
      >
        에임브릿지
      </span>
    </span>
  );
}
