import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { CheckInOut } from "@/features/attendance/CheckInOut";
import { AttendanceView } from "@/features/attendance/AttendanceView";
import {
  getAttendanceWithAbsences,
  getLeaveSummary,
  getMyCorrectionRequests,
  getMyLeaveAdjustments,
  getMyLeaveRequests,
  getMyOvertimeRequests,
  getThisWeekHours,
  getTodayAttendance,
} from "@/features/attendance/data";
import {
  WEEKLY_LIMIT_HOURS,
  WEEKLY_WARN_HOURS,
} from "@/features/attendance/constants";
import { isAbsentDay } from "@/features/attendance/data-client";
import { requireSessionEmployee } from "@/lib/auth/session";
import { monthLabel, todayYmd } from "@/features/calendar/date";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "내 근태" };

export default async function AttendancePage() {
  const me = await requireSessionEmployee();
  const today = todayYmd();
  const ym = today.slice(0, 7);
  const monthStart = `${ym}-01`;

  const [
    todayRecord,
    summary,
    records,
    leaves,
    overtimes,
    corrections,
    week,
    adjustments,
  ] = await Promise.all([
    getTodayAttendance(me.id),
    getLeaveSummary(me.id, me.hire_date),
    getAttendanceWithAbsences(me.id, monthStart, today),
    getMyLeaveRequests(me.id),
    getMyOvertimeRequests(me.id),
    getMyCorrectionRequests(me.id),
    getThisWeekHours(me.id),
    getMyLeaveAdjustments(me.id),
  ]);

  const monthlyHours = records.reduce((sum, row) => {
    if (isAbsentDay(row)) return sum;
    if (!row.check_in_at || !row.check_out_at) return sum;
    return (
      sum +
      (new Date(row.check_out_at).getTime() -
        new Date(row.check_in_at).getTime()) /
        3_600_000
    );
  }, 0);

  return (
    <>
      <PageHeader
        title="내 근태"
        description={`${me.name} · 입사일 ${formatDate(me.hire_date)}`}
        action={
          me.isManager ? (
            <Link
              href="/attendance/approvals"
              className="text-label text-primary hover:underline"
            >
              승인함으로 이동
            </Link>
          ) : null
        }
      />

      {/* 연차 요약 (스펙 3.2) */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader
            title="연차 현황"
            description={
              summary.next
                ? `다음 발생 ${summary.next.date} · ${summary.next.days}일`
                : "입사일이 등록되지 않아 연차가 계산되지 않습니다."
            }
          />
          <CardBody>
            <div className="grid grid-cols-3 divide-x divide-line text-center">
              {[
                { label: "발생", value: summary.accrued, tone: "text-ink" },
                { label: "사용", value: summary.used, tone: "text-muted" },
                {
                  label: "잔여",
                  value: summary.remaining,
                  tone: "text-primary",
                },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-caption">{item.label}</p>
                  <p className={cn("mt-1 text-h1 tabular-nums", item.tone)}>
                    {item.value}
                  </p>
                  <p className="text-caption">일</p>
                </div>
              ))}
            </div>

            {summary.adjustment !== 0 ? (
              <p className="mt-3 text-caption">
                조정 반영 {summary.adjustment > 0 ? "+" : ""}
                {summary.adjustment}일
                {adjustments.length > 0
                  ? ` (최근: ${adjustments[0].reason})`
                  : ""}
              </p>
            ) : null}

            <p className="mt-3 text-caption">
              근로기준법 기준 자동 계산입니다. 출근율 80% 미만 예외·특수 휴직 기간
              처리는 반영되지 않았고, 미사용 연차 소멸 정책도 아직 적용 전입니다.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="오늘의 근태" />
          <CardBody>
            <CheckInOut record={todayRecord} />
          </CardBody>
        </Card>
      </div>

      {/* 주 52시간 경고 (스펙 3.2) */}
      <div
        className={cn(
          "mb-5 flex flex-wrap items-center gap-3 rounded-card border px-4 py-3",
          week.level === "over"
            ? "border-danger/40 bg-danger/10"
            : week.level === "warn"
              ? "border-warn/40 bg-warn/10"
              : "border-line bg-surface",
        )}
      >
        {week.level === "ok" ? (
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
        ) : (
          <AlertTriangle
            className={cn(
              "size-4 shrink-0",
              week.level === "over" ? "text-danger" : "text-warn",
            )}
            aria-hidden
          />
        )}
        <span className="text-body text-ink">
          이번 주 근무 <strong className="tabular-nums">{week.hours}시간</strong>
          {week.level === "over"
            ? ` — 주 ${WEEKLY_LIMIT_HOURS}시간을 초과했습니다.`
            : week.level === "warn"
              ? ` — 주 ${WEEKLY_LIMIT_HOURS}시간에 근접했습니다(${WEEKLY_WARN_HOURS}시간 이상).`
              : ` (주 ${WEEKLY_LIMIT_HOURS}시간 이내)`}
        </span>
        <span className="ml-auto text-caption">
          {monthLabel(ym)} 누적 {Math.round(monthlyHours * 10) / 10}시간
        </span>
      </div>

      <AttendanceView
        records={records}
        leaves={leaves}
        overtimes={overtimes}
        corrections={corrections}
        remainingDays={summary.remaining}
        monthLabel={monthLabel(ym)}
      />
    </>
  );
}
