"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Clock, Download, FilePenLine, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { RequestModals, type RequestKind } from "./RequestModals";
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONES,
  LEAVE_CATEGORY_LABELS,
  LEAVE_TYPE_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_TONES,
  WORK_STATUS_LABELS,
} from "./constants";
import { cancelLeaveRequest } from "@/server/actions/attendance";
import { toSeoulTime, WEEKDAY_LABELS, weekdayOf } from "@/features/calendar/date";
import { cn } from "@/lib/utils";
import { isAbsentDay, type AbsentDay } from "./data-client";
import type {
  AttendanceRecord,
  CorrectionRequest,
  LeaveRequest,
  OvertimeRequest,
} from "@/types/db";

interface Props {
  records: (AttendanceRecord | AbsentDay)[];
  leaves: LeaveRequest[];
  overtimes: OvertimeRequest[];
  corrections: CorrectionRequest[];
  remainingDays: number;
  monthLabel: string;
}

export function AttendanceView({
  records,
  leaves,
  overtimes,
  corrections,
  remainingDays,
  monthLabel,
}: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<RequestKind>(null);
  const [pending, startTransition] = useTransition();

  /**
   * 엑셀 다운로드 (스펙 3.2)
   * 외부 라이브러리 없이 CSV로 내보낸다. Excel에서 한글이 깨지지 않도록 BOM을 붙인다.
   */
  const downloadCsv = () => {
    const header = [
      "날짜",
      "요일",
      "출근",
      "퇴근",
      "근무시간",
      "근무상태",
      "상태",
      "위치경고",
    ];
    const rows = records.map((row) => {
      if (isAbsentDay(row)) {
        return [
          row.work_date,
          WEEKDAY_LABELS[weekdayOf(row.work_date)],
          "",
          "",
          "",
          "",
          ATTENDANCE_STATUS_LABELS.absent,
          "",
        ];
      }
      const r = row;
      const hours =
        r.check_in_at && r.check_out_at
          ? (
              (new Date(r.check_out_at).getTime() -
                new Date(r.check_in_at).getTime()) /
              3_600_000
            ).toFixed(1)
          : "";
      return [
        r.work_date,
        WEEKDAY_LABELS[weekdayOf(r.work_date)],
        r.check_in_at ? toSeoulTime(r.check_in_at) : "",
        r.check_out_at ? toSeoulTime(r.check_out_at) : "",
        hours,
        WORK_STATUS_LABELS[r.work_status],
        ATTENDANCE_STATUS_LABELS[r.status],
        r.location_warning ?? "",
      ];
    });

    const csv = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
      )
      .join("\r\n");

    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `근태기록_${monthLabel.replace(/\s/g, "")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const cancel = (id: string) => {
    if (!window.confirm("이 신청을 취소하시겠습니까?")) return;
    startTransition(async () => {
      const result = await cancelLeaveRequest(id);
      if (!result.ok) {
        window.alert(result.message ?? "취소하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  const halfDayLeaves = leaves.filter(
    (l) => l.leave_type === "half_day_am" || l.leave_type === "half_day_pm",
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => setModal("leave")}>
          <CalendarPlus className="size-4" />
          연차·휴가 신청
        </Button>
        <Button variant="secondary" onClick={() => setModal("overtime")}>
          <Clock className="size-4" />
          초과근무 신청
        </Button>
        <Button variant="secondary" onClick={() => setModal("correction")}>
          <FilePenLine className="size-4" />
          근태 수정요청
        </Button>
        <Button
          variant="ghost"
          onClick={downloadCsv}
          disabled={records.length === 0}
          className="ml-auto"
        >
          <Download className="size-4" />
          엑셀 다운로드
        </Button>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader
            title={`${monthLabel} 근태 기록`}
            description="지각 판정 기준은 09:10, 정규 근무시간은 09:00~18:00입니다."
          />
          <CardBody className="p-0">
            {records.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="이번 달 근태 기록이 없습니다"
                description="출근 체크를 하면 여기에 쌓입니다."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="ab-table min-w-[720px]">
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>출근</th>
                      <th>퇴근</th>
                      <th>근무시간</th>
                      <th>근무상태</th>
                      <th>상태</th>
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((row) => {
                      // 근무일인데 기록이 없는 날은 결근으로 표시 (data.ts에서 계산)
                      if (isAbsentDay(row)) {
                        const wd = weekdayOf(row.work_date);
                        return (
                          <tr key={`absent-${row.work_date}`}>
                            <td className="whitespace-nowrap tabular-nums">
                              <span
                                className={cn(
                                  wd === 0
                                    ? "text-danger"
                                    : wd === 6
                                      ? "text-primary"
                                      : undefined,
                                )}
                              >
                                {row.work_date} ({WEEKDAY_LABELS[wd]})
                              </span>
                            </td>
                            <td className="text-muted">-</td>
                            <td className="text-muted">-</td>
                            <td className="text-muted">-</td>
                            <td className="text-muted">-</td>
                            <td>
                              <Badge tone="danger">
                                {ATTENDANCE_STATUS_LABELS.absent}
                              </Badge>
                            </td>
                            <td className="text-caption">기록 없음</td>
                          </tr>
                        );
                      }

                      const r = row;
                      const weekday = weekdayOf(r.work_date);
                      const hours =
                        r.check_in_at && r.check_out_at
                          ? (
                              (new Date(r.check_out_at).getTime() -
                                new Date(r.check_in_at).getTime()) /
                              3_600_000
                            ).toFixed(1)
                          : null;
                      return (
                        <tr key={r.id}>
                          <td className="whitespace-nowrap tabular-nums">
                            <span
                              className={cn(
                                weekday === 0
                                  ? "text-danger"
                                  : weekday === 6
                                    ? "text-primary"
                                    : undefined,
                              )}
                            >
                              {r.work_date} ({WEEKDAY_LABELS[weekday]})
                            </span>
                          </td>
                          <td className="tabular-nums">
                            {r.check_in_at ? toSeoulTime(r.check_in_at) : "-"}
                          </td>
                          <td className="tabular-nums">
                            {r.check_out_at ? toSeoulTime(r.check_out_at) : "-"}
                          </td>
                          <td className="tabular-nums">
                            {hours ? `${hours}h` : "-"}
                          </td>
                          <td>{WORK_STATUS_LABELS[r.work_status]}</td>
                          <td>
                            <Badge tone={ATTENDANCE_STATUS_TONES[r.status]}>
                              {ATTENDANCE_STATUS_LABELS[r.status]}
                            </Badge>
                          </td>
                          <td className="text-caption">
                            {r.location_warning ??
                              r.manual_adjustment_reason ??
                              "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="휴가 신청 내역"
            description="연차는 승인 시점에 잔여에서 차감됩니다. 법정휴가는 차감되지 않습니다."
          />
          <CardBody className="p-0">
            {leaves.length === 0 ? (
              <EmptyState
                icon={CalendarPlus}
                title="신청 내역이 없습니다"
                compact
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="ab-table min-w-[720px]">
                  <thead>
                    <tr>
                      <th>기간</th>
                      <th>종류</th>
                      <th>단위</th>
                      <th>일수</th>
                      <th>상태</th>
                      <th>사유·비고</th>
                      <th className="w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaves.map((l) => (
                      <tr key={l.id}>
                        <td className="whitespace-nowrap tabular-nums">
                          {l.start_date === l.end_date
                            ? l.start_date
                            : `${l.start_date} ~ ${l.end_date}`}
                        </td>
                        <td>{LEAVE_CATEGORY_LABELS[l.leave_category]}</td>
                        <td>
                          {LEAVE_TYPE_LABELS[l.leave_type]}
                          {l.leave_type === "hourly" && l.hours
                            ? ` ${l.hours}h`
                            : ""}
                        </td>
                        <td className="tabular-nums">{l.days}일</td>
                        <td>
                          <Badge tone={REQUEST_STATUS_TONES[l.status]}>
                            {REQUEST_STATUS_LABELS[l.status]}
                          </Badge>
                        </td>
                        <td className="text-caption">
                          {l.rejection_reason
                            ? `반려: ${l.rejection_reason}`
                            : (l.reason ?? "-")}
                        </td>
                        <td>
                          {l.status === "pending" || l.status === "approved" ? (
                            <button
                              type="button"
                              onClick={() => cancel(l.id)}
                              disabled={pending}
                              className="rounded-md p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                              aria-label="신청 취소"
                              title="신청 취소"
                            >
                              <X className="size-3.5" />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        {halfDayLeaves.length > 0 ? (
          <Card>
            <CardHeader title="반차 사용 내역" />
            <CardBody>
              <ul className="divide-y divide-line">
                {halfDayLeaves.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between gap-2 py-2.5"
                  >
                    <span className="tabular-nums text-body text-ink">
                      {l.start_date}
                    </span>
                    <span className="text-body">
                      {LEAVE_TYPE_LABELS[l.leave_type]}
                    </span>
                    <Badge tone={REQUEST_STATUS_TONES[l.status]}>
                      {REQUEST_STATUS_LABELS[l.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Card>
            <CardHeader title="초과근무 신청" />
            <CardBody className="p-0">
              {overtimes.length === 0 ? (
                <EmptyState icon={Clock} title="신청 내역이 없습니다" compact />
              ) : (
                <ul className="divide-y divide-line px-5">
                  {overtimes.map((o) => (
                    <li key={o.id} className="py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="tabular-nums text-body text-ink">
                          {o.work_date} {o.start_time.slice(0, 5)}~
                          {o.end_time.slice(0, 5)}
                        </span>
                        <Badge tone={REQUEST_STATUS_TONES[o.status]}>
                          {REQUEST_STATUS_LABELS[o.status]}
                        </Badge>
                      </div>
                      <p className="text-caption">
                        {o.compensate_as_leave ? "보상휴가 전환 · " : ""}
                        {o.rejection_reason
                          ? `반려: ${o.rejection_reason}`
                          : o.reason}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="근태 수정요청" />
            <CardBody className="p-0">
              {corrections.length === 0 ? (
                <EmptyState
                  icon={FilePenLine}
                  title="요청 내역이 없습니다"
                  compact
                />
              ) : (
                <ul className="divide-y divide-line px-5">
                  {corrections.map((c) => (
                    <li key={c.id} className="py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="tabular-nums text-body text-ink">
                          {c.target_date}
                        </span>
                        <Badge tone={REQUEST_STATUS_TONES[c.status]}>
                          {REQUEST_STATUS_LABELS[c.status]}
                        </Badge>
                      </div>
                      <p className="text-caption">
                        {c.rejection_reason
                          ? `반려: ${c.rejection_reason}`
                          : c.reason}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <RequestModals
        open={modal}
        onClose={() => setModal(null)}
        remainingDays={remainingDays}
      />
    </>
  );
}
