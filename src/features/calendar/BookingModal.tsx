"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { createResourceBooking } from "@/server/actions/calendar";
import { todayYmd } from "@/features/calendar/date";
import type { Resource, ResourceType } from "@/types/db";
import { Boxes } from "lucide-react";

const TYPE_LABELS: Record<ResourceType, string> = {
  meeting_room: "회의실",
  vehicle: "차량",
  equipment: "비품",
};

/** 리소스 예약 모달 (스펙 02 · 3.6) */
export function BookingModal({
  open,
  onClose,
  resources,
}: {
  open: boolean;
  onClose: () => void;
  resources: Resource[];
}) {
  const router = useRouter();
  const [resourceId, setResourceId] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [purpose, setPurpose] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setResourceId(resources[0]?.id ?? "");
    setDate(todayYmd());
    setStartTime("09:00");
    setEndTime("10:00");
    setPurpose("");
    setErrors({});
    setMessage(null);
  }, [open, resources]);

  const submit = () => {
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await createResourceBooking({
        resourceId,
        date,
        startTime,
        endTime,
        purpose,
      });
      if (result.ok) {
        onClose();
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message ?? null);
    });
  };

  // 종류별로 묶어 select에 표시
  const grouped = (["meeting_room", "vehicle", "equipment"] as ResourceType[])
    .map((type) => ({
      type,
      items: resources.filter((resource) => resource.type === type),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="리소스 예약"
      description="회의실·차량·비품을 시간대로 예약합니다."
      footer={
        resources.length > 0 ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              취소
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "예약 중…" : "예약"}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
        )
      }
    >
      {resources.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="예약 가능한 리소스가 없습니다"
          description="시스템 관리자가 '리소스 관리'에서 회의실·차량·비품을 등록해야 합니다."
          compact
        />
      ) : (
        <div className="space-y-4">
          <Field
            label="리소스"
            required
            htmlFor="b-resource"
            error={errors.resourceId}
          >
            <Select
              id="b-resource"
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
              disabled={pending}
              invalid={!!errors.resourceId}
            >
              {grouped.map((group) => (
                <optgroup key={group.type} label={TYPE_LABELS[group.type]}>
                  {group.items.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                      {resource.location ? ` (${resource.location})` : ""}
                      {resource.capacity ? ` · ${resource.capacity}인` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>

          <Field label="날짜" required htmlFor="b-date" error={errors.date}>
            <Input
              id="b-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={pending}
              className="md:max-w-52"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="시작 시각"
              required
              htmlFor="b-start"
              error={errors.startTime}
            >
              <Input
                id="b-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={pending}
                invalid={!!errors.startTime}
              />
            </Field>
            <Field
              label="종료 시각"
              required
              htmlFor="b-end"
              error={errors.endTime}
            >
              <Input
                id="b-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={pending}
                invalid={!!errors.endTime}
              />
            </Field>
          </div>

          <Field label="예약 목적" htmlFor="b-purpose">
            <Input
              id="b-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              disabled={pending}
              placeholder="주간 팀 회의"
            />
          </Field>

          {message ? <p className="text-label text-danger">{message}</p> : null}
        </div>
      )}
    </Modal>
  );
}
