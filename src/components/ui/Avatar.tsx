/* eslint-disable @next/next/no-img-element */
import { cn, initialsOf } from "@/lib/utils";

/**
 * 사람을 나타낼 땐 이름 텍스트 대신 원형 프로필 이미지(이니셜 fallback)를 우선 사용.
 * — 디자인시스템 컴포넌트 원칙
 *
 * next/image 대신 img를 쓰는 이유: 프로필 이미지 출처가 Google/Supabase Storage 등으로
 * 가변적이어서 next.config의 remotePatterns를 계속 늘려야 하는 부담을 피한다.
 */
/* 사이즈 이름은 SEED 규격(xsmall~xlarge)을 따라 Button과 통일한다 */
const SIZES = {
  // 2026-08-07 UI/UX 감사: 임의값 10px → 기존 nano(11px) 토큰. 24px 원 안 이니셜 1~2자라 차이 없음
  small: "size-6 text-nano",
  medium: "size-8 text-label",
  large: "size-12 text-body",
  xlarge: "size-20 text-h2",
} as const;

export function Avatar({
  name,
  src,
  size = "medium",
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        "bg-primary-light font-bold text-primary-ink",
        SIZES[size],
        className,
      )}
      aria-hidden
    >
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}

/** 아바타 + 이름/부가정보 조합 (목록·결재선 등) */
export function AvatarWithName({
  name,
  sub,
  src,
  size = "medium",
}: {
  name: string;
  sub?: string | null;
  src?: string | null;
  size?: keyof typeof SIZES;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={name} src={src} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-body text-ink">{name}</span>
        {sub ? <span className="block truncate text-caption">{sub}</span> : null}
      </span>
    </span>
  );
}
