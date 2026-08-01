"use server";

import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { AUDIT_ACTION_LABELS } from "@/features/audit/constants";
import {
  auditExportCap,
  listAuditLogs,
  type AuditExportQuery,
} from "@/features/audit/data";
import { detailText } from "@/features/audit/detail";
import type { AuditExportResult } from "@/features/audit/export";
import { formatDateTime } from "@/lib/utils";

/**
 * 감사 로그 CSV용 행 조회.
 *
 * 예전에는 페이지가 로드될 때마다 목록(50건)과 **함께** 내보내기용 모수(최대
 * 500건, detail jsonb 통째로)를 한 번 더 읽었다. 표에 안 그릴 450행을 매번
 * 읽는 셈이고, 그 집합이 뒤따르는 대상 이름 조회의 크기까지 결정했다.
 * audit_logs는 무한 누적되는 테이블이라 그 비용은 시간이 갈수록 커지기만 한다.
 * 이제 버튼을 누른 뒤에만 읽는다.
 *
 * 조건은 목록과 같은 것을 받는다(AuditExportQuery) — 화면에 보이던 필터·정렬과
 * 다른 CSV가 떨어지면 그 파일은 감사 근거가 되지 못한다.
 */
export async function exportAuditLogs(
  query: AuditExportQuery,
): Promise<AuditExportResult> {
  await requireSystemAdmin();

  const list = await listAuditLogs({
    ...query,
    limit: auditExportCap(!!query.q),
    offset: 0,
  });

  // 실패를 빈 배열로 넘기면 "그 기간에 아무 일도 없었다"는 CSV가 된다
  if (list.errorMessage) {
    return { ok: false, message: list.errorMessage };
  }

  const supabase = createServerSupabase();
  const targetIds = Array.from(
    new Set(
      list.rows.map((log) => log.targetId).filter((id): id is string => !!id),
    ),
  );

  const targetNames = new Map<string, string>();
  if (targetIds.length > 0) {
    const { data, error } = await supabase
      .from("employees")
      .select("id, name")
      .in("id", targetIds);
    // 이름을 못 붙이는 건 치명적이지 않다 — id로라도 내려보낸다
    if (error) {
      console.error("[audit] 대상 이름 조회 실패:", error.message);
    }
    (data ?? []).forEach((row) => targetNames.set(row.id, row.name));
  }

  return {
    ok: true,
    rows: list.rows.map((log) => ({
      at: formatDateTime(log.createdAt),
      actor: log.actorName ?? "시스템",
      actorEmail: log.actorEmail ?? "",
      action: AUDIT_ACTION_LABELS[log.action] ?? log.action,
      target: log.targetId
        ? (targetNames.get(log.targetId) ?? log.targetId)
        : "",
      detail: detailText(log.detail),
    })),
  };
}
