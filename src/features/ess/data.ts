import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type {
  CertificateStatus,
  CertificateType,
  ContractStatus,
  EmploymentStatus,
  PayrollItemKind,
  PayrollProfile,
} from "@/types/db";

/**
 * ⚑ ESS 3종(인사·급여·계약) 조회 계층 (스펙 13 · 마이그레이션 30)
 *
 * 모든 함수는 소프트 실패다 — 마이그레이션 30이 아직 적용되지 않은 환경에서
 * 테이블이 없으면 console.error만 남기고 빈 값을 돌려준다(mail/data.ts와
 * 같은 규약). 화면이 비어 보일지언정 죽지는 않는다.
 *
 * 급여는 이 프로젝트 최민감 데이터다. 여기의 어떤 함수도 권한을 스스로
 * 판정하지 않는다 — RLS(본인 + system_admin만)가 행 단위로 거르므로,
 * 남의 employeeId를 넘겨도 남의 급여는 **빈 결과**로 돌아온다. 관리자
 * 전용 함수는 화면(page) 계층의 requireSystemAdmin()이 1차로 막고,
 * RLS가 2차로 막는다.
 */

// ---------------------------------------------------------------------
// 뷰모델
// ---------------------------------------------------------------------

export interface PayrollSlipListItem {
  id: string;
  /** YYYY-MM-01 */
  payMonth: string;
  payDate: string;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  memo: string | null;
}

/** 명세서 표의 하단 합계 행 (13-ess.md "급(상)여명세서" 표) */
export interface PayrollSlipTotals {
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  count: number;
}

export interface PayrollSlipList {
  items: PayrollSlipListItem[];
  totals: PayrollSlipTotals;
}

export interface PayrollSlipItemEntry {
  id: string;
  kind: PayrollItemKind;
  name: string;
  amount: number;
  sort: number;
}

/** 명세 상세 — 사원명·부서 + 항목별 명세 (13-ess.md 상세) */
export interface PayrollSlipDetail extends PayrollSlipListItem {
  employeeId: string;
  employeeName: string | null;
  departmentName: string | null;
  position: string | null;
  items: PayrollSlipItemEntry[];
  createdAt: string;
}

export interface CertificateRequestItem {
  id: string;
  certType: CertificateType;
  purpose: string;
  status: CertificateStatus;
  requestedAt: string;
  processedAt: string | null;
  /** 처리자 이름. 미처리·퇴사자면 null */
  processorName: string | null;
  rejectReason: string | null;
}

export interface ContractListItem {
  id: string;
  employeeId: string;
  title: string;
  status: ContractStatus;
  signedAt: string | null;
  /** 파일 경로 유무만 노출 — 경로 자체는 서명 URL 액션이 다룬다 */
  hasFile: boolean;
  createdAt: string;
  /** 관리자 목록용. 본인 목록에서는 null */
  employeeName: string | null;
}

/** 관리자 — 명세 입력 대상(재직·휴직 전 직원 + 급여상세 유무) */
export interface PayrollTarget {
  employeeId: string;
  name: string;
  position: string | null;
  departmentName: string | null;
  teamName: string | null;
  employmentStatus: EmploymentStatus;
  profile: PayrollProfile | null;
}

/** 관리자 — 특정 월의 등록된 명세 목록 */
export interface MonthlySlipRow extends PayrollSlipListItem {
  employeeId: string;
  employeeName: string | null;
  departmentName: string | null;
}

/** 관리자 — 증명서 처리 목록 */
export interface CertificateAdminItem extends CertificateRequestItem {
  employeeId: string;
  employeeName: string | null;
  position: string | null;
  departmentName: string | null;
}

const EMPTY_TOTALS: PayrollSlipTotals = {
  grossTotal: 0,
  deductionTotal: 0,
  netTotal: 0,
  count: 0,
};

/**
 * "YYYY-MM" 또는 "YYYY-MM-DD"를 그 달 1일로 정규화한다.
 * pay_month 컬럼이 월 첫날로 고정돼 있어(CHECK) 질의도 같은 모양이어야 한다.
 */
