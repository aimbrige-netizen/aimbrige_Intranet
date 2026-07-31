import {
  FilterChip,
  TableToolbar,
  ToolbarSearch,
} from "@/components/ui/TableToolbar";
import {
  EmployeeTable,
  toEmployeeRow,
  type EmployeeSortKey,
} from "@/features/directory/EmployeeTable";
import { EmployeeExportButton } from "@/features/directory/EmployeeExportButton";
import {
  departmentMembers,
  tenureLabel,
  tenureMonths,
  type DirectoryEmployee,
  type OrgIndex,
} from "@/features/directory/org";

/**
 * 임직원 목록 (조직도 모듈 · 목록 뷰)
 *
 * 예전 목록은 검색어·부서·팀이 컴포넌트 로컬 state였다. URL에 남지 않으니
 * 공유·북마크·뒤로가기가 전부 깨졌고, includeInactive만 URL 파라미터여서
 * 한 화면 안에 필터 저장 방식이 두 개였다. 전부 searchParams로 통일한다.
 */
export interface PeopleParams {
  q?: string;
  dept?: string;
  team?: string;
  sort?: string;
  dir?: string;
  inactive?: string;
}

export function PeopleBoard({
  index,
  today,
  params,
  canToggleInactive,
  includeInactive,
}: {
  index: OrgIndex;
  today: string;
  params: PeopleParams;
  canToggleInactive: boolean;
  includeInactive: boolean;
}) {
  const keyword = (params.q ?? "").trim().toLowerCase();
  const sortKey: EmployeeSortKey =
    params.sort === "hire_date" || params.sort === "department"
      ? params.sort
      : "name";
  const dir = params.dir === "desc" ? "desc" : "asc";

  const departmentName = (id: string | null) =>
    id ? (index.departmentById.get(id)?.name ?? null) : null;
  const teamName = (id: string | null) =>
    id ? (index.teamById.get(id)?.name ?? null) : null;

  /** 부서 필터는 하위 부서·팀까지 포함한다 — 상위 부서를 골랐는데 본부장만 나오면 안 된다 */
  const scopeIds =
    params.dept && params.dept !== "none"
      ? new Set(departmentMembers(index, params.dept).map((e) => e.id))
      : null;

  const filtered = index.employees.filter((employee) => {
    if (params.dept === "none") {
      if (employee.department_id || employee.team_id) return false;
    } else if (scopeIds && !scopeIds.has(employee.id)) {
      return false;
    }
    if (params.team && employee.team_id !== params.team) return false;
    if (!keyword) return true;

    return [
      employee.name,
      employee.email,
      employee.position ?? "",
      departmentName(employee.department_id) ?? "",
      teamName(employee.team_id) ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(keyword);
  });

  const sorted = [...filtered].sort((a, b) => {
    const factor = dir === "asc" ? 1 : -1;
    if (sortKey === "hire_date") {
      return (a.hire_date ?? "").localeCompare(b.hire_date ?? "") * factor;
    }
    if (sortKey === "department") {
      const left = departmentName(a.department_id) ?? "";
      const right = departmentName(b.department_id) ?? "";
      if (left !== right) return left.localeCompare(right, "ko") * factor;
      return a.name.localeCompare(b.name, "ko");
    }
    return a.name.localeCompare(b.name, "ko") * factor;
  });

  const href = (patch: PeopleParams & { tab?: string }) => {
    const search = new URLSearchParams();
    search.set("tab", "people");
    const merged: Record<string, string | undefined> = {
      q: params.q,
      dept: params.dept,
      team: params.team,
      sort: params.sort,
      dir: params.dir,
      inactive: params.inactive,
      ...patch,
    };
    Object.entries(merged).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    return `/directory?${search.toString()}`;
  };

  const sortHref = (key: EmployeeSortKey) =>
    href({
      sort: key,
      dir: sortKey === key && dir === "asc" ? "desc" : "asc",
    });

  const teamsOfDepartment =
    params.dept && params.dept !== "none"
      ? (index.teamsByDepartment.get(params.dept) ?? [])
      : [];

  return (
    <>
      <TableToolbar
        search={
          <form action="/directory" className="contents">
            <input type="hidden" name="tab" value="people" />
            {params.dept ? (
              <input type="hidden" name="dept" value={params.dept} />
            ) : null}
            {params.team ? (
              <input type="hidden" name="team" value={params.team} />
            ) : null}
            {params.inactive ? (
              <input type="hidden" name="inactive" value={params.inactive} />
            ) : null}
            <ToolbarSearch
              name="q"
              defaultValue={params.q}
              placeholder="이름·직급·부서·이메일 검색"
              ariaLabel="임직원 통합검색"
            />
          </form>
        }
        filters={
          <>
            <FilterChip
              href={href({ dept: undefined, team: undefined })}
              active={!params.dept}
              count={index.employees.length}
            >
              전체
            </FilterChip>
            {index.roots.map((department) => (
              <FilterChip
                key={department.id}
                href={href({ dept: department.id, team: undefined })}
                active={params.dept === department.id}
                count={index.totalByDepartment.get(department.id) ?? 0}
              >
                {department.name}
              </FilterChip>
            ))}
            {index.unassigned.length > 0 ? (
              <FilterChip
                href={href({ dept: "none", team: undefined })}
                active={params.dept === "none"}
                count={index.unassigned.length}
              >
                미배정
              </FilterChip>
            ) : null}
          </>
        }
        count={`${sorted.length}명 표시 / 전체 ${index.employees.length}명`}
        actions={
          <>
            {canToggleInactive ? (
              <FilterChip
                href={href({ inactive: includeInactive ? undefined : "1" })}
                active={includeInactive}
              >
                휴직·퇴사 포함
              </FilterChip>
            ) : null}
            <EmployeeExportButton
              rows={sorted.map((employee) => ({
                name: employee.name,
                position: employee.position,
                department: departmentName(employee.department_id),
                team: teamName(employee.team_id),
                status: employee.employment_status,
                email: employee.email,
                phone: employee.phone,
                hireDate: employee.hire_date,
                tenure: tenureLabel(tenureMonths(employee.hire_date, today)),
              }))}
            />
          </>
        }
      />

      {teamsOfDepartment.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-nano text-muted">팀</span>
          <FilterChip href={href({ team: undefined })} active={!params.team}>
            전체
          </FilterChip>
          {teamsOfDepartment.map((team) => (
            <FilterChip
              key={team.id}
              href={href({ team: team.id })}
              active={params.team === team.id}
              count={index.membersByTeam.get(team.id)?.length ?? 0}
            >
              {team.name}
            </FilterChip>
          ))}
        </div>
      ) : null}

      <div className="ab-card overflow-hidden">
        <EmployeeTable
          rows={sorted.map((employee: DirectoryEmployee) =>
            toEmployeeRow(employee, departmentName, teamName),
          )}
          today={today}
          minWidth="min-w-[1040px]"
          sort={{ key: sortKey, dir }}
          sortHref={sortHref}
          emptyTitle={
            keyword
              ? `"${params.q}"와 일치하는 임직원이 없습니다`
              : "이 조건에 맞는 임직원이 없습니다"
          }
          emptyDescription="부서 칩을 '전체'로 돌리거나 검색어를 지우면 전 직원이 보입니다."
          emptyAction={
            <FilterChip href="/directory?tab=people">필터 초기화</FilterChip>
          }
        />
      </div>
    </>
  );
}
