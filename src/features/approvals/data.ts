import "server-only";

import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { seoulToDate } from "@/features/calendar/date";
import { agingLevel, elapsedDays } from "./format";
import {
  DOCUMENT_STATUS_ORDER,
  DOCUMENT_TYPES,
  type ApprovalDocument,
  type ApprovalDocumentWithRelations,
  type ApprovalLineConfig,
  type ApprovalStep,
  type DocumentStatus,
  type DocumentType,
} from "./types";
import type { Employee } from "@/types/db";

const DOC_SELECT =
  "id, document_type, title, form_data, requester_id, status, current_step, created_at, updated_at";

/** 기안자 표시에 필요한 최소 조인 — 이름만으로는 결재자가 소속을 못 본다 */
const REQUESTER_SELECT =
  "requester:employees!requester_id(id, name, position, department:departments!department_id(id, name))";

export type DocumentRequester = Pick<
  Employee,
  "id" | "name" | "position"
> & { department: { id: string; name: string } | null };

/**
 * 문서 하나의 시각 (approval_document_periods 뷰, 마이그레이션 26).
 *
 * approval_documents에는 이 값이 없다. created_at은 '임시저장을 만든 시각'이고
 * updated_at은 트리거가 모든 UPDATE마다 미는 값이라 둘 다 결재 시각이 아니다.
 */
export interface DocumentPeriod {
  /** 상신 시각 = min(approval_steps.created_at). 아직 상신 전이면 null */
  submitted_at: string | null;
  /** 결재가 끝난 시각 = max(processed_at) filter (approved|rejected) */
  decided_at: string | null;
  /** 상신 시각, 아직이면 생성 시각 — 기간 필터의 기준 */
  effective_at: string;
}

export interface DocumentListRow extends ApprovalDocument {
  requester: DocumentRequester | null;
  /** 결재 단계 수 — 목록의 진행 표기가 실제 결재선과 어긋나지 않게 함께 가져온다 */
  steps: { step_order: number }[];
  /**
   * 상신·결재 시각. 뷰를 못 읽었으면(마이그레이션 26 미적용) 전 행이 null이고
   * 목록 자체도 옛 기준으로 잘린다(MyDocumentList.basis) — 그때 화면은 시각을
   * 지어내지 말고 그 줄을 접어야 한다.
   */
  period: DocumentPeriod | null;
}

/** 조회 기간 — 'YYYY-MM-DD' 두 개. 없으면 전체 */
export interface PeriodRange {
  from?: string;
  to?: string;
}

/** 서울 자정 기준으로 [from, to] 를 timestamptz 경계로 바꾼다 */
function applyPeriod<T extends { gte: unknown; lt: unknown }>(
  query: T,
  period: PeriodRange,
  column = "created_at",
): T {
  let next = query as unknown as {
    gte: (c: string, v: string) => typeof next;
    lt: (c: string, v: string) => typeof next;
  };
  if (period.from) {
    next = next.gte(column, seoulToDate(period.from).toISOString());
  }
  if (period.to) {
    // 종료일 당일을 포함해야 하므로 다음날 자정 미만으로 자른다
    const [y, m, d] = period.to.split("-").map(Number);
    const exclusiveEnd = new Date(Date.UTC(y, m - 1, d + 1));
    next = next.lt(
      column,
      seoulToDate(exclusiveEnd.toISOString().slice(0, 10)).toISOString(),
    );
  }
  return next as unknown as T;
}

interface PeriodViewRow {
  document_id: string;
  submitted_at: string | null;
  decided_at: string | null;
  effective_at: string;
}

type ListScope =
  /** 뷰가 목록에 나올 문서를 순서까지 확정했다 */
  | { mode: "ids"; ids: string[]; times: Map<string, DocumentPeriod> }
  /** 뷰를 못 읽었다 — 예전 기준(created_at)으로라도 자른다 */
  | { mode: "fallback" };

/** 목록이 어느 시각을 기준으로 잘렸는지 — 화면이 기준을 말할 때 쓴다 */
export type ListBasis = "submitted" | "created";

export interface MyDocumentList {
  rows: DocumentListRow[];
  /**
   * "submitted"면 요약 밴드와 같은 기준(상신 시각), "created"면 뷰를 못 읽어
   * 예전 기준(문서 생성 시각)으로 자른 목록이다. 화면은 이때 기준이 다르다는
   * 사실을 말해야 한다 — 요약 밴드는 RPC가 따로 성공할 수 있어서 아무 경고도
   * 띄우지 않는다(두 조회는 서로 독립적으로 실패한다).
   */
  basis: ListBasis;
}

