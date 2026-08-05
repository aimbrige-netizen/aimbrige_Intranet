import Link from "next/link";
import { Users } from "lucide-react";
import { AvatarWithName } from "@/components/ui/Avatar";
import { EmploymentStatusBadge, RoleBadge } from "@/components/ui/Badge";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import { tenureLabel, tenureMonths } from "@/features/directory/org";
import { ariaSortOf, SortHeaderLink, type SortDir } from "@/lib/sort";
import { cn, formatDate } from "@/lib/utils";
import type { EmploymentStatus, RoleName } from "@/types/db";

/**
 * 임직원 표 — /directory 목록과 /admin/employees가 함께 쓴다.
 *
 * 예전에는 같은 '임직원 목록'이 두 벌이었다. 한쪽은 7컬럼에 전화번호가 있고
 * 다른 쪽은 8컬럼에 역할이 있었으며, 재직상태 표기 방식도 정렬 유무도 달랐다.
 * 컬럼 순서를 하나로 고정하고, 관리자 전용 컬럼만 플래그로 켠다.
 *
 * 훅을 쓰지 않으므로 서버 컴포넌트(목록 화면)와 클라이언트 컴포넌트
 * (조직도 마스터-디테일) 양쪽에서 그대로 렌더된다.
 */

export interface EmployeeTableRow {
  id: string;
  name: string;
  position: string | null;
  departmentName: string | null;
  teamName: string | null;
  employmentStatus: EmploymentStatus;
  email: string;
  phone: string | null;
  hireDate: string | null;
  profileImageUrl?: string | null;
  roleName?: RoleName | null;
  hasAccount?: boolean;
}

export type EmployeeSortKey =
  | "name"
  | "position"
  | "department"
  | "status"
  | "hire_date";

/** 표가 그대로 지원하는 정렬 키. 조회 계층이 못 하는 건 sortableKeys로 뺀다 */
export const EMPLOYEE_SORT_KEYS = [
  "name",
  "position",
  "department",
  "status",
  "hire_date",
] as const satisfies readonly EmployeeSortKey[];

export interface EmployeeSort {
  key: EmployeeSortKey;
  dir: SortDir;
}

const STATUS_ORDER: Record<EmploymentStatus, number> = {
  active: 0,
  leave: 1,
  terminated: 2,
};

/**
 * 클라이언트(메모리) 정렬 — 조직도 목록 뷰처럼 전 인원을 이미 들고 있는 화면용.
 * 서버 정렬(관리자 목록)과 결과 순서가 어긋나지 않도록 규칙을 한곳에 둔다.
 */
export function sortEmployeeRows<T extends EmployeeTableRow>(
  rows: T[],
  sort: EmployeeSort,
): T[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "ko");

  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case "hire_date": {
        const diff = (a.hireDate ?? "").localeCompare(b.hireDate ?? "");
        return diff !== 0 ? diff * factor : byName(a, b);
      }
      case "position": {
        const diff = (a.position ?? "").localeCompare(b.position ?? "", "ko");
        return diff !== 0 ? diff * factor : byName(a, b);
      }
      case "department": {
        const diff = (a.departmentName ?? "").localeCompare(
          b.departmentName ?? "",
          "ko",
        );
        return diff !== 0 ? diff * factor : byName(a, b);
      }
      case "status": {
        const diff =
          STATUS_ORDER[a.employmentStatus] - STATUS_ORDER[b.employmentStatus];
        return diff !== 0 ? diff * factor : byName(a, b);
      }
      default:
        return byName(a, b) * factor;
    }
  });
}

export interface EmployeeTableColumns {
  department?: boolean;
  team?: boolean;
  status?: boolean;
  role?: boolean;
  email?: boolean;
  phone?: boolean;
  hireDate?: boolean;
  tenure?: boolean;
  account?: boolean;
}

const DEFAULT_COLUMNS: Required<EmployeeTableColumns> = {
  department: true,
  team: true,
  status: true,
  role: false,
  email: true,
  phone: true,
  hireDate: true,
  tenure: true,
  account: false,
};

/**
 * 컬럼 순서는 어느 화면에서나 동일하다.
 * 앞머리는 주소록 실측 축(16 — 이름 · 부서/팀 · 직위 · 이메일 · 전화)을
 * 따르고, 주소록에 없는 정보 컬럼(재직상태·역할·입사일·근속·계정)은 뒤에 둔다.
 */
