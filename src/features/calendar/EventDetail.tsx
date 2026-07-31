"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, MapPin, Pencil, Trash2, Users } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { Button, LinkButton } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Meter } from "@/components/ui/Progress";
import {
  SegmentedControl,
  type SegmentOption,
} from "@/components/ui/SegmentedControl";
import {
  EVENT_COLORS,
  RESPONSE_COLORS,
  RESPONSE_ORDER,
  milestoneMark,
} from "@/features/calendar/colors";
import {
  countResponses,
  responseSummaryLine,
} from "@/features/calendar/data-client";
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
  respondToEvent,
} from "@/server/actions/calendar";
import { cn } from "@/lib/utils";
import type {
  CalendarItem,
  CalendarItemKind,
  EventResponse,
} from "@/types/db";

/** 이 항목이 어디에서 왔고 누가 보는지 */
const SOURCE_LABELS: Record<CalendarItemKind, string> = {
  personal: "나만 보기",
  team: "팀 공개",
  company: "전사 공개",
  invited: "참석 요청",
  leave: "승인된 휴가",
  approval: "승인된 결재 문서",
  milestone: "프로젝트 마일스톤",
  resource_booking: "리소스 예약",
};

/** 수정할 수 없는 항목은 왜 못 고치는지까지 말해준다 */
const LOCK_NOTES: Partial<Record<CalendarItemKind, string>> = {
  leave: "승인된 휴가는 근태 신청 내역에서 취소할 수 있습니다.",
  approval: "승인된 출장·재택은 결재 문서를 따라 표시됩니다.",
  invited:
    "참석자로 지정돼 내 캘린더에 표시됩니다. 시간·장소 변경은 등록자가 합니다.",
  milestone:
    "마일스톤의 목표일과 달성 체크는 프로젝트 상세에서 바꿉니다.",
};

/** 이 항목의 주체를 뭐라고 부르는가 — 마일스톤의 주체는 사람이 아니라 프로젝트다 */
const OWNER_LABELS: Partial<Record<CalendarItemKind, string>> = {
  resource_booking: "예약자",
  milestone: "프로젝트",
};

/**
 * 고를 수 있는 답. 'pending'은 답이 아니라 아직 답하지 않은 상태라 버튼이 없다.
 * 순서는 확정된 참석에서 확정된 불참으로 내려간다.
 */
const ANSWERS: EventResponse[] = ["accepted", "tentative", "declined"];

