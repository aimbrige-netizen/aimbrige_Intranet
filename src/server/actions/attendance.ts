"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { requireSessionEmployee, requireSystemAdmin } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { todayYmd, toSeoulTime, seoulToDate } from "@/features/calendar/date";
import {
  LATE_THRESHOLD,
  WORK_END,
  daysForLeaveType,
} from "@/features/attendance/constants";
import { countLeaveDays } from "@/features/attendance/leave-accrual";

export interface AttendanceActionResult {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  message?: string;
  warning?: string;
}

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

/** 사내 IP 대역·근무지 좌표는 환경변수로 관리 (스펙 3.1 / 7장) */
function officeIpPrefixes(): string[] {
  return (process.env.OFFICE_IP_PREFIXES ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function officeCoords(): { lat: number; lng: number; radiusM: number } | null {
  const raw = process.env.OFFICE_GPS?.trim();
  if (!raw) return null;
  const [lat, lng, radius] = raw.split(",").map((v) => Number(v.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, radiusM: Number.isFinite(radius) ? radius : 300 };
}

/** 두 좌표 사이 거리(m) — 하버사인 */
function distanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function clientIp(): string | null {
  const h = headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip");
}

const checkInSchema = z.object({
  workStatus: z.enum(["normal_office", "field_work", "remote", "training"]),
  // 위치 동의는 선택. 없으면 GPS 검사를 건너뛴다.
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
});

/**
 * 출근 체크 (스펙 3.1)
 * 사내 IP·GPS가 범위를 벗어나도 **절대 차단하지 않고 경고만** 남긴다.
 * 재택·외근이 일상이라 차단하면 정상 근무를 막게 된다.
 */
export async function checkIn(
  input: unknown,
): Promise<AttendanceActionResult> {
  const me = await requireSessionEmployee();
  const parsed = checkInSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = createServerSupabase();
  const workDate = todayYmd();
  const now = new Date();

  // 중복 체크인 방지
  const { data: existing } = await supabase
    .from("attendance_records")
    .select("id, check_in_at")
    .eq("employee_id", me.id)
    .eq("work_date", workDate)
    .maybeSingle<{ id: string; check_in_at: string | null }>();

  if (existing?.check_in_at) {
    return { ok: false, message: "이미 출근 처리되었습니다." };
  }

  // 위치 신호 확인 — 경고 문구만 만든다
  const warnings: string[] = [];
  const ip = clientIp();
  const prefixes = officeIpPrefixes();
  if (prefixes.length > 0 && ip && !prefixes.some((p) => ip.startsWith(p))) {
    warnings.push("사내 IP가 아닙니다");
  }

  const office = officeCoords();
  const { latitude, longitude } = parsed.data;
  let location: string | null = null;
  if (typeof latitude === "number" && typeof longitude === "number") {
    location = `${latitude},${longitude}`;
    if (office) {
      const distance = distanceMeters(
        latitude,
        longitude,
        office.lat,
        office.lng,
      );
      if (distance > office.radiusM) {
        warnings.push(`근무지에서 ${Math.round(distance)}m 떨어져 있습니다`);
      }
    }
  }

  const warning = warnings.length > 0 ? warnings.join(" · ") : null;

  // 지각 판정 — 09:10 이후 체크인 (스펙 7장)
  const isLate = toSeoulTime(now) > LATE_THRESHOLD;

  const { error } = await supabase.from("attendance_records").upsert(
    {
      employee_id: me.id,
      work_date: workDate,
      check_in_at: now.toISOString(),
      check_in_ip: ip,
      check_in_location: location,
      location_warning: warning,
      work_status: parsed.data.workStatus,
      status: isLate ? "late" : "normal",
    },
    { onConflict: "employee_id,work_date" },
  );

  if (error) return { ok: false, message: error.message };

  revalidatePath("/attendance");
  revalidatePath("/");
  return {
    ok: true,
    warning: warning
      ? `${warning}. 출근 기록은 정상 저장되었습니다.`
      : undefined,
  };
}

/** 퇴근 체크 — 정규 퇴근시간 전이면 조퇴로 기록 */
export async function checkOut(): Promise<AttendanceActionResult> {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();
  const workDate = todayYmd();
  const now = new Date();

  const { data: record } = await supabase
    .from("attendance_records")
    .select("id, check_in_at, check_out_at, status")
    .eq("employee_id", me.id)
    .eq("work_date", workDate)
    .maybeSingle<{
      id: string;
      check_in_at: string | null;
      check_out_at: string | null;
      status: string;
    }>();

  if (!record?.check_in_at) {
    return { ok: false, message: "출근 기록이 없습니다. 먼저 출근해 주세요." };
  }
  if (record.check_out_at) {
    return { ok: false, message: "이미 퇴근 처리되었습니다." };
  }

  // 지각이었으면 지각 상태를 유지한다(조퇴로 덮어쓰지 않는다)
  const isEarly = toSeoulTime(now) < WORK_END;
  const nextStatus =
    record.status === "late" ? "late" : isEarly ? "early_leave" : "normal";

  const { error } = await supabase
    .from("attendance_records")
    .update({ check_out_at: now.toISOString(), status: nextStatus })
    .eq("id", record.id);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/attendance");
  revalidatePath("/");
  return { ok: true };
}

// ---------------------------------------------------------------------
// 휴가 신청 (스펙 3.3)
// ---------------------------------------------------------------------

const leaveSchema = z
  .object({
    leaveType: z.enum(["full_day", "half_day_am", "half_day_pm", "hourly"]),
    leaveCategory: z.enum([
      "annual",
      "industrial_accident",
      "family_care",
      "maternity",
      "menstrual",
      "congratulation_condolence",
    ]),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "시작일을 선택하세요."),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "종료일을 선택하세요."),
    startTime: z.string().optional(),
    hours: z.coerce.number().optional(),
    reason: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "종료일은 시작일보다 뒤여야 합니다.",
      });
    }
    if (v.leaveType !== "full_day" && v.startDate !== v.endDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "반차·시간단위 연차는 하루만 신청할 수 있습니다.",
      });
    }
    if (v.leaveType === "hourly") {
      if (!v.hours || v.hours < 1 || v.hours > 7) {
        ctx.addIssue({
          code: "custom",
          path: ["hours"],
          message: "시간단위 연차는 1~7시간까지 신청할 수 있습니다.",
        });
      }
      if (!v.startTime) {
        ctx.addIssue({
          code: "custom",
          path: ["startTime"],
          message: "시작 시각을 선택하세요.",
        });
      }
    }
  });