export function payMonthFirstDay(value: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

// ---------------------------------------------------------------------
// 행 타입은 임베드 결과의 실제 모양을 따른다 (FK 명시 — 규약)
// ---------------------------------------------------------------------

interface SlipRow {
  id: string;
  employee_id: string;
  pay_month: string;
  pay_date: string;
  gross_total: number;
  deduction_total: number;
  net_total: number;
  memo: string | null;
  created_at: string;
}

interface SlipDetailRow extends SlipRow {
  employee: {
    id: string;
    name: string;
    position: string | null;
    department: { id: string; name: string } | null;
  } | null;
  items: {
    id: string;
    kind: PayrollItemKind;
    name: string;
    amount: number;
    sort: number;
  }[];
}

interface CertRow {
  id: string;
  employee_id: string;
  cert_type: CertificateType;
  purpose: string;
  status: CertificateStatus;
  requested_at: string;
  processed_at: string | null;
  reject_reason: string | null;
  processor: { id: string; name: string } | null;
}

interface CertAdminRow extends CertRow {
  employee: {
    id: string;
    name: string;
    position: string | null;
    department: { id: string; name: string } | null;
  } | null;
}

interface ContractRow {
  id: string;
  employee_id: string;
  title: string;
  status: ContractStatus;
  signed_at: string | null;
  file_path: string | null;
  created_at: string;
  employee?: { id: string; name: string } | null;
}

function slipItemOf(row: SlipRow): PayrollSlipListItem {
  return {
    id: row.id,
    payMonth: row.pay_month,
    payDate: row.pay_date,
    grossTotal: Number(row.gross_total ?? 0),
    deductionTotal: Number(row.deduction_total ?? 0),
    netTotal: Number(row.net_total ?? 0),
    memo: row.memo,
  };
}

function certItemOf(row: CertRow): CertificateRequestItem {
  return {
    id: row.id,
    certType: row.cert_type,
    purpose: row.purpose,
    status: row.status,
    requestedAt: row.requested_at,
    processedAt: row.processed_at,
    processorName: row.processor?.name ?? null,
    rejectReason: row.reject_reason,
  };
}

function contractItemOf(row: ContractRow): ContractListItem {
  return {
    id: row.id,
    employeeId: row.employee_id,
    title: row.title,
    status: row.status,
    signedAt: row.signed_at,
    hasFile: row.file_path !== null,
    createdAt: row.created_at,
    employeeName: row.employee?.name ?? null,
  };
}

// ---------------------------------------------------------------------
// 내 급여 (스펙 13 #payroll/my-pay)
// ---------------------------------------------------------------------

/** 급여상세 섹션 — 급여유형·연봉·월급·고정수당 */
export async function getMyPayrollProfile(
  employeeId: string,
): Promise<PayrollProfile | null> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("payroll_profiles")
    .select(
      "employee_id, pay_type, annual_salary, monthly_salary, fixed_allowance, note, updated_at",
    )
    .eq("employee_id", employeeId)
    .maybeSingle<PayrollProfile>();

  if (error) {
    console.error("[ess] 급여상세 조회 실패:", error.message);
    return null;
  }
  return data;
}

export interface PayrollSlipFilter {
  /** YYYY-MM 또는 YYYY-MM-DD — 이 달부터 */
  fromMonth?: string;
  /** 이 달까지 */
  toMonth?: string;
}

/**
 * 명세 목록 + 하단 합계 행. employeeId는 본인 화면이면 세션의 본인 id,
 * 관리자 화면이면 대상 직원 id다 — 어느 쪽이든 RLS가 최종 판정한다.
 * 기간 조회라 페이지네이션 없이 전부 가져온다(월 단위 데이터라 상한이 작다).
 */
