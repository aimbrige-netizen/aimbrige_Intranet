import type { Metadata } from "next";
import { Award, CalendarCheck, CalendarDays, Clock3 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Avatar } from "@/components/ui/Avatar";
import { EmploymentStatusBadge, RoleBadge } from "@/components/ui/Badge";
import { ProfileEditForm } from "@/features/profile/ProfileEditForm";
import { FavoriteList } from "@/features/profile/FavoriteList";
import {
  getEmergencyContact,
  requireSessionEmployee,
} from "@/lib/auth/session";
import { getFavorites } from "@/features/dashboard/widget-data";
import { getLeaveSummary, getThisWeekHours } from "@/features/attendance/data";
import { formatDays, formatHours } from "@/features/attendance/format";
import { monthsOfService } from "@/features/attendance/leave-accrual";
import { todayYmd } from "@/features/calendar/date";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "내 프로필" };

/**
 * 내 프로필.
 *
 * 예전에는 주요 액션 자리를 상단바에도 있는 '로그아웃'이 차지하고 있었고,
 * 화면 전체가 데이터 8개 대 설명문 5문장에 지표는 0개였다.
 * 지금은 연차·근속·이번 주 근무를 요약 밴드로 먼저 보여주고,
 * 같은 말을 반복하던 안내문은 헤더 한 줄로 줄였다.
 */
export default async function ProfilePage() {
  const me = await requireSessionEmployee();
  const [favorites, emergencyContact, leave, week] = await Promise.all([
    getFavorites(me.id),
    getEmergencyContact(me.id),
    getLeaveSummary(me.id, me.hire_date),
    getThisWeekHours(me.id),
  ]);

  const months = me.hire_date ? monthsOfService(me.hire_date, todayYmd()) : 0;
  const serviceLabel = me.hire_date
    ? months >= 12
      ? `${Math.floor(months / 12)}년 ${months % 12}개월`
      : `${months}개월`
    : "-";

  const basicInfo = [
    { label: "이메일", value: me.email },
    { label: "부서", value: me.department?.name ?? "-" },
    { label: "팀", value: me.team?.name ?? "-" },
    { label: "직급/직책", value: me.position ?? "-" },
    { label: "입사일", value: formatDate(me.hire_date) },
    { label: "담당업무", value: me.responsibilities ?? "-" },
  ];

  const grantedDays = leave.accrued + leave.adjustment;

  return (
    <>
      <PageHeader
        title="내 프로필"
        description="기본정보는 읽기 전용입니다. 변경이 필요하면 시스템 관리자에게 문의하세요."
        meta={
          <>
            <span>{me.department?.name ?? "부서 미지정"}</span>
            <span>·</span>
            <span>입사 {formatDate(me.hire_date)}</span>
            {leave.yearStart ? (
              <>
                <span>·</span>
                <span>
                  연차연도 {leave.yearStart} ~ {leave.yearEnd}
                </span>
              </>
            ) : null}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="잔여 연차"
          value={formatDays(leave.remaining)}
          unit="일"
          denominator={formatDays(grantedDays)}
          denominatorUnit="일"
          tone="brand"
          icon={CalendarCheck}
          emphasis
          max={grantedDays || 1}
          meterValue={leave.used}
          sub={
            leave.next
              ? `소진율 ${Math.round(leave.usageRate * 100)}% · 다음 발생 ${leave.next.date.slice(5)} +${leave.next.days}일`
              : `소진율 ${Math.round(leave.usageRate * 100)}%`
          }
        />
        <StatCard
          label="근속"
          value={serviceLabel}
          tone="neutral"
          icon={Award}
          state={me.hire_date ? "ok" : "empty"}
          sub={
            me.hire_date
              ? `${months}개월째 · 올해 부여 ${formatDays(leave.accrued)}일`
              : "입사일이 등록되지 않았습니다"
          }
        />
        <StatCard
          label="이번 주 근무"
          value={formatHours(week.hours)}
          denominator={`${week.targetHours}h`}
          tone="neutral"
          icon={Clock3}
          max={week.limitHours}
          meterValue={week.hours}
          thresholds={[
            { at: week.targetHours, label: `${week.targetHours}h`, tone: "brand" },
            { at: week.warnHours, label: `${week.warnHours}h`, tone: "warning" },
            { at: week.limitHours, tone: "critical" },
          ]}
          scale
          scaleMaxLabel={`${week.limitHours}h`}
        />
        <StatCard
          label="이번 주 근무일"
          value={week.workedDayCount}
          unit="일"
          denominator={week.plannedWorkDayCount}
          denominatorUnit="일"
          tone="informative"
          icon={CalendarDays}
          max={week.plannedWorkDayCount || 1}
          meterValue={week.workedDayCount}
          sub={
            week.overtimeHours > 0
              ? `승인 초과근무 ${formatHours(week.overtimeHours)}`
              : "승인 초과근무 없음"
          }
        />
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader
            title="기본정보"
            density="compact"
            action={
              <div className="flex items-center gap-2">
                <RoleBadge role={me.roleName} />
                <EmploymentStatusBadge status={me.employment_status} />
              </div>
            }
          />
          <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="flex shrink-0 items-center gap-3 sm:w-52 sm:flex-col sm:items-start">
              <Avatar
                name={me.name}
                src={me.profile_image_url}
                size="xlarge"
              />
              <div className="min-w-0">
                <p className="text-h3 text-ink">{me.name}</p>
                <p className="text-caption">
                  {[me.position, me.team?.name].filter(Boolean).join(" · ") ||
                    "직급 미지정"}
                </p>
              </div>
            </div>

            <dl className="grid flex-1 grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              {basicInfo.map((item) => (
                <div key={item.label} className="min-w-0">
                  <dt className="text-caption">{item.label}</dt>
                  <dd className="mt-0.5 truncate text-body text-ink">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="내가 수정할 수 있는 항목"
            density="compact"
          />
          <CardBody>
            <ProfileEditForm
              authUserId={me.auth_user_id}
              name={me.name}
              initial={{
                phone: me.phone ?? "",
                emergency_contact: emergencyContact ?? "",
                profile_image_url: me.profile_image_url,
              }}
            />
          </CardBody>
        </Card>

        <Card id="favorites">
          <CardHeader
            title="즐겨찾기"
            description="사이드바 상단에 고정되는 바로가기입니다."
            density="compact"
            action={
              <span className="text-label tabular-nums text-muted">
                {favorites.length}개
              </span>
            }
          />
          <CardBody density="compact">
            <FavoriteList favorites={favorites} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
