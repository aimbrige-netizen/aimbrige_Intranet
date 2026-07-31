import { cn } from "@/lib/utils";
import type { EmploymentStatus, RoleName } from "@/types/db";

/**
 * SEED 기반 상태 뱃지.
 *
 * 원칙 4 "신뢰는 차분함에서": 빨강(critical)은 실제 오류·위반에만 쓴다.
 * 진행중·대기 같은 중간 상태는 브랜드 톤(primary-low)이나 중립으로 둔다.
 */
type Tone = "neutral" | "primary" | "success" | "warn" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-subtle text-muted",
  primary: "bg-primary-light text-primary",
  // 상태 틴트는 solid를 쓴다 — 알파 합성은 얹히는 면마다 결과가 달라진다
  success: "bg-success-light text-success-ink",
  info: "bg-info-light text-info-ink",
  warn: "bg-warn-light text-warn-ink",
  danger: "bg-danger-light text-danger-ink",
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
        "inline-flex items-center whitespace-nowrap rounded-sm px-2 py-0.5 text-label font-bold",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** 재직상태 뱃지 (스펙 01 · 3.4) */
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
  manager: { label: "팀장/매니저", tone: "info" },
  employee: { label: "일반직원", tone: "neutral" },
};

export function RoleBadge({ role }: { role: RoleName | null | undefined }) {
  if (!role) return <span className="text-caption">-</span>;
  const meta = ROLE_META[role];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
