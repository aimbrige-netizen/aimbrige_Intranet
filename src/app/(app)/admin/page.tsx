import type { Metadata } from "next";
import Link from "next/link";
import {
  Boxes,
  Building2,
  CalendarOff,
  CircleCheck,
  CircleX,
  ClipboardList,
  GitBranch,
  ScrollText,
  Send,
  Settings,
  Shield,
  Timer,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader, SectionHeader } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Callout } from "@/components/ui/Callout";
import { LinkButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { METER_FILL, Meter, type MeterTone } from "@/components/ui/Progress";
import { PeriodNavigator } from "@/components/ui/PeriodNavigator";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  getAnnualLeaveUsageByTeam,
  getApprovalActivity,
  getHeadcountByDepartment,
  getHeadcountSummary,
  getRecentHires,
  getTodayAttendanceSummary,
  RECENT_HIRE_DAYS,
  type TeamLeaveUsage,
  type TodayAttendance,
} from "@/features/admin/data";
import { listAuditLogs } from "@/features/audit/data";
import { AUDIT_ACTION_LABELS } from "@/features/audit/constants";
import { AGING_LATE_DAYS } from "@/features/approvals/format";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  carryPeriod,
  parsePeriod,
  periodHref,
  PERIOD_UNIT_LABELS,
  type PeriodSearchParams,
  type PeriodUnit,
} from "@/lib/period";
import { todayYmd } from "@/features/calendar/date";
import { formatDate, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "시스템 개요" };

/**
 * 이 화면이 지원하는 기간 단위 (lib/period 규약).
 * 월간이면 스테퍼로 지난달까지 가고, 연간이 "올해"다 — 스펙 18이 말한
 * 이번달/지난달/올해가 이 둘로 전부 나온다.
 */
const UNITS = ["month", "year"] as const satisfies readonly PeriodUnit[];
const DEFAULT_UNIT = "month";

/** 활동 로그 위젯이 보여주는 건수 (스펙 18 · 3장) */
const ACTIVITY_LIMIT = 10;

/**
 * 오늘 출근 현황의 네 칸. 순서가 곧 우선순위다 —
 * 종일휴가 > 반차·시간연차 > 출근완료 > 미출근 중 사람마다 한 칸만 고른다
 * (마이그레이션 25). 여기서는 읽는 순서대로 뒤집어 둔다.
 *
 * 톤: 미출근만 조치 대상이라 warning, 휴가는 정상적인 상태라 중립·정보 축에 둔다.
 * 빨강은 실제 위반에만 쓴다(디자인시스템 원칙 4).
 * 단, 주말·공휴일에는 미출근이 조치 대상이 아니라 warning을 쓰지 않는다
 * (nonWorking — 그날은 거의 전원이 이 칸에 들어간다).
 *
 * note는 각 칸이 무엇을 세는지 설명하는 유일한 문구다. 막대 아래에 그대로
 * 렌더한다 — 여기에만 있고 화면에 없으면 시간연차 처리 규칙을 아무도 모른다.
 */
const ATTENDANCE_BUCKETS: {
  key: keyof Pick<
    TodayAttendance,
    "checkedIn" | "partialLeave" | "fullDayLeave" | "absent"
  >;
  label: string;
  tone: MeterTone;
  note: string;
}[] = [
  {
    key: "checkedIn",
    label: "출근 완료",
    tone: "positive",
    note: "출근 기록이 찍힌 인원",
  },
  {
    key: "partialLeave",
    label: "반차·부분휴가",
    tone: "informative",
    note: "반차·시간연차 — 출근도 하지만 온전한 하루는 아니다",
  },
  {
    key: "fullDayLeave",
    label: "종일휴가",
    tone: "neutral",
    note: "오늘 자리에 없는 인원",
  },
  {
    key: "absent",
    label: "미출근",
    tone: "warning",
    note: "휴가도 아니고 출근 기록도 없는 인원",
  },
];

