import "server-only";

import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * service_role 키를 쓰는 관리자 클라이언트 — RLS를 우회한다.
 *
 * 쓰는 곳을 최소로 유지한다. 현재 용도:
 *  1) 로그인 콜백에서 employees.auth_user_id 링크 (본인 행을 아직 못 읽는 상태라 필요)
 *  2) audit_logs INSERT (스펙 4장 RLS 원칙: INSERT는 서버 측에서만)
 *  3) 시딩 스크립트
 *  4) gmail_connections 읽기/쓰기 (마이그레이션 29 — RLS 정책 0개라
 *     service role만 닿는 refresh token 금고. src/server/gmail/tokens.ts 전용)
 *
 * 절대 클라이언트 컴포넌트에서 import 하지 않는다("server-only"로 강제).
 */
export function createAdminSupabase() {
  return createClient(publicEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