/**
 * 목록에 나올 문서를 뷰에서 먼저 확정한다.
 *
 * 기준 시각(상신 시각, 아직이면 생성 시각)은 문서 테이블에 컬럼이 없다 —
 * 문서당 min(steps.created_at) 집계라서 PostgREST의 .gte/.lt/.order로는
 * 표현할 수 없다(임베드한 자식 테이블의 집계로 부모를 자르거나 정렬하는
 * 문법이 없다). 그래서 뷰에서 id를 뽑고 목록 질의는 본문만 채운다.
 *
 * 기간뿐 아니라 상태·검색까지 **여기서** 건다. 뷰가 기간만 걸러 상위 200건을
 * 넘기고 상태·검색을 목록 질의가 다시 얹으면, 필터가 '기간 전체'가 아니라
 * '기간 상위 200건'을 대상으로 돈다 — 필터칩 건수(my_approval_activity는
 * 기간 전체를 센다)와 표의 행 수가 모집단부터 어긋난다.
 * 정렬도 여기서 확정한다. 반환 순서가 곧 표의 순서다.
 *
 * 한도(기본 200)는 목록 한도와 같다. .in() 목록은 uuid당 37자
 * (postgrest-js는 예약문자가 없는 값을 따옴표로 감싸지 않는다)라 200건이면
 * 질의 문자열이 7.5KB쯤 된다 — 흔한 8KB 요청줄 한계 안이지만 여유가 크지
 * 않다. 한도를 더 키우려면 목록을 페이지로 끊어야 한다.
 */
async function scopeDocuments(
  supabase: ReturnType<typeof createServerSupabase>,
  employeeId: string,
  options: PeriodRange & { status?: string; q?: string },
  limit: number,
): Promise<ListScope> {
  let query = supabase
    .from("approval_document_periods")
    .select("document_id, submitted_at, decided_at, effective_at")
    .eq("requester_id", employeeId)
    .order("effective_at", { ascending: false })
    .limit(limit);
  query = applyPeriod(query, options, "effective_at");
  if (options.status) query = query.eq("status", options.status);
  if (options.q) query = query.ilike("title", `%${options.q}%`);

  const { data, error } = await query;
  if (error) {
    // 뷰가 아직 없을 수 있다(마이그레이션 26 미적용). 목록을 통째로 비우는 것보다
    // 예전 기준으로라도 자르는 편이 낫다 — 대신 기준이 다르다고 화면에 밝힌다.
    console.error("[approvals] 목록 기준 조회 실패:", error.message);
    return { mode: "fallback" };
  }

  const rows = (data ?? []) as PeriodViewRow[];
  const times = new Map<string, DocumentPeriod>(
    rows.map((row) => [
      row.document_id,
      {
        submitted_at: row.submitted_at,
        decided_at: row.decided_at,
        effective_at: row.effective_at,
      },
    ]),
  );

  return { mode: "ids", ids: rows.map((row) => row.document_id), times };
}