export async function getPayrollSlips(
  employeeId: string,
  filter: PayrollSlipFilter = {},
): Promise<PayrollSlipList> {
  const supabase = createServerSupabase();

  let query = supabase
    .from("payroll_slips")
    .select(
      "id, employee_id, pay_month, pay_date, gross_total, deduction_total, net_total, memo, created_at",
    )
    .eq("employee_id", employeeId)
    .order("pay_month", { ascending: false });

  const from = filter.fromMonth ? payMonthFirstDay(filter.fromMonth) : null;
  const to = filter.toMonth ? payMonthFirstDay(filter.toMonth) : null;
  if (from) query = query.gte("pay_month", from);
  if (to) query = query.lte("pay_month", to);

  const { data, error } = await query;

  if (error) {
    console.error("[ess] 급여명세 목록 조회 실패:", error.message);
    return { items: [], totals: EMPTY_TOTALS };
  }

  const items = ((data ?? []) as SlipRow[]).map(slipItemOf);
  const totals = items.reduce<PayrollSlipTotals>(
    (acc, item) => ({
      grossTotal: acc.grossTotal + item.grossTotal,
      deductionTotal: acc.deductionTotal + item.deductionTotal,
      netTotal: acc.netTotal + item.netTotal,
      count: acc.count + 1,
    }),
    EMPTY_TOTALS,
  );
  return { items, totals };
}

/** 명세 상세 — 사원명·부서·항목별 명세. RLS 밖의 명세는 null */
export async function getPayrollSlipDetail(
  slipId: string,
): Promise<PayrollSlipDetail | null> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("payroll_slips")
    .select(
      `id, employee_id, pay_month, pay_date, gross_total, deduction_total,
       net_total, memo, created_at,
       employee:employees!employee_id(
         id, name, position,
         department:departments!department_id(id, name)
       ),
       items:payroll_slip_items!slip_id(id, kind, name, amount, sort)`,
    )
    .eq("id", slipId)
    .maybeSingle();

  if (error) {
    console.error("[ess] 급여명세 상세 조회 실패:", error.message);
    return null;
  }
  if (!data) return null;

  const row = data as unknown as SlipDetailRow;
  return {
    ...slipItemOf(row),
    employeeId: row.employee_id,
    employeeName: row.employee?.name ?? null,
    departmentName: row.employee?.department?.name ?? null,
    position: row.employee?.position ?? null,
    createdAt: row.created_at,
    items: [...(row.items ?? [])]
      .map((item) => ({ ...item, amount: Number(item.amount ?? 0) }))
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
  };
}

// ---------------------------------------------------------------------
// 내 증명서 신청 (스펙 13 #hr/cert-isu)
// ---------------------------------------------------------------------

export async function getMyCertificateRequests(
  employeeId: string,
): Promise<CertificateRequestItem[]> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("certificate_requests")
    .select(
      `id, employee_id, cert_type, purpose, status, requested_at, processed_at,
       reject_reason,
       processor:employees!processed_by(id, name)`,
    )
    .eq("employee_id", employeeId)
    .order("requested_at", { ascending: false });

  if (error) {
    console.error("[ess] 증명서 신청 목록 조회 실패:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as CertRow[]).map(certItemOf);
}

// ---------------------------------------------------------------------
// 내 계약 (스펙 13 #econtract)
// ---------------------------------------------------------------------

export async function getMyContracts(
  employeeId: string,
): Promise<ContractListItem[]> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("employment_contracts")
    .select("id, employee_id, title, status, signed_at, file_path, created_at")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[ess] 계약 목록 조회 실패:", error.message);
    return [];
  }
  return ((data ?? []) as ContractRow[]).map(contractItemOf);
}

// ---------------------------------------------------------------------
// 관리자 — /admin/payroll · /admin/hr · /admin/contracts
// 화면 계층의 requireSystemAdmin()이 1차, RLS가 2차 방어선이다.
// 관리자가 아니면 아래 질의는 전부 빈 결과로 끝난다(에러가 아니라).
// ---------------------------------------------------------------------

/**
 * 명세 입력 대상 — 퇴사자를 뺀 전 직원 + 급여상세 유무.
 * payroll_profiles!employee_id는 PK 역방향이라 객체(1:1)로 온다.
 */
