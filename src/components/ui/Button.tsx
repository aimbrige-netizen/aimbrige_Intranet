import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * 디자인시스템 컴포넌트 원칙:
 * Primary(채움) / Secondary(아웃라인) / Ghost(텍스트만) 3단계만 사용 — 종류를 늘리지 않는다.
 * danger는 퇴사 처리 등 파괴적 확인 버튼에만 예외적으로 사용.
 */
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-hover disabled:bg-primary/35",
  secondary:
    "border border-line-strong bg-surface text-ink hover:bg-canvas disabled:border-line disabled:text-muted",
  ghost: "text-primary hover:bg-primary-light disabled:text-muted",
  danger: "bg-danger text-white hover:bg-[#C33F3F] disabled:bg-danger/35",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1 px-3 text-label",
  md: "h-9 gap-1.5 px-4 text-body",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors",
        "disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
