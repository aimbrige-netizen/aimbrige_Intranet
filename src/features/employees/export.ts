import type { EmploymentStatus } from "@/types/db";

/**
 * 임직원 목록 내보내기의 공용 조각.
 *
 * 목록(page.tsx)과 내보내기(server/actions/employees.ts)가 **정확히 같은 모수**를
 * 봐야 한다. 예전에는 필터 헬퍼가 page.tsx 안의 지역 함수라 두 질의가 같은
 * 파일에 있는 동안만 그 약속이 지켜졌다. 내보내기가 서버 액션으로 옮겨가면서
 * 조건·정렬·상한을 여기로 꺼낸다 — 한쪽만 고치면 CSV가 화면과 달라진다.
 *
 * 클라이언트 버튼도 행 타입을 읽으므로 이 파일은 서버 전용이 아니다
 * (질의 빌더를 받아 조건만 얹을 뿐 supabase를 직접 만들지 않는다).
 */

/** 내보내기는 페이지가 아니라 필터 전체를 담는다. 상한만 걸어 둔다 */
export const EMPLOYEE_EXPORT_LIMIT = 1000;

/**
 * 서버에서 정렬 가능한 키. 부서는 임베드 테이블 컬럼이라 PostgREST가
 * 부모 행 순서를 바꿔 주지 못한다 — 표에서도 빼 둔다.
 */
export const EMPLOYEE_SORTABLE_KEYS = [
  "name",
  "position",
  "status",
  "hire_date",
] as const;

export type EmployeeQuerySortKey = (typeof EMPLOYEE_SORTABLE_KEYS)[number];

export const EMPLOYEE_SORT_COLUMNS: Record<EmployeeQuerySortKey, string> = {
  name: "name",
  position: "position",
  status: "employment_status",
  hire_date: "hire_date",
};

/** 목록 파라미터 규약: q / department / role / status (+ sort / dir) */
export interface EmployeeExportQuery {
  q?: string;
  department?: string;
  status?: string;
  /**
   * 역할 이름 → id 변환은 질의 전에 한 번 필요하다.
   * 없는 역할이면 결과가 비도록 서버가 더미 uuid를 넣는다.
   */
  role?: string;
  sortKey: EmployeeQuerySortKey;
  ascending: boolean;
  /** 관리자 목록만 역할·계정 연결 컬럼을 함께 받는다 */
  withAdminColumns?: boolean;
}

export interface EmployeeExportRow {
  name: string;
  position: string | null;
  department: string | null;
  team: string | null;
  status: EmploymentStatus;
  email: string;
  phone: string | null;
  hireDate: string | null;
  tenure: string;
  /** 관리자 목록에서만 채운다 */
  role?: string | null;
  hasAccount?: boolean;
}

/**
 * 빈 배열과 실패를 구분한다 — 빈 CSV가 "해당 인원이 없다"로 읽히면 안 된다.
 * RLS에 막힌 조회도 0행으로 끝나므로 여기서 갈라 둔다.
 */
export type EmployeeExportResult =
  | { ok: true; rows: EmployeeExportRow[] }
  | { ok: false; message: string };

/** CSV에 실제로 들어가는 컬럼만. 아바타 URL까지 끌고 올 이유가 없다 */
export const EMPLOYEE_EXPORT_SELECT = `name, email, position, phone, hire_date, employment_status, auth_user_id,
       role:roles(label),
       department:departments!department_id(name),
       team:teams!team_id(name)`;

/** 목록과 내보내기가 정확히 같은 모수를 보게 조건을 한 곳에 둔다 */
export function applyEmployeeFilters<T extends { eq: unknown; or: unknown }>(
  input: T,
  filters: Pick<EmployeeExportQuery, "q" | "department" | "status">,
  roleId: string | null,
): T {
  let next = input as unknown as {
    eq: (column: string, value: string) => typeof next;
    or: (filter: string) => typeof next;
  };
  if (filters.q) {
    // PostgREST or() 구문에서 콤마·괄호는 구분자라 제거한다
    const keyword = filters.q.replace(/[,()]/g, "").trim();
    if (keyword) {
      next = next.or(`name.ilike.%${keyword}%,email.ilike.%${keyword}%`);
    }
  }
  if (filters.department) {
    next = next.eq("department_id", filters.department);
  }
  if (filters.status) {
    next = next.eq("employment_status", filters.status);
  }
  if (roleId) next = next.eq("role_id", roleId);
  return next as unknown as T;
}
