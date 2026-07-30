import { forwardRef } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const CONTROL_BASE =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-body text-ink placeholder:text-muted " +
  "transition-colors focus:border-primary disabled:bg-canvas disabled:text-muted";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(CONTROL_BASE, invalid && "border-danger", className)}
    {...props}
  />
));
Input.displayName = "Input";

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(CONTROL_BASE, "appearance-none pr-8", invalid && "border-danger", className)}
    style={{
      backgroundImage:
        "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%236B7280' stroke-width='1.6'%3E%3Cpath d='M4 6.5l4 4 4-4'/%3E%3C/svg%3E\")",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "right 10px center",
    }}
    {...props}
  />
));
Select.displayName = "Select";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(CONTROL_BASE, "min-h-20 resize-y", invalid && "border-danger", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

/** 에러는 빨간 텍스트 + 아이콘으로 입력창 바로 아래 (디자인시스템 폼 원칙) */
export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-label text-danger">
      <CircleAlert className="size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function FieldHint({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="mt-1 text-caption">{children}</p>;
}

/**
 * 라벨-옆-인풋 표 형태 한 줄 (결재·신청서류처럼 항목 많은 폼)
 * 부모에 .ab-form-grid 를 붙여서 사용한다.
 */
export function FormRow({
  label,
  required,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  htmlFor?: string;
  error?: string | null;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <label className="ab-form-label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </label>
      <div className="ab-form-field">
        {children}
        <FieldError>{error}</FieldError>
        <FieldHint>{hint}</FieldHint>
      </div>
    </>
  );
}

/** 라벨-위-인풋 (항목이 적은 단순 폼·설정 화면) */
export function Field({
  label,
  required,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  htmlFor?: string;
  error?: string | null;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <label
        className="block text-label font-medium text-ink"
        htmlFor={htmlFor}
      >
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </label>
      {children}
      <FieldError>{error}</FieldError>
      <FieldHint>{hint}</FieldHint>
    </div>
  );
}
