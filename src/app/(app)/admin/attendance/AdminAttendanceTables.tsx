"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  Download,
  Pencil,
  Settings2,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import {
  FilterChip,
  TableToolbar,
  ToolbarSearch,
} from "@/components/ui/TableToolbar";
import { MiniMeter } from "@/components/ui/Progress";
import { AvatarWithName } from "@/components/ui/Avatar";
import { downloadCsv } from "@/lib/csv";
import {
  adjustAttendanceRecord,
  adjustLeaveBalance,
  setCompensatoryRate,
} from "@/server/actions/attendance";
import {
  ATTENDANCE_STATUS_LABELS,
  WEEKLY_LIMIT_HOURS,
  WEEKLY_WARN_HOURS,
} from "@/features/attendance/constants";
import { formatDays, formatHours } from "@/features/attendance/format";
import { toSeoulTime, WEEKDAY_LABELS, weekdayOf } from "@/features/calendar/date";
import { cn } from "@/lib/utils";
import type { AttendanceStatus } from "@/types/db";

export interface AdminRow {
  employeeId: string;
  name: string;
  departmentName: string | null;
  profileImageUrl: string | null;
  workDays: number;
  plannedDays: number;
  totalHours: number;
  lateCount: number;
  earlyLeaveCount: number;
  absentDays: number;
  remainingLeave: number;
  accruedLeave: number;
  /** 조회 기간 중 가장 긴 한 주의 근무시간 */
  peakWeeklyHours: number;
  peakWeekStart: string | null;
}

export interface AdminRecordRow {
  id: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: AttendanceStatus;
  reason: string | null;
}

/** 표 셀 미니바 — 요약 밴드의 Meter와 같은 임계선을 쓴다 */
const CELL_THRESHOLDS = [
  { at: WEEKLY_WARN_HOURS, tone: "warning" as const },
  { at: WEEKLY_LIMIT_HOURS, tone: "critical" as const },
];

const STATUS_FILTERS: { value: AttendanceStatus | "all"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "normal", label: "정상" },
  { value: "late", label: "지각" },
  { value: "early_leave", label: "조퇴" },
];

/**
 * 전사 근태 — 목록과 수동 조정.
 *
 * 요약 밴드와 52시간 모니터는 서버(page.tsx)가 그린다. 여기는 검색·필터가
 * 필요한 두 개의 조밀 표와 조정 모달만 담당한다.
 */
