import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { ApprovalList } from "@/features/attendance/ApprovalList";
import {
  getApprovalQueue,
  getTeamWeeklyHours,
} from "@/features/attendance/data";
import {
  WEEKLY_LIMIT_HOURS,
  WEEKLY_WARN_HOURS,
} from "@/features/attendance/constants";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { requireSessionEmployee } from "@/lib/auth/session";
import {
  LEAVE_CATEGORY_LABELS,
  LEAVE_TYPE_LABELS,
} from "@/features/attendance/constants";
import type { ApprovalItem } from "@/types/db";

export const metadata: Metadata = { title: "근태 승인함" };

export default async function ApprovalsPage() {
  const me = await requireSessionEmployee();
  // 팀장·매니저·관리자만 (스펙 2장 접근 권한)
  if (!me.isManager) redirect("/attendance");

  const [{ leaves, overtimes, corrections }, teamHours] = await Promise.all([
    getApprovalQueue(),
    getTeamWeeklyHours(),
  ]);

  // 세 종류의 신청을 한 목록으로 합쳐 대기중이 위로 오게 정렬한다
  const items: ApprovalItem[] = [
    ...leaves.map((l) => ({
      id: l.id,
      kind: "leave" as const,
      employeeId: l.employee_id,
      employeeName: l.employee?.name ?? "(알 수 없음)",
      typeLabel: LEAVE_CATEGORY_LABELS[l.leave_category],
      dateLabel:
        l.start_date === l.end_date
          ? l.start_date
          : `${l.start_date} ~ ${l.end_date}`,
      detailLabel: `${LEAVE_TYPE_LABELS[l.leave_type]} · ${l.days}일`,
      reason: l.reason,
      status: l.status,
      createdAt: l.created_at,
      rejectionReason: l.rejection_reason,
    })),
    ...overtimes.map((o) => ({
      id: o.id,
      kind: "overtime" as const,
      employeeId: o.employee_id,
      employeeName: o.employee?.name ?? "(알 수 없음)",
      typeLabel: "초과근무",
      dateLabel: o.work_date,
      detailLabel: `${o.start_time.slice(0, 5)}~${o.end_time.slice(0, 5)}${
        o.compensate_as_leave ? " · 보상휴가" : ""
      }`,
      reason: o.reason,
      status: o.status,
      createdAt: o.created_at,
      rejectionReason: o.rejection_reason,
    })),
    ...corrections.map((c) => ({
      id: c.id,
      kind: "correction" as const,
      employeeId: c.employee_id,
      employeeName: c.employee?.name ?? "(알 수 없음)",
      typeLabel: "근태 수정",
      dateLabel: c.target_date,
      detailLabel: [
        c.requested_check_in ? "출근 정정" : null,
        c.requested_check_out ? "퇴근 정정" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      reason: c.reason,
      status: c.status,
      createdAt: c.created_at,
      rejectionReason: c.rejection_reason,
    })),
  ].sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return (
    <>
      <Link
        href="/attendance"
        className="mb-3 inline-flex items-center gap-1 text-label text-primary hover:underline"
      >
        <ChevronLeft className="size-3.5" />
        내 근태
      </Link>

      <PageHeader
        title="근태 승인함"
        description={
          me.isSystemAdmin
            ? "시스템 관리자는 전체 팀의 신청을 처리할 수 있습니다(팀장 부재 시 대리 처리)."
            : "본인이 팀장·부서장으로 지정된 팀원의 신청입니다."
        }
      />

      <ApprovalList items={items} />

      {/* 팀원 주 52시간 현황 (스펙 3.2 — "본인과 팀장 모두에게 노출") */}
      {teamHours.length > 0 ? (
        <Card className="mt-5">
          <CardHeader
            title="팀원 이번 주 근무시간"
            description={`정규 근무 + 승인된 초과근무 합산. ${WEEKLY_WARN_HOURS}시간 이상이면 경고, ${WEEKLY_LIMIT_HOURS}시간 초과면 위반입니다.`}
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="ab-table min-w-[420px]">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th className="w-32">이번 주</th>
                    <th className="w-24">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {teamHours.map((row) => {
                    const over = row.hours > WEEKLY_LIMIT_HOURS;
                    const warn = !over && row.hours >= WEEKLY_WARN_HOURS;
                    return (
                      <tr key={row.employeeId}>
                        <td>{row.name}</td>
                        <td
                          className={cn(
                            "tabular-nums",
                            over
                              ? "font-bold text-danger"
                              : warn
                                ? "font-bold text-warn"
                                : undefined,
                          )}
                        >
                          {row.hours}시간
                        </td>
                        <td className="text-caption">
                          {over ? "초과" : warn ? "근접" : "정상"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