export async function getPayrollTargets(): Promise<PayrollTarget[]> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("employees")
    .select(
      `id, name, position, employment_status,
       department:departments!department_id(id, name),
       team:teams!team_id(id, name),
       profile:payroll_profiles!employee_id(
         employee_id, pay_type, annual_salary, monthly_salary,
         fixed_allowance, note, updated_at
       )`,
    )
    .neq("employment_status", "terminated")
    .order("name");

  if (error) {
    console.error("[ess] 명세 입력 대상 조회 실패:", error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    name: string;
    position: string | null;
    employment_status: EmploymentStatus;
    department: { id: string; name: string } | null;
    team: { id: string; name: string } | null;
    /*
     * PK 역방향 1:1 임베드 — 최신 PostgREST는 객체로 주지만 to-one 감지가
     * 없던 버전은 배열로 준다. 이 임베드 모양은 코드베이스에서 여기가
     * 처음이라(정방향 employees!employee_id만 있었다) 양쪽 다 받는다.
     */
    profile: PayrollProfile | PayrollProfile[] | null;
  }[];

  return rows.map((row) => ({
    employeeId: row.id,
    name: row.name,
    position: row.position,
    departmentName: row.department?.name ?? null,
    teamName: row.team?.name ?? null,
    employmentStatus: row.employment_status,
    profile: Array.isArray(row.profile)
      ? (row.profile[0] ?? null)
      : row.profile,
  }));
}

/** 특정 월에 등록된 명세 전부 — 관리자 월별 입력 현황 */
export async function getMonthlyPayrollSlips(
  month: string,
): Promise<MonthlySlipRow[]> {
  const firstDay = payMonthFirstDay(month);
  if (!firstDay) return [];

  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("payroll_slips")
    .select(
      `id, employee_id, pay_month, pay_date, gross_total, deduction_total,
       net_total, memo, created_at,
       employee:employees!employee_id(
         id, name,
         department:departments!department_id(id, name)
       )`,
    )
    .eq("pay_month", firstDay)
    .order("created_at");

  if (error) {
    console.error("[ess] 월별 명세 조회 실패:", error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as (SlipRow & {
    employee: {
      id: string;
      name: string;
      department: { id: string; name: string } | null;
    } | null;
  })[];

  return rows.map((row) => ({
    ...slipItemOf(row),
    employeeId: row.employee_id,
    employeeName: row.employee?.name ?? null,
    departmentName: row.employee?.department?.name ?? null,
  }));
}

/** 증명서 처리 목록. status를 주면 그 상태만, 없으면 전부(신청순 최신부터) */
export async function getCertificateQueue(
  status?: CertificateStatus,
): Promise<CertificateAdminItem[]> {
  const supabase = createServerSupabase();

  let query = supabase
    .from("certificate_requests")
    .select(
      `id, employee_id, cert_type, purpose, status, requested_at, processed_at,
       reject_reason,
       employee:employees!employee_id(
         id, name, position,
         department:departments!department_id(id, name)
       ),
       processor:employees!processed_by(id, name)`,
    )
    .order("requested_at", { ascending: false });

  if (status) query = query.eq("status", status);

  const { data, error } = await query;

  if (error) {
    console.error("[ess] 증명서 처리 목록 조회 실패:", error.message);
    return [];
  }

  return ((data ?? []) as unknown as CertAdminRow[]).map((row) => ({
    ...certItemOf(row),
    employeeId: row.employee_id,
    employeeName: row.employee?.name ?? null,
    position: row.employee?.position ?? null,
    departmentName: row.employee?.department?.name ?? null,
  }));
}

/** 전사 계약 목록 (관리자) */
export async function getAllContracts(): Promise<ContractListItem[]> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("employment_contracts")
    .select(
      `id, employee_id, title, status, signed_at, file_path, created_at,
       employee:employees!employee_id(id, name)`,
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[ess] 전사 계약 목록 조회 실패:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as ContractRow[]).map(contractItemOf);
}
