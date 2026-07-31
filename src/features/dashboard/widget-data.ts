import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import {
  getLeaveSummary,
  getThisWeekHours,
  type LeaveSummary,
  type WeeklyHours,
} from "@/features/attendance/data";
import { getMyPendingApprovals } from "@/features/approvals/data";
import { getUnreadNotices } from "@/features/boards/data";
import { seoulToDate } from "@/features/calendar/date";
import type { Favorite, RoleName, WidgetKey } from "@/types/db";

/**
 * ⚑ 홈 대시보드 조회 계층
 *
 * 예전에는 모든 함수가 `{ connected: false }`를 돌려줄 수 있는 래퍼 타입이었다.
 * 다섯 함수 전부 실제 테이블에 연결된 지금은 화면마다 `x.connected ? x.data : 0`
 * 삼항이 붙어, 값이 있는데도 0으로 떨어지는 경로만 늘렸다. 그래서 래퍼를 걷어냈다.
 *
 * 더 큰 문제는 fetch해 온 값을 버리는 것이었다. getLeaveSummary는 발생·사용·
 * 소진율·다음 발생일을 이미 계산해 돌려주는데 remaining 하나만 남기고 버렸고,
 * 주간 누적(getThisWeekHours)은 아예 호출하지 않았다. 그 결과 홈의 지표 4개가
 * 전부 아래 위젯의 재출력이 됐다. 이제 화면이 쓰는 값을 전부 내보낸다.
 */

/** 요약 밴드의 근무·연차 집계 — 홈과 근태 화면이 같은 계산을 공유한다 */
export interface WorkSnapshot {
  leave: LeaveSummary;
  week: WeeklyHours;
}

export async function getWorkSnapshot(
  employeeId: string,
  hireDate: string | null,
  weekStartYmd?: string,
): Promise<WorkSnapshot> {
  const [leave, week] = await Promise.all([
    getLeaveSummary(employeeId, hireDate),
    getThisWeekHours(employeeId, weekStartYmd),
  ]);
  return { leave, week };
}

export interface PendingApprovalItem {
  id: string;
  title: string;
  requester: string;
  requestedAt: string;
}

export interface ApprovalWorkload {
  /** 지금 내 차례인 문서 (상위 5건) */
  items: PendingApprovalItem[];
  /** 내 차례 총 건수 */
  myTurn: number;
  /** 내가 올렸거나 내가 결재선에 있는 진행중 문서 — "내 차례"의 분모 */
  inProgress: number;
  /** 내 차례 문서 중 가장 오래 기다린 일수 */
  oldestWaitingDays: number | null;
}

/**
 * 결재 업무량.
 *
 * "대기 3건"만으로는 많은 건지 알 수 없다. 진행중 문서 8건 중 3건이 내 차례인지,
 * 3건 중 3건인지에 따라 해야 할 일이 다르다. 그래서 분모를 함께 만든다.
 */
export async function getApprovalWorkload(
  employeeId: string,
): Promise<ApprovalWorkload> {
  const supabase = createServerSupabase();

  const [rows, mine, assigned] = await Promise.all([
    getMyPendingApprovals(employeeId),
    supabase
      .from("approval_documents")
      .select("id")
      .eq("requester_id", employeeId)
      .eq("status", "pending")
      .limit(200),
    supabase
      .from("approval_steps")
      .select("document_id, document:approval_documents!document_id(status)")
      .eq("approver_id", employeeId)
      .eq("status", "pending")
      .limit(200),
  ]);

  // 같은 문서가 "내가 올린 것"이자 "내 결재선"일 수 있어 id로 합집합을 만든다
  const inProgressIds = new Set<string>();
  ((mine.data ?? []) as { id: string }[]).forEach((row) =>
    inProgressIds.add(row.id),
  );
  (
    (assigned.data ?? []) as unknown as {
      document_id: string;
      document: { status: string } | null;
    }[]
  ).forEach((row) => {
    if (row.document?.status === "pending") inProgressIds.add(row.document_id);
  });
  rows.forEach((row) => inProgressIds.add(row.document.id));

  const oldest = rows.reduce<number | null>((acc, row) => {
    const days = Math.floor(
      (Date.now() - new Date(row.document.created_at).getTime()) / 86_400_000,
    );
    return acc === null || days > acc ? days : acc;
  }, null);

  return {
    items: rows.slice(0, 5).map((row) => ({
      id: row.document.id,
      title: row.document.title,
      requester: row.document.requester?.name ?? "-",
      requestedAt: row.document.created_at,
    })),
    myTurn: rows.length,
    inProgress: inProgressIds.size,
    oldestWaitingDays: oldest,
  };
}

export interface NoticeItem {
  id: string;
  /** 글 상세로 딥링크하려면 게시판 id가 필요하다 */
  boardId: string;
  title: string;
  boardName: string;
  createdAt: string;
}

/** 미열람 공지 — 공지 게시판의 최근 글 중 본인이 아직 읽지 않은 것 */
export async function getNotices(employeeId: string): Promise<NoticeItem[]> {
  return getUnreadNotices(employeeId);
}

export interface UpcomingEvent {
  id: string;
  title: string;
  startsAt: string;
  allDay: boolean;
  kind: string;
}

/**
 * 다가오는 일정.
 *
 * 예전에는 now~+7일이 함수 안에 하드코딩돼 있어서, 목록이 몇 일치인지 알 수 있는
 * 곳이 "향후 7일간 일정이 없습니다"라는 빈 상태 문구뿐이었다. 범위를 인자로 받아
 * 카드 헤더에 그대로 적는다.
 */
export async function getCalendarUpcoming(
  fromYmd: string,
  toYmd: string,
  limit = 6,
): Promise<UpcomingEvent[]> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("calendar_events")
    .select("id, title, start_at, all_day, visibility")
    .gte("end_at", seoulToDate(fromYmd).toISOString())
    .lte("start_at", seoulToDate(toYmd, "23:59").toISOString())
    .order("start_at")
    .limit(limit);

  if (error) {
    console.error("[widget] 다가오는 일정 조회 실패:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    startsAt: row.start_at as string,
    allDay: row.all_day as boolean,
    kind: row.visibility as string,
  }));
}

/** 즐겨찾기 */
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
 * 역할별 기본 위젯 순서.
 * 팀장/매니저는 결재 대기가 상단, 일반직원은 주간 근태가 상단.
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
