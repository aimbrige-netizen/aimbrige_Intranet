"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { deleteHoliday, upsertHoliday } from "@/server/actions/holidays";
import { WEEKDAY_LABELS, weekdayOf } from "@/features/calendar/date";
import { cn } from "@/lib/utils";
import type { Holiday, HolidayKind } from "@/types/db";

const KIND_LABELS: Record<HolidayKind, string> = {
  public: "법정공휴일",
  substitute: "대체공휴일",
  temporary: "임시공휴일",
  statutory_leave: "유급휴일",
};

const KIND_TONES: Record<HolidayKind, "danger" | "warn" | "primary" | "neutral"> =
  {
    public: "danger",
    substitute: "warn",
    temporary: "primary",
    statutory_leave: "neutral",
  };

interface FormValues {
  date: string;
  name: string;
  kind: HolidayKind;
  isNonWorking: boolean;
}

/**
 * 공휴일 관리 (관리자 전용)
 * 음력 공휴일·대체공휴일·임시공휴일은 규칙으로 계산할 수 없어 직접 관리한다.
 * 이 데이터는 캘린더 표시와 근무일 산정(스펙 03 연차 차감)의 공통 기준이 된다.
 */
export function HolidayManager({ holidays }: { holidays: Holiday[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>({
    date: "",
    name: "",
    kind: "public",
    isNonWorking: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 연도별로 묶어서 보여준다
  const years = Array.from(
    new Set(holidays.map((h) => h.date.slice(0, 4))),
  ).sort();

  const openCreate = () => {
    setEditingDate(null);
    setValues({ date: "", name: "", kind: "public", isNonWorking: true });
    setErrors({});
    setMessage(null);
    setOpen(true);
  };

  const openEdit = (holiday: Holiday) => {
    setEditingDate(holiday.date);
    setValues({
      date: holiday.date,
      name: holiday.name,
      kind: holiday.kind,
      isNonWorking: holiday.is_non_working,
    });
    setErrors({});
    setMessage(null);
    setOpen(true);
  };

  const submit = () => {
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await upsertHoliday(values);
      if (result.ok) {
        setOpen(false);
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message ?? null);
    });
  };

  const remove = (holiday: Holiday) => {
    if (!window.confirm(`${holiday.date} ${holiday.name}을(를) 삭제하시겠습니까?`))
      return;
    startTransition(async () => {
      const result = await deleteHoliday(holiday.date);
      if (!result.ok) {
        window.alert(result.message ?? "삭제하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption">
          등록된 휴일 {holidays.length}일
          {years.length > 0 ? ` · ${years.join(", ")}년` : ""}
        </p>
        <Button size="small" onClick={openCreate}>
          <Plus className="size-3.5" />
          휴일 추가
        </Button>
      </div>

      {holidays.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title="등록된 휴일이 없습니다"
          description="휴일을 등록하면 캘린더에 빨간날로 표시되고, 근태 모듈의 근무일 산정에도 반영됩니다."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="ab-table min-w-[640px]">
            <thead>
              <tr>
                <th>날짜</th>
                <th>요일</th>
                <th>휴일명</th>
                <th>구분</th>
                <th>근무일 제외</th>
                <th className="w-24">관리</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((holiday) => {
                const weekday = weekdayOf(holiday.date);
                return (
                  <tr key={holiday.date}>
                    <td className="whitespace-nowrap tabular-nums">
                      {holiday.date}
                    </td>
                    <td
                      className={cn(
                        weekday === 0
                          ? "text-danger"
                          : weekday === 6
                            ? "text-primary"
                            : "text-muted",
                      )}
                    >
                      {WEEKDAY_LABELS[weekday]}
                    </td>
                    <td className="font-bold text-ink">{holiday.name}</td>
                    <td>
                      <Badge tone={KIND_TONES[holiday.kind]}>
                        {KIND_LABELS[holiday.kind]}
                      </Badge>
                    </td>
                    <td>{holiday.is_non_working ? "제외" : "포함"}</td>
                    <td>
                      <span className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(holiday)}
                          aria-label={`${holiday.name} 수정`}
                          className="rounded-sm p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(holiday)}
                          aria-label={`${holiday.name} 삭제`}
                          className="rounded-sm p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editingDate ? "휴일 수정" : "휴일 추가"}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              취소
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="날짜" required htmlFor="h-date" error={errors.date}>
            <Input
              id="h-date"
              type="date"
              value={values.date}
              onChange={(e) =>
                setValues((v) => ({ ...v, date: e.target.value }))
              }
              disabled={pending || !!editingDate}
              invalid={!!errors.date}
              className="md:max-w-52"
            />
          </Field>

          <Field label="휴일명" required htmlFor="h-name" error={errors.name}>
            <Input
              id="h-name"
              value={values.name}
              onChange={(e) =>
                setValues((v) => ({ ...v, name: e.target.value }))
              }
              disabled={pending}
              invalid={!!errors.name}
              placeholder="예) 설날, 임시공휴일, 창립기념일"
            />
          </Field>

          <Field label="구분" required htmlFor="h-kind">
            <Select
              id="h-kind"
              value={values.kind}
              onChange={(e) =>
                setValues((v) => ({ ...v, kind: e.target.value as HolidayKind }))
              }
              disabled={pending}
              className="md:max-w-52"
            >
              <option value="public">법정공휴일</option>
              <option value="substitute">대체공휴일</option>
              <option value="temporary">임시공휴일</option>
              <option value="statutory_leave">유급휴일(근로자의 날 등)</option>
            </Select>
          </Field>

          <label className="flex cursor-pointer items-start gap-2 text-body text-ink">
            <input
              type="checkbox"
              checked={values.isNonWorking}
              onChange={(e) =>
                setValues((v) => ({ ...v, isNonWorking: e.target.checked }))
              }
              disabled={pending}
              className="mt-0.5 size-4 accent-[#ff6f0f]"
            />
            <span>
              근무일에서 제외
              <span className="block text-caption">
                해제하면 캘린더에는 표시되지만 근무일·연차 산정에서는 평일로 계산됩니다.
              </span>
            </span>
          </label>

          {message ? <p className="text-label text-danger">{message}</p> : null}
        </div>
      </Modal>
    </>
  );
}
