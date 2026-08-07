"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import {
  createCorrectionRequest,
  createLeaveRequest,
  createOvertimeRequest,
} from "@/server/actions/attendance";
import {
  LEAVE_CATEGORY_LABELS,
  LEAVE_TYPE_LABELS,
  daysForLeaveType,
} from "@/features/attendance/constants";
import { todayYmd } from "@/features/calendar/date";
import type { LeaveCategory, LeaveType } from "@/types/db";

export type RequestKind = "leave" | "overtime" | "correction" | null;

/** 연차·초과근무·근태수정 신청 모달 (스펙 3.3 / 3.4 / 3.5) */
export function RequestModals({
  open,
  onClose,
  remainingDays,
}: {
  open: RequestKind;
  onClose: () => void;
  remainingDays: number;
}) {
  return (
    <>
      <LeaveModal
        open={open === "leave"}
        onClose={onClose}
        remainingDays={remainingDays}
      />
      <OvertimeModal open={open === "overtime"} onClose={onClose} />
      <CorrectionModal open={open === "correction"} onClose={onClose} />
    </>
  );
}

function useSubmitState(open: boolean) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (open) {
      setErrors({});
      setMessage(null);
    }
  }, [open]);
  return { errors, setErrors, message, setMessage, pending, startTransition };
}

