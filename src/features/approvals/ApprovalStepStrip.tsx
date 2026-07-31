import { cn } from "@/lib/utils";

/**
 * 결재 진행 스트립.
 *
 * 예전에는 목록의 '현재 단계' 칸이 `current_step === 1 ? "1차 검토" : "최종 승인"`
 * 이라는 순수 텍스트였고, 기안 화면에만 칩 형태의 결재라인 미리보기가 있었다.
 * 같은 개념을 화면마다 다른 모양으로 그리니 목록에서 배운 읽는 법이
 * 상세로 이어지지 않았다. 세 화면이 이 한 부품을 공유한다.
 *
 * 훅을 쓰지 않으므로 서버 컴포넌트에서도 그대로 렌더된다.
 */

export type StepState = "done" | "current" | "todo" | "rejected";

export interface StripStep {
  label: string;
  /** 담당자 이름(+직위). 없으면 라벨만 */
  name?: string | null;
  state: StepState;
}

const BAR: Record<StepState, string> = {
  done: "bg-success",
  current: "bg-info",
  todo: "bg-line",
  rejected: "bg-danger",
};

const CHIP: Record<StepState, string> = {
  done: "bg-success-light text-success-ink",
  current: "bg-info-light text-info-ink",
  todo: "bg-subtle text-muted",
  rejected: "bg-danger-light text-danger-ink",
};

/**
 * 표 셀용 축소판 — 단계 수만큼 막대를 깔고 지금 어디인지 한 줄로 적는다.
 * 텍스트만 있을 때와 달리 "2단계 중 1단계"가 눈으로 스캔된다.
 */
export function ApprovalStepBar({
  steps,
  className,
}: {
  steps: StripStep[];
  className?: string;
}) {
  const active = steps.find((s) => s.state === "current" || s.state === "rejected");
  const doneCount = steps.filter((s) => s.state === "done").length;

  return (
    <div className={cn("min-w-28", className)}>
      <div className="flex gap-0.5" aria-hidden>
        {steps.map((step, i) => (
          <span
            key={i}
            className={cn("h-1.5 flex-1 rounded-pill", BAR[step.state])}
            title={`${step.label}${step.name ? ` · ${step.name}` : ""}`}
          />
        ))}
      </div>
      <p className="mt-1 truncate text-nano text-muted">
        {active
          ? `${active.label}${active.name ? ` · ${active.name}` : ""}`
          : `${doneCount}/${steps.length}단계 완료`}
      </p>
    </div>
  );
}

/**
 * 기안·상세용 전체판 — 칩과 화살표로 결재선을 그대로 보여준다.
 */
export function ApprovalStepStrip({
  steps,
  className,
}: {
  steps: StripStep[];
  className?: string;
}) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {steps.map((step, i) => (
        <li key={i} className="flex items-center gap-1.5">
          {i > 0 ? (
            <span className="text-muted" aria-hidden>
              →
            </span>
          ) : null}
          <span
            className={cn(
              "rounded-sm px-2.5 py-1.5 text-left",
              CHIP[step.state],
            )}
          >
            <span className="block text-nano opacity-80">{step.label}</span>
            <span className="block text-label font-bold">
              {step.name ?? "미지정"}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