export function AdminAttendanceTables({
  rows,
  records,
  periodLabel,
  compensatoryRate,
}: {
  rows: AdminRow[];
  records: AdminRecordRow[];
  periodLabel: string;
  compensatoryRate: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminRecordRow | null>(null);
  const [adjusting, setAdjusting] = useState<AdminRow | null>(null);
  const [rateOpen, setRateOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [rowQuery, setRowQuery] = useState("");
  const [recordQuery, setRecordQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<AttendanceStatus | "all">(
    "all",
  );

  // 수동 조정 폼
  const [checkInTime, setCheckInTime] = useState("");
  const [checkOutTime, setCheckOutTime] = useState("");
  const [editReason, setEditReason] = useState("");
  // 연차 조정 폼
  const [days, setDays] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [rate, setRate] = useState(String(compensatoryRate));
  const [error, setError] = useState<string | null>(null);

  const visibleRows = useMemo(() => {
    const q = rowQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        (row.departmentName ?? "").toLowerCase().includes(q),
    );
  }, [rows, rowQuery]);

  const visibleRecords = useMemo(() => {
    const q = recordQuery.trim().toLowerCase();
    return records.filter((record) => {
      if (statusFilter !== "all" && record.status !== statusFilter) return false;
      if (!q) return true;
      return (
        record.employeeName.toLowerCase().includes(q) ||
        record.workDate.includes(q)
      );
    });
  }, [records, recordQuery, statusFilter]);

  const statusCount = (value: AttendanceStatus | "all") =>
    value === "all"
      ? records.length
      : records.filter((record) => record.status === value).length;

  const openEdit = (record: AdminRecordRow) => {
    setEditing(record);
    setCheckInTime(record.checkInAt ? toSeoulTime(record.checkInAt) : "");
    setCheckOutTime(record.checkOutAt ? toSeoulTime(record.checkOutAt) : "");
    setEditReason("");
    setError(null);
  };

  const submitEdit = () => {
    if (!editing) return;
    setError(null);
    startTransition(async () => {
      const result = await adjustAttendanceRecord({
        employeeId: editing.employeeId,
        workDate: editing.workDate,
        checkInTime,
        checkOutTime,
        reason: editReason,
      });
      if (!result.ok) {
        setError(
          result.fieldErrors?.reason ??
            result.fieldErrors?.checkOutTime ??
            result.message ??
            "수정하지 못했습니다.",
        );
        return;
      }
      setEditing(null);
      router.refresh();
    });
  };

  const submitAdjust = () => {
    if (!adjusting) return;
    setError(null);
    startTransition(async () => {
      const result = await adjustLeaveBalance(
        adjusting.employeeId,
        Number(days),
        adjustReason,
      );
      if (!result.ok) {
        setError(
          result.fieldErrors?.days ??
            result.fieldErrors?.reason ??
            result.message ??
            "조정하지 못했습니다.",
        );
        return;
      }
      setAdjusting(null);
      setDays("");
      setAdjustReason("");
      router.refresh();
    });
  };

  const submitRate = () => {
    setError(null);
    startTransition(async () => {
      const result = await setCompensatoryRate(Number(rate));
      if (!result.ok) {
        setError(result.fieldErrors?.rate ?? result.message ?? "저장 실패");
        return;
      }
      setRateOpen(false);
      router.refresh();
    });
  };

  const exportCsv = () => {
    downloadCsv(
      `전사근태_${periodLabel.replace(/[\s~]/g, "")}`,
      [
        "이름",
        "부서",
        "근무일수",
        "근무예정일",
        "총근무시간",
        "주간최대",
        "지각",
        "조퇴",
        "결근",
        "잔여연차",
      ],
      visibleRows.map((row) => [
        row.name,
        row.departmentName ?? "",
        row.workDays,
        row.plannedDays,
        row.totalHours,
        row.peakWeeklyHours,
        row.lateCount,
        row.earlyLeaveCount,
        row.absentDays,
        row.remainingLeave,
      ]),
    );
  };

  return (
    <>
      <div className="space-y-5">
        <Card>
          <CardHeader
            title={`${periodLabel} 임직원별 근태`}
            description={`재직 ${rows.length}명 · 연차 조정은 경력직 이월 등 특수 케이스에 사용합니다`}
            density="compact"
          />
          <CardBody density="compact" className="!pb-0">
            <TableToolbar
              search={
                <ToolbarSearch
                  placeholder="이름·부서 검색"
                  value={rowQuery}
                  onChange={setRowQuery}
                />
              }
              count={`${visibleRows.length}명`}
              actions={
                <>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => {
                      setRate(String(compensatoryRate));
                      setError(null);
                      setRateOpen(true);
                    }}
                  >
                    <Settings2 className="size-3.5" />
                    보상휴가 {compensatoryRate}배
                  </Button>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={exportCsv}
                    disabled={visibleRows.length === 0}
                  >
                    <Download className="size-3.5" />
                    내보내기
                  </Button>
                </>
              }
              className="mb-3"
            />
          </CardBody>
          <CardBody density="compact" className="!p-0">
            <div className="overflow-x-auto">
              <table className="ab-table ab-table--compact min-w-[900px]">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>부서</th>
                    <th>근무일</th>
                    <th>총 근무</th>
                    <th className="w-44">주간 최대</th>
                    <th>지각</th>
                    <th>조퇴</th>
                    <th>결근</th>
                    <th>잔여연차</th>
                    <th className="w-20">조정</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <TableEmptyRow
                      colSpan={10}
                      icon={Users}
                      title={
                        rows.length === 0
                          ? "재직 중인 임직원이 없습니다"
                          : "검색 결과가 없습니다"
                      }
                      description="이름 또는 부서로 검색할 수 있습니다."
                      action={
                        rowQuery ? (
                          <Button
                            size="small"
                            variant="secondary"
                            onClick={() => setRowQuery("")}
                          >
                            검색 초기화
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    visibleRows.map((row) => (
                      <tr key={row.employeeId}>
                        <td>
                          <AvatarWithName
                            name={row.name}
                            src={row.profileImageUrl}
                            size="small"
                          />
                        </td>
                        <td className="text-muted">
                          {row.departmentName ?? "-"}
                        </td>
                        <td className="whitespace-nowrap tabular-nums">
                          {row.workDays}
                          <span className="text-muted">/{row.plannedDays}일</span>
                        </td>
                        <td className="whitespace-nowrap tabular-nums">
                          {formatHours(row.totalHours)}
                        </td>
                        <td>
                          <span className="flex items-center gap-2">
                            <MiniMeter
                              value={row.peakWeeklyHours}
                              max={WEEKLY_LIMIT_HOURS}
                              tone="informative"
                              thresholds={CELL_THRESHOLDS}
                              aria-label={`${row.name} 주간 최대 근무 ${row.peakWeeklyHours}시간`}
                            />
                            <span
                              className={cn(
                                "whitespace-nowrap text-label tabular-nums",
                                row.peakWeeklyHours > WEEKLY_LIMIT_HOURS
                                  ? "font-bold text-danger-ink"
                                  : row.peakWeeklyHours >= WEEKLY_WARN_HOURS
                                    ? "font-bold text-warn-ink"
                                    : "text-muted",
                              )}
                            >
                              {formatHours(row.peakWeeklyHours)}
                            </span>
                          </span>
                        </td>
                        <td className="tabular-nums">
                          {row.lateCount > 0 ? (
                            row.lateCount
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td className="tabular-nums">
                          {row.earlyLeaveCount > 0 ? (
                            row.earlyLeaveCount
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td className="tabular-nums">
                          {row.absentDays > 0 ? (
                            row.absentDays
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap tabular-nums">
                          <span className="font-bold text-ink">
                            {formatDays(row.remainingLeave)}
                          </span>
                          <span className="text-muted">
                            /{formatDays(row.accruedLeave)}일
                          </span>
                        </td>
                        <td>
                          <Button
                            size="small"
                            variant="secondary"
                            onClick={() => {
                              setAdjusting(row);
                              setDays("");
                              setAdjustReason("");
                              setError(null);
                            }}
                          >
                            <SlidersHorizontal className="size-3" />
                            연차
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="근태 기록 수동 조정"
            description="사유가 필수이며 감사 로그에 남습니다"
            density="compact"
          />
          <CardBody density="compact" className="!pb-0">
            <TableToolbar
              search={
                <ToolbarSearch
                  placeholder="이름·날짜 검색"
                  value={recordQuery}
                  onChange={setRecordQuery}
                />
              }
              filters={STATUS_FILTERS.map((filter) => (
                <FilterChip
                  key={filter.value}
                  active={statusFilter === filter.value}
                  count={statusCount(filter.value)}
                  onClick={() => setStatusFilter(filter.value)}
                >
                  {filter.label}
                </FilterChip>
              ))}
              count={`${visibleRecords.length}건`}
              className="mb-3"
            />
          </CardBody>
          <CardBody density="compact" className="!p-0">
            <div className="overflow-x-auto">
              <table className="ab-table ab-table--compact min-w-[760px]">
                <thead>
                  <tr>
                    <th className="w-32">날짜</th>
                    <th className="w-32">이름</th>
                    <th>출근</th>
                    <th>퇴근</th>
                    <th>근무</th>
                    <th className="w-20">상태</th>
                    <th>수정 이력</th>
                    <th className="w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.length === 0 ? (
                    <TableEmptyRow
                      colSpan={8}
                      icon={ClipboardList}
                      title={
                        records.length === 0
                          ? "이 기간에 근태 기록이 없습니다"
                          : "조건에 맞는 기록이 없습니다"
                      }
                      description="출퇴근 체크가 누락된 날은 사유와 함께 직접 채워 넣을 수 있습니다."
                      action={
                        statusFilter !== "all" || recordQuery ? (
                          <Button
                            size="small"
                            variant="secondary"
                            onClick={() => {
                              setStatusFilter("all");
                              setRecordQuery("");
                            }}
                          >
                            필터 초기화
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    visibleRecords.map((record) => (
                      <RecordRow
                        key={record.id}
                        record={record}
                        onEdit={() => openEdit(record)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* 근태 기록 수동 조정 */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="근태 기록 수정"
        description={
          editing ? `${editing.employeeName} · ${editing.workDate}` : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setEditing(null)}
              disabled={pending}
            >
              취소
            </Button>
            <Button onClick={submitEdit} disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="출근시각" htmlFor="a-in">
              <Input
                id="a-in"
                type="time"
                value={checkInTime}
                onChange={(e) => setCheckInTime(e.target.value)}
                disabled={pending}
              />
            </Field>
            <Field label="퇴근시각" htmlFor="a-out">
              <Input
                id="a-out"
                type="time"
                value={checkOutTime}
                onChange={(e) => setCheckOutTime(e.target.value)}
                disabled={pending}
              />
            </Field>
          </div>
          <Field label="수정 사유" required htmlFor="a-reason" error={error}>
            <Textarea
              id="a-reason"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              disabled={pending}
              invalid={!!error}
              placeholder="예) 시스템 장애로 체크인 미기록"
            />
          </Field>
        </div>
      </Modal>

      {/* 연차 잔여 조정 */}
      <Modal
        open={!!adjusting}
        onClose={() => setAdjusting(null)}
        title="연차 잔여 조정"
        description={
          adjusting
            ? `${adjusting.name} · 현재 잔여 ${formatDays(adjusting.remainingLeave)}일 / 발생 ${formatDays(adjusting.accruedLeave)}일`
            : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setAdjusting(null)}
              disabled={pending}
            >
              취소
            </Button>
            <Button onClick={submitAdjust} disabled={pending}>
              {pending ? "저장 중…" : "조정"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field
            label="조정 일수"
            required
            htmlFor="adj-days"
            hint="더할 때는 양수, 뺄 때는 음수로 입력하세요. 예) 3 또는 -1.5"
          >
            <Input
              id="adj-days"
              type="number"
              step="0.5"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              disabled={pending}
              className="md:max-w-40"
            />
          </Field>
          <Field label="조정 사유" required htmlFor="adj-reason" error={error}>
            <Textarea
              id="adj-reason"
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              disabled={pending}
              invalid={!!error}
              placeholder="예) 경력직 입사 시 전 직장 연차 이월"
            />
          </Field>
        </div>
      </Modal>

      {/* 보상휴가 가산율 */}
      <Modal
        open={rateOpen}
        onClose={() => setRateOpen(false)}
        title="보상휴가 가산율 설정"
        description="초과근무를 보상휴가로 전환할 때 적용되는 배율입니다."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setRateOpen(false)}
              disabled={pending}
            >
              취소
            </Button>
            <Button onClick={submitRate} disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </>
        }
      >
        <Field
          label="가산율"
          required
          htmlFor="comp-rate"
          error={error}
          hint="기본 1.5배. 8시간 초과근무를 1.5배로 전환하면 1.5일이 가산됩니다."
        >
          <Input
            id="comp-rate"
            type="number"
            step="0.1"
            min="0.1"
            max="5"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            disabled={pending}
            invalid={!!error}
            className="md:max-w-40"
          />
        </Field>
      </Modal>
    </>
  );
}

/** 날짜 색 — 일요일 빨강, 토요일 파랑 */
function RecordRow({
  record,
  onEdit,
}: {
  record: AdminRecordRow;
  onEdit: () => void;
}) {
  const weekday = weekdayOf(record.workDate);
  const hours =
    record.checkInAt && record.checkOutAt
      ? (new Date(record.checkOutAt).getTime() -
          new Date(record.checkInAt).getTime()) /
        3_600_000
      : null;

  return (
    <tr>
      <td className="whitespace-nowrap tabular-nums">
        <span
          className={cn(
            weekday === 0
              ? "text-danger"
              : weekday === 6
                ? "text-info-ink"
                : undefined,
          )}
        >
          {record.workDate.slice(5)} ({WEEKDAY_LABELS[weekday]})
        </span>
      </td>
      <td>{record.employeeName}</td>
      <td className="tabular-nums">
        {record.checkInAt ? toSeoulTime(record.checkInAt) : "-"}
      </td>
      <td className="tabular-nums">
        {record.checkOutAt ? toSeoulTime(record.checkOutAt) : "-"}
      </td>
      <td className="whitespace-nowrap tabular-nums">
        {hours === null ? (
          <span className="text-muted">-</span>
        ) : (
          formatHours(hours)
        )}
      </td>
      <td>
        {record.status === "normal" ? (
          <span className="text-muted">정상</span>
        ) : (
          <Badge tone={record.status === "absent" ? "neutral" : "warn"}>
            {ATTENDANCE_STATUS_LABELS[record.status]}
          </Badge>
        )}
      </td>
      <td className="max-w-56 truncate text-caption">{record.reason ?? "-"}</td>
      <td>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`${record.employeeName} ${record.workDate} 기록 수정`}
          className="rounded-sm p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink"
        >
          <Pencil className="size-3.5" />
        </button>
      </td>
    </tr>
  );
}
