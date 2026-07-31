"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Meter } from "@/components/ui/Progress";
import { checkIn, checkOut } from "@/server/actions/attendance";
import { WORK_STATUS_LABELS } from "@/features/attendance/constants";
import { toSeoulTime } from "@/features/calendar/date";
import type { WeeklyHours } from "@/features/attendance/data";
import type { AttendanceRecord, WorkStatus } from "@/types/db";
import { cn } from "@/lib/utils";

/**
 * 모듈 패널 하단에 상주하는 근태 블록.
 *
 * 매일 반복되는 유일한 실제 액션인 출퇴근이 본문 카드 안에 있어서,
 * 스크롤하면 시야에서 사라지고 역할에 따라 위치가 바뀌었으며
 * 위젯 표시 설정을 끄면 아예 없어졌다(대체 경로 없음).
 * 여기로 옮기고 숨김 설정 대상에서 제외한다.
 */
export function AttendancePanelWidget({
  record,
  week,
}: {
  record: AttendanceRecord | null;
  week: WeeklyHours;
}) {
  const router = useRouter();
  const [workStatus, setWorkStatus] = useState<WorkStatus>("normal_office");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const checkedIn = !!record?.check_in_at;
  const checkedOut = !!record?.check_out_at;

  const submit = (action: "in" | "out") => {
    setMessage(null);
    startTransition(async () => {
      const result =
        action === "in"
          ? await checkIn({ workStatus, lat: null, lng: null })
          : await checkOut();
      if (!result.ok) setMessage(result.message ?? "처리하지 못했습니다");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <LiveClock />

      <div className="grid grid-cols-2 gap-2 text-center">
        <TimeCell
          label="출근"
          value={record?.check_in_at ? toSeoulTime(record.check_in_at) : null}
        />
        <TimeCell
          label="퇴근"
          value={record?.check_out_at ? toSeoulTime(record.check_out_at) : null}
        />
      </div>

      {!checkedIn ? (
        <>
          <select
            value={workStatus}
            onChange={(e) => setWorkStatus(e.target.value as WorkStatus)}
            disabled={pending}
            aria-label="근무 상태"
            className="h-8 w-full rounded-sm border border-line-strong bg-surface px-2 text-label text-ink"
          >
            {(Object.keys(WORK_STATUS_LABELS) as WorkStatus[]).map((key) => (
              <option key={key} value={key}>
                {WORK_STATUS_LABELS[key]}
              </option>
            ))}
          </select>
          <Button
            size="small"
            className="w-full"
            disabled={pending}
            onClick={() => submit("in")}
          >
            <LogIn className="size-4" aria-hidden />
            출근하기
          </Button>
        </>
      ) : !checkedOut ? (
        <Button
          size="small"
          variant="secondary"
          className="w-full"
          disabled={pending}
          onClick={() => submit("out")}
        >
          <LogOut className="size-4" aria-hidden />
          퇴근하기
        </Button>
      ) : (
        <p className="rounded-sm bg-success-light px-2 py-1.5 text-center text-label text-success-ink">
          오늘 근무 완료
        </p>
      )}

      {message ? <p className="text-nano text-danger">{message}</p> : null}

      <div className="border-t border-line pt-3">
        <Meter
          value={week.hours}
          max={week.limitHours}
          thresholds={[
            { at: week.targetHours, tone: "brand" },
            { at: week.warnHours, tone: "warning" },
            { at: week.limitHours, tone: "critical" },
          ]}
          label="이번 주"
          valueLabel={formatHours(week.hours)}
          size="sm"
        />
        <p className="mt-1.5 text-nano leading-relaxed text-muted">
          {coachingLine(week)}
        </p>
      </div>
    </div>
  );
}

function TimeCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-sm bg-subtle px-2 py-1.5">
      <p className="text-nano text-muted">{label}</p>
      <p
        className={cn(
          "text-label font-bold tabular-nums",
          value ? "text-ink" : "text-muted",
        )}
      >
        {value ?? "--:--"}
      </p>
    </div>
  );
}

/**
 * 실시간 시계.
 * 서버에서 렌더한 시각과 클라이언트 시각이 다르면 hydration이 어긋나므로,
 * 마운트 전에는 자리만 잡아두고 값은 비워둔다.
 */
function LiveClock() {
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    const tick = () =>
      setNow(
        new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date()),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <p className="text-center text-h2 tabular-nums text-ink">
      {now ?? "--:--:--"}
    </p>
  );
}

function formatHours(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}

/**
 * "남은 3일간 하루 평균 4h 55m" — 목표까지의 페이스를 알려준다.
 * 숫자만 던지는 것보다 다음 행동을 정하기 쉽다.
 */
function coachingLine(week: WeeklyHours) {
  if (week.level === "over") {
    return `주 ${week.limitHours}시간을 ${formatHours(week.hours - week.limitHours)} 초과했습니다`;
  }

  const remainingHours = week.targetHours - week.hours;
  const remainingDays = Math.max(
    0,
    week.plannedWorkDayCount - week.workedDayCount,
  );

  if (remainingHours <= 0) {
    return `${formatHours(week.targetHours)} 달성 · 근무일 ${week.workedDayCount}/${week.plannedWorkDayCount}일`;
  }
  if (remainingDays === 0) {
    return `근무일 ${week.workedDayCount}/${week.plannedWorkDayCount}일 · ${formatHours(remainingHours)} 미달`;
  }
  return `남은 ${remainingDays}일간 하루 평균 ${formatHours(remainingHours / remainingDays)} 필요`;
}