/** 내가 올린 문서 (스펙 3.1) */
export async function getMyDocuments(
  employeeId: string,
  options: PeriodRange & { status?: string; q?: string; limit?: number } = {},
): Promise<MyDocumentList> {
  const supabase = createServerSupabase();
  const limit = options.limit ?? 200;
  const scope = await scopeDocuments(supabase, employeeId, options, limit);

  let query = supabase
    .from("approval_documents")
    .select(
      `${DOC_SELECT}, ${REQUESTER_SELECT}, steps:approval_steps(step_order)`,
    )
    .eq("requester_id", employeeId)
    .limit(limit);

  if (scope.mode === "ids") {
    // 조건에 걸리는 문서가 없으면 질의할 것도 없다 (빈 in 목록은 보내지 않는다)
    if (scope.ids.length === 0) return { rows: [], basis: "submitted" };
    query = query.in("id", scope.ids);
  } else {
    // 뷰 없이 도는 경로 — 기간·상태·검색·정렬을 전부 옛 기준으로 건다
    query = applyPeriod(query, options).order("created_at", {
      ascending: false,
    });
    if (options.status) query = query.eq("status", options.status);
    if (options.q) query = query.ilike("title", `%${options.q}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[approvals] 내 문서 조회 실패:", error.message);
    return { rows: [], basis: scope.mode === "ids" ? "submitted" : "created" };
  }

  const rows = (data ?? []).map((row) => row as unknown as DocumentListRow);

  if (scope.mode === "fallback") {
    for (const doc of rows) doc.period = null;
    return { rows, basis: "created" };
  }

  /*
   * 표에 찍히는 '기안일'은 effective_at인데 .in()은 순서를 보장하지 않고,
   * 문서 테이블은 effective_at으로 정렬할 수도 없다. 뷰가 확정한 순서를
   * 그대로 쓴다 — 정렬 키와 사용자가 읽는 열이 같은 값이어야 한다.
   */
  const byId = new Map(rows.map((doc) => [doc.id, doc]));
  const ordered: DocumentListRow[] = [];
  for (const id of scope.ids) {
    const doc = byId.get(id);
    // 뷰에는 보이는데 목록 질의에서 빠진 문서(권한·경합)는 조용히 건너뛴다
    if (!doc) continue;
    doc.period = scope.times.get(id) ?? null;
    ordered.push(doc);
  }
  return { rows: ordered, basis: "submitted" };
}

export interface DocumentStats {
  /** 기간 안 내 문서 총 건수 — 기준은 상신 시각(임시저장은 생성 시각) */
  total: number;
  /** 상태별 건수 — 0건인 상태도 키가 있다 */
  byStatus: Record<DocumentStatus, number>;
  /** 유형별 건수 */
  byType: Record<DocumentType, number>;
  /**
   * 상신 → 마지막 승인·반려까지의 평균 소요일 (없으면 null).
   * 시행완료(complete_approval_document)까지가 아니다.
   */
  avgDecisionDays: number | null;
  /**
   * 이 기간에 결재(승인·반려)가 끝난 문서 수. 상신 건수와 분모가 다르다 —
   * 지난달에 올린 문서가 이번 달에 결재되면 여기 들어온다.
   */
  decidedCount: number;
  /** 지금 진행중인 내 문서 수 — 기간과 무관한 '지금' 값 */
  pendingNow: number;
  /** 그중 가장 오래 기다린 문서의 상신 후 경과일. 마찬가지로 '지금' 값 */
  oldestPendingDays: number;
  /** 직전 동일 길이 기간의 총 건수 — 증감 비교용 */
  previousTotal: number;
  /**
   * 집계를 불러오지 못했다. 0건과 구분하지 않으면 화면이 "이 기간 0건"을
   * 사실로 그리고, 사용자는 그 0을 믿는다 (features/admin/data.ts와 같은 태도).
   */
  unavailable: boolean;
}

const EMPTY_STATUS: Record<DocumentStatus, number> = {
  draft: 0,
  pending: 0,
  approved: 0,
  completed: 0,
  rejected: 0,
};

/** numeric·bigint는 드라이버에 따라 문자열로 온다 — 화면에 넣기 전에 맞춘다 */
function num(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

/**
 * jsonb 카운트를 고정 키 레코드로 옮긴다.
 * my_approval_activity()가 0건인 키까지 채워 주지만, 상태·유형이 늘었는데
 * 함수 쪽 목록만 안 고친 날에도 화면이 undefined를 그리지 않도록 여기서 연다.
 */
function countsOf<K extends string>(
  keys: readonly K[],
  raw: Record<string, number | string> | null | undefined,
): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const key of keys) {
    const value = raw?.[key];
    if (value !== undefined && value !== null) out[key] = num(value);
  }
  return out;
}

interface MyApprovalActivityRow {
  decided_count: number | string;
  avg_decision_days: number | string | null;
  pending_count: number | string;
  oldest_pending_days: number | string;
  total_count: number | string;
  by_status: Record<string, number | string> | null;
  by_type: Record<string, number | string> | null;
}

async function callMyApprovalActivity(
  supabase: ReturnType<typeof createServerSupabase>,
  employeeId: string,
  period: PeriodRange,
): Promise<MyApprovalActivityRow | null> {
  // from/to가 없는 '전체 기간'은 null로 넘긴다 — 함수가 무한대 경계로 연다
  const { data, error } = await supabase.rpc("my_approval_activity", {
    p_from: period.from ?? null,
    p_to: period.to ?? null,
    p_employee_id: employeeId,
  });

  if (error) {
    console.error("[approvals] 결재 통계 조회 실패:", error.message);
    return null;
  }
  return ((data ?? []) as MyApprovalActivityRow[])[0] ?? null;
}

/**
 * 요약 밴드용 집계 (마이그레이션 26).
 *
 * 계산은 전부 my_approval_activity()가 한다. 여기서 다시 세지 않는 이유:
 * 시각의 정의(상신 = min(steps.created_at), 결재 = max(processed_at))는
 * 문서당 집계라 PostgREST 필터로 표현할 수 없고, TS로 접으면 관리자 대시보드와
 * 같은 정의가 두 벌이 된다 — 그게 두 화면이 다른 숫자를 내던 원인이다.
 * 앞 일곱 칸은 approval_activity()(전사)와 글자 그대로 같은 본문에서 나온다.
 */
export async function getMyDocumentStats(
  employeeId: string,
  period: PeriodRange = {},
  previous: PeriodRange = {},
): Promise<DocumentStats> {
  const supabase = createServerSupabase();

  const [row, prevRow] = await Promise.all([
    callMyApprovalActivity(supabase, employeeId, period),
    previous.from || previous.to
      ? callMyApprovalActivity(supabase, employeeId, previous)
      : Promise.resolve(null),
  ]);

  if (!row) {
    return {
      total: 0,
      byStatus: { ...EMPTY_STATUS },
      byType: countsOf(DOCUMENT_TYPES, null),
      avgDecisionDays: null,
      decidedCount: 0,
      pendingNow: 0,
      oldestPendingDays: 0,
      previousTotal: 0,
      unavailable: true,
    };
  }

  return {
    total: num(row.total_count),
    byStatus: countsOf(DOCUMENT_STATUS_ORDER, row.by_status),
    byType: countsOf(DOCUMENT_TYPES, row.by_type),
    // null은 "결재가 끝난 문서가 없음"이다 — num()에 넣으면 0.0일로 둔갑한다
    avgDecisionDays:
      row.avg_decision_days === null ? null : num(row.avg_decision_days),
    decidedCount: num(row.decided_count),
    pendingNow: num(row.pending_count),
    oldestPendingDays: num(row.oldest_pending_days),
    // 직전 기간 집계만 실패하면 0이 되고, 화면은 그때 증감 칩을 그리지 않는다
    previousTotal: prevRow ? num(prevRow.total_count) : 0,
    unavailable: false,
  };
}

export interface PendingApprovalRow {
  document: ApprovalDocument & {
    requester: DocumentRequester | null;
  };
  stepOrder: number;
  /** 문서의 전체 결재 단계 수 — "2단계 중 1단계"를 찍으려면 필요하다 */
  totalSteps: number;
  /**
   * 결재선에 이 문서가 올라온 시각 = 내 단계 행의 created_at.
   * 결재선은 상신할 때 한 번에 만들어지므로(submit_approval_draft) 곧 상신 시각이다.
   * documents.created_at은 '임시저장을 만든 시각'이라 결재자의 대기와 무관하다.
   */
  arrivedAt: string;
  /** 상신 후 경과일 (서버 기준). 클라이언트 재계산으로 어긋나지 않게 값으로 넘긴다 */
  waitingDays: number;
}

/**
 * 내가 승인할 문서 (스펙 3.1)
 * 내가 담당자인 pending 단계 중, 문서의 current_step과 일치하는 것만 = 지금 내 차례.
 *
 * 정렬은 오래된 것 먼저 — 방치된 문서가 목록 아래로 밀려나면 안 된다.
 *
 * 대기 경과는 단계 행의 created_at으로 잰다. getMyApprovalWorkload()의
 * '도착 → 처리' 평균도 같은 값을 쓰므로 결재함의 두 숫자가 같은 축에 놓인다.
 * 문서의 created_at으로 재면 6월에 임시저장했다가 7월에 올린 문서가 결재자에게
 * 도착한 날과 무관하게 41일 대기로 잡혀 빨간 칸을 차지한다.
 *
 * 같은 요청 안에서 모듈 패널 위젯과 본문이 함께 부르므로 react cache로 묶는다.
 */
export const getMyPendingApprovals = cache(async function getMyPendingApprovals(
  employeeId: string,
): Promise<PendingApprovalRow[]> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("approval_steps")
    .select(
      `step_order, status, created_at,
       document:approval_documents!document_id(
         ${DOC_SELECT},
         ${REQUESTER_SELECT},
         steps:approval_steps(step_order)
       )`,
    )
    .eq("approver_id", employeeId)
    .eq("status", "pending")
    .limit(200);

  if (error) {
    console.error("[approvals] 승인 대기 조회 실패:", error.message);
    return [];
  }

  const now = Date.now();

  return (data ?? [])
    .map((row) => {
      const r = row as unknown as {
        step_order: number;
        created_at: string;
        document:
          | (PendingApprovalRow["document"] & {
              steps?: { step_order: number }[];
            })
          | null;
      };
      if (!r.document) return null;
      const { steps, ...document } = r.document;
      return {
        document,
        stepOrder: r.step_order,
        // 단계 조회가 권한으로 비면 최소한 내 단계까지는 그린다
        totalSteps: Math.max(steps?.length ?? 0, r.step_order),
        arrivedAt: r.created_at,
        waitingDays: elapsedDays(r.created_at, now),
      } satisfies PendingApprovalRow;
    })
    .filter((row): row is PendingApprovalRow => {
      if (!row) return false;
      // 문서가 진행중이고 지금 단계가 내 단계일 때만 "내 차례"
      return (
        row.document.status === "pending" &&
        row.document.current_step === row.stepOrder
      );
    })
    .sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt));
});

/** 내가 올린 문서 중 아직 진행중인 건수 — 모듈 패널 위젯용 */
export async function countMyPendingDocuments(
  employeeId: string,
): Promise<number> {
  const supabase = createServerSupabase();
  const { count, error } = await supabase
    .from("approval_documents")
    .select("id", { count: "exact", head: true })
    .eq("requester_id", employeeId)
    .eq("status", "pending");

  if (error) {
    console.error("[approvals] 진행중 문서 집계 실패:", error.message);
    return 0;
  }
  return count ?? 0;
}

export interface ApprovalWorkload {
  /** 기간 내 내가 처리한 건수 */
  processed: number;
  approved: number;
  rejected: number;
  /** 도착 → 처리까지 평균 소요일 */
  avgResponseDays: number | null;
}

/**
 * 결재자 관점 집계 — "내가 이번 기간에 몇 건을 얼마나 빨리 처리했나".
 * 대기 건수만으로는 분모가 없어서 밀렸는지 아닌지 판단할 수 없다.
 */
export async function getMyApprovalWorkload(
  employeeId: string,
  period: PeriodRange = {},
): Promise<ApprovalWorkload> {
  const supabase = createServerSupabase();

  let query = supabase
    .from("approval_steps")
    .select("status, created_at, processed_at")
    .eq("approver_id", employeeId)
    .in("status", ["approved", "rejected"])
    .limit(1000);
  query = applyPeriod(query, period, "processed_at");

  const { data, error } = await query;
  if (error) {
    console.error("[approvals] 처리 이력 집계 실패:", error.message);
    return { processed: 0, approved: 0, rejected: 0, avgResponseDays: null };
  }

  const rows = (data ?? []) as {
    status: "approved" | "rejected";
    created_at: string;
    processed_at: string | null;
  }[];

  let sum = 0;
  let counted = 0;
  let approved = 0;

  for (const row of rows) {
    if (row.status === "approved") approved += 1;
    if (!row.processed_at) continue;
    const days =
      (new Date(row.processed_at).getTime() -
        new Date(row.created_at).getTime()) /
      86_400_000;
    if (Number.isFinite(days) && days >= 0) {
      sum += days;
      counted += 1;
    }
  }

  return {
    processed: rows.length,
    approved,
    rejected: rows.length - approved,
    avgResponseDays: counted > 0 ? Math.round((sum / counted) * 10) / 10 : null,
  };
}

/** 대기 문서의 경과 분포 — 0~2일 / 3~6일 / 7일 이상 */
export function bucketByAging(rows: PendingApprovalRow[]) {
  const buckets = { fresh: 0, aging: 0, late: 0 };
  for (const row of rows) buckets[agingLevel(row.waitingDays)] += 1;
  return buckets;
}

/**
 * 유형별 내 사용 이력 — 기안 유형 선택 카드의 부가정보.
 * "이 유형으로 몇 건 올렸고 마지막이 언제였는지"가 있으면 카드가
 * 길이만 다른 설명 문단이 아니라 선택 근거가 된다.
 */
export async function getMyTypeUsage(
  employeeId: string,
): Promise<Record<DocumentType, { count: number; lastUsed: string | null }>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("approval_documents")
    .select("document_type, created_at")
    .eq("requester_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(500);

  const usage = Object.fromEntries(
    DOCUMENT_TYPES.map((t) => [t, { count: 0, lastUsed: null }]),
  ) as Record<DocumentType, { count: number; lastUsed: string | null }>;

  if (error) {
    console.error("[approvals] 유형별 사용 이력 조회 실패:", error.message);
    return usage;
  }

  for (const row of (data ?? []) as {
    document_type: DocumentType;
    created_at: string;
  }[]) {
    const entry = usage[row.document_type];
    if (!entry) continue;
    entry.count += 1;
    if (!entry.lastUsed) entry.lastUsed = row.created_at;
  }
  return usage;
}

/** 홈 위젯 "결재 대기" 건수 (스펙 7장) */
export async function countMyPendingApprovals(
  employeeId: string,
): Promise<number> {
  const rows = await getMyPendingApprovals(employeeId);
  return rows.length;
}

/** 문서 상세 (스펙 3.4) */
export async function getApprovalDocument(
  id: string,
): Promise<ApprovalDocumentWithRelations | null> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("approval_documents")
    .select(
      `${DOC_SELECT},
       requester:employees!requester_id(
         id, name, position,
         department:departments!department_id(id, name),
         team:teams!team_id(id, name)
       ),
       steps:approval_steps(
         id, document_id, step_order, approver_id, status, comment,
         processed_at, created_at,
         approver:employees!approver_id(id, name, position)
       ),
       attachments:approval_attachments(
         id, document_id, file_url, file_name, file_size, uploaded_at
       )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[approvals] 문서 조회 실패:", error.message);
    return null;
  }
  if (!data) return null;

  const doc = data as unknown as ApprovalDocumentWithRelations;
  // 단계는 순서대로 보여야 한다
  doc.steps = [...(doc.steps ?? [])].sort((a, b) => a.step_order - b.step_order);
  return doc;
}

/** 결재라인 설정 (스펙 3.5) */
export async function getApprovalLineConfigs(): Promise<
  (ApprovalLineConfig & {
    approver: Pick<Employee, "id" | "name" | "position"> | null;
  })[]
> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("approval_line_configs")
    .select(
      `id, document_type, step2_approver_id, use_team_review, updated_at,
       approver:employees!step2_approver_id(id, name, position)`,
    )
    .order("document_type");

  if (error) {
    console.error("[approvals] 결재라인 조회 실패:", error.message);
    return [];
  }
  return (data ?? []) as never;
}