/** 지금 상태가 등록자에게 어떻게 보이는지 + 되돌릴 수 있는지 */
const RESPONSE_NOTES: Record<EventResponse, string> = {
  pending: "등록자에게는 아직 미응답으로 보입니다.",
  accepted: "참석으로 응답했습니다. 언제든 바꿀 수 있습니다.",
  tentative: "미정으로 응답했습니다. 정해지면 다시 눌러 주세요.",
  declined: "불참으로 응답했습니다. 이 일정은 목록에서 흐리게 표시됩니다.",
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
  /*
   * 방금 누른 답을 화면에 바로 반영한다.
   * router.refresh()는 서버 목록을 새로 받아오지만, 이 모달이 들고 있는 item은
   * 보드가 열 때 넘긴 그 객체 그대로다 — 닫았다 열기 전까지는 옛 값이 남는다.
   * 일정 id로 키를 두어 다른 일정을 열면 저절로 버려지게 한다.
   */
  const [answered, setAnswered] = useState<Record<string, EventResponse>>({});
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(
    null,
  );

  if (!item) return null;

  const color = EVENT_COLORS[item.kind];
  const isBooking = item.kind === "resource_booking";
  const isMilestone = item.kind === "milestone";
  const mark = isMilestone ? milestoneMark(item.completed) : null;
  /*
   * 장소·참석자는 일정과 리소스 예약에만 있는 개념이다. 휴가·출장·마일스톤은
   * 다른 모듈이 원본이라 여기에 빈 칸을 세우면 "적을 수 있는데 안 적었다"로
   * 잘못 읽힌다.
   */
  const showPlace =
    item.kind !== "leave" &&
    item.kind !== "approval" &&
    item.kind !== "milestone";

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

  /*
   * 참석 여부는 respond_to_event()만 바꾼다. 테이블 UPDATE를 열면 response뿐
   * 아니라 event_id·employee_id까지 바꿀 수 있어 남의 응답을 가로챌 수 있다.
   */
  const myResponse = answered[item.id] ?? item.myResponse;
  const errorMessage = failure?.id === item.id ? failure.message : null;

  const respond = (next: EventResponse) => {
    if (next === myResponse) return;
    setFailure(null);
    startTransition(async () => {
      const result = await respondToEvent(item.id, next);
      if (!result.ok) {
        setFailure({
          id: item.id,
          message: result.message ?? "응답을 저장하지 못했습니다.",
        });
        return;
      }
      setAnswered((prev) => ({ ...prev, [item.id]: next }));
      router.refresh();
    });
  };

  /* 방금 누른 답이 명단에도 반영돼야 요약과 목록이 어긋나지 않는다 */
  const attendees = item.attendees.map((attendee) =>
    attendee.isMe && myResponse
      ? { ...attendee, response: myResponse }
      : attendee,
  );
  const summary = countResponses(attendees);

  const answerOptions: SegmentOption<EventResponse>[] = ANSWERS.map(
    (response) => ({
      value: response,
      label: RESPONSE_COLORS[response].label,
      disabled: pending,
    }),
  );

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
          <>
            <Button variant="secondary" onClick={onClose}>
              닫기
            </Button>
            {/*
              캘린더는 표시만 한다. 고칠 수 있는 자리가 따로 있는 항목은
              그 화면으로 보낸다 — 안내 문구만 남기면 사용자가 모듈 패널에서
              프로젝트를 다시 찾아 들어가야 한다.
            */}
            {item.sourceHref ? (
              <LinkButton href={item.sourceHref} variant="secondary">
                <ExternalLink className="size-3.5" />
                프로젝트 열기
              </LinkButton>
            ) : null}
          </>
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
          {/* 마일스톤은 구간이 아니라 목표'일' 하나다 — '1일 종일'은 셀 것이 없다 */}
          {isMilestone ? (
            <Row label="목표일">
              <span className="tabular-nums">{withWeekday(startYmd)}</span>
            </Row>
          ) : (
            <>
              <Row label="일시">
                <span className="tabular-nums">{period}</span>
              </Row>
              <Row label="소요">
                <span className="tabular-nums">{duration(item)}</span>
              </Row>
            </>
          )}
          {mark ? (
            <Row label="달성">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-sm px-1.5 text-label",
                  mark.badge,
                )}
              >
                <mark.icon className="size-3" aria-hidden />
                {mark.label}
              </span>
            </Row>
          ) : null}
          <Row label={OWNER_LABELS[item.kind] ?? "등록자"}>
            {item.ownerName ?? "-"}
          </Row>
          {/* 장소가 비어 있어도 줄은 남긴다 — "안 적혔다"와 "칸이 없다"는 다르다 */}
          {showPlace ? (
            <Row label="장소">
              {item.location ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5 shrink-0 text-muted" aria-hidden />
                  {item.location}
                </span>
              ) : (
                <span className="text-muted">장소 미지정</span>
              )}
            </Row>
          ) : null}
          <Row label={isBooking || isMilestone ? "구분" : "공개범위"}>
            {SOURCE_LABELS[item.kind]}
          </Row>
        </dl>

        {/*
          내가 참석자로 지정된 일정에서만 뜬다. 등록자는 자리를 만든 사람이라
          응답 대상이 아니고(참석자 행이 없다), 휴가·출장·예약에는 답할 것이 없다.
        */}
        {myResponse !== null ? (
          <div className="rounded-card border border-line bg-canvas px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="min-w-0">
                <p className="text-label font-bold text-ink">참석 여부</p>
                <p className="mt-0.5 text-caption">
                  {RESPONSE_NOTES[myResponse]}
                </p>
              </div>
              <SegmentedControl
                size="small"
                ariaLabel="내 참석 여부"
                value={myResponse}
                onChange={respond}
                options={answerOptions}
              />
            </div>
            {errorMessage ? (
              <p className="mt-2 text-label text-danger">{errorMessage}</p>
            ) : null}
          </div>
        ) : null}

        {showPlace && !isBooking ? (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-label font-bold text-ink">
              <Users className="size-3.5 text-muted" aria-hidden />
              참석자
              <span className="font-normal text-muted tabular-nums">
                {attendees.length > 0
                  ? `${attendees.length}명 · 등록자 별도`
                  : "등록자만"}
              </span>
            </p>
            {attendees.length === 0 ? (
              <p className="text-caption">
                지정된 참석자가 없습니다. 이 일정은 등록자만 참석합니다.
              </p>
            ) : (
              <>
                {/* 이름을 세지 않고도 "몇 명이 온다고 했는지"가 먼저 읽혀야 한다 */}
                <Meter
                  max={summary.total}
                  segments={RESPONSE_ORDER.map((response) => ({
                    value: summary[response],
                    tone: RESPONSE_COLORS[response].tone,
                    label: `${RESPONSE_COLORS[response].label} ${summary[response]}명`,
                  }))}
                  size="sm"
                  aria-label={`참석 응답 — ${responseSummaryLine(summary)}`}
                />
                <p className="mb-2 mt-1.5 text-caption tabular-nums">
                  {responseSummaryLine(summary)}
                  <span className="text-muted"> / 참석자 {summary.total}명</span>
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {attendees.map((attendee) => {
                    const meta = RESPONSE_COLORS[attendee.response];
                    return (
                      <li
                        key={attendee.id}
                        className="inline-flex items-center gap-1.5 rounded-pill bg-subtle py-0.5 pl-0.5 pr-1.5 text-label text-ink"
                      >
                        <Avatar
                          name={attendee.name}
                          src={attendee.profileImageUrl}
                          size="small"
                        />
                        {attendee.name}
                        {attendee.isMe ? (
                          <span className="text-muted">(나)</span>
                        ) : null}
                        <span
                          className={cn(
                            "rounded-sm px-1.5 text-nano",
                            meta.badge,
                          )}
                        >
                          {meta.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        ) : null}

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
