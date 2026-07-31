"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  AlertTriangle,
  Download,
  Pencil,
  Settings2,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { AvatarWithName } from "@/components/ui/Avatar";
import {
  adjustAttendanceRecord,
  adjustLeaveBalance,
  setCompensatoryRate,
} from "@/server/actions/attendance";
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONES,
  WEEKLY_LIMIT_HOURS,
} from "./constants";
import { toSeoulTime } from "@/features/calendar/date";

export interface AdminRow {
  employeeId: string;
  name: string;
  departmentName: string | null;
  workDays: number;
  totalHours: number;
  lateCount: number;
  earlyLeaveCount: number;
  remainingLeave: number;
  weeklyHours: number;
}

export interface AdminRecordRow {
  id: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: keyof typeof ATTENDANCE_STATUS_LABELS;
  reason: string | null;
}

/** 관리자 근태 관리 (스펙 3.7) */
export function AdminAttendance({
  rows,
  records,
  monthLabel,
  compensatoryRate,
}: {
  rows: AdminRow[];
  records: AdminRecordRow[];
  monthLabel: string;
  compensatoryRate: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminRecordRow | null>(null);
  const [adjusting, setAdjusting] = useState<AdminRow | null>(null);
  const [rateOpen, setRateOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // 수동 조정 폼
  const [checkInTime, setCheckInTime] = useState("");
  const [checkOutTime, setCheckOutTime] = useState("");
  const [editReason, setEditReason] = useState("");
  // 연차 조정 폼
  const [days, setDays] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [rate, setRate] = useState(String(compensatoryRate));
  const [error, setError] = useState<string | null>(null);

  const overLimit = rows.filter((r) => r.weeklyHours >= 48).length;
  const lateTotal = rows.reduce((s, r) => s + r.lateCount, 0);
  const earlyTotal = rows.reduce((s, r) => s + r.earlyLeaveCount, 0);

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

  const downloadCsv = () => {
    const header = ["이름", "부서", "근무일수", "총근무시간", "지각", "조퇴", "잔여연차"];
    const body = rows.map((r) => [
      r.name,
      r.departmentName ?? "",
      r.workDays,
      r.totalHours,
      r.lateCount,
      r.earlyLeaveCount,
      r.remainingLeave,
    ]);
    const csv = [header, ...body]
      .map((row) =>
        row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
      )
      .join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `전사근태_${monthLabel.replace(/\s/g, "")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* 전사 통계 요약 (스펙 3.7) */}
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="재직 임직원"
          value={rows.length}
          unit="명"
          tone="brand"
          icon={Users}
          emphasis
          sub={`${monthLabel} 기준`}
        />
        <StatCard
          label="지각 합계"
          value={lateTotal}
          unit="건"
          tone={lateTotal > 0 ? "informative" : "positive"}
          icon={AlarmClock}
          sub={`조퇴 ${earlyTotal}건`}
        />
        <StatCard
          label={`주 ${WEEKLY_LIMIT_HOURS}시간 근접·초과`}
          value={overLimit}
          unit="명"
          tone={overLimit > 0 ? "critical" : "positive"}
          icon={AlertTriangle}
          sub={overLimit > 0 ? "확인이 필요합니다" : "이상 없음"}
        />
        <StatCard
          label="보상휴가 가산율"
          value={compensatoryRate}
          unit="배"
          tone="neutral"
          icon={Settings2}
          sub="8시간 = 1일 환산"
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setRateOpen(true)}>
          <Settings2 className="size-4" />
          보상휴가 가산율 설정
        </Button>
        <Button
          variant="ghost"
          onClick={downloadCsv}
          disabled={rows.length === 0}
          className="ml-auto"
        >
          <Download className="size-4" />
          엑셀 다운로드
        </Button>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader
            title={`${monthLabel} 임직원별 근태`}
            description="연차 잔여 조정은 경력직 입사 시 이월 등 특수 케이스에 사용합니다."
          />
          <CardBody className="p-0">
            {rows.length === 0 ? (
              <EmptyState title="표시할 임직원이 없습니다" />
            ) : (
              <div className="overflow-x-auto">
                <table className="ab-table min-w-[860px]">
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th>부서</th>
                      <th>근무일수</th>
                      <th>총 근무시간</th>
                      <th>이번주</th>
                      <th>지각</th>
                      <th>조퇴</th>
                      <th>잔여연차</th>
                      <th className="w-24">조정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.employeeId}>
                        <td>
                          <AvatarWithName name={r.name} size="small" />
                        </td>
                        <td>{r.departmentName ?? "-"}</td>
                        <td className="tabular-nums">{r.workDays}일</td>
                        <td className="tabular-nums">{r.totalHours}h</td>
                        <td className="tabular-nums">
                          <span
                            className={
                              r.weeklyHours > WEEKLY_LIMIT_HOURS
                                ? "font-bold text-danger"
                                : r.weeklyHours >= 48
                                  ? "font-bold text-warn-ink"
                                  : undefined
                            }
                          >
                            {r.weeklyHours}h
                          </span>
                        </td>
                        <td className="tabular-nums">{r.lateCount}</td>
                        <td className="tabular-nums">{r.earlyLeaveCount}</td>
                        <td className="tabular-nums font-bold text-primary">
                          {r.remainingLeave}일
                        </td>
                        <td>
                          <Button
                            size="small"
                            variant="secondary"
                            onClick={() => {
                              setAdjusting(r);
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
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="개별 근태 기록 수동 조정"
            description="시스템 오류로 체크가 안 된 경우에 사용합니다. 사유가 필수이며 감사 로그에 남습니다."
          />
          <CardBody className="p-0">
            {records.length === 0 ? (
              <EmptyState title="이번 달 기록이 없습니다" compact />
            ) : (
              <div className="overflow-x-auto">
                <table className="ab-table min-w-[760px]">
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>이름</th>
                      <th>출근</th>
                      <th>퇴근</th>
                      <th>상태</th>
                      <th>수정 이력</th>
                      <th className="w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap tabular-nums">
                          {r.workDate}
                        </td>
                        <td>{r.employeeName}</td>
                        <td className="tabular-nums">
                          {r.checkInAt ? toSeoulTime(r.checkInAt) : "-"}
                        </td>
                        <td className="tabular-nums">
                          {r.checkOutAt ? toSeoulTime(r.checkOutAt) : "-"}
                        </td>
                        <td>
                          <Badge tone={ATTENDANCE_STATUS_TONES[r.status]}>
                            {ATTENDANCE_STATUS_LABELS[r.status]}
                          </Badge>
                        </td>
                        <td className="max-w-56 truncate text-caption">
                          {r.reason ?? "-"}
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => openEdit(r)}
                            aria-label="기록 수정"
                            className="rounded-sm p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
            ? `${adjusting.name} · 현재 잔여 ${adjusting.remainingLeave}일`
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
