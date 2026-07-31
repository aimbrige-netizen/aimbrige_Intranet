import Link from "next/link";
import { ArrowDown, ArrowUp, Users } from "lucide-react";
import { AvatarWithName } from "@/components/ui/Avatar";
import { EmploymentStatusBadge, RoleBadge } from "@/components/ui/Badge";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import { tenureLabel, tenureMonths } from "@/features/directory/org";
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

export type EmployeeSortKey = "name" | "department" | "hire_date";

export interface EmployeeSort {
  key: EmployeeSortKey;
  dir: "asc" | "desc";
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

/** 컬럼 순서는 어느 화면에서나 동일하다 */
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
}) {
  const show = { ...DEFAULT_COLUMNS, ...columns };
  const sortable = new Set<EmployeeSortKey>(
    sortableKeys ?? ["name", "department", "hire_date"],
  );

  const headers: { key: EmployeeSortKey | null; label: string }[] = [
    { key: "name", label: "이름" },
    { key: null, label: "직급" },
    ...(show.department ? [{ key: "department" as const, label: "부서" }] : []),
    ...(show.team ? [{ key: null, label: "팀" }] : []),
    ...(show.status ? [{ key: null, label: "재직상태" }] : []),
    ...(show.role ? [{ key: null, label: "역할" }] : []),
    ...(show.email ? [{ key: null, label: "이메일" }] : []),
    ...(show.phone ? [{ key: null, label: "전화" }] : []),
    ...(show.hireDate ? [{ key: "hire_date" as const, label: "입사일" }] : []),
    ...(show.tenure ? [{ key: null, label: "근속" }] : []),
    ...(show.account ? [{ key: null, label: "계정" }] : []),
  ];

  return (
    <div className="overflow-x-auto">
      <table className={cn("ab-table", compact && "ab-table--compact", minWidth)}>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header.label}>
                {header.key && sortHref && sortable.has(header.key) ? (
                  <Link
                    href={sortHref(header.key)}
                    className={cn(
                      "inline-flex items-center gap-1 transition-colors duration-fast ease-standard hover:text-ink",
                      sort?.key === header.key && "text-ink",
                    )}
                  >
                    {header.label}
                    {sort?.key === header.key ? (
                      sort.dir === "asc" ? (
                        <ArrowUp className="size-3" aria-hidden />
                      ) : (
                        <ArrowDown className="size-3" aria-hidden />
                      )
                    ) : null}
                  </Link>
                ) : (
                  header.label
                )}
              </th>
            ))}
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
                <td>{row.position ?? "-"}</td>
                {show.department ? <td>{row.departmentName ?? "-"}</td> : null}
                {show.team ? <td>{row.teamName ?? "-"}</td> : null}
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
