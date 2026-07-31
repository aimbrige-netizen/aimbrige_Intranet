import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 기간 네비게이터 — ‹ 기간 › [오늘] + 우측 뷰 토글 슬롯.
 *
 * 근태·관리자근태·결재·게시판·휴일·파일함 6개 모듈에 기간 이동 수단이
 * 통째로 없어서, 이번 달 초에 접속하면 표에 1~2행만 보이고 지난달을 볼
 * 방법이 없었다. 유일한 구현이던 캘린더 것도 1회성 하드코딩이라 재사용이 안 됐다.
 *
 * href를 주면 서버 컴포넌트에서 그대로 쓸 수 있고,
 * onPrev/onNext를 주면 클라이언트 상태와 연결된다.
 */
export function PeriodNavigator({
  label,
  sublabel,
  prevHref,
  nextHref,
  todayHref,
  onPrev,
  onNext,
  onToday,
  atToday,
  nextDisabled,
  right,
  className,
}: {
  /** "2026-07-27 ~ 2026-08-02" 또는 "2026년 7월" */
  label: React.ReactNode;
  /** 기간 아래 보조 설명 (예: "8월 1일 기준") */
  sublabel?: React.ReactNode;
  prevHref?: string;
  nextHref?: string;
  todayHref?: string;
  onPrev?: () => void;
  onNext?: () => void;
  onToday?: () => void;
  /** 이미 오늘이 포함된 기간이면 [오늘]을 비활성화한다 */
  atToday?: boolean;
  /** 미래 기간으로 넘어가지 못하게 막을 때 */
  nextDisabled?: boolean;
  /** 우측 슬롯 — 보통 SegmentedControl(주간/월간) */
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center gap-2 md:flex-nowrap",
        className,
      )}
    >
      {/* 좌측은 우측 슬롯과 무게를 맞추기 위한 빈 칸 — 기간이 가운데 오도록 */}
      <div className="hidden flex-1 md:block" />

      <div className="flex items-center gap-1">
        <StepButton
          direction="prev"
          href={prevHref}
          onClick={onPrev}
          label="이전 기간"
        />

        <div className="min-w-44 px-2 text-center">
          <p className="text-body font-bold tabular-nums text-ink">{label}</p>
          {sublabel ? <p className="text-nano text-muted">{sublabel}</p> : null}
        </div>

        <StepButton
          direction="next"
          href={nextHref}
          onClick={onNext}
          disabled={nextDisabled}
          label="다음 기간"
        />

        <TodayButton href={todayHref} onClick={onToday} disabled={atToday} />
      </div>

      <div className="flex flex-1 justify-end">{right}</div>
    </div>
  );
}

const STEP_CLASS =
  "grid size-8 place-items-center rounded-sm text-muted transition-colors duration-fast ease-standard hover:bg-subtle hover:text-ink disabled:pointer-events-none disabled:opacity-40";

function StepButton({
  direction,
  href,
  onClick,
  disabled,
  label,
}: {
  direction: "prev" | "next";
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  label: string;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  const icon = <Icon className="size-4" aria-hidden />;

  if (href && !disabled) {
    return (
      <Link href={href} aria-label={label} className={STEP_CLASS}>
        {icon}
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled || (!onClick && !href)}
      onClick={onClick}
      className={STEP_CLASS}
    >
      {icon}
    </button>
  );
}

const TODAY_CLASS =
  "ml-1 rounded-sm border border-line-strong px-2.5 py-1 text-label text-ink transition-colors duration-fast ease-standard hover:bg-subtle disabled:pointer-events-none disabled:border-line disabled:text-muted";

function TodayButton({
  href,
  onClick,
  disabled,
}: {
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  if (href && !disabled) {
    return (
      <Link href={href} className={TODAY_CLASS}>
        오늘
      </Link>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled || (!onClick && !href)}
      onClick={onClick}
      className={TODAY_CLASS}
    >
      오늘
    </button>
  );
}
