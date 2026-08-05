"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  Clock,
  Download,
  FilePenLine,
  History,
  X,
} from "lucide-react";
import { Button, buttonClass } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/ui/Card";
import { EmptyState, TableEmptyRow } from "@/components/ui/EmptyState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { downloadCsv } from "@/lib/csv";
import { RequestModals, type RequestKind } from "./RequestModals";
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONES,
  LEAVE_CATEGORY_LABELS,
  LEAVE_TYPE_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_TONES,
  WORK_STATUS_LABELS,
} from "./constants";
import { formatDays, formatHours, hoursBetween } from "./format";
import { cancelLeaveRequest } from "@/server/actions/attendance";
import {
  toSeoulTime,
  WEEKDAY_LABELS,
  weekdayOf,
} from "@/features/calendar/date";
import { cn } from "@/lib/utils";
import { isAbsentDay, type AbsentDay } from "./data-client";
import type {
  AttendanceRecord,
  CorrectionRequest,
  LeaveAdjustment,
  LeaveRequest,
  OvertimeRequest,
} from "@/types/db";

interface Props {
  records: (AttendanceRecord | AbsentDay)[];
  leaves: LeaveRequest[];
  overtimes: OvertimeRequest[];
  corrections: CorrectionRequest[];
  adjustments: LeaveAdjustment[];
  remainingDays: number;
  periodLabel: string;
  /**
   * 주간누적 게이지·지표·주간 캘린더 블록(서버 렌더, page.tsx).
   * ehr 순서(14-ehr) 그대로 툴바 아래·표들 위에 끼운다.
   */
  overview?: React.ReactNode;
}

type RequestTab = "leave" | "overtime" | "correction" | "adjustment";

