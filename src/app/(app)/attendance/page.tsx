import type { Metadata } from "next";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarMinus,
  CalendarPlus,
  CheckCircle2,
  Clock3,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
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
    getAttendanceWithAbsences(me.id, monthStart, today, me.hire_date),
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

  const workedDays = records.filter(
    (row) => !isAbsentDay(row) && row.check_in_at,
  ).length;

  return (
    <>
      <PageHeader
        title="내 근태"
        description={`${me.name} · 입사일 ${formatDate(me.hire_date)}`}
      />

      {/* 핵심 지표를 큰 숫자 카드로 (스펙 3.2) */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="잔여 연차"
          value={summary.remaining}
          unit="일"
          tone="brand"
          icon={CalendarCheck}
          emphasis
          sub={
            summary.next
              ? `다음 발생 ${summary.next.date.slice(5)} +${summary.next.days}일`
              : "입사일 미등록"
          }
        />
        <StatCard
          label="발생 연차"
          value={summary.accrued}
          unit="일"
          tone="neutral"
          icon={CalendarPlus}
          sub={
            summary.adjustment !== 0
              ? `조정 ${summary.adjustment > 0 ? "+" : ""}${summary.adjustment}일 포함`
              : "근로기준법 자동 계산"
          }
        />
        <StatCard
          label="사용 연차"
          value={summary.used}
          unit="일"
          tone="neutral"
          icon={CalendarMinus}
          sub={`${monthLabel(ym)} 기준`}
        />
        <StatCard
          label="이번 주 근무"
          value={week.hours}
          unit="시간"
          tone={
            week.level === "over"
              ? "critical"
              : week.level === "warn"
                ? "informative"
                : "positive"
          }
          icon={week.level === "ok" ? CheckCircle2 : AlertTriangle}
          sub={
            week.level === "over"
              ? `주 ${WEEKLY_LIMIT_HOURS}시간 초과`
              : week.level === "warn"
                ? `${WEEKLY_WARN_HOURS}시간 이상 — 근접`
                : `주 ${WEEKLY_LIMIT_HOURS}시간 이내`
          }
        />
        <StatCard
          label="이번 달 누적"
          value={Math.round(monthlyHours * 10) / 10}
          unit="시간"
          tone="neutral"
          icon={Clock3}
          sub={`근무일 ${workedDays}일`}
        />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader
            title="연차 안내"
            description="근로기준법 제60조 기준으로 입사일부터 자동 계산됩니다."
          />
          <CardBody className="space-y-2">
            <p className="text-body text-ink">
              1년 미만은 매월 개근 시 1일(최대 11일), 1년 이상은 15일,
              3년차부터 2년마다 1일씩 가산되어 최대 25일입니다.
            </p>
            <p className="text-caption">
              출근율 80% 미만 예외·특수 휴직 기간 처리는 반영되지 않았고,
              미사용 연차 소멸 정책도 아직 적용 전입니다.
              {adjustments.length > 0
                ? ` 최근 조정: ${adjustments[0].reason}`
                : ""}
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
