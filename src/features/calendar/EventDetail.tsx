"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, Pencil, Trash2, UserRound } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EVENT_COLORS } from "@/features/calendar/colors";
import { toSeoulTime, toSeoulYmd } from "@/features/calendar/date";
import {
  deleteCalendarEvent,
  deleteResourceBooking,
} from "@/server/actions/calendar";
import type { CalendarItem } from "@/types/db";

/**
 * 일정 상세 (스펙 02 · 3.4)
 * 본인 항목이면 수정/삭제 버튼을 노출한다.
 */
export function EventDetail({
  item,
  onClose,
  onEdit,
}: {
  item: CalendarItem | null;
  onClose: () => void;
  onEdit: (item: CalendarItem) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!item) return null;

  const color = EVENT_COLORS[item.kind];
  const isBooking = item.kind === "resource_booking";

  const remove = () => {
    if (!window.confirm(`"${item.title}"을(를) 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      const result = isBooking
        ? await deleteResourceBooking(item.id)
        : await deleteCalendarEvent(item.id);
      if (!result.ok) {
        window.alert(result.message ?? "삭제하지 못했습니다.");
        return;
      }
      onClose();
      router.refresh();
    });
  };

  const period = item.allDay
    ? `${toSeoulYmd(item.startAt)} (종일)`
    : `${toSeoulYmd(item.startAt)} ${toSeoulTime(item.startAt)} – ${toSeoulTime(item.endAt)}`;

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={item.title}
      footer={
        item.editable ? (
          <>
            <Button
              variant="ghost"
              onClick={remove}
              disabled={pending}
              className="mr-auto !text-danger hover:!bg-danger-light"
            >
              <Trash2 className="size-3.5" />
              삭제
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              닫기
            </Button>
            {/* 리소스 예약은 수정 대신 삭제 후 재예약 — 시간 충돌 검사를 단순하게 유지 */}
            {!isBooking ? (
              <Button onClick={() => onEdit(item)} disabled={pending}>
                <Pencil className="size-3.5" />
                수정
              </Button>
            ) : null}
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
        )
      }
    >
      <div className="space-y-3">
        <Badge tone="neutral">
          <span className={`mr-1.5 inline-block size-2 rounded-full ${color.dot}`} />
          {color.label}
        </Badge>

        <p className="flex items-center gap-2 text-body text-ink">
          <Clock className="size-4 shrink-0 text-muted" aria-hidden />
          {period}
        </p>

        {item.ownerName ? (
          <p className="flex items-center gap-2 text-body text-ink">
            <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
            {item.ownerName}
          </p>
        ) : null}

        {item.description ? (
          <p className="whitespace-pre-wrap rounded-card bg-canvas px-3 py-2 text-body text-ink">
            {item.description}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
