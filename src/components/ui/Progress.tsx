import { cn } from "@/lib/utils";

/**
 * Meter — 값을 상한 대비 얼마인지 보여주는 진행바.
 *
 * 이 부품이 없어서 지금까지 모든 지표가 "맥락 없는 숫자 하나"로 렌더됐다.
 * 근태 주간 근무(0/40/52h), 연차 소진율, 게시판 열람률, Drive 용량,
 * 부서 인원 분포가 전부 이걸 공유한다.
 *
 * 차트 라이브러리를 쓰지 않는 이유: 필요한 건 1차원 막대 하나뿐이고,
 * 번들 수십 KB를 늘리는 대신 div 두 개로 끝난다.
 */

export type MeterTone =
  | "brand"
  | "neutral"
  | "positive"
  | "informative"
  | "warning"
  | "critical";

/*
 * positive는 민트 축의 **accent-ink**(#158466)다.
 *
 * accent는 14-ehr 재실측으로 민트로 복원됐다(판정 이력은 tailwind.config.ts
 * accent 주석). 막대·범례는 DEFAULT 민트(#44d1a5)가 아니라 ink를 쓴다 —
 * 4px 막대에서 DEFAULT는 트랙(bg-line #eaecef)과 1.6:1이라 진행률이 안
 * 읽히고, ink는 트랙 대비 ~3.7:1로 읽힌다. 숫자(StatCard 28px 민트)와
 * 막대(민트 잉크)가 색상은 같고 명도만 다른 관계다.
 *
 * 범례 점을 그리는 화면들은 이 표를 그대로 가져다 쓴다(METER_FILL).
 * 각 화면이 "bg-success" 같은 문자열을 따로 들고 있으면 여기 값을 바꾼 순간
 * 막대와 범례가 서로 다른 색이 된다.
 */
const FILL: Record<MeterTone, string> = {
  brand: "bg-primary",
  neutral: "bg-muted",
  positive: "bg-accent-ink",
  informative: "bg-info",
  /*
   * warning 채움은 warn(#f0bc00)이 아니라 warn-strong(yellow-64 #b18803).
   * warn은 트랙 대비 1.49:1이라 4px 막대의 48h 경고 구간이 사실상 안
   * 보였다 — positive가 accent-ink(primary-64)로 내려간 것과 같은 보정이고,
   * critical(#ee3010=red-64)과도 같은 스텝이다. METER_FILL을 쓰는 범례는
   * 자동으로 따라온다.
   */
  warning: "bg-warn-strong",
  critical: "bg-danger",
};

/** 범례 스와치 색 — 반드시 Meter의 채움 색과 같은 출처여야 한다 */
export const METER_FILL: Record<MeterTone, string> = FILL;

const TEXT: Record<MeterTone, string> = {
  brand: "text-primary",
  neutral: "text-ink",
  positive: "text-accent-ink",
  informative: "text-info-ink",
  warning: "text-warn-ink",
  critical: "text-danger-ink",
};

export interface MeterThreshold {
  /** 눈금 위치(값 기준). max와 같은 단위 */
  at: number;
  /** 눈금 아래 캡션. 없으면 선만 그린다 */
  label?: string;
  /** 값이 이 선을 넘었을 때 채움에 적용할 톤 */
  tone: MeterTone;
}

export interface MeterSegment {
  value: number;
  tone: MeterTone;
  label?: string;
}

const HEIGHT = {
  sm: "h-1",
  md: "h-2",
  lg: "h-2.5",
} as const;

/** value가 넘어선 임계선 중 가장 높은 것의 톤을 고른다 */
export function resolveMeterTone(
  value: number,
  base: MeterTone,
  thresholds: MeterThreshold[],
): MeterTone {
  const crossed = thresholds
    .filter((t) => value >= t.at)
    .sort((a, b) => b.at - a.at)[0];
  return crossed?.tone ?? base;
}

