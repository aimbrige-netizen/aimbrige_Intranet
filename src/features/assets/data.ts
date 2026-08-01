import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type {
  AssetLoan,
  AssetRow,
  WelfareBalance,
  WelfareRequest,
} from "./types";

/**
 * 자산·복지포인트 조회 (스펙 13)
 *
 * 자산 목록은 RPC(list_assets)로 받는다. 대여자 이름이 asset_loans에 있는데
 * 그 테이블은 본인·관리자만 볼 수 있어서(RLS), 목록에서 조인하면 남의 대여는
 * 이름이 비어 나온다. 스펙 3.1은 현재 대여자를 전 직원에게 보여주라고 하므로
 * 이름만 꺼내는 함수를 따로 뒀다 — 이력 전체를 열지 않으면서 필요한 것만 준다.
 */

const LOAN_COLUMNS =
  "id, asset_id, employee_id, requested_at, loaned_at, expected_return_date, return_requested_at, returned_at, rejected_at, note";

export interface LoadResult<T> {
  data: T;
  error: string | null;
}

export async function getAssets(): Promise<LoadResult<AssetRow[]>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("list_assets");

  if (error) {
    console.error("[assets] 목록 조회 실패:", error.message);
    return { data: [], error: error.message };
  }
  return { data: (data ?? []) as AssetRow[], error: null };
}

/** 자산 이름을 붙인 대여 목록. 관리자면 전사, 아니면 RLS가 본인 것만 남긴다 */
export interface LoanWithAsset extends AssetLoan {
  asset_name: string;
  asset_type: string | null;
  employee_name: string;
}

export async function getLoans(options: {
  employeeId?: string;
  /** 아직 끝나지 않은 건만 (신청·대여중·반납확인대기) */
  activeOnly?: boolean;
  limit?: number;
}): Promise<LoadResult<LoanWithAsset[]>> {
  const supabase = createServerSupabase();

  let query = supabase
    .from("asset_loans")
    .select(
      // 여기도 FK를 명시한다. 지금은 asset_loans가 employees를 한 갈래로만
      // 참조해서 테이블 이름만 적어도 되지만, 나중에 승인자 컬럼 하나만 붙어도
      // 조회 전체가 "more than one relationship"으로 죽는다.
      `${LOAN_COLUMNS}, assets!asset_id(name, asset_type), employees!employee_id(name)`,
    )
    .order("requested_at", { ascending: false })
    .limit(options.limit ?? 200);

  if (options.employeeId) query = query.eq("employee_id", options.employeeId);
  if (options.activeOnly) {
    query = query.is("returned_at", null).is("rejected_at", null);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[assets] 대여 목록 조회 실패:", error.message);
    return { data: [], error: error.message };
  }

  /*
   * PostgREST 임베드는 !inner를 써도 타입상 배열로 추론된다. 실제로는
   * to-one 관계라 객체 하나가 오므로 unknown을 거쳐 좁힌다.
   */
  const rows = (data ?? []) as unknown as (AssetLoan & {
    assets: { name: string; asset_type: string | null } | null;
    employees: { name: string } | null;
  })[];

  return {
    data: rows.map((row) => ({
      ...row,
      asset_name: row.assets?.name ?? "(삭제된 자산)",
      asset_type: row.assets?.asset_type ?? null,
      employee_name: row.employees?.name ?? "(퇴사자)",
    })),
    error: null,
  };
}

export async function getWelfareBalance(
  employeeId: string,
  year: number,
): Promise<LoadResult<WelfareBalance | null>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("welfare_point_balances")
    .select("employee_id, year, granted_points, used_points, updated_at")
    .eq("employee_id", employeeId)
    .eq("year", year)
    .maybeSingle<WelfareBalance>();

  if (error) {
    console.error("[welfare] 잔액 조회 실패:", error.message);
    return { data: null, error: error.message };
  }
  if (!data) return { data: null, error: null };

  /*
   * numeric 컬럼은 PostgREST가 문자열로 준다. 타입은 number라고 적혀 있어서
   * 지금은 뺄셈이 우연히 동작하지만, 더하기나 크기 비교를 쓰는 순간 깨진다
   * ("1000" > "900"은 사전식 비교라 false다).
   */
  return {
    data: {
      ...data,
      granted_points: Number(data.granted_points),
      used_points: Number(data.used_points),
    },
    error: null,
  };
}

const REQUEST_COLUMNS =
  "id, employee_id, year, amount, purpose, status, requested_at, processed_at, processed_by, reject_reason";

export async function getWelfareRequests(options: {
  employeeId?: string;
  year?: number;
  pendingOnly?: boolean;
}): Promise<LoadResult<(WelfareRequest & { employee_name: string })[]>> {
  const supabase = createServerSupabase();

  /*
   * 임베드를 컬럼으로 지정한다(employees!inner가 아니라 employees:employee_id).
   * welfare_point_requests는 employees를 employee_id와 processed_by 두 갈래로
   * 참조해서, 테이블 이름만 적으면 PostgREST가 어느 쪽인지 정하지 못하고
   *   Could not embed because more than one relationship was found
   * 로 조회 전체가 실패한다. 신청자 이름이 필요한 것이므로 employee_id다.
   */
  let query = supabase
    .from("welfare_point_requests")
    .select(`${REQUEST_COLUMNS}, employees:employee_id(name)`)
    .order("requested_at", { ascending: false })
    .limit(300);

  if (options.employeeId) query = query.eq("employee_id", options.employeeId);
  if (options.year) query = query.eq("year", options.year);
  if (options.pendingOnly) query = query.eq("status", "pending");

  const { data, error } = await query;

  if (error) {
    console.error("[welfare] 신청 목록 조회 실패:", error.message);
    return { data: [], error: error.message };
  }

  const rows = (data ?? []) as unknown as (WelfareRequest & {
    employees: { name: string } | null;
  })[];

  return {
    data: rows.map((row) => ({
      ...row,
      // amount는 numeric이라 PostgREST가 문자열로 준다
      amount: Number(row.amount),
      employee_name: row.employees?.name ?? "(퇴사자)",
    })),
    error: null,
  };
}

/**
 * 관리자 화면의 전사 지급 현황.
 *
 * 임직원 수만큼 잔액 행을 세는 대신 한 번에 집계한다. 인원이 20명이든
 * 200명이든 질의 수가 같아야 목록이 커져도 화면이 느려지지 않는다.
 */
export async function getWelfareOverview(
  year: number,
): Promise<LoadResult<{ granted: number; used: number; employees: number }>> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("welfare_point_balances")
    .select("granted_points, used_points")
    .eq("year", year);

  if (error) {
    console.error("[welfare] 전사 현황 조회 실패:", error.message);
    return { data: { granted: 0, used: 0, employees: 0 }, error: error.message };
  }

  const rows = (data ?? []) as { granted_points: number; used_points: number }[];
  return {
    data: {
      granted: rows.reduce((sum, r) => sum + Number(r.granted_points), 0),
      used: rows.reduce((sum, r) => sum + Number(r.used_points), 0),
      employees: rows.length,
    },
    error: null,
  };
}
