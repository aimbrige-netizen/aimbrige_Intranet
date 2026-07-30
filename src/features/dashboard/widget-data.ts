import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import {
  getLeaveSummary,
  getTodayAttendance,
} from "@/features/attendance/data";
import { getMyPendingApprovals } from "@/features/approvals/data";
import { getUnreadNotices } from "@/features/boards/data";
import type {
  AttendanceRecord,
  Favorite,
  RoleName,
  WidgetKey,
} from "@/types/db";

/**
 * ⚑ 위젯 데이터 fetch 레이어 (스펙 01 · 3.2)
 *
 * 스펙 요구사항: "각 위젯 컴포넌트는 데이터 fetch 함수를 별도로 분리해서,
 * 나중에 실제 테이블이 생기면 이 함수 내부만 교체하면 되도록 구조화(UI 재작업 없이)"
 *
 * 지금은 대상 테이블이 없으므로 { connected: false }를 돌려주고 위젯은 빈 상태를 그린다.
 * 각 모듈 스펙 작업 시 아래 함수 본문만 실제 쿼리로 바꾸면 UI는 그대로 동작한다.
 */

export type WidgetData<T> =
  | { connected: false; pendingSpec: string }
  | { connected: true; data: T };

/**
 * 결재 대기 — 스펙 04에서 실제 연동 완료 (스펙 04 · 7장)
 * 본인이 현재 단계 담당자인 문서만.
 */
export async function getApprovalPending(employeeId: string): Promise<
  WidgetData<
    { id: string; title: string; requester: string; requestedAt: string }[]
  >
> {
  const rows = await getMyPendingApprovals(employeeId);
  return {
    connected: true,
    data: rows.slice(0, 5).map((row) => ({
      id: row.document.id,
      title: row.document.title,
      requester: row.document.requester?.name ?? "-",
      requestedAt: row.document.created_at,
    })),
  };
}

/**
 * 오늘의 근태 — 스펙 03에서 실제 연동 완료
 * 출퇴근 기록과 잔여 연차를 함께 돌려준다.
 */
export async function getAttendanceToday(
  employeeId: string,
  hireDate: string | null,
): Promise<
  WidgetData<{ record: AttendanceRecord | null; remainingLeave: number }>
> {
  const [record, summary] = await Promise.all([
    getTodayAttendance(employeeId),
    getLeaveSummary(employeeId, hireDate),
  ]);

  return {
    connected: true,
    data: {
      record,
      remainingLeave: Math.round(summary.remaining * 100) / 100,
    },
  };
}

/**
 * 미열람 공지 — 스펙 05에서 실제 연동 완료 (스펙 05 · 7장)
 * 공지 게시판의 최근 글 중 본인이 아직 읽지 않은 것.
 */
export async function getNotices(employeeId: string): Promise<
  WidgetData<{ id: string; title: string; boardName: string; createdAt: string }[]>
> {
  const notices = await getUnreadNotices(employeeId);
  return { connected: true, data: notices };
}

/**
 * 다가오는 일정 — 스펙 02에서 실제 연동 완료 (스펙 02 · 6장)
 * 본인의 향후 7일 일정 상위 5건. RLS가 볼 수 있는 범위를 이미 제한한다.
 */
export async function getCalendarUpcoming(): Promise<
  WidgetData<
    { id: string; title: string; startsAt: string; allDay: boolean; kind: string }[]
  >
> {
  const supabase = createServerSupabase();
  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("calendar_events")
    .select("id, title, start_at, all_day, visibility")
    .gte("end_at", now.toISOString())
    .lte("start_at", weekLater.toISOString())
    .order("start_at")
    .limit(5);

  if (error) {
    console.error("[widget] 다가오는 일정 조회 실패:", error.message);
    return { connected: true, data: [] };
  }

  return {
    connected: true,
    data: (data ?? []).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      startsAt: row.start_at as string,
      allDay: row.all_day as boolean,
      kind: row.visibility as string,
    })),
  };
}

/** 즐겨찾기 — 이번 모듈에서 실제 동작 */
export async function getFavorites(
  employeeId: string,
): Promise<Pick<Favorite, "id" | "label" | "target_path">[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("favorites")
    .select("id, label, target_path")
    .eq("employee_id", employeeId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return data ?? [];
}

/** 위젯 표시 설정 — 행이 없으면 기본값(표시)으로 취급 */
export async function getWidgetSettings(
  employeeId: string,
): Promise<Record<string, boolean>> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("dashboard_widgets")
    .select("widget_key, is_visible")
    .eq("employee_id", employeeId);

  const settings: Record<string, boolean> = {};
  (data ?? []).forEach((row) => {
    settings[row.widget_key] = row.is_visible;
  });
  return settings;
}

/**
 * 역할별 기본 위젯 순서 (스펙 3.2)
 * 팀장/매니저는 결재 대기가 상단, 일반직원은 오늘의 근태가 상단.
 * MVP는 드래그앤드롭 없이 이 고정 순서만 사용한다.
 */
export function defaultWidgetOrder(role: RoleName): WidgetKey[] {
  if (role === "manager" || role === "system_admin") {
    return [
      "approval_pending",
      "attendance_today",
      "notices",
      "calendar_upcoming",
      "favorites",
    ];
  }
  return [
    "attendance_today",
    "approval_pending",
    "notices",
    "calendar_upcoming",
    "favorites",
  ];
}
