import "server-only";

import { createAdminSupabase } from "@/lib/supabase/admin";
import type { AuditAction } from "@/types/db";

interface AuditInput {
  actorId: string | null;
  action: AuditAction;
  targetId?: string | null;
  detail?: Record<string, unknown> | null;
}

/**
 * 감사 로그 기록 (스펙 01 · 3.6 / 4장 RLS 원칙)
 * audit_logs INSERT는 클라이언트에 열지 않고 서버에서만 수행한다.
 * 로그 기록 실패가 본 기능(권한 변경 등)을 막지 않도록 예외는 삼킨다.
 */
export async function writeAuditLog({
  actorId,
  action,
  targetId = null,
  detail = null,
}: AuditInput): Promise<void> {
  try {
    const supabase = createAdminSupabase();
    const { error } = await supabase.from("audit_logs").insert({
      actor_id: actorId,
      action,
      target_id: targetId,
      detail,
    });
    if (error) {
      console.error("[audit] insert 실패", action, error.message);
    }
  } catch (error) {
    console.error("[audit] 기록 중 예외", action, error);
  }
}

/**
 * 변경 전/후 스냅샷에서 실제로 바뀐 필드만 뽑아낸다.
 * 감사 로그 detail을 {before, after} 형태로 남기기 위한 헬퍼.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};
  let changed = false;

  for (const key of Object.keys(after) as (keyof T)[]) {
    const prev = before[key] ?? null;
    const next = after[key] ?? null;
    if (prev !== next) {
      changedBefore[key] = prev as T[keyof T];
      changedAfter[key] = next as T[keyof T];
      changed = true;
    }
  }

  return changed ? { before: changedBefore, after: changedAfter } : null;
}