export function EmployeeTable({
  rows,
  today,
  hrefBase = "/directory",
  columns,
  sort,
  sortHref,
  sortableKeys,
  emptyTitle = "조건에 맞는 임직원이 없습니다",
  emptyDescription = "검색어나 필터를 바꿔보세요.",
  emptyAction,
  compact = true,
  minWidth = "min-w-[900px]",
  thClassName,
}: {
  rows: EmployeeTableRow[];
  /** 근속 계산 기준일 (YYYY-MM-DD) */
  today: string;
  hrefBase?: string;
  columns?: EmployeeTableColumns;
  sort?: EmployeeSort;
  /** 주면 헤더가 정렬 토글 링크가 된다 */
  sortHref?: (key: EmployeeSortKey) => string;
  /** 정렬을 지원하는 컬럼. 조회 계층이 감당 못 하는 키는 빼둔다 */
  sortableKeys?: EmployeeSortKey[];
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  compact?: boolean;
  minWidth?: string;
  /**
   * th에 덧붙는 클래스. 조직도/임직원 화면은 주소록 실측(16 — th 높이 48px
   * 확정)에 맞춰 "h-12 align-middle"을 넘긴다. .ab-table 전역을 바꾸지 않고
   * 화면 한정으로 얹는 자리다 — 관리자 목록 등 다른 호출부는 기본 높이 유지.
   */
  thClassName?: string;
}) {
  const show = { ...DEFAULT_COLUMNS, ...columns };
  const sortable = new Set<EmployeeSortKey>(sortableKeys ?? EMPLOYEE_SORT_KEYS);

  const headers: { key: EmployeeSortKey | null; label: string }[] = [
    { key: "name", label: "이름" },
    ...(show.department ? [{ key: "department" as const, label: "부서" }] : []),
    ...(show.team ? [{ key: null, label: "팀" }] : []),
    { key: "position", label: "직위" },
    ...(show.email ? [{ key: null, label: "이메일" }] : []),
    ...(show.phone ? [{ key: null, label: "전화" }] : []),
    ...(show.status ? [{ key: "status" as const, label: "재직상태" }] : []),
    ...(show.role ? [{ key: null, label: "역할" }] : []),
    ...(show.hireDate ? [{ key: "hire_date" as const, label: "입사일" }] : []),
    ...(show.tenure ? [{ key: null, label: "근속" }] : []),
    ...(show.account ? [{ key: null, label: "계정" }] : []),
  ];

  return (
    <div className="overflow-x-auto">
      <table className={cn("ab-table", compact && "ab-table--compact", minWidth)}>
        <thead>
          <tr>
            {headers.map((header) => {
              const sortableHere =
                !!header.key && !!sortHref && sortable.has(header.key);
              const current = sortableHere && sort?.key === header.key;

              return (
                <th
                  key={header.label}
                  className={thClassName || undefined}
                  aria-sort={
                    sortableHere
                      ? ariaSortOf(current, sort?.dir ?? "asc")
                      : undefined
                  }
                >
                  {sortableHere && header.key && sortHref ? (
                    <SortHeaderLink
                      href={sortHref(header.key)}
                      label={header.label}
                      active={current}
                      dir={sort?.dir ?? "asc"}
                    />
                  ) : (
                    header.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <TableEmptyRow
              colSpan={headers.length}
              icon={Users}
              title={emptyTitle}
              description={emptyDescription}
              action={emptyAction}
            />
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link
                    href={`${hrefBase}/${row.id}`}
                    className="inline-flex items-center gap-2 hover:underline"
                  >
                    <AvatarWithName
                      name={row.name}
                      src={row.profileImageUrl}
                      size="small"
                    />
                  </Link>
                </td>
                {show.department ? <td>{row.departmentName ?? "-"}</td> : null}
                {show.team ? <td>{row.teamName ?? "-"}</td> : null}
                <td>{row.position ?? "-"}</td>
                {show.email ? (
                  <td className="text-muted">
                    <a
                      href={`mailto:${row.email}`}
                      className="hover:text-ink hover:underline"
                    >
                      {row.email}
                    </a>
                  </td>
                ) : null}
                {show.phone ? (
                  <td className="whitespace-nowrap text-muted">
                    {row.phone ?? "-"}
                  </td>
                ) : null}
                {show.status ? (
                  <td>
                    <EmploymentStatusBadge status={row.employmentStatus} />
                  </td>
                ) : null}
                {show.role ? (
                  <td>
                    <RoleBadge role={row.roleName} />
                  </td>
                ) : null}
                {show.hireDate ? (
                  <td className="whitespace-nowrap tabular-nums text-muted">
                    {formatDate(row.hireDate)}
                  </td>
                ) : null}
                {show.tenure ? (
                  <td className="whitespace-nowrap tabular-nums">
                    {tenureLabel(tenureMonths(row.hireDate, today))}
                  </td>
                ) : null}
                {show.account ? (
                  <td>
                    {row.hasAccount ? (
                      <span className="text-caption">연결됨</span>
                    ) : (
                      <span className="text-warn-ink">미연결</span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** 조직도·목록이 공유하는 행 변환 */
export function toEmployeeRow(
  employee: {
    id: string;
    name: string;
    position: string | null;
    email: string;
    phone: string | null;
    hire_date: string | null;
    profile_image_url: string | null;
    employment_status: EmploymentStatus;
    department_id: string | null;
    team_id: string | null;
  },
  departmentName: (id: string | null) => string | null,
  teamName: (id: string | null) => string | null,
): EmployeeTableRow {
  return {
    id: employee.id,
    name: employee.name,
    position: employee.position,
    departmentName: departmentName(employee.department_id),
    teamName: teamName(employee.team_id),
    employmentStatus: employee.employment_status,
    email: employee.email,
    phone: employee.phone,
    hireDate: employee.hire_date,
    profileImageUrl: employee.profile_image_url,
  };
}
