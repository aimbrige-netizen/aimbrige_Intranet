"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, UserRound, UsersRound, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { OptionCardGrid } from "@/components/ui/OptionCardGrid";
import { ToolbarSearch } from "@/components/ui/TableToolbar";
import {
  createCalendarEvent,
  updateCalendarEvent,
} from "@/server/actions/calendar";
import { toSeoulTime, toSeoulYmd, addDaysYmd } from "@/features/calendar/date";
import {
  matchesAttendee,
  type AttendeeOption,
} from "@/features/calendar/data-client";
import { isGoogleCalendarSyncEnabled } from "@/lib/env";
import { cn } from "@/lib/utils";
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
  location: string;
  attendeeIds: string[];
}

/** 참석자 목록에서 한 번에 보여주는 인원. 넘치면 검색으로 좁힌다 */
const ATTENDEE_PAGE = 60;

/** 일정 등록/수정 모달 (스펙 02 · 3.5) */
export function EventModal({
  open,
  onClose,
  editing,
  presetDate,
  canCreateTeamEvent,
  attendeeOptions,
}: {
  open: boolean;
  onClose: () => void;
  editing: CalendarItem | null;
  presetDate: string | null;
  canCreateTeamEvent: boolean;
  /** 참석자로 고를 수 있는 재직 임직원 (본인 제외) */
  attendeeOptions: AttendeeOption[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => blank(presetDate));
  const [query, setQuery] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 모달이 열릴 때마다 대상에 맞춰 폼을 초기화한다
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setMessage(null);
    setQuery("");

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
        location: editing.location ?? "",
        attendeeIds: editing.attendees.map((attendee) => attendee.id),
      });
    } else {
      setValues(blank(presetDate));
    }
  }, [open, editing, presetDate]);

  /*
   * 이름 조회표. 퇴사 등으로 선택 목록에서 빠진 참석자도 이미 저장돼 있으면
   * 칩에 이름이 떠야 한다 — 수정 중에 조용히 명단에서 사라지면 안 된다.
   */
  const nameById = useMemo(() => {
    const map = new Map<string, { name: string; src: string | null }>();
    editing?.attendees.forEach((attendee) =>
      map.set(attendee.id, {
        name: attendee.name,
        src: attendee.profileImageUrl,
      }),
    );
    attendeeOptions.forEach((option) =>
      map.set(option.id, { name: option.name, src: option.profileImageUrl }),
    );
    return map;
  }, [attendeeOptions, editing]);

  const matched = useMemo(
    () => attendeeOptions.filter((option) => matchesAttendee(option, query)),
    [attendeeOptions, query],
  );
  const shown = matched.slice(0, ATTENDEE_PAGE);

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

  const toggleAttendee = (id: string) =>
    setValues((prev) => ({
      ...prev,
      attendeeIds: prev.attendeeIds.includes(id)
        ? prev.attendeeIds.filter((value) => value !== id)
        : [...prev.attendeeIds, id],
    }));

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
          장소는 자유 입력이다. 사내 회의실은 리소스 예약이 시간까지 잡아 주므로
          여기에 회의실 목록을 다시 세우면 예약 없이 이름만 적힌 일정이 늘어난다.
        */}
        <Field
          label="장소"
          htmlFor="e-location"
          error={errors.location}
          hint="사내 회의실은 리소스 예약에서 시간까지 함께 잡을 수 있습니다."
        >
          <Input
            id="e-location"
            value={values.location}
            onChange={(e) => patch({ location: e.target.value })}
            disabled={pending}
            invalid={!!errors.location}
            placeholder="본사 3층 대회의실 / 온라인(구글 미트)"
          />
        </Field>

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
                description: "나와 참석자만 볼 수 있습니다",
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

        <AttendeePicker
          options={shown}
          totalMatched={matched.length}
          totalOptions={attendeeOptions.length}
          selectedIds={values.attendeeIds}
          nameById={nameById}
          query={query}
          onQuery={setQuery}
          onToggle={toggleAttendee}
          onClear={() => patch({ attendeeIds: [] })}
          disabled={pending}
          error={errors.attendeeIds}
        />

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

