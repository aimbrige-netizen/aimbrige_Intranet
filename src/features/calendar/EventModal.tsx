"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, UserRound, UsersRound } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { OptionCardGrid } from "@/components/ui/OptionCardGrid";
import {
  createCalendarEvent,
  updateCalendarEvent,
} from "@/server/actions/calendar";
import { toSeoulTime, toSeoulYmd, addDaysYmd } from "@/features/calendar/date";
import { isGoogleCalendarSyncEnabled } from "@/lib/env";
import type { CalendarItem } from "@/types/db";

interface FormValues {
  title: string;
  description: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  visibility: "personal" | "team" | "company";
}

/** 일정 등록/수정 모달 (스펙 02 · 3.5) */
export function EventModal({
  open,
  onClose,
  editing,
  presetDate,
  canCreateTeamEvent,
}: {
  open: boolean;
  onClose: () => void;
  editing: CalendarItem | null;
  presetDate: string | null;
  canCreateTeamEvent: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => blank(presetDate));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 모달이 열릴 때마다 대상에 맞춰 폼을 초기화한다
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setMessage(null);

    if (editing) {
      const allDay = editing.allDay;
      setValues({
        title: editing.title,
        description: editing.description ?? "",
        startDate: toSeoulYmd(editing.startAt),
        startTime: allDay ? "09:00" : toSeoulTime(editing.startAt),
        // 종일 일정은 종료가 다음 날 자정으로 저장돼 있어 하루 되돌려 보여준다
        endDate: allDay
          ? addDaysYmd(toSeoulYmd(editing.endAt), -1)
          : toSeoulYmd(editing.endAt),
        endTime: allDay ? "18:00" : toSeoulTime(editing.endAt),
        allDay,
        visibility:
          editing.kind === "team"
            ? "team"
            : editing.kind === "company"
              ? "company"
              : "personal",
      });
    } else {
      setValues(blank(presetDate));
    }
  }, [open, editing, presetDate]);

  const submit = () => {
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = editing
        ? await updateCalendarEvent(editing.id, values)
        : await createCalendarEvent(values);

      if (result.ok) {
        onClose();
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message ?? null);
    });
  };

  const patch = (next: Partial<FormValues>) =>
    setValues((prev) => ({ ...prev, ...next }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "일정 수정" : "일정 추가"}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "저장 중…" : "저장"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="제목" required htmlFor="e-title" error={errors.title}>
          <Input
            id="e-title"
            value={values.title}
            onChange={(e) => patch({ title: e.target.value })}
            invalid={!!errors.title}
            disabled={pending}
            placeholder="주간 회의"
          />
        </Field>

        <label className="flex cursor-pointer items-center gap-2 text-body text-ink">
          <input
            type="checkbox"
            checked={values.allDay}
            onChange={(e) => patch({ allDay: e.target.checked })}
            disabled={pending}
            className="size-4 accent-[#ff6f0f]"
          />
          종일
        </label>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="시작" required htmlFor="e-start" error={errors.startDate}>
            <div className="flex gap-2">
              <Input
                id="e-start"
                type="date"
                value={values.startDate}
                onChange={(e) => patch({ startDate: e.target.value })}
                disabled={pending}
                invalid={!!errors.startDate}
              />
              {!values.allDay ? (
                <Input
                  type="time"
                  aria-label="시작 시각"
                  value={values.startTime}
                  onChange={(e) => patch({ startTime: e.target.value })}
                  disabled={pending}
                  className="max-w-32"
                />
              ) : null}
            </div>
          </Field>

          <Field
            label="종료"
            required
            htmlFor="e-end"
            error={errors.endDate ?? errors.endTime}
          >
            <div className="flex gap-2">
              <Input
                id="e-end"
                type="date"
                value={values.endDate}
                onChange={(e) => patch({ endDate: e.target.value })}
                disabled={pending}
                invalid={!!errors.endDate}
              />
              {!values.allDay ? (
                <Input
                  type="time"
                  aria-label="종료 시각"
                  value={values.endTime}
                  onChange={(e) => patch({ endTime: e.target.value })}
                  disabled={pending}
                  invalid={!!errors.endTime}
                  className="max-w-32"
                />
              ) : null}
            </div>
          </Field>
        </div>

        {/*
          공개범위는 "누가 보게 되는가"라 결과가 카드에 적혀 있어야 한다.
          2줄짜리 select는 고를 수 있는 값만 알려주고 결과를 감춘다.
        */}
        <Field label="공개범위" required error={errors.visibility}>
          <OptionCardGrid
            columns={3}
            value={values.visibility}
            onChange={(visibility) => patch({ visibility })}
            className={pending ? "pointer-events-none opacity-60" : undefined}
            options={[
              {
                value: "personal",
                title: "개인",
                description: "나만 볼 수 있습니다",
                icon: UserRound,
                meta: ["내 캘린더에만 표시"],
              },
              {
                value: "team",
                title: "팀",
                description: "같은 팀 구성원이 함께 봅니다",
                icon: UsersRound,
                meta: ["팀 캘린더에 표시"],
                disabled: !canCreateTeamEvent,
                disabledLabel: "소속 팀 없음",
              },
              {
                value: "company",
                title: "전사",
                description: "전 임직원이 볼 수 있습니다",
                icon: Building2,
                meta: ["전사 캘린더에 표시"],
              },
            ]}
          />
        </Field>

        <Field label="설명" htmlFor="e-description">
          <Textarea
            id="e-description"
            value={values.description}
            onChange={(e) => patch({ description: e.target.value })}
            disabled={pending}
          />
        </Field>

        {isGoogleCalendarSyncEnabled ? (
          <p className="text-caption">
            저장하면 본인 Google 캘린더에도 함께 등록됩니다.
          </p>
        ) : null}

        {message ? <p className="text-label text-danger">{message}</p> : null}
      </div>
    </Modal>
  );
}

function blank(presetDate: string | null): FormValues {
  const date = presetDate ?? toSeoulYmd(new Date());
  return {
    title: "",
    description: "",
    startDate: date,
    startTime: "09:00",
    endDate: date,
    endTime: "10:00",
    allDay: false,
    visibility: "personal",
  };
}