function LeaveModal({
  open,
  onClose,
  remainingDays,
}: {
  open: boolean;
  onClose: () => void;
  remainingDays: number;
}) {
  const router = useRouter();
  const s = useSubmitState(open);
  const [leaveType, setLeaveType] = useState<LeaveType>("full_day");
  const [leaveCategory, setLeaveCategory] = useState<LeaveCategory>("annual");
  const [startDate, setStartDate] = useState(todayYmd());
  const [endDate, setEndDate] = useState(todayYmd());
  const [startTime, setStartTime] = useState("09:00");
  const [hours, setHours] = useState("1");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setLeaveType("full_day");
    setLeaveCategory("annual");
    setStartDate(todayYmd());
    setEndDate(todayYmd());
    setStartTime("09:00");
    setHours("1");
    setReason("");
  }, [open]);

  const isSingleDay = leaveType !== "full_day";
  // 반차·시간단위는 하루만 가능하므로 종료일을 시작일에 맞춘다
  useEffect(() => {
    if (isSingleDay) setEndDate(startDate);
  }, [isSingleDay, startDate]);

  const estimatedDays = daysForLeaveType(leaveType, Number(hours));
  const isAnnual = leaveCategory === "annual";

  const submit = () => {
    s.setErrors({});
    s.setMessage(null);
    s.startTransition(async () => {
      const result = await createLeaveRequest({
        leaveType,
        leaveCategory,
        startDate,
        endDate,
        startTime,
        hours: Number(hours),
        reason,
      });
      if (result.ok) {
        onClose();
        router.refresh();
        return;
      }
      s.setErrors(result.fieldErrors ?? {});
      s.setMessage(result.message ?? null);
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="연차·휴가 신청"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={s.pending}>
            취소
          </Button>
          <Button onClick={submit} disabled={s.pending}>
            {s.pending ? "신청 중…" : "신청"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {isAnnual ? (
          <div className="flex items-center justify-between rounded-card bg-primary-light px-4 py-3">
            <span className="text-body text-ink">잔여 연차</span>
            <span className="text-h2 text-primary-ink">{remainingDays}일</span>
          </div>
        ) : (
          <Callout tone="info">
            법정휴가는 연차 잔여에서 차감되지 않고 별도로 기록됩니다.
          </Callout>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="휴가 종류" required htmlFor="l-category">
            <Select
              id="l-category"
              value={leaveCategory}
              onChange={(e) =>
                setLeaveCategory(e.target.value as LeaveCategory)
              }
              disabled={s.pending}
            >
              {(Object.keys(LEAVE_CATEGORY_LABELS) as LeaveCategory[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {LEAVE_CATEGORY_LABELS[key]}
                  </option>
                ),
              )}
            </Select>
          </Field>

          <Field label="사용 단위" required htmlFor="l-type">
            <Select
              id="l-type"
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value as LeaveType)}
              disabled={s.pending}
            >
              {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((key) => (
                <option key={key} value={key}>
                  {LEAVE_TYPE_LABELS[key]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            label={isSingleDay ? "날짜" : "시작일"}
            required
            htmlFor="l-start"
            error={s.errors.startDate}
          >
            <Input
              id="l-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={s.pending}
              invalid={!!s.errors.startDate}
            />
          </Field>

          {!isSingleDay ? (
            <Field
              label="종료일"
              required
              htmlFor="l-end"
              error={s.errors.endDate}
            >
              <Input
                id="l-end"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={s.pending}
                invalid={!!s.errors.endDate}
              />
            </Field>
          ) : null}
        </div>

        {leaveType === "hourly" ? (
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="시작 시각"
              required
              htmlFor="l-time"
              error={s.errors.startTime}
            >
              <Input
                id="l-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={s.pending}
              />
            </Field>
            <Field
              label="사용 시간"
              required
              htmlFor="l-hours"
              error={s.errors.hours}
              hint="1~7시간"
            >
              <Input
                id="l-hours"
                type="number"
                min={1}
                max={7}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                disabled={s.pending}
                invalid={!!s.errors.hours}
              />
            </Field>
          </div>
        ) : null}

        {estimatedDays !== null ? (
          <p className="text-caption">
            차감 예정 {estimatedDays}일
            {isAnnual
              ? ` · 신청 후 잔여 ${Math.round((remainingDays - estimatedDays) * 100) / 100}일`
              : " (연차 차감 없음)"}
          </p>
        ) : (
          <p className="text-caption">
            주말·공휴일은 자동으로 제외하고 계산됩니다.
          </p>
        )}

        <Field label="사유" htmlFor="l-reason">
          <Textarea
            id="l-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={s.pending}
            placeholder="선택 입력"
          />
        </Field>

        {s.message ? (
          <p className="text-label text-danger">{s.message}</p>
        ) : null}
      </div>
    </Modal>
  );
}

function OvertimeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const s = useSubmitState(open);
  const [workDate, setWorkDate] = useState(todayYmd());
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("20:00");
  const [reason, setReason] = useState("");
  const [compensate, setCompensate] = useState(false);

  useEffect(() => {
    if (!open) return;
    setWorkDate(todayYmd());
    setStartTime("18:00");
    setEndTime("20:00");
    setReason("");
    setCompensate(false);
  }, [open]);

  const submit = () => {
    s.setErrors({});
    s.setMessage(null);
    s.startTransition(async () => {
      const result = await createOvertimeRequest({
        workDate,
        startTime,
        endTime,
        reason,
        compensateAsLeave: compensate,
      });
      if (result.ok) {
        onClose();
        router.refresh();
        return;
      }
      s.setErrors(result.fieldErrors ?? {});
      s.setMessage(result.message ?? null);
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="초과근무 신청"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={s.pending}>
            취소
          </Button>
          <Button onClick={submit} disabled={s.pending}>
            {s.pending ? "신청 중…" : "신청"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="날짜" required htmlFor="o-date" error={s.errors.workDate}>
          <Input
            id="o-date"
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            disabled={s.pending}
            className="md:max-w-52"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="시작" required htmlFor="o-start" error={s.errors.startTime}>
            <Input
              id="o-start"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              disabled={s.pending}
            />
          </Field>
          <Field label="종료" required htmlFor="o-end" error={s.errors.endTime}>
            <Input
              id="o-end"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={s.pending}
              invalid={!!s.errors.endTime}
            />
          </Field>
        </div>

        <Field label="사유" required htmlFor="o-reason" error={s.errors.reason}>
          <Textarea
            id="o-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={s.pending}
            invalid={!!s.errors.reason}
          />
        </Field>

        <label className="flex cursor-pointer items-start gap-2 text-body text-ink">
          <input
            type="checkbox"
            checked={compensate}
            onChange={(e) => setCompensate(e.target.checked)}
            disabled={s.pending}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            초과근무를 보상휴가로 받기
            <span className="block text-caption">
              승인 시 관리자가 설정한 가산율(기본 1.5배)을 적용해 연차에 가산됩니다.
              8시간을 1일로 환산하고 0.5일 단위로 반올림합니다.
            </span>
          </span>
        </label>

        {s.message ? (
          <p className="text-label text-danger">{s.message}</p>
        ) : null}
      </div>
    </Modal>
  );
}

function CorrectionModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const s = useSubmitState(open);
  const [targetDate, setTargetDate] = useState(todayYmd());
  const [checkInTime, setCheckInTime] = useState("");
  const [checkOutTime, setCheckOutTime] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setTargetDate(todayYmd());
    setCheckInTime("");
    setCheckOutTime("");
    setReason("");
  }, [open]);

  const submit = () => {
    s.setErrors({});
    s.setMessage(null);
    s.startTransition(async () => {
      const result = await createCorrectionRequest({
        targetDate,
        checkInTime,
        checkOutTime,
        reason,
      });
      if (result.ok) {
        onClose();
        router.refresh();
        return;
      }
      s.setErrors(result.fieldErrors ?? {});
      s.setMessage(result.message ?? null);
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="근태 수정요청"
      description="체크인을 깜빡한 날 등 기록 오류를 정정 요청합니다. 팀장 승인 후 반영됩니다."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={s.pending}>
            취소
          </Button>
          <Button onClick={submit} disabled={s.pending}>
            {s.pending ? "요청 중…" : "요청"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="대상 날짜" required htmlFor="c-date">
          <Input
            id="c-date"
            type="date"
            value={targetDate}
            max={todayYmd()}
            onChange={(e) => setTargetDate(e.target.value)}
            disabled={s.pending}
            className="md:max-w-52"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="정정 출근시각"
            htmlFor="c-in"
            error={s.errors.checkInTime}
          >
            <Input
              id="c-in"
              type="time"
              value={checkInTime}
              onChange={(e) => setCheckInTime(e.target.value)}
              disabled={s.pending}
              invalid={!!s.errors.checkInTime}
            />
          </Field>
          <Field
            label="정정 퇴근시각"
            htmlFor="c-out"
            error={s.errors.checkOutTime}
          >
            <Input
              id="c-out"
              type="time"
              value={checkOutTime}
              onChange={(e) => setCheckOutTime(e.target.value)}
              disabled={s.pending}
              invalid={!!s.errors.checkOutTime}
            />
          </Field>
        </div>
        <p className="text-caption">정정이 필요한 항목만 입력하면 됩니다.</p>

        <Field label="사유" required htmlFor="c-reason" error={s.errors.reason}>
          <Textarea
            id="c-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={s.pending}
            invalid={!!s.errors.reason}
            placeholder="예) 외부 미팅으로 출근 체크를 못 했습니다."
          />
        </Field>

        {s.message ? (
          <p className="text-label text-danger">{s.message}</p>
        ) : null}
      </div>
    </Modal>
  );
}