/**
 * 관리자 진입점 + 전사 대시보드 (스펙 18).
 *
 * 스펙은 /admin/dashboard를 따로 두라고 하지만 새 라우트를 만들지 않았다.
 * 지금 이 화면의 상단 카드 4장 중 3장이 스펙의 "인원 현황" 위젯과 같은 값을
 * 다른 질의로 내고 있어서, 화면을 둘로 나누면 성격이 겹치는 항목이 나란히
 * 서고 같은 숫자가 두 기준으로 갈린다.
 *
 * 집계는 전부 마이그레이션 25의 security definer 함수에서 온다 —
 * 전사 통계는 RLS를 우회해야 나오므로 함수 자체가 권한 경계다.
 */
export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: PeriodSearchParams;
}) {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const today = todayYmd();
  const period = parsePeriod(searchParams, {
    units: UNITS,
    defaultUnit: DEFAULT_UNIT,
    today,
  });

  const [
    headcount,
    byDepartment,
    attendance,
    leaveUsage,
    approvals,
    hires,
    { data: lines, error: linesError },
    activity,
  ] = await Promise.all([
    getHeadcountSummary(),
    getHeadcountByDepartment(),
    // 기준일을 넘겨 둔다 — 카드에 적는 날짜와 집계한 날짜가 같아야 한다
    getTodayAttendanceSummary(today),
    getAnnualLeaveUsageByTeam(today),
    getApprovalActivity(period.from, period.to),
    getRecentHires(),
    supabase.from("approval_line_configs").select("document_type, step2_approver_id"),
    listAuditLogs({
      from: period.from,
      to: period.to,
      q: "",
      action: "",
      actions: null,
      target: "",
      sortKey: "created_at",
      ascending: false,
      limit: ACTIVITY_LIMIT,
      offset: 0,
    }),
  ]);

  /*
   * 조회가 실패하면 0건이 아니라 "모른다"다. 실패를 0으로 그리면 미설정 0건 ·
   * 초록 카드 · 경고 없음이 되어, 아무도 기안할 수 없는 상태가 정상으로 보인다.
   * 이 화면의 나머지 집계가 null로 실패를 드러내는 것과 같은 규약이다.
   */
  const linesFailed = !!linesError;
  const unsetLines = (lines ?? []).filter((l) => !l.step2_approver_id).length;
  const totalLines = (lines ?? []).length;

  /*
   * 계정 연결의 분모는 재직+휴직이다. auth_user_id는 첫 로그인 때 채워지므로
   * 로그인 없이 퇴사한 사람은 영구히 미연결로 남는다. 전체 인원을 분모로 쓰면
   * 조치할 대상이 0명인데도 경고가 꺼지지 않는다(headcount_summary의
   * unlinked도 같은 기준으로 센다).
   */
  const linkable = headcount ? headcount.active + headcount.onLeave : 0;
  const linkedCount = headcount ? linkable - headcount.unlinked : 0;

  const linkFor = (unit: PeriodUnit, cursor: string | null) =>
    periodHref("/admin", { unit, cursor }, { defaultUnit: DEFAULT_UNIT });

  /** 감사 로그 화면으로 지금 보고 있는 구간을 들고 간다 */
  const auditHref = carryPeriod("/admin/audit-logs", period);

  return (
    <>
      <PageHeader
        title="시스템 개요"
        description="전사 통계와 조치가 필요한 항목"
        toolbar={
          <PeriodNavigator
            label={period.label}
            /* 기간이 무엇에 걸리는지 여기서 한 번 말해 둔다.
               필터를 바꿨는데 안 변하는 카드가 있으면 고장으로 읽힌다 */
            sublabel="결재 처리·활동 로그에만 적용됩니다"
            prevHref={
              period.prevCursor ? linkFor(period.unit, period.prevCursor) : undefined
            }
            nextHref={
              period.nextCursor ? linkFor(period.unit, period.nextCursor) : undefined
            }
            todayHref={linkFor(period.unit, null)}
            atToday={period.includesToday}
            nextDisabled={period.to >= today}
            className="mb-0"
            right={
              <SegmentedControl
                options={UNITS.map((unit) => ({
                  value: unit,
                  label: PERIOD_UNIT_LABELS[unit],
                  // 지난 기간을 보는 중이면 단위를 바꿔도 그 지점에 머문다
                  href: linkFor(unit, period.includesToday ? null : period.cursor),
                }))}
                value={period.unit}
                ariaLabel="조회 기간 단위"
              />
            }
          />
        }
      />

      {unsetLines > 0 ? (
        <Callout
          tone="warn"
          title={`결재라인 ${unsetLines}건에 최종 결재자가 지정되지 않았습니다`}
          action={
            <LinkButton
              href="/admin/approval-lines"
              size="small"
              variant="secondary"
            >
              지정하기
            </LinkButton>
          }
          className="mb-5"
        >
          최종 결재자가 없는 문서 유형은 아무도 기안할 수 없습니다.
        </Callout>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="재직 인원"
          value={headcount?.active ?? 0}
          unit="명"
          denominator={headcount?.total ?? 0}
          denominatorUnit="명"
          tone="brand"
          icon={Building2}
          emphasis
          state={headcount ? "ok" : "empty"}
          href="/admin/employees"
          sub={
            headcount
              ? `부서 ${headcount.departments}개 · 팀 ${headcount.teams}개`
              : "집계를 불러오지 못했습니다"
          }
        />
        <StatCard
          label="계정 연결"
          value={linkedCount}
          unit="명"
          denominator={linkable}
          denominatorUnit="명"
          tone={headcount?.unlinked ? "warning" : "positive"}
          icon={Shield}
          href="/admin/employees"
          state={headcount ? "ok" : "empty"}
          max={linkable || 1}
          meterValue={linkedCount}
          sub={
            !headcount
              ? "집계를 불러오지 못했습니다"
              : headcount.unlinked
                ? `미연결 ${headcount.unlinked}명 — 로그인 불가`
                : "재직·휴직 전원 로그인 가능"
          }
        />
        <StatCard
          label="결재라인 설정"
          value={totalLines - unsetLines}
          denominator={totalLines}
          unit="건"
          tone={unsetLines ? "warning" : "positive"}
          icon={GitBranch}
          max={totalLines || 1}
          meterValue={totalLines - unsetLines}
          href="/admin/approval-lines"
          state={linesFailed ? "empty" : "ok"}
          sub={
            linesFailed
              ? "설정을 불러오지 못했습니다"
              : unsetLines
                ? `최종 결재자 미지정 ${unsetLines}건`
                : "전 유형 설정 완료"
          }
        />
        <StatCard
          label="시스템 변경"
          value={activity.total}
          unit="건"
          tone="informative"
          icon={ScrollText}
          href={auditHref}
          state={activity.errorMessage ? "empty" : "ok"}
          sub={
            activity.errorMessage
              ? "감사 로그를 불러오지 못했습니다"
              : `${period.label} 기록`
          }
        />
      </div>

      <SectionHeader
        title="현재 시점"
        description="아래 네 카드는 지금 상태를 세므로 기간 필터를 바꿔도 변하지 않습니다"
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <HeadcountWidget headcount={headcount} departments={byDepartment} />
        <AttendanceWidget attendance={attendance} />
        <LeaveUsageWidget teams={leaveUsage} />
        <RecentHiresWidget hires={hires} />
      </div>

      <SectionHeader
        title={`${period.label} 집계`}
        /* 카드 sub은 한 줄로 잘리므로(StatCard) 분모 규칙은 여기서 한 번 말한다 */
        description="상신은 상신된 시각, 승인·반려는 결재가 끝난 시각으로 셉니다. 승인에는 시행완료가 포함됩니다"
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="상신"
          value={approvals?.submitted ?? 0}
          unit="건"
          tone="neutral"
          icon={Send}
          href="/approvals"
          state={approvals ? "ok" : "empty"}
          sub={approvals ? "기간 안에 올라온 문서" : "집계를 불러오지 못했습니다"}
        />
        <StatCard
          label="승인"
          value={approvals?.approved ?? 0}
          denominator={approvals?.decided ?? 0}
          unit="건"
          tone="positive"
          icon={CircleCheck}
          href="/approvals"
          state={approvals ? "ok" : "empty"}
          max={approvals?.decided || 1}
          meterValue={approvals?.approved ?? 0}
          sub={
            approvals ? "분모는 결재 완료 건" : "집계를 불러오지 못했습니다"
          }
        />
        <StatCard
          label="반려"
          value={approvals?.rejected ?? 0}
          denominator={approvals?.decided ?? 0}
          unit="건"
          tone={approvals?.rejected ? "warning" : "neutral"}
          icon={CircleX}
          href="/approvals"
          state={approvals ? "ok" : "empty"}
          max={approvals?.decided || 1}
          meterValue={approvals?.rejected ?? 0}
          sub={
            approvals ? "분모는 결재 완료 건" : "집계를 불러오지 못했습니다"
          }
        />
        <StatCard
          label="평균 처리 소요"
          value={approvals?.avgDecisionDays ?? 0}
          unit="일"
          tone="informative"
          icon={Timer}
          href="/approvals"
          /* 결재된 건이 없으면 "—"다. 0.0일로 적으면 "즉시 처리"로 읽힌다 */
          state={
            approvals && approvals.avgDecisionDays !== null ? "ok" : "empty"
          }
          sub={
            !approvals
              ? "집계를 불러오지 못했습니다"
              : approvals.avgDecisionDays === null
                ? "결재가 끝난 문서가 없습니다"
                : `결재 완료 ${approvals.decided}건 평균`
          }
        />
      </div>

      {approvals ? (
        <PendingLine approvals={approvals} />
      ) : (
        /* 대기 줄이 사라지면 "지금 대기 0건"과 구분이 안 된다 */
        <Callout tone="neutral" className="mt-4">
          결재 대기 현황을 불러오지 못했습니다.
        </Callout>
      )}

      <div className="mb-6 mt-4">
        <ActivityWidget
          rows={activity.rows}
          errorMessage={activity.errorMessage}
          periodLabel={period.label}
          href={auditHref}
        />
      </div>

      <SectionHeader
        title="관리 화면"
        description="각 기능은 해당 모듈 패널의 '관리' 섹션에서도 열 수 있습니다"
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {AREAS.map((area) => (
          <AdminLink key={area.href} {...area} />
        ))}
      </div>
    </>
  );
}

/* ── 위젯 A. 인원 현황 ─────────────────────────────────────────────── */

function HeadcountWidget({
  headcount,
  departments,
}: {
  headcount: Awaited<ReturnType<typeof getHeadcountSummary>>;
  departments: Awaited<ReturnType<typeof getHeadcountByDepartment>>;
}) {
  return (
    <Card>
      <CardHeader
        title="인원 현황"
        description="재직·휴직·퇴사와 부서별 분포"
        action={
          <LinkButton href="/admin/employees" size="small" variant="secondary">
            임직원 관리
          </LinkButton>
        }
      />
      <CardBody>
        {!headcount ? (
          <LoadFailed label="인원 현황" />
        ) : (
          <>
            {/*
              세 상태는 한 덩어리(전체 인원)를 나눈 것이라 조각으로 쌓는다.
              파이 차트를 쓰지 않는 이유는 값이 셋뿐이고, 막대 하나면
              비율과 분모를 동시에 읽히기 때문이다.
            */}
            <Meter
              max={headcount.total || 1}
              segments={[
                { value: headcount.active, tone: "positive", label: "재직중" },
                { value: headcount.onLeave, tone: "warning", label: "휴직" },
                { value: headcount.terminated, tone: "neutral", label: "퇴사" },
              ]}
              label="전체 인원"
              valueLabel={`${headcount.total}명`}
              size="lg"
              aria-label={`전체 ${headcount.total}명 중 재직 ${headcount.active}명`}
            />
            {/* 조각 색과 상태를 묶어 준다. 색 없는 평문 캡션만 두면 얇은
                조각이 휴직인지 퇴사인지 hover 없이는 알 수 없다 */}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <Legend
                tone={METER_FILL.positive}
                label="재직"
                value={headcount.active}
              />
              <Legend
                tone={METER_FILL.warning}
                label="휴직"
                value={headcount.onLeave}
              />
              <Legend
                tone={METER_FILL.neutral}
                label="퇴사"
                value={headcount.terminated}
              />
            </div>

            <p className="mb-2 mt-4 text-label font-bold text-ink">
              부서별 재직 인원
            </p>
            {!departments ? (
              <LoadFailed label="부서별 인원" />
            ) : departments.length === 0 ? (
              <EmptyState compact title="등록된 인원이 없습니다" />
            ) : (
              <div className="flex flex-col gap-2.5">
                {departments.map((row) => (
                  <Meter
                    key={row.departmentId ?? "none"}
                    value={row.active}
                    max={headcount.active || 1}
                    tone={row.name ? "informative" : "neutral"}
                    label={row.name ?? "부서 미지정"}
                    valueLabel={`${row.active}명`}
                    aria-label={`${row.name ?? "부서 미지정"} 재직 ${row.active}명`}
                  />
                ))}
                <p className="text-nano text-muted">
                  막대 합 = 재직 {headcount.active}명. 부서가 지정되지 않은
                  인원도 한 줄로 셉니다. 재직자가 없는 부서는 줄이 생기지 않아
                  위 카드의 부서 개수({headcount.departments}개)와 다를 수
                  있습니다.
                </p>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* ── 위젯 B. 오늘의 출근 현황 ──────────────────────────────────────── */

function AttendanceWidget({
  attendance,
}: {
  attendance: TodayAttendance | null;
}) {
  /*
   * 함수가 네 칸과 합(active_total)을 같이 돌려주므로 화면에서 빼기로 만들지
   * 않는다. 합이 어긋나면 그건 화면 버그가 아니라 데이터 이상이고,
   * 그때 조용히 맞춰 보이는 것보다 드러나는 편이 낫다.
   */
  const sum = attendance
    ? attendance.checkedIn +
      attendance.partialLeave +
      attendance.fullDayLeave +
      attendance.absent
    : 0;
  const mismatched = !!attendance && sum !== attendance.activeTotal;

  return (
    <Card>
      <CardHeader
        title="오늘의 출근 현황"
        description={
          attendance
            ? `${attendance.date} 기준 · 재직 ${attendance.activeTotal}명`
            : "오늘 기준"
        }
        action={
          <LinkButton href="/admin/attendance" size="small" variant="secondary">
            근태 관리
          </LinkButton>
        }
      />
      <CardBody>
        {!attendance ? (
          <LoadFailed label="출근 현황" />
        ) : attendance.activeTotal === 0 ? (
          <EmptyState compact title="재직 중인 인원이 없습니다" />
        ) : (
          <>
            {/*
              비근무일에는 거의 전원이 미출근 칸으로 떨어진다. 그 상태를
              경고로 그리면 전사 무단결근으로 읽히고, 한 번 그렇게 읽힌
              위젯은 다음부터 무시된다. 이유를 먼저 말하고 톤을 낮춘다.
            */}
            {attendance.nonWorking ? (
              <Callout tone="neutral" className="mb-3">
                오늘은 {attendance.nonWorkingLabel ?? "비근무일"}이라 출근 기록이
                없는 것이 정상입니다.
              </Callout>
            ) : null}
            {/*
              네 칸은 서로 겹치지 않고 분모가 같다(재직 인원). 칸마다 막대를
              따로 그려 "재직 몇 명 중 몇 명"을 각각 읽게 한다.
            */}
            <div className="flex flex-col gap-3">
              {ATTENDANCE_BUCKETS.map((bucket) => {
                const value = attendance[bucket.key];
                const isIdleAbsence =
                  bucket.key === "absent" && attendance.nonWorking;
                return (
                  <div key={bucket.key}>
                    <Meter
                      value={value}
                      max={attendance.activeTotal}
                      tone={isIdleAbsence ? "neutral" : bucket.tone}
                      label={bucket.label}
                      valueLabel={`${value}명 /${attendance.activeTotal}명`}
                      size="md"
                      aria-label={`${bucket.label} ${value}명 / 재직 ${attendance.activeTotal}명`}
                    />
                    <p className="mt-1 text-nano text-muted">
                      {isIdleAbsence
                        ? "비근무일이라 조치 대상이 아닙니다"
                        : bucket.note}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-nano text-muted">
              한 사람은 한 칸에만 들어갑니다. 입사 예정자는 세지 않습니다.
            </p>
            {mismatched ? (
              <Callout tone="warn" title="네 칸의 합이 재직 인원과 다릅니다" className="mt-3">
                합 {sum}명 · 재직 {attendance.activeTotal}명. 집계가 어긋난
                상태이므로 근태 관리 화면에서 원본을 확인해 주세요.
              </Callout>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* ── 위젯 C. 연차 사용률 ───────────────────────────────────────────── */

function LeaveUsageWidget({ teams }: { teams: TeamLeaveUsage[] | null }) {
  const totals = (teams ?? []).reduce(
    (acc, row) => ({
      granted: acc.granted + row.grantedDays,
      used: acc.used + row.usedDays,
      members: acc.members + row.memberCount,
      computed: acc.computed + row.computedCount,
      uncomputed: acc.uncomputed + row.uncomputedCount,
    }),
    { granted: 0, used: 0, members: 0, computed: 0, uncomputed: 0 },
  );

  return (
    <Card>
      <CardHeader
        title="연차 사용률"
        description="이번 연차연도(입사기념일 ~ 다음 기념일 전날) 기준 · 팀별"
        action={
          <LinkButton href="/admin/attendance" size="small" variant="secondary">
            근태 관리
          </LinkButton>
        }
      />
      <CardBody>
        {!teams ? (
          <LoadFailed label="연차 사용률" />
        ) : teams.length === 0 ? (
          <EmptyState compact title="재직 중인 인원이 없습니다" />
        ) : (
          <>
            {totals.granted > 0 ? (
              <Meter
                value={totals.used}
                max={totals.granted}
                tone="informative"
                label="전사 평균 (부여일수 가중)"
                valueLabel={`${percent(totals.used, totals.granted)}%`}
                size="lg"
                aria-label={`전사 연차 사용 ${days(totals.used)}일 / 부여 ${days(totals.granted)}일`}
              />
            ) : (
              <p className="text-label text-muted">
                아직 부여된 연차가 없어 사용률을 낼 수 없습니다.
              </p>
            )}
            <p className="mt-2 text-label text-muted">
              사용 {days(totals.used)}일 / 부여 {days(totals.granted)}일 · 산정{" "}
              {totals.computed}명 /{totals.members}명
              {totals.uncomputed > 0 ? ` (산정 안 됨 ${totals.uncomputed}명)` : ""}
            </p>

            <div className="mt-4 flex flex-col gap-3">
              {teams.map((row) => (
                <TeamUsageRow key={row.teamId ?? "none"} row={row} />
              ))}
            </div>

            {totals.uncomputed > 0 ? (
              <p className="mt-3 text-nano text-muted">
                산정 안 됨 = 입사일이 비어 있거나 아직 입사 전인 인원입니다.
                분모(부여일수)에서 빠져 있으므로 임직원 정보에서 입사일을
                채우면 사용률이 정확해집니다.
              </p>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function TeamUsageRow({ row }: { row: TeamLeaveUsage }) {
  const name = row.teamName ?? "팀 미지정";
  const label = row.departmentName ? `${name} · ${row.departmentName}` : name;
  const uncomputed =
    row.uncomputedCount > 0 ? ` · 산정 안 됨 ${row.uncomputedCount}명` : "";

  // 부여일수가 0이면 나누지 않는다 — 0%는 "안 썼다"로 읽히지만 사실은 분모가 없다
  if (row.grantedDays <= 0) {
    return (
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-label text-muted">{label}</span>
        <span className="shrink-0 text-label text-muted">
          산정 대상 없음 ({row.memberCount}명{uncomputed})
        </span>
      </div>
    );
  }

  return (
    <div>
      <Meter
        value={row.usedDays}
        max={row.grantedDays}
        tone="informative"
        label={label}
        valueLabel={`${percent(row.usedDays, row.grantedDays)}%`}
        aria-label={`${name} 연차 사용 ${days(row.usedDays)}일 / 부여 ${days(row.grantedDays)}일`}
      />
      <p className="mt-1 text-nano text-muted">
        사용 {days(row.usedDays)}일 / 부여 {days(row.grantedDays)}일 · 산정{" "}
        {row.computedCount}명 /{row.memberCount}명{uncomputed}
      </p>
    </div>
  );
}

/* ── 위젯 E. 최근 입사자 ───────────────────────────────────────────── */

function RecentHiresWidget({
  hires,
}: {
  hires: Awaited<ReturnType<typeof getRecentHires>>;
}) {
  const unlinked = (hires ?? []).filter((row) => row.isUnlinked).length;

  return (
    <Card>
      <CardHeader
        title="최근 입사자"
        description={`최근 ${RECENT_HIRE_DAYS}일 안에 입사한 재직자`}
        action={
          <LinkButton href="/admin/employees" size="small" variant="secondary">
            임직원 관리
          </LinkButton>
        }
      />
      <CardBody>
        {!hires ? (
          <LoadFailed label="최근 입사자" />
        ) : hires.length === 0 ? (
          <EmptyState
            compact
            icon={UserPlus}
            title={`최근 ${RECENT_HIRE_DAYS}일 입사자가 없습니다`}
            description="입사일이 등록된 재직자만 셉니다."
          />
        ) : (
          <>
            <p className="mb-3 text-label text-muted">
              <span className="text-body font-bold text-ink">
                {hires.length}
              </span>
              명
              {unlinked > 0 ? ` · 계정 미연결 ${unlinked}명` : ""}
            </p>
            <ul className="flex flex-col gap-2">
              {hires.map((row) => (
                <li
                  key={row.employeeId}
                  className="flex items-baseline justify-between gap-2"
                >
                  <span className="min-w-0">
                    <span className="text-body-sm font-bold text-ink">
                      {row.name}
                    </span>
                    <span className="ml-1.5 text-label text-muted">
                      {[row.position, row.departmentName ?? row.teamName]
                        .filter(Boolean)
                        .join(" · ") || "소속 미지정"}
                    </span>
                    {row.isUnlinked ? (
                      <Badge tone="warn" className="ml-1.5">
                        계정 미연결
                      </Badge>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-label tabular-nums text-muted">
                    {formatDate(row.hiredOn)} ·{" "}
                    {/* 당일은 0일째가 아니다 — 한국어로 성립하지 않는다 */}
                    {row.daysSince > 0 ? `${row.daysSince}일째` : "오늘 입사"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* ── 위젯 D의 '지금' 값 ────────────────────────────────────────────── */

/**
 * 대기 건수와 최장 대기일은 기간과 무관한 현재 값이다. 기간 카드에 섞으면
 * "이번 달에 밀린 건"으로 읽히는데, 실제로는 지난달에 올라와 아직 안 끝난
 * 문서가 대부분이다.
 */
function PendingLine({
  approvals,
}: {
  approvals: NonNullable<Awaited<ReturnType<typeof getApprovalActivity>>>;
}) {
  if (approvals.pending === 0) {
    return (
      <Callout tone="success" className="mt-4">
        지금 결재 대기 중인 문서가 없습니다.
      </Callout>
    );
  }

  const late = approvals.oldestPendingDays >= AGING_LATE_DAYS;

  return (
    <Callout
      tone={late ? "warn" : "neutral"}
      title={
        late
          ? `${approvals.oldestPendingDays}일째 결재되지 않은 문서가 있습니다`
          : undefined
      }
      action={
        <LinkButton href="/approvals" size="small" variant="secondary">
          결재함 열기
        </LinkButton>
      }
      className="mt-4"
    >
      지금 대기 {approvals.pending}건 · 가장 오래된 건{" "}
      {/* 오늘 올라온 건이면 "0일째"가 아니라 "오늘 상신"이다 */}
      {approvals.oldestPendingDays > 0
        ? `${approvals.oldestPendingDays}일째`
        : "오늘 상신"}{" "}
      (기간 필터와 무관한 현재 값)
    </Callout>
  );
}

/* ── 위젯 F. 최근 활동 로그 ────────────────────────────────────────── */

function ActivityWidget({
  rows,
  errorMessage,
  periodLabel,
  href,
}: {
  rows: Awaited<ReturnType<typeof listAuditLogs>>["rows"];
  errorMessage: string | null;
  periodLabel: string;
  href: string;
}) {
  return (
    <Card>
      <CardHeader
        title="최근 활동 로그"
        description={`${periodLabel} 안의 최근 ${ACTIVITY_LIMIT}건`}
        action={
          <LinkButton href={href} size="small" variant="secondary">
            감사 로그
          </LinkButton>
        }
      />
      <CardBody>
        {errorMessage ? (
          <LoadFailed label="활동 로그" />
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            icon={ScrollText}
            title="이 기간에 기록된 변경이 없습니다"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((log) => (
              <li
                key={log.id}
                className="flex items-baseline justify-between gap-2"
              >
                <span className="min-w-0 truncate">
                  <span className="text-body-sm text-ink">
                    {/* 라벨이 없는 액션은 원문 키가 그대로 찍힌다 — 그래서
                        DB가 쓰는 값은 전부 AUDIT_ACTION_LABELS에 있어야 한다 */}
                    {AUDIT_ACTION_LABELS[log.action] ?? log.action}
                  </span>
                  <span className="ml-1.5 text-label text-muted">
                    {log.actorName ?? log.actorEmail ?? "시스템"}
                  </span>
                </span>
                <span className="shrink-0 text-label tabular-nums text-muted">
                  {formatDateTime(log.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* ── 공통 ──────────────────────────────────────────────────────────── */

/**
 * "0건"과 "못 불러왔다"를 반드시 다르게 말한다.
 * 전사 통계에서 조용한 0은 사실로 읽히고, 그대로 판단 근거가 된다.
 */
function LoadFailed({ label }: { label: string }) {
  return (
    <p className="py-4 text-center text-label text-muted">
      {label}을(를) 불러오지 못했습니다.
    </p>
  );
}

/** 누적 막대의 색 범례. approvals/page.tsx가 같은 모양으로 쓴다 */
function Legend({
  tone,
  label,
  value,
}: {
  tone: string;
  label: string;
  value: number;
}) {
  return (
    <span className="flex items-center gap-1.5 text-label text-muted">
      <span className={`size-2 rounded-pill ${tone}`} aria-hidden />
      {label}
      <span className="tabular-nums text-ink">{value}명</span>
    </span>
  );
}

/** 0.5일 단위가 나오므로 정수일 때만 소수점을 뗀다 */
function days(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

const AREAS: { href: string; label: string; note: string; icon: LucideIcon }[] =
  [
    {
      href: "/admin/employees",
      label: "임직원 관리",
      note: "계정 생성·인사정보·재직상태",
      icon: Building2,
    },
    {
      href: "/admin/roles",
      label: "권한 관리",
      note: "역할 부여와 권한 범위",
      icon: Shield,
    },
    {
      href: "/admin/attendance",
      label: "전사 근태 관리",
      note: "근태 조회·보정·주52시간 모니터링",
      icon: ClipboardList,
    },
    {
      href: "/admin/approval-lines",
      label: "결재라인 설정",
      note: "문서 유형별 결재 단계",
      icon: GitBranch,
    },
    {
      href: "/admin/holidays",
      label: "휴일 관리",
      note: "공휴일·회사 지정 휴무일",
      icon: CalendarOff,
    },
    {
      href: "/admin/resources",
      label: "리소스 관리",
      note: "회의실·장비 예약 대상",
      icon: Boxes,
    },
    {
      href: "/admin/boards",
      label: "게시판 관리",
      note: "게시판 생성·쓰기 권한",
      icon: Settings,
    },
    {
      href: "/admin/files",
      label: "파일함 관리",
      note: "사내 규정 문서 등록",
      icon: Settings,
    },
    {
      href: "/admin/audit-logs",
      label: "감사 로그",
      note: "누가 무엇을 바꿨는지",
      icon: ScrollText,
    },
  ];

function AdminLink({
  href,
  label,
  note,
  icon: Icon,
}: {
  href: string;
  label: string;
  note: string;
  icon: LucideIcon;
}) {
  return (
    <Link href={href} className="block">
      <Card className="h-full transition-colors duration-fast ease-standard hover:border-line-strong">
        <CardBody density="compact" className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-subtle text-muted">
            <Icon className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-body-sm font-bold text-ink">
              {label}
            </span>
            <span className="block truncate text-caption">{note}</span>
          </span>
        </CardBody>
      </Card>
    </Link>
  );
}