/**
 * 참석자 선택.
 *
 * 드롭다운 다중 선택은 "지금 몇 명이 잡혀 있는지"를 접어 버린다. 선택된 사람은
 * 항상 칩으로 위에 남기고, 아래 목록에서 켜고 끈다. 사람이 늘면 검색으로 좁힌다.
 */
function AttendeePicker({
  options,
  totalMatched,
  totalOptions,
  selectedIds,
  nameById,
  query,
  onQuery,
  onToggle,
  onClear,
  disabled,
  error,
}: {
  options: AttendeeOption[];
  totalMatched: number;
  totalOptions: number;
  selectedIds: string[];
  nameById: Map<string, { name: string; src: string | null }>;
  query: string;
  onQuery: (value: string) => void;
  onToggle: (id: string) => void;
  onClear: () => void;
  disabled: boolean;
  error?: string;
}) {
  const selected = new Set(selectedIds);

  return (
    <Field
      label="참석자"
      error={error}
      hint={
        selectedIds.length > 0
          ? "지정된 사람은 개인 일정이어도 이 일정을 볼 수 있고, 참석·미정·불참으로 응답할 수 있습니다."
          : "지정하지 않으면 등록자만 참석합니다."
      }
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedIds.length === 0 ? (
            <span className="text-caption">선택된 참석자가 없습니다</span>
          ) : (
            <>
              {selectedIds.map((id) => {
                const person = nameById.get(id);
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-pill bg-primary-light py-0.5 pl-0.5 pr-1.5 text-label text-primary"
                  >
                    <Avatar
                      name={person?.name ?? "?"}
                      src={person?.src}
                      size="small"
                    />
                    {person?.name ?? "알 수 없음"}
                    <button
                      type="button"
                      onClick={() => onToggle(id)}
                      disabled={disabled}
                      aria-label={`${person?.name ?? "참석자"} 제외`}
                      className="rounded-full p-0.5 transition-colors duration-fast ease-standard hover:bg-surface"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                onClick={onClear}
                disabled={disabled}
                className="ml-1 text-label text-muted transition-colors duration-fast ease-standard hover:text-ink"
              >
                전체 해제
              </button>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ToolbarSearch
            value={query}
            onChange={onQuery}
            placeholder="이름·직위·소속 검색"
            ariaLabel="참석자 검색"
          />
          <span className="text-caption tabular-nums">
            {selectedIds.length}명 선택 · {totalMatched}/{totalOptions}명 표시
          </span>
        </div>

        <div className="max-h-52 overflow-y-auto rounded-card border border-line">
          {options.length === 0 ? (
            <p className="px-3 py-6 text-center text-caption">
              검색 결과가 없습니다
            </p>
          ) : (
            <ul>
              {options.map((option) => {
                const active = selected.has(option.id);
                return (
                  <li key={option.id} className="border-b border-line last:border-b-0">
                    <button
                      type="button"
                      onClick={() => onToggle(option.id)}
                      disabled={disabled}
                      aria-pressed={active}
                      className={cn(
                        "flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors duration-fast ease-standard",
                        active
                          ? "bg-primary-light text-primary"
                          : "text-ink hover:bg-subtle",
                      )}
                    >
                      <Avatar
                        name={option.name}
                        src={option.profileImageUrl}
                        size="small"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-sm">
                          {option.name}
                          {option.position ? (
                            <span className="ml-1 text-label opacity-70">
                              {option.position}
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-nano opacity-70">
                          {option.org ?? "조직 미배정"}
                        </span>
                      </span>
                      {active ? (
                        <Check className="size-4 shrink-0" aria-hidden />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {totalMatched > options.length ? (
          <p className="text-caption">
            {options.length}명까지 표시했습니다. 검색으로 좁혀 주세요.
          </p>
        ) : null}
      </div>
    </Field>
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
    location: "",
    attendeeIds: [],
  };
}
