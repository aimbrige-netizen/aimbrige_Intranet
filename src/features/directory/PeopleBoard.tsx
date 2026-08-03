import {
  FilterChip,
  TableToolbar,
  ToolbarSearch,
} from "@/components/ui/TableToolbar";
import {
  EmployeeTable,
  sortEmployeeRows,
  toEmployeeRow,
  EMPLOYEE_SORT_KEYS,
  type EmployeeSortKey,
} from "@/features/directory/EmployeeTable";
import { EmployeeExportButton } from "@/features/directory/EmployeeExportButton";
import {
  departmentMembers,
  tenureLabel,
  tenureMonths,
  type OrgIndex,
} from "@/features/directory/org";
import { parseSortDir, parseSortKey, toggledDir } from "@/lib/sort";

/**
 * 임직원 목록 (조직도 모듈 · 목록 뷰)
 *
 * 예전 목록은 검색어·부서·팀이 컴포넌트 로컬 state였다. URL에 남지 않으니
 * 공유·북마크·뒤로가기가 전부 깨졌고, includeInactive만 URL 파라미터여서
 * 한 화면 안에 필터 저장 방식이 두 개였다. 전부 searchParams로 통일한다.
 *
 * 파라미터 이름은 관리자 임직원 목록과 같은 규약을 쓴다
 * (q / department / team / status / sort / dir). 예전 dept는 여기서만
 * 쓰던 이름이라 department로 맞췄다.
 */
export interface PeopleParams {
  q?: string;
  department?: string;
  team?: string;
  sort?: string;
  dir?: string;
  inactive?: string;
}

/** 이 뷰는 전 인원을 메모리에 들고 있어 부서 정렬까지 그대로 된다 */
const SORTABLE: readonly EmployeeSortKey[] = EMPLOYEE_SORT_KEYS;

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
  const sortKey = parseSortKey(params.sort, SORTABLE);
  const dir = parseSortDir(params.dir);

  const departmentName = (id: string | null) =>
    id ? (index.departmentById.get(id)?.name ?? null) : null;
  const teamName = (id: string | null) =>
    id ? (index.teamById.get(id)?.name ?? null) : null;

  /** 부서 필터는 하위 부서·팀까지 포함한다 — 상위 부서를 골랐는데 본부장만 나오면 안 된다 */
  const scopeIds =
    params.department && params.department !== "none"
      ? new Set(departmentMembers(index, params.department).map((e) => e.id))
      : null;

  const filtered = index.employees.filter((employee) => {
    if (params.department === "none") {
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

  const sorted = sortEmployeeRows(
    filtered.map((employee) =>
      toEmployeeRow(employee, departmentName, teamName),
    ),
    { key: sortKey, dir },
  );

  const href = (patch: PeopleParams & { tab?: string }) => {
    const search = new URLSearchParams();
    search.set("tab", "people");
    const merged: Record<string, string | undefined> = {
      q: params.q,
      department: params.department,
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
      // 입사일은 최근 입사자부터 보는 쪽이 자연스럽다
      dir: toggledDir(sortKey === key, dir, key === "hire_date" ? "desc" : "asc"),
    });

  const teamsOfDepartment =
    params.department && params.department !== "none"
      ? (index.teamsByDepartment.get(params.department) ?? [])
      : [];

  return (
    <>
      <TableToolbar
        search={
          <form action="/directory" className="contents">
            <input type="hidden" name="tab" value="people" />
            {params.department ? (
              <input
                type="hidden"
                name="department"
                value={params.department}
              />
            ) : null}
            {params.team ? (
              <input type="hidden" name="team" value={params.team} />
            ) : null}
            {params.sort ? (
              <input type="hidden" name="sort" value={params.sort} />
            ) : null}
            {params.dir ? (
              <input type="hidden" name="dir" value={params.dir} />
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
              href={href({ department: undefined, team: undefined })}
              active={!params.department}
              count={index.employees.length}
            >
              전체
            </FilterChip>
            {index.roots.map((department) => (
              <FilterChip
                key={department.id}
                href={href({ department: department.id, team: undefined })}
                active={params.department === department.id}
                count={index.totalByDepartment.get(department.id) ?? 0}
              >
                {department.name}
              </FilterChip>
            ))}
            {index.unassigned.length > 0 ? (
              <FilterChip
                href={href({ department: "none", team: undefined })}
                active={params.department === "none"}
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
            {/*
              조직도는 이미 받아 둔 목록을 그대로 넘긴다 — 추가 왕복이 없다.
              배열로 넘기는 게 핵심이다. 여기는 서버 컴포넌트라 fetchRows에
              인라인 클로저를 물리면 RSC 직렬화가 던진다(서버 액션만 넘어간다).
            */}
            <EmployeeExportButton
              variant="ghost"
              total={sorted.length}
              rows={sorted.map((employee) => ({
                name: employee.name,
                position: employee.position,
                department: employee.departmentName,
                team: employee.teamName,
                status: employee.employmentStatus,
                email: employee.email,
                phone: employee.phone,
                hireDate: employee.hireDate,
                tenure: tenureLabel(tenureMonths(employee.hireDate, today)),
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

      {/*
        08·10 흰 시트: md+에서 .ab-card는 흰 면 위 이중 테두리 — 표를 시트에
        직접 놓는다. md 미만(회청 canvas)은 카드 면 유지(캘린더 패턴).
      */}
      <div className="ab-card overflow-hidden md:rounded-none md:border-0">
        <EmployeeTable
          rows={sorted}
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
