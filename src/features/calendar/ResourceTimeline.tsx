"use client";

import { toSeoulTime } from "@/features/calendar/date";
import {
  TIMELINE_END_MIN,
  TIMELINE_SLOTS,
  TIMELINE_SLOT_MIN,
  TIMELINE_START_MIN,
  minutesOfIso,
  slotRange,
  timeOfMinutes,
  timelinePct,
  type ResourceBookingBrief,
} from "@/features/calendar/data-client";
import { cn } from "@/lib/utils";

/**
 * 리소스 × 시간 타임라인의 한 줄.
 *
 * 예약 화면의 원래 질문은 "이 회의실이 몇 건 잡혔나"가 아니라 "3시에 비나"다.
 * 목록으로는 그 답이 안 나온다 — 하루를 폭으로 펴고, 찬 구간은 블록으로,
 * 빈 구간은 누를 수 있는 칸으로 둔다. 빈칸을 누르면 그 시각이 예약 폼에 들어간다.
 *
 * 예약 모달과 예약 현황판이 같은 규칙으로 그려야 해서(하나가 비었다고 하는데
 * 다른 하나가 찼다고 하면 아무도 못 믿는다) 이 컴포넌트 하나만 쓴다.
 */

/** 2시간마다 눈금 */
const TICKS = Array.from(
  { length: Math.floor((TIMELINE_END_MIN - TIMELINE_START_MIN) / 120) + 1 },
  (_, i) => TIMELINE_START_MIN + i * 120,
);

const SLOT_WIDTH_PCT =
  (TIMELINE_SLOT_MIN / (TIMELINE_END_MIN - TIMELINE_START_MIN)) * 100;

export interface TimelineSelection {
  startMin: number;
  endMin: number;
}

const TRACK_HEIGHT = {
  sm: "h-8",
  md: "h-10",
} as const;

export function TimelineTrack({
  blocks,
  selection,
  conflict,
  myId,
  onPickSlot,
  slotLabel,
  size = "sm",
}: {
  blocks: ResourceBookingBrief[];
  /** 지금 폼에 들어 있는 시간대. 그리면 "여기에 넣겠다"가 보인다 */
  selection?: TimelineSelection | null;
  conflict?: boolean;
  /** 내 예약을 남의 예약과 구분한다 */
  myId?: string;
  /** 빈칸 클릭. 없으면 읽기 전용 타임라인 */
  onPickSlot?: (range: TimelineSelection) => void;
  /** 빈칸 aria-label 앞에 붙일 이름 ("대회의실") */
  slotLabel?: string;
  size?: keyof typeof TRACK_HEIGHT;
}) {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-sm bg-subtle",
        TRACK_HEIGHT[size],
      )}
    >
      {TICKS.slice(1, -1).map((minutes) => (
        <span
          key={minutes}
          aria-hidden
          className="absolute inset-y-0 w-px bg-line"
          style={{ left: `${timelinePct(minutes)}%` }}
        />
      ))}

      {/* 빈칸은 블록 아래에 깔아 둔다 — 겹치는 자리는 slotRange가 이미 걸러낸다 */}
      {onPickSlot
        ? TIMELINE_SLOTS.map((startMin) => {
            const range = slotRange(startMin, blocks);
            if (!range) return null;
            const time = `${timeOfMinutes(range.startMin)}–${timeOfMinutes(range.endMin)}`;
            return (
              <button
                key={startMin}
                type="button"
                onClick={() => onPickSlot(range)}
                title={`${slotLabel ? `${slotLabel} ` : ""}${time} 예약`}
                aria-label={`${slotLabel ? `${slotLabel} ` : ""}${time} 예약`}
                className="absolute inset-y-0 border-l border-transparent transition-colors duration-fast ease-standard hover:border-primary hover:bg-primary-light"
                style={{
                  left: `${timelinePct(startMin)}%`,
                  width: `${SLOT_WIDTH_PCT}%`,
                }}
              />
            );
          })
        : null}

      {blocks.map((booking) => {
        const left = timelinePct(minutesOfIso(booking.startAt));
        const right = timelinePct(minutesOfIso(booking.endAt));
        const mine = !!myId && booking.bookerId === myId;
        return (
          <span
            key={booking.id}
            title={`${toSeoulTime(booking.startAt)}–${toSeoulTime(booking.endAt)} ${booking.bookerName ?? "예약됨"}${booking.purpose ? ` · ${booking.purpose}` : ""}`}
            className={cn(
              "absolute inset-y-1 flex items-center overflow-hidden rounded-sm px-1 text-nano",
              mine ? "bg-primary-light text-primary-ink" : "bg-line-strong text-ink",
            )}
            style={{
              left: `${left}%`,
              width: `${Math.max(right - left, 1)}%`,
            }}
          >
            <span className="truncate">{booking.bookerName ?? "예약됨"}</span>
          </span>
        );
      })}

      {selection ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 rounded-sm border-2",
            conflict
              ? "border-danger bg-danger-light/70"
              : "border-primary bg-primary-light/60",
          )}
          style={{
            left: `${timelinePct(selection.startMin)}%`,
            width: `${Math.max(
              timelinePct(selection.endMin) - timelinePct(selection.startMin),
              1,
            )}%`,
          }}
        />
      ) : null}
    </div>
  );
}

/** 트랙 아래 시각 눈금 */
export function TimelineAxis({ className }: { className?: string }) {
  return (
    <div className={cn("relative h-3", className)}>
      {TICKS.map((minutes, index) => {
        const isFirst = index === 0;
        const isLast = index === TICKS.length - 1;
        return (
          <span
            key={minutes}
            className={cn(
              "absolute text-nano tabular-nums text-muted",
              isFirst ? "left-0" : isLast ? "right-0" : "-translate-x-1/2",
            )}
            style={
              isFirst || isLast
                ? undefined
                : { left: `${timelinePct(minutes)}%` }
            }
          >
            {timeOfMinutes(minutes)}
          </span>
        );
      })}
    </div>
  );
}
