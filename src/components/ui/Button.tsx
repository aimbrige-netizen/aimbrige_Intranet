import { forwardRef } from "react";
import Link from "next/link";
import type { LinkProps } from "next/link";
import { cn } from "@/lib/utils";

/**
 * SEED Box Button (v2.seed-design.io/component/box-button)
 *
 * 문서화된 상태 계약을 그대로 따른다:
 *   primary / primary-low / secondary / danger / disabled / hover / keyboard
 * 크기는 xsmall~xlarge 중 medium이 기본.
 *
 * 브랜드 시안은 희소해야 하므로(원칙 1) primary는 한 화면에 하나만 쓴다.
 * 같은 화면에 주요 액션이 둘이면 하나는 secondary로 내린다.
 */
type Variant = "primary" | "primary-low" | "secondary" | "danger" | "ghost";
type Size = "xsmall" | "small" | "medium" | "large";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-hover active:bg-primary-pressed disabled:bg-line disabled:text-muted",
  /*
   * primary-low: 브랜드 톤을 유지하되 무게를 낮춘 액션.
   * hover/active는 리터럴이 아니라 primary.light-hover / light-pressed 토큰이다 —
   * 리터럴로 두면 브랜드 색을 다시 바꿀 때 이 두 값만 남는다(오렌지 시절
   * #ffe8dc/#ffe0d0가 그대로 남아 시안 면에 살구색 hover가 났던 사고와 같다).
   */
  "primary-low":
    "bg-primary-light text-primary-ink hover:bg-primary-light-hover active:bg-primary-light-pressed disabled:bg-line disabled:text-muted",
  secondary:
    "border border-line-strong bg-surface text-ink hover:bg-subtle active:bg-line disabled:border-line disabled:text-muted",
  danger:
    "bg-danger text-white hover:bg-danger-hover active:bg-danger-pressed disabled:bg-line disabled:text-muted",
  ghost:
    "text-ink hover:bg-subtle active:bg-line disabled:text-muted",
};

// 4px 그리드에 맞춘 높이 (SEED §5)
const SIZES: Record<Size, string> = {
  xsmall: "h-8 gap-1 px-3 text-label",
  /*
   * small = 실측 빈 상태 CTA (07-modules.md 게시판 "새 글 작성하기"):
   * 32px · radius 4(원본 radius-2xs) · 13px/400.
   * BASE의 rounded-card(12px)·font-medium(500)을 여기서 되돌린다 —
   * 원본 소형 버튼은 모서리가 각지고 글자가 가늘다.
   */
  small: "h-8 gap-1 rounded-[4px] px-3.5 text-label font-normal",
  medium: "h-10 gap-1.5 px-4 text-body-sm",
  large: "h-12 gap-2 px-5 text-body",
};

/*
 * font-medium(500). 실측 버튼 굵기는 500~600이고 700은 없다.
 * tailwind.config.ts가 이미 bold를 500으로 접어놨지만, 여기 이름이 계속
 * font-bold면 다음 사람이 "버튼은 굵게"라고 읽고 그 전제로 다른 걸 만든다.
 * 값이 같아도 이름을 맞춰둔다.
 */
const BASE =
  "inline-flex items-center justify-center whitespace-nowrap rounded-card font-medium transition-colors duration-fast ease-standard disabled:cursor-not-allowed";

export function buttonClass({
  variant = "primary",
  size = "medium",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
} = {}) {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, size, className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={buttonClass({ variant, size, className })}
      {...props}
    />
  ),
);
Button.displayName = "Button";

/**
 * 이동이 목적인 버튼.
 * button을 Link로 감싸면 중첩 인터랙티브 요소가 되고, Link에 버튼 클래스만
 * 붙이면 호출부마다 클래스 문자열이 복제된다. 그래서 별도 컴포넌트로 둔다.
 */
export function LinkButton({
  variant,
  size,
  className,
  children,
  ...props
}: LinkProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    variant?: Variant;
    size?: Size;
  }) {
  return (
    <Link className={buttonClass({ variant, size, className })} {...props}>
      {children}
    </Link>
  );
}
