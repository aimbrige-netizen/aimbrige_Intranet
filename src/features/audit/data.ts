import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { addDaysYmd } from "@/features/calendar/date";
import type { AuditLog } from "@/types/db";

/** 한 페이지에 담는 기록 수 (스펙 3.6) */
export const AUDIT_PAGE_SIZE = 50;

/**
 * list_audit_logs가 함수 안에서 거는 행 상한.
 * 더 큰 값을 넘겨도 잘리므로 내보내기 상한을 여기에 맞춰 잘라 둔다.
 */
const RPC_MAX_ROWS = 200;

/**
 * 화면이 쓰는 한 행.
 *
 * 목록은 두 경로로 온다 — 필터만 걸었을 때는 audit_logs 직접 조회(임베드
 * actor:employees), 행위자 이름으로 찾을 때는 list_audit_logs RPC(평평한
 * actor_name). 반환 모양이 다르니 여기서 한 번만 맞춘다. 표와 CSV가 같은
 * 필드를 읽는다.
 */
export interface AuditLogRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetId: string | null;
  detail: AuditLog["detail"];
  createdAt: string;
}

export interface AuditListParams {
  /** 'yyyy-MM-dd', 양끝 포함 */
  from: string;
  to: string;
  /** 행위자 이름·이메일·액션 키워드. 비어 있으면 필터 조회 */
  q: string;
  /** 정밀 액션 하나 */
  action: string;
  /** 그룹이 고른 액션 집합. 정밀 액션이 있으면 그쪽이 이긴다 */
  actions: string[] | null;
  /** 대상(target_id)으로 좁히기 */
  target: string;
  sortKey: "created_at" | "action";
  ascending: boolean;
  limit: number;
  offset: number;
}

export interface AuditListResult {
  rows: AuditLogRow[];
  /** 조건 전체 건수 — 페이지네이터의 분모 */
  total: number;
  /**
   * 실패했을 때만 채워진다. 화면은 "0건"과 "못 불러왔다"를 반드시
   * 다르게 말해야 한다 — 감사 화면에서 조용히 빈 표는 "기록이 없다"로 읽힌다.
   */
  errorMessage: string | null;
}

/** 서울 자정 경계. 구간은 [from 00:00, to+1일 00:00) 으로 잡는다 */
function dayStart(ymd: string): string {
  return `${ymd}T00:00:00+09:00`;
}

// FK를 명시한다(employees!actor_id). audit_logs → employees FK는 지금
// actor_id 하나뿐이라 생략해도 붙지만, target_id에 FK가 생기는 순간
// PostgREST가 PGRST201(관계가 둘 이상)로 실패한다 — 감사 로그 화면과
// /admin 활동 위젯이 같이 죽는다.
const LOG_SELECT = `id, action, target_id, detail, created_at, actor_id,
       actor:employees!actor_id(id, name, email)`;

interface EmbeddedRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_id: string | null;
  detail: AuditLog["detail"];
  created_at: string;
  actor: { id: string; name: string; email: string } | null;
}

interface RpcRow {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  target_id: string | null;
  detail: AuditLog["detail"];
  created_at: string;
  total_count: number | string;
}

/**
 * 감사 로그 목록.
 *
 * 키워드가 있으면 list_audit_logs RPC로 간다 — audit_logs에는 actor_id만
 * 있어서 PostgREST의 or(ilike)로는 이름을 걸 수 없다. 그 함수는 액션을
 * 하나(p_action)까지만 받고 정렬이 최신순으로 고정돼 있으므로, 호출하는
 * 쪽에서 검색 중에는 그룹·대상·정렬을 걸지 않는다(page.tsx가 URL에서 떨군다).
 */
export async function listAuditLogs(
  params: AuditListParams,
): Promise<AuditListResult> {
  return params.q ? searchAuditLogs(params) : filterAuditLogs(params);
}

async function searchAuditLogs(
  params: AuditListParams,
): Promise<AuditListResult> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase.rpc("list_audit_logs", {
    p_from: dayStart(params.from),
    // 함수는 상한을 미포함으로 본다 (created_at < p_to)
    p_to: dayStart(addDaysYmd(params.to, 1)),
    p_action: params.action || null,
    p_q: params.q,
    p_limit: Math.min(params.limit, RPC_MAX_ROWS),
    p_offset: params.offset,
  });

  if (error) {
    console.error("[audit] 감사 로그 검색 실패:", error.message);
    return { rows: [], total: 0, errorMessage: error.message };
  }

  const rows = (data ?? []) as RpcRow[];

  return {
    rows: rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      actorEmail: row.actor_email,
      action: row.action,
      targetId: row.target_id,
      detail: row.detail,
      createdAt: row.created_at,
    })),
    // 모든 행에 같은 값이 실려 온다. 한 번의 호출로 페이지네이션까지 끝난다
    total: Number(rows[0]?.total_count ?? 0),
    errorMessage: null,
  };
}

async function filterAuditLogs(
  params: AuditListParams,
): Promise<AuditListResult> {
  const supabase = createServerSupabase();

  let query = supabase
    .from("audit_logs")
    .select(LOG_SELECT, { count: "exact" })
    .gte("created_at", dayStart(params.from))
    .lt("created_at", dayStart(addDaysYmd(params.to, 1)));

  if (params.target) query = query.eq("target_id", params.target);
  if (params.action) query = query.eq("action", params.action);
  else if (params.actions) query = query.in("action", params.actions);

  // 액션 정렬은 동률이 많다 — 같은 액션 안에서는 최신순으로 고정한다
  const sorted =
    params.sortKey === "created_at"
      ? query.order("created_at", { ascending: params.ascending })
      : query
          .order("action", { ascending: params.ascending })
          .order("created_at", { ascending: false });

  const { data, count, error } = await sorted.range(
    params.offset,
    params.offset + params.limit - 1,
  );

  if (error) {
    console.error("[audit] 감사 로그 조회 실패:", error.message);
    return { rows: [], total: 0, errorMessage: error.message };
  }

  const rows = (data ?? []) as unknown as EmbeddedRow[];

  return {
    rows: rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor?.name ?? null,
      actorEmail: row.actor?.email ?? null,
      action: row.action,
      targetId: row.target_id,
      detail: row.detail,
      createdAt: row.created_at,
    })),
    total: count ?? rows.length,
    errorMessage: null,
  };
}

/**
 * 기간 안의 액션별 건수 — 액션 칩의 분모이자 요약 밴드의 분자.
 * 그룹마다 count 쿼리를 던지던 것을 한 번의 호출로 줄인다.
 * 실패하면 null — 건수를 숨길지언정 틀린 분모를 붙이지 않는다.
 */
export async function getAuditActionCounts(
  from: string,
  to: string,
): Promise<Record<string, number> | null> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase.rpc("audit_action_counts", {
    p_from: dayStart(from),
    p_to: dayStart(addDaysYmd(to, 1)),
  });

  if (error) {
    console.error("[audit] 액션별 건수 조회 실패:", error.message);
    return null;
  }

  const counts: Record<string, number> = {};
  ((data ?? []) as { action: string; count: number | string }[]).forEach(
    (row) => {
      counts[row.action] = Number(row.count);
    },
  );
  return counts;
}
