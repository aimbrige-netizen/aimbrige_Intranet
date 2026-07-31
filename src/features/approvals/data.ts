import "server-only";

import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { seoulToDate } from "@/features/calendar/date";
import { agingLevel, elapsedDays } from "./format";
import {
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

export interface DocumentListRow extends ApprovalDocument {
  requester: DocumentRequester | null;
  /** 결재 단계 수 — 목록의 진행 표기가 실제 결재선과 어긋나지 않게 함께 가져온다 */
  steps: { step_order: number }[];
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

/** 내가 올린 문서 (스펙 3.1) */
export async function getMyDocuments(
  employeeId: string,
  options: PeriodRange & { status?: string; q?: string; limit?: number } = {},
): Promise<DocumentListRow[]> {
  const supabase = createServerSupabase();
  let query = supabase
    .from("approval_documents")
    .select(
      `${DOC_SELECT}, ${REQUESTER_SELECT}, steps:approval_steps(step_order)`,
    )
    .eq("requester_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 200);

  if (options.status) query = query.eq("status", options.status);
  if (options.q) query = query.ilike("title", `%${options.q}%`);
  query = applyPeriod(query, options);

  const { data, error } = await query;
  if (error) {
    console.error("[approvals] 내 문서 조회 실패:", error.message);
    return [];
  }
  return (data ?? []) as unknown as DocumentListRow[];
}

export interface DocumentStats {
  total: number;
  /** 상태별 건수 — 0건인 상태도 키가 있다 */
  byStatus: Record<DocumentStatus, number>;
  /** 유형별 건수 */
  byType: Record<DocumentType, number>;
  /** 결재가 끝난 문서의 평균 소요일 (없으면 null) */
  avgDecisionDays: number | null;
  decidedCount: number;
  /** 진행중 문서 중 가장 오래 묵은 것의 경과일 */
  oldestPendingDays: number;
  /** 직전 동일 길이 기간의 총 건수 — 증감 비교용 */
  previousTotal: number;
}

const EMPTY_STATUS: Record<DocumentStatus, number> = {
  pending: 0,
  approved: 0,
  completed: 0,
  rejected: 0,
};

/**
 * 요약 밴드용 집계.
 * 예전에는 집계 함수 자체가 없어서, 목록 화면이 "진행중이 몇 건인지"를
 * 필터를 눌러보기 전에는 알려주지 못했다.
 */
export async function getMyDocumentStats(
  employeeId: string,
  period: PeriodRange = {},
  previous: PeriodRange = {},
): Promise<DocumentStats> {
  const supabase = createServerSupabase();

  let query = supabase
    .from("approval_documents")
    .select("status, document_type, created_at, updated_at")
    .eq("requester_id", employeeId)
    .limit(1000);
  query = applyPeriod(query, period);

  const [{ data, error }, prev] = await Promise.all([
    query,
    previous.from
      ? applyPeriod(
          supabase
            .from("approval_documents")
            .select("id", { count: "exact", head: true })
            .eq("requester_id", employeeId),
          previous,
        )
      : Promise.resolve({ count: 0 }),
  ]);

  if (error) {
    console.error("[approvals] 문서 집계 실패:", error.message);
  }

  const rows = (data ?? []) as {
    status: DocumentStatus;
    document_type: DocumentType;
    created_at: string;
    updated_at: string;
  }[];

  const byStatus = { ...EMPTY_STATUS };
  const byType = Object.fromEntries(
    DOCUMENT_TYPES.map((t) => [t, 0]),
  ) as Record<DocumentType, number>;

  let decidedCount = 0;
  let decidedDaysSum = 0;
  let oldestPendingDays = 0;
  const now = Date.now();

  for (const row of rows) {
    if (row.status in byStatus) byStatus[row.status] += 1;
    if (row.document_type in byType) byType[row.document_type] += 1;

    if (row.status === "pending") {
      oldestPendingDays = Math.max(
        oldestPendingDays,
        elapsedDays(row.created_at, now),
      );
    } else {
      const days =
        (new Date(row.updated_at).getTime() -
          new Date(row.created_at).getTime()) /
        86_400_000;
      if (Number.isFinite(days) && days >= 0) {
        decidedCount += 1;
        decidedDaysSum += days;
      }
    }
  }

  return {
    total: rows.length,
    byStatus,
    byType,
    avgDecisionDays:
      decidedCount > 0
        ? Math.round((decidedDaysSum / decidedCount) * 10) / 10
        : null,
    decidedCount,
    oldestPendingDays,
    previousTotal: (prev as { count: number | null }).count ?? 0,
  };
}

export interface PendingApprovalRow {
  document: ApprovalDocument & {
    requester: DocumentRequester | null;
  };
  stepOrder: number;
  /** 문서의 전체 결재 단계 수 — "2단계 중 1단계"를 찍으려면 필요하다 */
  totalSteps: number;
  /** 기안 후 경과일 (서버 기준). 클라이언트 재계산으로 어긋나지 않게 값으로 넘긴다 */
  waitingDays: number;
}

/**
 * 내가 승인할 문서 (스펙 3.1)
 * 내가 담당자인 pending 단계 중, 문서의 current_step과 일치하는 것만 = 지금 내 차례.
 *
 * 정렬은 오래된 것 먼저 — 방치된 문서가 목록 아래로 밀려나면 안 된다.
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
      `step_order, status,
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
        waitingDays: elapsedDays(document.created_at, now),
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
    .sort((a, b) => a.document.created_at.localeCompare(b.document.created_at));
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
      `id, document_type, step2_approver_id, updated_at,
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