export async function createLeaveRequest(
  input: unknown,
): Promise<AttendanceActionResult> {
  const me = await requireSessionEmployee();
  const parsed = leaveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;
  const supabase = createServerSupabase();

  // 신청 일수 계산 — 주말·공휴일은 차감하지 않는다
  let days = daysForLeaveType(v.leaveType, v.hours ?? null);
  if (days === null) {
    const { data: holidays } = await supabase
      .from("holidays")
      .select("date")
      .eq("is_non_working", true)
      .gte("date", v.startDate)
      .lte("date", v.endDate);

    days = countLeaveDays(
      v.startDate,
      v.endDate,
      new Set((holidays ?? []).map((h) => h.date as string)),
    );

    if (days === 0) {
      return {
        ok: false,
        fieldErrors: {
          startDate: "선택한 기간에 근무일이 없습니다(주말·공휴일만 포함).",
        },
      };
    }
  }

  // 연차는 잔여를 초과할 수 없다. 최종 검증은 승인 시 DB 함수에서 다시 한다.
  if (v.leaveCategory === "annual") {
    const { data: balance } = await supabase
      .from("leave_balances")
      .select("accrued_days, used_days, adjustment_days")
      .eq("employee_id", me.id)
      .maybeSingle<{
        accrued_days: number;
        used_days: number;
        adjustment_days: number;
      }>();

    const remaining =
      Number(balance?.accrued_days ?? 0) -
      Number(balance?.used_days ?? 0) +
      Number(balance?.adjustment_days ?? 0);

    // 대기중 신청도 미리 잡아둔 것으로 보고 함께 차감한다(중복 신청 방지)
    const { data: pending } = await supabase
      .from("leave_requests")
      .select("days")
      .eq("employee_id", me.id)
      .eq("leave_category", "annual")
      .eq("status", "pending");

    const pendingDays = (pending ?? []).reduce(
      (sum, r) => sum + Number(r.days ?? 0),
      0,
    );

    if (days > remaining - pendingDays) {
      return {
        ok: false,
        fieldErrors: {
          startDate: `잔여 연차가 부족합니다. (잔여 ${remaining}일, 대기중 ${pendingDays}일, 신청 ${days}일)`,
        },
      };
    }
  }

  const { error } = await supabase.from("leave_requests").insert({
    employee_id: me.id,
    leave_type: v.leaveType,
    leave_category: v.leaveCategory,
    start_date: v.startDate,
    end_date: v.endDate,
    start_time: v.leaveType === "hourly" ? (v.startTime ?? null) : null,
    hours: v.leaveType === "hourly" ? (v.hours ?? null) : null,
    days,
    reason: v.reason ?? null,
    status: "pending",
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/attendance");
  revalidatePath("/attendance/approvals");
  return { ok: true };
}

// ---------------------------------------------------------------------
// 초과근무 · 근태 수정요청
// ---------------------------------------------------------------------

const overtimeSchema = z
  .object({
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜를 선택하세요."),
    startTime: z.string().min(1, "시작 시각을 선택하세요."),
    endTime: z.string().min(1, "종료 시각을 선택하세요."),
    reason: z.string().trim().min(1, "사유를 입력하세요."),
    compensateAsLeave: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.endTime <= v.startTime) {
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "종료 시각은 시작 시각보다 뒤여야 합니다.",
      });
    }
  });

