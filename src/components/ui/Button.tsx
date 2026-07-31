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
 * 오렌지는 희소해야 하므로(원칙 1) primary는 한 화면에 하나만 쓴다.
 * 같은 화면에 주요 액션이 둘이면 하나는 secondary로 내린다.
 */
type Variant = "primary" | "primary-low" | "secondary" | "danger" | "ghost";
type Size = "xsmall" | "small" | "medium" | "large";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-hover active:bg-primary-pressed disabled:bg-line disabled:text-muted",
  // primary-low: 브랜드 톤을 유지하되 무게를 낮춘 액션
  "primary-low":
    "bg-primary-light text-primary hover:bg-[#ffe8dc] active:bg-[#ffe0d0] disabled:bg-line disabled:text-muted",
  secondary:
    "border border-line-strong bg-surface text-ink hover:bg-subtle active:bg-line disabled:border-line disabled:text-muted",
  danger:
    "bg-danger text-white hover:bg-[#e01f11] active:bg-[#c81b0f] disabled:bg-line disabled:text-muted",
  ghost:
    "text-ink hover:bg-subtle active:bg-line disabled:text-muted",
};

// 4px 그리드에 맞춘 높이 (SEED §5)
const SIZES: Record<Size, string> = {
  xsmall: "h-8 gap-1 px-3 text-label",
  small: "h-9 gap-1 px-3.5 text-body-sm",
  medium: "h-10 gap-1.5 px-4 text-body-sm",
  large: "h-12 gap-2 px-5 text-body",
};

const BASE =
  "inline-flex items-center justify-center whitespace-nowrap rounded-card font-bold transition-colors duration-fast ease-standard disabled:cursor-not-allowed";

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
