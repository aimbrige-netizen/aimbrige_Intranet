import {
  FilterChip,
  TableToolbar,
  ToolbarSearch,
} from "@/components/ui/TableToolbar";
import type { OrgOption } from "@/features/employees/EmployeeFields";
import type { EmploymentStatus, RoleName } from "@/types/db";

/**
 * 임직원 관리 목록의 검색·필터 (스펙 3.4)
 *
 * 예전에는 드롭다운 3개라서 닫혀 있는 동안 선택지도, 각 선택지의 규모도 보이지
 * 않았다. 조직도 목록 뷰와 같은 칩 스트립으로 맞추고, 전부 URL 파라미터로 둬서
 * 두 화면의 공유·뒤로가기 동작을 통일한다.
 *
 * 훅이 없어 서버 컴포넌트에서 그대로 렌더된다.
 */
export interface EmployeeFilterParams {
  q?: string;
  department?: string;
  role?: string;
  status?: string;
}

const STATUS_OPTIONS: { value: EmploymentStatus; label: string }[] = [
  { value: "active", label: "재직중" },
  { value: "leave", label: "휴직" },
  { value: "terminated", label: "퇴사" },
];

const ROLE_OPTIONS: { value: RoleName; label: string }[] = [
  { value: "system_admin", label: "시스템 관리자" },
  { value: "manager", label: "팀장·매니저" },
  { value: "employee", label: "일반직원" },
];

export function EmployeeFilters({
  departments,
  params,
  statusCounts,
  departmentCounts,
  total,
  shown,
  actions,
}: {
  departments: OrgOption[];
  params: EmployeeFilterParams;
  statusCounts: Record<EmploymentStatus, number>;
  departmentCounts: Map<string, number>;
  total: number;
  shown: number;
  actions?: React.ReactNode;
}) {
  const href = (patch: EmployeeFilterParams) => {
    const search = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q: params.q,
      department: params.department,
      role: params.role,
      status: params.status,
      ...patch,
    };
    Object.entries(merged).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    const query = search.toString();
    return query ? `/admin/employees?${query}` : "/admin/employees";
  };

  return (
    <>
      <TableToolbar
        search={
          <form action="/admin/employees" className="contents">
            {params.department ? (
              <input
                type="hidden"
                name="department"
                value={params.department}
              />
            ) : null}
            {params.role ? (
              <input type="hidden" name="role" value={params.role} />
            ) : null}
            {params.status ? (
              <input type="hidden" name="status" value={params.status} />
            ) : null}
            <ToolbarSearch
              name="q"
              defaultValue={params.q}
              placeholder="이름 또는 이메일 검색"
              ariaLabel="이름 또는 이메일 검색"
            />
          </form>
        }
        filters={
          <>
            <FilterChip
              href={href({ status: undefined })}
              active={!params.status}
              count={total}
            >
              전체
            </FilterChip>
            {STATUS_OPTIONS.map((option) => (
              <FilterChip
                key={option.value}
                href={href({ status: option.value })}
                active={params.status === option.value}
                count={statusCounts[option.value]}
              >
                {option.label}
              </FilterChip>
            ))}
          </>
        }
        count={`${shown}명 표시 / 전체 ${total}명`}
        actions={actions}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-nano text-muted">부서</span>
        <FilterChip href={href({ department: undefined })} active={!params.department}>
          전체
        </FilterChip>
        {departments.map((department) => (
          <FilterChip
            key={department.id}
            href={href({ department: department.id })}
            active={params.department === department.id}
            count={departmentCounts.get(department.id) ?? 0}
          >
            {department.name}
          </FilterChip>
        ))}

        <span className="ml-4 text-nano text-muted">역할</span>
        <FilterChip href={href({ role: undefined })} active={!params.role}>
          전체
        </FilterChip>
        {ROLE_OPTIONS.map((option) => (
          <FilterChip
            key={option.value}
            href={href({ role: option.value })}
            active={params.role === option.value}
          >
            {option.label}
          </FilterChip>
        ))}
      </div>
    </>
  );
}
