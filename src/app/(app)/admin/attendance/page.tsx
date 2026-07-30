import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  AdminAttendance,
  type AdminRecordRow,
  type AdminRow,
} from "@/features/attendance/AdminAttendance";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { computeAccruedDays } from "@/features/attendance/leave-accrual";
import {
  addDaysYmd,
  monthLabel,
  todayYmd,
  weekdayOf,
} from "@/features/calendar/date";
import type {
  AttendanceRecord,
  AttendanceStatus,
  LeaveBalance,
} from "@/types/db";

export const metadata: Metadata = { title: "근태 관리" };

interface EmployeeRow {
  id: string;
  name: string;
  hire_date: string | null;
  department: { name: string } | null;
}

export default async function AdminAttendancePage() {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const today = todayYmd();
  const ym = today.slice(0, 7);
  const monthStart = `${ym}-01`;
  const weekStart = addDaysYmd(today, -weekdayOf(today));

  const [{ data: employees }, { data: records }, { data: balances }] =
    await Promise.all([
      supabase
        .from("employees")
        .select("id, name, hire_date, department:departments!department_id(name)")
        .eq("employment_status", "active")
        .order("name"),
      supabase
        .from("attendance_records")
        .select("*")
        .gte("work_date", monthStart)
        .lte("work_date", today)
        .order("work_date", { ascending: false }),
      supabase.from("leave_balances").select("*"),
    ]);

  const employeeList = (employees ?? []) as unknown as EmployeeRow[];
  const recordList = (records ?? []) as AttendanceRecord[];
  const balanceMap = new Map(
    ((balances ?? []) as LeaveBalance[]).map((b) => [b.employee_id, b]),
  );
  const nameMap = new Map(employeeList.map((e) => [e.id, e.name]));

  const hoursOf = (r: AttendanceRecord) =>
    r.check_in_at && r.check_out_at
      ? (new Date(r.check_out_at).getTime() -
          new Date(r.check_in_at).getTime()) /
        3_600_000
      : 0;

  const rows: AdminRow[] = employeeList.map((employee) => {
    const mine = recordList.filter((r) => r.employee_id === employee.id);
    const balance = balanceMap.get(employee.id);
    // 발생분은 저장값이 아니라 계산값을 기준으로 보여준다(동기화 지연 방지)
    const accrued = computeAccruedDays(employee.hire_date, today);
    const remaining =
      accrued -
      Number(balance?.used_days ?? 0) +
      Number(balance?.adjustment_days ?? 0);

    return {
      employeeId: employee.id,
      name: employee.name,
      departmentName: employee.department?.name ?? null,
      workDays: mine.filter((r) => r.check_in_at).length,
      totalHours: Math.round(mine.reduce((s, r) => s + hoursOf(r), 0) * 10) / 10,
      lateCount: mine.filter((r) => r.status === "late").length,
      earlyLeaveCount: mine.filter((r) => r.status === "early_leave").length,
      remainingLeave: Math.round(remaining * 100) / 100,
      weeklyHours:
        Math.round(
          mine
            .filter((r) => r.work_date >= weekStart)
            .reduce((s, r) => s + hoursOf(r), 0) * 10,
        ) / 10,
    };
  });

  const recordRows: AdminRecordRow[] = recordList.slice(0, 200).map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeName: nameMap.get(r.employee_id) ?? "(알 수 없음)",
    workDate: r.work_date,
    checkInAt: r.check_in_at,
    checkOutAt: r.check_out_at,
    status: r.status as AttendanceStatus,
    reason: r.manual_adjustment_reason ?? r.location_warning,
  }));

  const { data: setting } = await supabase
    .from("compensatory_leave_settings")
    .select("rate")
    .is("group_scope", null)
    .maybeSingle<{ rate: number }>();

  return (
    <>
      <PageHeader
        title="근태 관리"
        description="전사 근태 현황과 연차 잔여를 관리합니다. 모든 수동 조정은 감사 로그에 기록됩니다."
      />

      <AdminAttendance
        rows={rows}
        records={recordRows}
        monthLabel={monthLabel(ym)}
        compensatoryRate={Number(setting?.rate ?? 1.5)}
      />
    </>
  );
}
