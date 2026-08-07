import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Meter,
  resolveMeterTone,
  type MeterThreshold,
  type MeterTone,
} from "@/components/ui/Progress";

/**
 * 지표 카드.
 *
 * 예전 버전은 label/value/unit/sub/tone 다섯 개뿐이라, 서버에서 계산이 끝난
 * 분모(40h·52h·총 연차)와 임계선을 담을 자리가 없었다. "14h46m /40h"를
 * value에 넣으면 분모까지 28px 볼드가 되고, sub에 넣으면 각주로 읽힌다.
 * 그래서 모든 카드가 맥락 없는 숫자 하나만 찍었다.
 *
 * 이제 세 가지를 더 표현한다:
 *  - denominator: 값 옆 작은 회색 분모 (2 /5일)
 *  - max + thresholds: 하단 Meter와 임계선 (0h · 40h · 52h)
 *  - state: "값이 0"과 "아직 값 없음"과 "연동 안 됨"을 구분
 *
 * SEED 원칙 1 "오렌지는 희소하게": 한 화면에 tone="brand"는 하나만 둔다.
 */
export type StatTone =
  | "brand"
  | "neutral"
  | "positive"
  | "informative"
  | "warning"
  | "critical";

/**
 * 값 색.
 *
 * 원본 규칙 — **총계는 먹색, 활성·잔여는 민트.** neutral(총계)은 ink,
 * positive(살아 있는 값: 활성 인원·잔여 연차·처리 완료)는 accent로 간다.
 *
 * accent 판정 이력(tailwind.config.ts accent 주석의 요약): 04 실측 민트 →
 * 06 gw 변수 전수에 없어 시안으로 오판 → **14-ehr 재실측으로 민트 복원**
 * (ehr 앱이 자체 팔레트로 지표 값에 민트를 쓴다). 이 파일은 토큰 참조라
 * 값 교체만으로 민트 축으로 복귀했다.
 *
 * 민트 DEFAULT는 흰 배경 1.9:1이라 **28px 큰 숫자·게이지 막대 전용**이다.
 * "숫자가 아닌 것"에는 쓰지 않는다 — 칩·라벨·작은 글자(18px 포함)는
 * accent-ink(#158466, 흰 배경 4.6:1), 진행바 채움도 accent-ink로 간다.
 */
const ACCENTS: Record<StatTone, { value: string; chip: string }> = {
  brand: { value: "text-primary-ink", chip: "bg-primary-light text-primary-ink" },
  neutral: { value: "text-ink", chip: "bg-subtle text-muted" },
  positive: {
    /*
     * 2026-08-07 UI/UX 감사: 민트 DEFAULT(#44d1a5)는 흰 배경 1.9:1이라
     * 28px 숫자에서도 큰 텍스트 기준(3:1)을 못 넘는다. 위 주석의 원칙대로
     * accent-ink(4.6:1)로 교체 — 토큰 참조만 바꾸면 되는 자리였다.
     */
    value: "text-accent-ink",
    chip: "bg-accent-light text-accent-ink",
  },
  informative: { value: "text-info-ink", chip: "bg-info-light text-info-ink" },
  warning: { value: "text-warn-ink", chip: "bg-warn-light text-warn-ink" },
  critical: {
    value: "text-danger-ink",
    chip: "bg-danger-light text-danger-ink",
  },
};

/** StatTone과 MeterTone은 같은 의미 축이라 이름만 맞춰 넘긴다 */
const AS_METER: Record<StatTone, MeterTone> = {
  brand: "brand",
  neutral: "neutral",
  positive: "positive",
  informative: "informative",
  warning: "warning",
  critical: "critical",
};

const FROM_METER = Object.fromEntries(
  (Object.keys(AS_METER) as StatTone[]).map((k) => [AS_METER[k], k]),
) as Record<MeterTone, StatTone>;

export interface StatDelta {
  /** "+2일", "-3h 20m"처럼 이미 포맷된 문자열 */
  label: string;
  direction: "up" | "down" | "flat";
  /** 올라가는 게 좋은 지표인지. 기본은 up이 좋음 */
  goodDirection?: "up" | "down";
}

