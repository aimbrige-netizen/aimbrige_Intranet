"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { EVENT_COLORS } from "@/features/calendar/colors";
import {
  WEEKDAY_LABELS,
  addDaysYmd,
  toSeoulTime,
  toSeoulYmd,
  weekdayOf,
} from "@/features/calendar/date";
import {
  deleteCalendarEvent,
  deleteResourceBooking,
} from "@/server/actions/calendar";
import { cn } from "@/lib/utils";
import type { CalendarItem, CalendarItemKind } from "@/types/db";

/** 이 항목이 어디에서 왔고 누가 보는지 */
const SOURCE_LABELS: Record<CalendarItemKind, string> = {
  personal: "나만 보기",
  team: "팀 공개",
  company: "전사 공개",
  leave: "승인된 휴가",
  approval: "승인된 결재 문서",
  resource_booking: "리소스 예약",
};

/** 수정할 수 없는 항목은 왜 못 고치는지까지 말해준다 */
const LOCK_NOTES: Partial<Record<CalendarItemKind, string>> = {
  leave: "승인된 휴가는 근태 신청 내역에서 취소할 수 있습니다.",
  approval: "승인된 출장·재택은 결재 문서를 따라 표시됩니다.",
};

/**
 * 일정 상세 (스펙 02 · 3.4)
 *
 * 예전에는 배지 하나 + 문장 세 줄이라 "언제부터 언제까지 몇 시간짜리인지",
 * "이게 어디에서 온 항목인지"를 읽는 사람이 조합해야 했다.
 * 값은 라벨-값 격자로 세우고, 수정 불가 사유는 별도 블록으로 분리한다.
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

  const startYmd = toSeoulYmd(item.startAt);
  // 종일 항목은 종료가 다음 날 자정으로 저장돼 있어 하루 되돌려 보여준다
  const endYmd = item.allDay
    ? addDaysYmd(toSeoulYmd(item.endAt), -1)
    : toSeoulYmd(item.endAt);

  const period = item.allDay
    ? startYmd === endYmd
      ? `${withWeekday(startYmd)} 종일`
      : `${withWeekday(startYmd)} ~ ${withWeekday(endYmd)}`
    : `${withWeekday(startYmd)} ${toSeoulTime(item.startAt)} – ${toSeoulTime(item.endAt)}`;

  const lockNote = LOCK_NOTES[item.kind];

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
      <div className="space-y-4">
        <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-2.5">
          <Row label="종류">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn("size-2 rounded-full", color.dot)}
                aria-hidden
              />
              {color.label}
            </span>
          </Row>
          <Row label="일시">
            <span className="tabular-nums">{period}</span>
          </Row>
          <Row label="소요">
            <span className="tabular-nums">{duration(item)}</span>
          </Row>
          <Row label={isBooking ? "예약자" : "등록자"}>
            {item.ownerName ?? "-"}
          </Row>
          <Row label={isBooking ? "구분" : "공개범위"}>
            {SOURCE_LABELS[item.kind]}
          </Row>
        </dl>

        {item.description ? (
          <div>
            <p className="mb-1 text-label font-bold text-ink">
              {isBooking ? "예약 목적" : "설명"}
            </p>
            <p className="whitespace-pre-wrap rounded-card bg-canvas px-3 py-2 text-body-sm text-ink">
              {item.description}
            </p>
          </div>
        ) : null}

        {!item.editable ? (
          <Callout tone="neutral">
            {lockNote ?? "다른 직원이 등록한 항목이라 열람만 할 수 있습니다."}
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="pt-0.5 text-label text-muted">{label}</dt>
      <dd className="text-body-sm text-ink">{children}</dd>
    </>
  );
}

/** '2026-07-31 (금)' */
function withWeekday(ymd: string): string {
  return `${ymd} (${WEEKDAY_LABELS[weekdayOf(ymd)]})`;
}

function duration(item: CalendarItem): string {
  const ms = new Date(item.endAt).getTime() - new Date(item.startAt).getTime();
  if (ms <= 0) return "-";
  if (item.allDay) {
    const days = Math.round(ms / 86_400_000);
    return `${days}일`;
  }
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}분`;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}