/** 기안 화면에서 보여줄 결재라인 미리보기 (스펙 3.3 공통) */
export async function getLinePreview(
  employeeId: string,
  documentType: DocumentType,
): Promise<{
  step1: { name: string; position: string | null } | null;
  step2: { name: string; position: string | null } | null;
  blocked: boolean;
}> {
  const supabase = createServerSupabase();

  const [{ data: me }, { data: config }] = await Promise.all([
    supabase
      .from("employees")
      .select(
        `id,
         team:teams!team_id(id, name, manager_id),
         department:departments!department_id(id, name, manager_id)`,
      )
      .eq("id", employeeId)
      .maybeSingle(),
    supabase
      .from("approval_line_configs")
      .select(
        "step2_approver_id, approver:employees!step2_approver_id(id, name, position)",
      )
      .eq("document_type", documentType)
      .maybeSingle(),
  ]);

  const meRow = me as unknown as {
    team: { manager_id: string | null } | null;
    department: { manager_id: string | null } | null;
  } | null;

  const step1Id =
    meRow?.team?.manager_id ?? meRow?.department?.manager_id ?? null;

  let step1: { name: string; position: string | null } | null = null;
  // 기안자 자신이 팀장이면 1차 검토를 건너뛴다(제출 함수와 동일한 규칙)
  if (step1Id && step1Id !== employeeId) {
    const { data: manager } = await supabase
      .from("employees")
      .select("name, position")
      .eq("id", step1Id)
      .maybeSingle<{ name: string; position: string | null }>();
    step1 = manager ?? null;
  }

  const configRow = config as unknown as {
    step2_approver_id: string | null;
    approver: { name: string; position: string | null } | null;
  } | null;

  return {
    step1,
    step2: configRow?.approver ?? null,
    blocked: !configRow?.step2_approver_id,
  };
}

// 캘린더 표시용 출장·재택 조회는 src/features/calendar/data.ts의
// getApprovalItems()가 list_calendar_approvals() RPC로 처리한다.
// (문서 RLS로는 동료 문서가 안 보여서 definer 함수를 거쳐야 한다)

export type { ApprovalStep };