export function Meter({
  value,
  max,
  segments,
  tone = "brand",
  thresholds = [],
  label,
  valueLabel,
  showScale = false,
  maxLabel,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: {
  value?: number;
  max: number;
  /** 여러 조각을 쌓아 보여준다(사용/예정/잔여 등). 주면 value는 무시된다 */
  segments?: MeterSegment[];
  tone?: MeterTone;
  thresholds?: MeterThreshold[];
  /** 트랙 위 좌측 캡션 */
  label?: React.ReactNode;
  /** 트랙 위 우측 캡션 */
  valueLabel?: React.ReactNode;
  /** 트랙 아래 0·임계선·max 눈금 캡션 */
  showScale?: boolean;
  /** 우측 끝 눈금 라벨. 없으면 max를 그대로 쓴다("52h" vs "52") */
  maxLabel?: string;
  size?: keyof typeof HEIGHT;
  className?: string;
  "aria-label"?: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const total = segments
    ? segments.reduce((sum, s) => sum + s.value, 0)
    : (value ?? 0);
  const pct = (n: number) => Math.min(100, Math.max(0, (n / safeMax) * 100));
  const fillTone = resolveMeterTone(total, tone, thresholds);

  // 눈금 캡션이 트랙 밖으로 삐져나가지 않게 양 끝만 정렬을 바꾼다
  const anchor = (p: number) =>
    p <= 2 ? "left-0" : p >= 98 ? "right-0" : "-translate-x-1/2";

  return (
    <div className={cn("w-full", className)}>
      {label || valueLabel ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          {label ? (
            <span className="truncate text-label text-muted">{label}</span>
          ) : (
            <span />
          )}
          {valueLabel ? (
            <span
              className={cn("shrink-0 text-label font-bold", TEXT[fillTone])}
            >
              {valueLabel}
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        role="progressbar"
        aria-valuenow={Math.round(total * 10) / 10}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-label={ariaLabel}
        className={cn(
          "relative w-full overflow-hidden rounded-pill bg-line",
          HEIGHT[size],
        )}
      >
        {segments ? (
          <div className="flex h-full">
            {segments.map((seg, i) => (
              <div
                key={i}
                className={cn("h-full", FILL[seg.tone])}
                style={{ width: `${pct(seg.value)}%` }}
                title={seg.label}
              />
            ))}
          </div>
        ) : (
          <div
            className={cn(
              "h-full rounded-pill transition-[width] duration-standard ease-standard",
              FILL[fillTone],
            )}
            style={{ width: `${pct(total)}%` }}
          />
        )}

        {/*
          임계선은 채움 위에 겹쳐 그린다. 트랙 색으로 그리면 채움이 그 지점을
          지났을 때 선이 묻혀 사라진다.
        */}
        {thresholds.map((t) => {
          const p = pct(t.at);
          if (p <= 0 || p >= 100) return null;
          return (
            <span
              key={t.at}
              aria-hidden
              className="absolute inset-y-0 w-px bg-ink/25"
              style={{ left: `${p}%` }}
            />
          );
        })}
      </div>

      {showScale ? (
        <div className="relative mt-1 h-4">
          <span className="absolute left-0 text-nano text-muted">0</span>
          {thresholds.map((t) => {
            const p = pct(t.at);
            if (!t.label || p <= 2 || p >= 98) return null;
            return (
              <span
                key={t.at}
                className={cn(
                  "absolute whitespace-nowrap text-nano text-muted",
                  anchor(p),
                )}
                style={{ left: `${p}%` }}
              >
                {t.label}
              </span>
            );
          })}
          <span className="absolute right-0 text-nano text-muted">
            {maxLabel ?? formatScaleMax(max)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 표 셀·목록 행에 인라인으로 넣는 축소판.
 * 캡션 없이 막대만 그리고, 옆에 값을 직접 쓴다.
 */
export function MiniMeter({
  value,
  max,
  tone = "neutral",
  thresholds = [],
  className,
  "aria-label": ariaLabel,
}: {
  value: number;
  max: number;
  tone?: MeterTone;
  thresholds?: MeterThreshold[];
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Meter
      value={value}
      max={max}
      tone={tone}
      thresholds={thresholds}
      size="sm"
      className={cn("min-w-16 max-w-28", className)}
      aria-label={ariaLabel}
    />
  );
}

function formatScaleMax(max: number) {
  return Number.isInteger(max) ? String(max) : String(Math.round(max * 10) / 10);
}