export async function createOvertimeRequest(
  input: unknown,
): Promise<AttendanceActionResult> {
  const me = await requireSessionEmployee();
  const parsed = overtimeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const supabase = createServerSupabase();
  const { error } = await supabase.from("overtime_requests").insert({
    employee_id: me.id,
    work_date: v.workDate,
    start_time: v.startTime,
    end_time: v.endTime,
    reason: v.reason,
    compensate_as_leave: v.compensateAsLeave,
    status: "pending",
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/attendance");
  revalidatePath("/attendance/approvals");
  return { ok: true };
}

const correctionSchema = z
  .object({
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜를 선택하세요."),
    checkInTime: z.string().optional(),
    checkOutTime: z.string().optional(),
    reason: z.string().trim().min(1, "사유를 입력하세요."),
  })
  .superRefine((v, ctx) => {
    if (!v.checkInTime && !v.checkOutTime) {
      ctx.addIssue({
        code: "custom",
        path: ["checkInTime"],
        message: "정정할 출근 또는 퇴근 시각을 입력하세요.",
      });
    }
    if (v.checkInTime && v.checkOutTime && v.checkOutTime <= v.checkInTime) {
      ctx.addIssue({
        code: "custom",
        path: ["checkOutTime"],
        message: "퇴근 시각은 출근 시각보다 뒤여야 합니다.",
      });
    }
  });

export async function createCorrectionRequest(
  input: unknown,
): Promise<AttendanceActionResult> {
  const me = await requireSessionEmployee();
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("attendance_correction_requests")
    .insert({
      employee_id: me.id,
      target_date: v.targetDate,
      requested_check_in: v.checkInTime
        ? seoulToDate(v.targetDate, v.checkInTime).toISOString()
        : null,
      requested_check_out: v.checkOutTime
        ? seoulToDate(v.targetDate, v.checkOutTime).toISOString()
        : null,
      reason: v.reason,
      status: "pending",
    });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/attendance");
  revalidatePath("/attendance/approvals");
  return { ok: true };
}

// ---------------------------------------------------------------------
// 승인 / 반려 (스펙 3.6)
// 승인은 잔여 차감·보상휴가 가산이 얽혀 있어 DB 함수로 원자 처리한다.
// ---------------------------------------------------------------------

const RPC_BY_KIND = {
  leave: "approve_leave_request",
  overtime: "approve_overtime_request",
  correction: "approve_correction_request",
} as const;

const TABLE_BY_KIND = {
  leave: "leave_requests",
  overtime: "overtime_requests",
  correction: "attendance_correction_requests",
} as const;

export async function approveRequest(
  kind: keyof typeof RPC_BY_KIND,
  requestId: string,
): Promise<AttendanceActionResult> {
  await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { error } = await supabase.rpc(RPC_BY_KIND[kind], {
    request_id: requestId,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/attendance");
  revalidatePath("/attendance/approvals");
  revalidatePath("/calendar");
  return { ok: true };
}

export async function rejectRequest(
  kind: keyof typeof TABLE_BY_KIND,
  requestId: string,
  rejectionReason: string,
): Promise<AttendanceActionResult> {
  const me = await requireSessionEmployee();
  const reason = rejectionReason.trim();
  if (!reason) {
    return { ok: false, fieldErrors: { rejectionReason: "반려 사유는 필수입니다." } };
  }

  const supabase = createServerSupabase();
  const patch: Record<string, unknown> = {
    status: "rejected",
    approver_id: me.id,
    rejection_reason: reason,
  };
  if (kind === "correction") patch.processed_at = new Date().toISOString();
  else patch.approved_at = null;

  const { error, count } = await supabase
    .from(TABLE_BY_KIND[kind])
    .update(patch, { count: "exact" })
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return { ok: false, message: "이미 처리되었거나 권한이 없습니다." };
  }

  revalidatePath("/attendance");
  revalidatePath("/attendance/approvals");
  return { ok: true };
}

/** 신청 취소 — 승인된 연차를 취소하면 차감분이 복구된다 */
export async function cancelLeaveRequest(
  requestId: string,
): Promise<AttendanceActionResult> {
  await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { error } = await supabase.rpc("cancel_leave_request", {
    request_id: requestId,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/attendance");
  revalidatePath("/calendar");
  return { ok: true };
}

// ---------------------------------------------------------------------
// 관리자 (스펙 3.7)
// ---------------------------------------------------------------------

export async function adjustLeaveBalance(
  employeeId: string,
  days: number,
  reason: string,
): Promise<AttendanceActionResult> {
  const me = await requireSystemAdmin();
  if (!Number.isFinite(days) || days === 0) {
    return { ok: false, fieldErrors: { days: "0이 아닌 일수를 입력하세요." } };
  }
  if (!reason.trim()) {
    return { ok: false, fieldErrors: { reason: "조정 사유는 필수입니다." } };
  }

  const supabase = createServerSupabase();
  const { error } = await supabase.rpc("adjust_leave_balance", {
    target_employee_id: employeeId,
    delta_days: days,
    adjust_reason: reason.trim(),
  });
  if (error) return { ok: false, message: error.message };

  await writeAuditLog({
    actorId: me.id,
    action: "employee_updated",
    targetId: employeeId,
    detail: { leave_adjustment_days: days, reason: reason.trim() },
  });

  revalidatePath("/admin/attendance");
  revalidatePath("/attendance");
  return { ok: true };
}

const manualEditSchema = z
  .object({
    employeeId: z.string().min(1),
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checkInTime: z.string().optional(),
    checkOutTime: z.string().optional(),
    reason: z.string().trim().min(1, "수정 사유는 필수입니다."),
  })
  .superRefine((v, ctx) => {
    if (v.checkInTime && v.checkOutTime && v.checkOutTime <= v.checkInTime) {
      ctx.addIssue({
        code: "custom",
        path: ["checkOutTime"],
        message: "퇴근 시각은 출근 시각보다 뒤여야 합니다.",
      });
    }
  });

/** 관리자 수동 조정 — 사유 필수 + 감사 로그 (스펙 3.7) */
export async function adjustAttendanceRecord(
  input: unknown,
): Promise<AttendanceActionResult> {
  const me = await requireSystemAdmin();
  const parsed = manualEditSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const admin = createAdminSupabase();
  const { data: before } = await admin
    .from("attendance_records")
    .select("check_in_at, check_out_at")
    .eq("employee_id", v.employeeId)
    .eq("work_date", v.workDate)
    .maybeSingle<{ check_in_at: string | null; check_out_at: string | null }>();

  const { error } = await admin.from("attendance_records").upsert(
    {
      employee_id: v.employeeId,
      work_date: v.workDate,
      check_in_at: v.checkInTime
        ? seoulToDate(v.workDate, v.checkInTime).toISOString()
        : null,
      check_out_at: v.checkOutTime
        ? seoulToDate(v.workDate, v.checkOutTime).toISOString()
        : null,
      manual_adjustment_reason: v.reason,
    },
    { onConflict: "employee_id,work_date" },
  );

  if (error) return { ok: false, message: error.message };

  await writeAuditLog({
    actorId: me.id,
    action: "employee_updated",
    targetId: v.employeeId,
    detail: {
      attendance_manual_edit: v.workDate,
      before,
      after: { check_in: v.checkInTime, check_out: v.checkOutTime },
      reason: v.reason,
    },
  });

  revalidatePath("/admin/attendance");
  return { ok: true };
}

/** 보상휴가 가산율 설정 (스펙 3.7) */
export async function setCompensatoryRate(
  rate: number,
): Promise<AttendanceActionResult> {
  await requireSystemAdmin();
  if (!Number.isFinite(rate) || rate <= 0 || rate > 5) {
    return { ok: false, fieldErrors: { rate: "0보다 크고 5 이하로 입력하세요." } };
  }

  const supabase = createServerSupabase();
  const { data: existing } = await supabase
    .from("compensatory_leave_settings")
    .select("id")
    .is("group_scope", null)
    .maybeSingle<{ id: string }>();

  const { error } = existing
    ? await supabase
        .from("compensatory_leave_settings")
        .update({ rate, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
    : await supabase
        .from("compensatory_leave_settings")
        .insert({ group_scope: null, rate });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/attendance");
  return { ok: true };
}
