import { cn } from "@/lib/utils";
import type { EmploymentStatus, RoleName } from "@/types/db";

type Tone = "neutral" | "primary" | "success" | "warn" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "bg-line-strong/70 text-muted",
  primary: "bg-primary-light text-primary",
  success: "bg-success/10 text-success",
  warn: "bg-warn/15 text-[#8A6316]",
  danger: "bg-danger/10 text-danger",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-label font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** 재직상태 뱃지 — 재직중=초록 / 휴직=노랑 / 퇴사=회색 (스펙 3.4) */
const STATUS_META: Record<EmploymentStatus, { label: string; tone: Tone }> = {
  active: { label: "재직중", tone: "success" },
  leave: { label: "휴직", tone: "warn" },
  terminated: { label: "퇴사", tone: "neutral" },
};

export function EmploymentStatusBadge({
  status,
}: {
  status: EmploymentStatus;
}) {
  const meta = STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const ROLE_META: Record<RoleName, { label: string; tone: Tone }> = {
  system_admin: { label: "시스템 관리자", tone: "primary" },
  manager: { label: "팀장/매니저", tone: "primary" },
  employee: { label: "일반직원", tone: "neutral" },
};

export function RoleBadge({ role }: { role: RoleName | null | undefined }) {
  if (!role) return <span className="text-caption">-</span>;
  const meta = ROLE_META[role];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
