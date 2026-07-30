"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogIn, LogOut, MapPinOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { checkIn, checkOut } from "@/server/actions/attendance";
import { WORK_STATUS_LABELS } from "@/features/attendance/constants";
import { toSeoulTime } from "@/features/calendar/date";
import type { AttendanceRecord, WorkStatus } from "@/types/db";

/**
 * 출퇴근 체크 (스펙 03 · 3.1)
 * 홈 위젯과 근태 화면에서 같은 컴포넌트를 쓴다.
 *
 * 위치 정보는 선택 동의다. 브라우저가 거부하거나 응답이 늦어도 체크인은 진행한다 —
 * 위치는 참고 신호일 뿐이고, 이걸로 출근을 막으면 재택·외근이 불가능해진다.
 */
export function CheckInOut({
  record,
  compact,
}: {
  record: AttendanceRecord | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [workStatus, setWorkStatus] = useState<WorkStatus>("normal_office");
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(
    record?.location_warning ?? null,
  );
  const [pending, startTransition] = useTransition();

  const checkedIn = !!record?.check_in_at;
  const checkedOut = !!record?.check_out_at;

  /** 위치 동의를 최대 5초만 기다린다. 실패해도 null로 진행. */
  const getPosition = (): Promise<{ lat: number; lng: number } | null> =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      const timer = setTimeout(() => resolve(null), 5000);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
        { timeout: 5000 },
      );
    });

  const doCheckIn = () => {
    setMessage(null);
    setWarning(null);
    startTransition(async () => {
      const position = await getPosition();
      const result = await checkIn({
        workStatus,
        latitude: position?.lat ?? null,
        longitude: position?.lng ?? null,
      });
      if (result.ok) {
        if (result.warning) setWarning(result.warning);
        router.refresh();
        return;
      }
      setMessage(result.message ?? "출근 처리에 실패했습니다.");
    });
  };

  const doCheckOut = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await checkOut();
      if (result.ok) {
        router.refresh();
        return;
      }
      setMessage(result.message ?? "퇴근 처리에 실패했습니다.");
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 divide-x divide-line rounded-card bg-canvas py-3 text-center">
        <div>
          <p className="text-caption">출근</p>
          <p className="mt-0.5 text-body font-semibold tabular-nums text-ink">
            {record?.check_in_at ? toSeoulTime(record.check_in_at) : "--:--"}
          </p>
        </div>
        <div>
          <p className="text-caption">퇴근</p>
          <p className="mt-0.5 text-body font-semibold tabular-nums text-ink">
            {record?.check_out_at ? toSeoulTime(record.check_out_at) : "--:--"}
          </p>
        </div>
        <div>
          <p className="text-caption">근무상태</p>
          <p className="mt-0.5 text-body font-semibold text-ink">
            {record ? WORK_STATUS_LABELS[record.work_status] : "-"}
          </p>
        </div>
      </div>

      {!checkedIn ? (
        <Select
          aria-label="근무상태 선택"
          value={workStatus}
          onChange={(e) => setWorkStatus(e.target.value as WorkStatus)}
          disabled={pending}
        >
          {(Object.keys(WORK_STATUS_LABELS) as WorkStatus[]).map((key) => (
            <option key={key} value={key}>
              {WORK_STATUS_LABELS[key]}
            </option>
          ))}
        </Select>
      ) : null}

      <div className="flex gap-2">
        <Button
          onClick={doCheckIn}
          disabled={pending || checkedIn}
          className="flex-1"
        >
          <LogIn className="size-4" />
          {checkedIn ? "출근 완료" : pending ? "처리 중…" : "출근하기"}
        </Button>
        <Button
          variant="secondary"
          onClick={doCheckOut}
          disabled={pending || !checkedIn || checkedOut}
          className="flex-1"
        >
          <LogOut className="size-4" />
          {checkedOut ? "퇴근 완료" : "퇴근하기"}
        </Button>
      </div>

      {warning ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-warn/10 px-3 py-2 text-label text-[#8A6316]">
          <MapPinOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {warning}
        </p>
      ) : null}

      {message ? <p className="text-label text-danger">{message}</p> : null}

      {!compact && record?.manual_adjustment_reason ? (
        <p className="text-caption">
          수정 이력: {record.manual_adjustment_reason}
        </p>
      ) : null}
    </div>
  );
}