export function AttendanceView({
  records,
  leaves,
  overtimes,
  corrections,
  adjustments,
  remainingDays,
  periodLabel,
  overview,
}: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<RequestKind>(null);
  const [tab, setTab] = useState<RequestTab>("leave");
  const [pending, startTransition] = useTransition();

  /** 엑셀 다운로드 (스펙 3.2) — 포맷은 lib/csv.ts */
  const exportCsv = () => {
    downloadCsv(
      `근태기록_${periodLabel.replace(/[\s~]/g, "")}`,
      ["날짜", "요일", "출근", "퇴근", "근무시간", "근무상태", "상태", "비고"],
      records.map((row) => {
        const weekday = WEEKDAY_LABELS[weekdayOf(row.work_date)];
        if (isAbsentDay(row)) {
          return [
            row.work_date,
            weekday,
            "",
            "",
            "",
            "",
            ATTENDANCE_STATUS_LABELS.absent,
            "",
          ];
        }
        const hours = hoursBetween(row.check_in_at, row.check_out_at);
        return [
          row.work_date,
          weekday,
          row.check_in_at ? toSeoulTime(row.check_in_at) : "",
          row.check_out_at ? toSeoulTime(row.check_out_at) : "",
          hours === null ? "" : formatHours(hours),
          WORK_STATUS_LABELS[row.work_status],
          ATTENDANCE_STATUS_LABELS[row.status],
          row.location_warning ?? "",
        ];
      }),
    );
  };

  const cancel = (id: string) => {
    if (!window.confirm("이 신청을 취소하시겠습니까?")) return;
    startTransition(async () => {
      const result = await cancelLeaveRequest(id);
      if (!result.ok) {
        window.alert(result.message ?? "취소하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  const pendingCount = (rows: { status: string }[]) =>
    rows.filter((r) => r.status === "pending").length || undefined;

  return (
    <>
      {/*
        콘텐츠 상단 액션 툴바. 좌측 신청 액션은 07·10 문법(h-8·13px·radius 4,
        주요 액션 하나만 primary) 그대로 — 캘린더 툴바의 '일정 추가'와 같은
        결정. 우측은 14-ehr 근태 홈 상단 우측 실측으로 교체: "신청 이력"
        (아래 신청 내역 섹션 앵커) + "목록 다운로드"(기존 내보내기), 고스트
        h-40 · radius 8 · 13px(원본 121×40 단 — medium 높이에 radius·글자만
        실측 단으로 내린다).
      */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="small" onClick={() => setModal("leave")}>
          <CalendarPlus className="size-3.5" />
          연차·휴가 신청
        </Button>
        <Button size="small" variant="ghost" onClick={() => setModal("overtime")}>
          <Clock className="size-3.5" />
          초과근무 신청
        </Button>
        <Button size="small" variant="ghost" onClick={() => setModal("correction")}>
          <FilePenLine className="size-3.5" />
          근태 수정요청
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <a
            href="#request-history"
            className={buttonClass({
              variant: "ghost",
              size: "medium",
              className: "rounded-sm text-label",
            })}
          >
            <History className="size-3.5" />
            신청 이력
          </a>
          <Button
            variant="ghost"
            size="medium"
            className="rounded-sm text-label"
            onClick={exportCsv}
            disabled={records.length === 0}
          >
            <Download className="size-3.5" />
            목록 다운로드
          </Button>
        </div>
      </div>

      {overview}

      <div className="space-y-5">
        {/*
          08·10 흰 시트: md+에서는 본문 전체가 흰 면이라 .ab-card 래퍼가
          흰 면 위 이중 테두리가 된다 — 섹션 제목 + 표 직접 배치로 바꾸고,
          md 미만(패널 없는 회청 canvas)은 카드 면을 유지한다(캘린더 패턴).
        */}
        <section>
          <SectionHeader
            title={`${periodLabel} 근태 기록`}
            description={`${records.length}일`}
          />
          <div className="ab-card md:rounded-none md:border-0">
            <div className="overflow-x-auto">
              <table className="ab-table ab-table--compact min-w-[680px]">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>출근</th>
                    <th>퇴근</th>
                    <th>근무시간</th>
                    <th>근무상태</th>
                    <th>상태</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {records.length === 0 ? (
                    <TableEmptyRow
                      colSpan={7}
                      icon={Clock}
                      title="이 기간에 근태 기록이 없습니다"
                      description="출근 체크를 하면 여기에 쌓입니다. 지난 기록은 근태 수정요청으로 보완할 수 있습니다."
                      action={
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => setModal("correction")}
                        >
                          근태 수정요청
                        </Button>
                      }
                    />
                  ) : (
                    records.map((row) => <AttendanceRow key={row.work_date} row={row} />)
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* 상단 "신청 이력" 앵커의 목적지 — scroll-mt는 고정 topbar(60px) 몫 */}
        <section id="request-history" className="scroll-mt-20">
          <SectionHeader
            title="신청 내역"
            action={
              <SegmentedControl
                size="small"
                value={tab}
                onChange={setTab}
                ariaLabel="신청 종류"
                options={[
                  {
                    value: "leave",
                    label: "연차·휴가",
                    badge: pendingCount(leaves),
                  },
                  {
                    value: "overtime",
                    label: "초과근무",
                    badge: pendingCount(overtimes),
                  },
                  {
                    value: "correction",
                    label: "근태수정",
                    badge: pendingCount(corrections),
                  },
                  { value: "adjustment", label: "연차 조정" },
                ]}
              />
            }
          />
          <div className="ab-card md:rounded-none md:border-0">
            {tab === "leave" ? (
              <LeaveTable leaves={leaves} onCancel={cancel} pending={pending} />
            ) : tab === "overtime" ? (
              <SimpleRequestTable
                icon={Clock}
                emptyTitle="초과근무 신청 내역이 없습니다"
                rows={overtimes.map((o) => ({
                  id: o.id,
                  when: `${o.work_date} ${o.start_time.slice(0, 5)}~${o.end_time.slice(0, 5)}`,
                  detail:
                    (o.compensate_as_leave ? "보상휴가 전환 · " : "") +
                    (o.rejection_reason
                      ? `반려: ${o.rejection_reason}`
                      : o.reason),
                  status: o.status,
                }))}
              />
            ) : tab === "correction" ? (
              <SimpleRequestTable
                icon={FilePenLine}
                emptyTitle="근태 수정요청 내역이 없습니다"
                rows={corrections.map((c) => ({
                  id: c.id,
                  when: c.target_date,
                  detail: c.rejection_reason
                    ? `반려: ${c.rejection_reason}`
                    : c.reason,
                  status: c.status,
                }))}
              />
            ) : (
              <AdjustmentList adjustments={adjustments} />
            )}
          </div>
        </section>
      </div>

      <RequestModals
        open={modal}
        onClose={() => setModal(null)}
        remainingDays={remainingDays}
      />
    </>
  );
}

/** 날짜 칸 색 — 일요일 빨강, 토요일 파랑 (한국 캘린더 기본) */
function dateCellClass(weekday: number) {
  return weekday === 0 ? "text-danger" : weekday === 6 ? "text-info" : undefined;
}

function AttendanceRow({ row }: { row: AttendanceRecord | AbsentDay }) {
  const weekday = weekdayOf(row.work_date);
  const dateCell = (
    <td className="whitespace-nowrap tabular-nums">
      <span className={cn(dateCellClass(weekday))}>
        {row.work_date.slice(5)} ({WEEKDAY_LABELS[weekday]})
      </span>
    </td>
  );

  if (isAbsentDay(row)) {
    return (
      <tr>
        {dateCell}
        <td className="text-muted">-</td>
        <td className="text-muted">-</td>
        <td className="text-muted">-</td>
        <td className="text-muted">-</td>
        <td>
          {/*
            결근은 위반이 아니라 "기록이 없는 상태"다. 1건이든 15건이든
            같은 빨간 배지를 반복하면 심각도 구분이 사라진다.
          */}
          <Badge tone="neutral">{ATTENDANCE_STATUS_LABELS.absent}</Badge>
        </td>
        <td className="text-caption">기록 없음</td>
      </tr>
    );
  }

  const hours = hoursBetween(row.check_in_at, row.check_out_at);

  return (
    <tr>
      {dateCell}
      <td className="tabular-nums">
        {row.check_in_at ? toSeoulTime(row.check_in_at) : "-"}
      </td>
      <td className="tabular-nums">
        {row.check_out_at ? toSeoulTime(row.check_out_at) : "-"}
      </td>
      <td className="tabular-nums">
        {hours === null ? "-" : formatHours(hours)}
      </td>
      <td>{WORK_STATUS_LABELS[row.work_status]}</td>
      <td>
        <Badge tone={ATTENDANCE_STATUS_TONES[row.status]}>
          {ATTENDANCE_STATUS_LABELS[row.status]}
        </Badge>
      </td>
      <td className="text-caption">
        {row.location_warning ?? row.manual_adjustment_reason ?? "-"}
      </td>
    </tr>
  );
}

function LeaveTable({
  leaves,
  onCancel,
  pending,
}: {
  leaves: LeaveRequest[];
  onCancel: (id: string) => void;
  pending: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="ab-table ab-table--compact min-w-[680px]">
        <thead>
          <tr>
            <th>기간</th>
            <th>종류</th>
            <th>단위</th>
            <th>일수</th>
            <th>상태</th>
            <th>사유·비고</th>
            <th className="w-12"></th>
          </tr>
        </thead>
        <tbody>
          {leaves.length === 0 ? (
            <TableEmptyRow
              colSpan={7}
              icon={CalendarPlus}
              title="연차·휴가 신청 내역이 없습니다"
              description="연차는 승인 시점에 잔여에서 차감됩니다. 법정휴가는 차감되지 않습니다."
            />
          ) : (
            leaves.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap tabular-nums">
                  {l.start_date === l.end_date
                    ? l.start_date
                    : `${l.start_date} ~ ${l.end_date}`}
                </td>
                <td>{LEAVE_CATEGORY_LABELS[l.leave_category]}</td>
                <td>
                  {LEAVE_TYPE_LABELS[l.leave_type]}
                  {l.leave_type === "hourly" && l.hours ? ` ${l.hours}h` : ""}
                </td>
                <td className="tabular-nums">{formatDays(Number(l.days))}일</td>
                <td>
                  <Badge tone={REQUEST_STATUS_TONES[l.status]}>
                    {REQUEST_STATUS_LABELS[l.status]}
                  </Badge>
                </td>
                <td className="text-caption">
                  {l.rejection_reason
                    ? `반려: ${l.rejection_reason}`
                    : (l.reason ?? "-")}
                </td>
                <td>
                  {l.status === "pending" || l.status === "approved" ? (
                    <button
                      type="button"
                      onClick={() => onCancel(l.id)}
                      disabled={pending}
                      className="rounded-sm p-1.5 text-muted transition-colors hover:bg-danger-light hover:text-danger disabled:opacity-50"
                      aria-label="신청 취소"
                      title="신청 취소"
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SimpleRequestTable({
  rows,
  icon,
  emptyTitle,
}: {
  rows: { id: string; when: string; detail: string; status: string }[];
  icon: typeof Clock;
  emptyTitle: string;
}) {
  return (
    <table className="ab-table ab-table--compact">
      <thead>
        <tr>
          <th className="w-56">일시</th>
          <th>사유·비고</th>
          <th className="w-24">상태</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <TableEmptyRow colSpan={3} icon={icon} title={emptyTitle} />
        ) : (
          rows.map((row) => (
            <tr key={row.id}>
              <td className="whitespace-nowrap tabular-nums">{row.when}</td>
              <td className="text-caption">{row.detail}</td>
              <td>
                <Badge
                  tone={
                    REQUEST_STATUS_TONES[
                      row.status as keyof typeof REQUEST_STATUS_TONES
                    ]
                  }
                >
                  {
                    REQUEST_STATUS_LABELS[
                      row.status as keyof typeof REQUEST_STATUS_LABELS
                    ]
                  }
                </Badge>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

/**
 * 연차 조정 이력.
 * 서버가 20행을 넘겨주는데 예전엔 가장 최근 한 건의 사유 문자열만 뽑아
 * 안내 문구 끝에 붙였다. 나머지 19건은 화면에 도달하지 못했다.
 */
function AdjustmentList({ adjustments }: { adjustments: LeaveAdjustment[] }) {
  if (adjustments.length === 0) {
    return (
      <div className="px-4">
        <EmptyState
          icon={History}
          title="연차 조정 이력이 없습니다"
          description="관리자가 연차를 가감하면 여기에 남습니다."
          compact
        />
      </div>
    );
  }

  return (
    <table className="ab-table ab-table--compact">
      <thead>
        <tr>
          <th className="w-36">일시</th>
          <th className="w-24">변동</th>
          <th>사유</th>
        </tr>
      </thead>
      <tbody>
        {adjustments.map((a) => {
          const delta = Number(a.days);
          return (
            <tr key={a.id}>
              <td className="whitespace-nowrap tabular-nums text-caption">
                {a.created_at.slice(0, 10)}
              </td>
              <td>
                <Badge tone={delta >= 0 ? "success" : "warn"}>
                  {delta >= 0 ? "+" : ""}
                  {formatDays(delta)}일
                </Badge>
              </td>
              <td className="text-caption">{a.reason ?? "-"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