export function StatCard({
  label,
  value,
  unit,
  denominator,
  denominatorUnit,
  sub,
  tone = "neutral",
  icon: Icon,
  emphasis,
  max,
  meterValue,
  thresholds,
  scaleMaxLabel,
  scale,
  delta,
  href,
  state = "ok",
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  /** 값 옆에 붙는 작은 회색 분모. 슬래시는 자동으로 붙는다 */
  denominator?: string | number;
  /** 분모 뒤 단위. 없으면 unit을 재사용 */
  denominatorUnit?: string;
  sub?: React.ReactNode;
  tone?: StatTone;
  icon?: LucideIcon;
  /** 브랜드 틴트 배경까지 채워 화면에서 가장 중요한 값 하나를 앞세운다 */
  emphasis?: boolean;
  /** 주면 카드 하단에 Meter를 그린다 */
  max?: number;
  /** Meter에 쓸 값. 없으면 value가 숫자일 때 그대로 쓴다 */
  meterValue?: number;
  thresholds?: MeterThreshold[];
  /** Meter 아래 0·임계선·max 눈금 캡션 */
  scale?: boolean;
  /** 눈금 우측 끝 라벨 */
  scaleMaxLabel?: string;
  delta?: StatDelta;
  /** 주면 카드 전체가 링크가 된다 */
  href?: string;
  /**
   * ok           — 정상 값
   * empty        — 아직 값이 없음(0이 아니라 "—")
   * disconnected — 외부 연동이 안 돼 값을 모름
   */
  state?: "ok" | "empty" | "disconnected";
  className?: string;
}) {
  const numeric = meterValue ?? (typeof value === "number" ? value : undefined);
  const hasMeter = typeof max === "number" && typeof numeric === "number";

  /*
   * 임계선을 넘었으면 숫자 색도 같이 바뀐다.
   * 진행바만 빨개지고 숫자는 검은 상태로 두면 둘이 다른 말을 하는 것처럼 보인다.
   */
  const effectiveTone: StatTone =
    hasMeter && thresholds?.length
      ? FROM_METER[resolveMeterTone(numeric, AS_METER[tone], thresholds)]
      : tone;

  const accent = ACCENTS[effectiveTone];
  const isPlaceholder = state !== "ok";
  const displayValue = isPlaceholder ? "—" : value;

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        {/*
          라벨 14px / 400 / rgb(155,156,158) — 실측 그대로.
          종전 11~13px은 값(28px)과의 낙차가 너무 커서, 라벨이 각주처럼
          읽히고 "이 숫자가 무엇인지"를 먼저 못 읽었다.
        */}
        <p className="truncate text-body text-muted">{label}</p>
        {Icon ? (
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-sm",
              emphasis ? "bg-white text-primary-ink" : accent.chip,
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
      </div>

      <p className="mt-3 flex flex-wrap items-baseline gap-x-1">
        {/*
          값 28px / 500. 크기로 강조하고 굵기로는 강조하지 않는다 —
          실측 표본에 700이 한 건도 없다(400 ×1824 / 500 ×37 / 600 ×5).
          text-metric 토큰이 28px·500·행간 1.25를 함께 들고 있다.
        */}
        <span
          className={cn(
            "text-metric tabular-nums",
            isPlaceholder
              ? "text-muted"
              : emphasis
                ? "text-primary-ink"
                : accent.value,
          )}
        >
          {displayValue}
        </span>
        {unit && !isPlaceholder ? (
          <span className="text-label text-muted">{unit}</span>
        ) : null}
        {denominator !== undefined && !isPlaceholder ? (
          <span className="text-label tabular-nums text-muted">
            /{denominator}
            {denominatorUnit ?? unit ?? ""}
          </span>
        ) : null}
        {delta && !isPlaceholder ? <DeltaChip {...delta} /> : null}
      </p>

      {hasMeter && !isPlaceholder ? (
        <Meter
          className="mt-3"
          value={numeric}
          max={max}
          tone={AS_METER[tone]}
          thresholds={thresholds ?? []}
          showScale={scale}
          maxLabel={scaleMaxLabel}
          size="sm"
          aria-label={`${label} ${numeric} / ${max}`}
        />
      ) : null}

      {sub ? (
        <p className="mt-2 truncate text-label text-muted">{sub}</p>
      ) : state === "disconnected" ? (
        <p className="mt-2 truncate text-label text-muted">연동 필요</p>
      ) : null}
    </>
  );

  const shell = cn(
    "rounded-card border p-4",
    emphasis ? "border-primary/20 bg-primary-light" : "border-line bg-surface",
    href &&
      "block transition-colors duration-fast ease-standard hover:border-line-strong",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={shell}>
        {body}
      </Link>
    );
  }

  return <div className={shell}>{body}</div>;
}

function DeltaChip({ label, direction, goodDirection = "up" }: StatDelta) {
  const Icon =
    direction === "up"
      ? ArrowUpRight
      : direction === "down"
        ? ArrowDownRight
        : ArrowRight;

  const good = direction === "flat" ? null : direction === goodDirection;

  return (
    <span
      className={cn(
        // 실측 최소 글자 크기가 12px이다. 11px(nano)은 값 옆 보조 표식이라도 쓰지 않는다.
        "ml-1 inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5 text-micro font-medium tabular-nums",
        good === null
          ? "bg-subtle text-muted"
          : good
            ? "bg-success-light text-success-ink"
            : "bg-danger-light text-danger-ink",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}
