import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type {
  ApprovalDocument,
  ApprovalDocumentWithRelations,
  ApprovalLineConfig,
  ApprovalStep,
  DocumentType,
} from "./types";
import type { Employee } from "@/types/db";

const DOC_SELECT =
  "id, document_type, title, form_data, requester_id, status, current_step, created_at, updated_at";

/** 내가 올린 문서 (스펙 3.1) */
export async function getMyDocuments(
  employeeId: string,
  status?: string,
): Promise<ApprovalDocument[]> {
  const supabase = createServerSupabase();
  let query = supabase
    .from("approval_documents")
    .select(DOC_SELECT)
    .eq("requester_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    console.error("[approvals] 내 문서 조회 실패:", error.message);
    return [];
  }
  return (data ?? []) as ApprovalDocument[];
}

export interface PendingApprovalRow {
  document: ApprovalDocument & {
    requester: Pick<Employee, "id" | "name"> | null;
  };
  stepOrder: number;
}

/**
 * 내가 승인할 문서 (스펙 3.1)
 * 내가 담당자인 pending 단계 중, 문서의 current_step과 일치하는 것만 = 지금 내 차례.
 */
export async function getMyPendingApprovals(
  employeeId: string,
): Promise<PendingApprovalRow[]> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("approval_steps")
    .select(
      `step_order, status,
       document:approval_documents!document_id(
         ${DOC_SELECT},
         requester:employees!requester_id(id, name)
       )`,
    )
    .eq("approver_id", employeeId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[approvals] 승인 대기 조회 실패:", error.message);
    return [];
  }

  return (data ?? [])
    .map((row) => {
      const r = row as unknown as {
        step_order: number;
        document: PendingApprovalRow["document"] | null;
      };
      return r.document ? { document: r.document, stepOrder: r.step_order } : null;
    })
    .filter((row): row is PendingApprovalRow => {
      if (!row) return false;
      // 문서가 진행중이고 지금 단계가 내 단계일 때만 "내 차례"
      return (
        row.document.status === "pending" &&
        row.document.current_step === row.stepOrder
      );
    });
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
       requester:employees!requester_id(id, name, position),
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

/** 승인된 출장·재택근무를 캘린더에 표시 (스펙 7장) */
export async function getApprovedDateDocuments(
  fromYmd: string,
  toYmd: string,
): Promise<
  {
    id: string;
    document_type: DocumentType;
    title: string;
    form_data: Record<string, unknown>;
    requester: Pick<Employee, "id" | "name"> | null;
  }[]
> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("approval_documents")
    .select(
      `id, document_type, title, form_data,
       requester:employees!requester_id(id, name)`,
    )
    .in("status", ["approved", "completed"])
    .in("document_type", ["business_trip", "remote_work"]);

  if (error) {
    console.error("[approvals] 캘린더용 문서 조회 실패:", error.message);
    return [];
  }

  // 날짜는 form_data 안에 있어 SQL로 범위 필터가 어렵다.
  // 문서 수가 많지 않아 애플리케이션에서 걸러낸다.
  return ((data ?? []) as never[]).filter((row) => {
    const form = (row as { form_data: Record<string, unknown> }).form_data;
    const start = String(form?.startDate ?? "");
    const end = String(form?.endDate ?? start);
    if (!start) return false;
    return start <= toYmd && end >= fromYmd;
  });
}

export type { ApprovalStep };
