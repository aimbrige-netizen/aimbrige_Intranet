import type { Department, EmploymentStatus, Team } from "@/types/db";

/**
 * 조직도·임직원 화면의 공통 계산.
 *
 * 서버(page.tsx)와 클라이언트(OrgBrowser)가 같은 트리·같은 분모를 써야 해서
 * 순수 모듈로 분리했다. data.ts는 "server-only"라 여기에 타입을 두고
 * 조회 계층이 그걸 가져다 쓴다.
 *
 * 예전에는 트리 인덱스가 OrgTree 안 useMemo에만 있어서 부서별 인원·평균 근속
 * 같은 총량 지표를 만들 자리가 없었고, 화면의 유일한 숫자가 분모 없는 "N명"이었다.
 */

export interface DirectoryEmployee {
  id: string;
  name: string;
  email: string;
  position: string | null;
  phone: string | null;
  profile_image_url: string | null;
  employment_status: EmploymentStatus;
  department_id: string | null;
  team_id: string | null;
  hire_date: string | null;
}

/** 트리에서 선택된 노드 */
export type OrgSelection =
  | { kind: "company" }
  | { kind: "department"; id: string }
  | { kind: "team"; id: string };

export interface OrgIndex {
  departments: Department[];
  teams: Team[];
  employees: DirectoryEmployee[];
  employeeById: Map<string, DirectoryEmployee>;
  departmentById: Map<string, Department>;
  teamById: Map<string, Team>;
  /** 상위 부서 id → 하위 부서. 최상위는 null 키 */
  childDepartments: Map<string | null, Department[]>;
  teamsByDepartment: Map<string, Team[]>;
  membersByTeam: Map<string, DirectoryEmployee[]>;
  /** 부서에는 속하지만 팀은 없는 사람 */
  directMembersByDepartment: Map<string, DirectoryEmployee[]>;
  /** 부서·팀 모두 없는 사람 → 회사 최상단 */
  unassigned: DirectoryEmployee[];
  /** 소속 부서가 사라진 팀 — 트리에서 통째로 증발하면 안 되므로 최상단에 붙인다 */
  orphanTeams: Team[];
  /** 하위 부서까지 합산한 인원 */
  totalByDepartment: Map<string, number>;
  roots: Department[];
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildOrgIndex(
  departments: Department[],
  teams: Team[],
  employees: DirectoryEmployee[],
): OrgIndex {
  const departmentById = new Map(departments.map((d) => [d.id, d]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const childDepartments = new Map<string | null, Department[]>();
  departments.forEach((department) => {
    // 상위 부서가 없어졌으면 최상위로 올린다 — 트리에서 사라지는 것보다 낫다
    const parent =
      department.parent_id && departmentById.has(department.parent_id)
        ? department.parent_id
        : null;
    push(childDepartments, parent, department);
  });

  const teamsByDepartment = new Map<string, Team[]>();
  const orphanTeams: Team[] = [];
  teams.forEach((team) => {
    if (team.department_id && departmentById.has(team.department_id)) {
      push(teamsByDepartment, team.department_id, team);
    } else {
      orphanTeams.push(team);
    }
  });

  const membersByTeam = new Map<string, DirectoryEmployee[]>();
  const directMembersByDepartment = new Map<string, DirectoryEmployee[]>();
  const unassigned: DirectoryEmployee[] = [];

  employees.forEach((employee) => {
    if (employee.team_id && teamById.has(employee.team_id)) {
      push(membersByTeam, employee.team_id, employee);
    } else if (
      employee.department_id &&
      departmentById.has(employee.department_id)
    ) {
      push(directMembersByDepartment, employee.department_id, employee);
    } else {
      unassigned.push(employee);
    }
  });

  const totalByDepartment = new Map<string, number>();
  const visiting = new Set<string>();
  const countDepartment = (id: string): number => {
    const cached = totalByDepartment.get(id);
    if (cached !== undefined) return cached;
    // 상위·하위가 서로를 가리키는 데이터가 들어와도 무한 재귀에 빠지지 않게
    if (visiting.has(id)) return 0;
    visiting.add(id);

    const direct = directMembersByDepartment.get(id)?.length ?? 0;
    const inTeams = (teamsByDepartment.get(id) ?? []).reduce(
      (sum, team) => sum + (membersByTeam.get(team.id)?.length ?? 0),
      0,
    );
    const inChildren = (childDepartments.get(id) ?? []).reduce(
      (sum, child) => sum + countDepartment(child.id),
      0,
    );

    visiting.delete(id);
    const total = direct + inTeams + inChildren;
    totalByDepartment.set(id, total);
    return total;
  };
  departments.forEach((department) => countDepartment(department.id));

  return {
    departments,
    teams,
    employees,
    employeeById,
    departmentById,
    teamById,
    childDepartments,
    teamsByDepartment,
    membersByTeam,
    directMembersByDepartment,
    unassigned,
    orphanTeams,
    totalByDepartment,
    roots: childDepartments.get(null) ?? [],
  };
}

/** 부서 하위(팀·하위부서 포함) 인원 전체 */
export function departmentMembers(
  index: OrgIndex,
  departmentId: string,
  seen = new Set<string>(),
): DirectoryEmployee[] {
  if (seen.has(departmentId)) return [];
  seen.add(departmentId);

  const direct = index.directMembersByDepartment.get(departmentId) ?? [];
  const inTeams = (index.teamsByDepartment.get(departmentId) ?? []).flatMap(
    (team) => index.membersByTeam.get(team.id) ?? [],
  );
  const inChildren = (index.childDepartments.get(departmentId) ?? []).flatMap(
    (child) => departmentMembers(index, child.id, seen),
  );

  return [...direct, ...inTeams, ...inChildren];
}

/** 회사 → 부서 → 하위 부서 경로 */
export function departmentPath(
  index: OrgIndex,
  departmentId: string,
): Department[] {
  const path: Department[] = [];
  const seen = new Set<string>();
  let current = index.departmentById.get(departmentId) ?? null;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parent_id
      ? (index.departmentById.get(current.parent_id) ?? null)
      : null;
  }
  return path;
}

/** 부서·팀의 매니저. 지정돼 있어도 목록에 없으면(퇴사 등) null */
export function managerOf(
  index: OrgIndex,
  managerId: string | null,
): DirectoryEmployee | null {
  if (!managerId) return null;
  return index.employeeById.get(managerId) ?? null;
}

// ---------------------------------------------------------------------------
// 근속
// ---------------------------------------------------------------------------

function parseYmd(value: string | null | undefined) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!matched) return null;
  return {
    year: Number(matched[1]),
    month: Number(matched[2]),
    day: Number(matched[3]),
  };
}

/** 입사일부터 기준일까지 개월 수. 날짜가 없거나 미래면 null */
export function tenureMonths(
  hireDate: string | null | undefined,
  today: string,
): number | null {
  const from = parseYmd(hireDate);
  const to = parseYmd(today);
  if (!from || !to) return null;

  let months =
    (to.year - from.year) * 12 + (to.month - from.month) - (to.day < from.day ? 1 : 0);
  if (months < 0) months = 0;
  return months;
}

/** 28 → "2년 4개월", 7 → "7개월", 0 → "1개월 미만" */
export function tenureLabel(months: number | null): string {
  if (months === null) return "-";
  if (months <= 0) return "1개월 미만";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest}개월`;
  return rest === 0 ? `${years}년` : `${years}년 ${rest}개월`;
}

function toUtcDays(value: string | null | undefined): number | null {
  const parsed = parseYmd(value);
  if (!parsed) return null;
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day) / 86_400_000;
}

/** 기준일로부터 며칠 전에 입사했는지 */
export function daysSince(
  date: string | null | undefined,
  today: string,
): number | null {
  const from = toUtcDays(date);
  const to = toUtcDays(today);
  if (from === null || to === null) return null;
  return to - from;
}

// ---------------------------------------------------------------------------
// 요약 지표
// ---------------------------------------------------------------------------

export interface OrgStats {
  /** 이 화면이 볼 수 있는 인원 전체 (일반 사용자는 재직자만) */
  total: number;
  active: number;
  onLeave: number;
  terminated: number;
  departmentCount: number;
  teamCount: number;
  /** 팀까지 배치된 인원 */
  inTeam: number;
  /** 부서·팀 모두 없는 인원 */
  unassigned: number;
  avgTenureMonths: number | null;
  maxTenureMonths: number | null;
  /** 최근 90일 입사 */
  recentHires: number;
  /** 인원이 가장 많은 최상위 부서 인원 */
  largestDepartment: number;
}

export const RECENT_HIRE_DAYS = 90;

export function computeOrgStats(index: OrgIndex, today: string): OrgStats {
  const { employees } = index;

  let onLeave = 0;
  let terminated = 0;
  let inTeam = 0;
  let recentHires = 0;
  let tenureSum = 0;
  let tenureCount = 0;
  let maxTenure: number | null = null;

  employees.forEach((employee) => {
    if (employee.employment_status === "leave") onLeave += 1;
    if (employee.employment_status === "terminated") terminated += 1;
    if (employee.team_id && index.teamById.has(employee.team_id)) inTeam += 1;

    const since = daysSince(employee.hire_date, today);
    if (since !== null && since >= 0 && since <= RECENT_HIRE_DAYS) {
      recentHires += 1;
    }

    const months = tenureMonths(employee.hire_date, today);
    if (months !== null) {
      tenureSum += months;
      tenureCount += 1;
      if (maxTenure === null || months > maxTenure) maxTenure = months;
    }
  });

  const largestDepartment = index.roots.reduce(
    (max, department) =>
      Math.max(max, index.totalByDepartment.get(department.id) ?? 0),
    0,
  );

  return {
    total: employees.length,
    active: employees.length - onLeave - terminated,
    onLeave,
    terminated,
    departmentCount: index.departments.length,
    teamCount: index.teams.length,
    inTeam,
    unassigned: index.unassigned.length,
    avgTenureMonths: tenureCount > 0 ? Math.round(tenureSum / tenureCount) : null,
    maxTenureMonths: maxTenure,
    recentHires,
    largestDepartment,
  };
}

export interface DepartmentBar {
  /** null이면 조직 미배정 */
  id: string | null;
  name: string;
  count: number;
  teamCount: number;
  managerName: string | null;
}

/** 최상위 부서별 인원(하위 부서 포함) + 미배정. 인원 많은 순 */
export function departmentBars(index: OrgIndex): DepartmentBar[] {
  const bars: DepartmentBar[] = index.roots.map((department) => ({
    id: department.id,
    name: department.name,
    count: index.totalByDepartment.get(department.id) ?? 0,
    teamCount: (index.teamsByDepartment.get(department.id) ?? []).length,
    managerName: managerOf(index, department.manager_id)?.name ?? null,
  }));

  bars.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));

  if (index.unassigned.length > 0) {
    bars.push({
      id: null,
      name: "조직 미배정",
      count: index.unassigned.length,
      teamCount: 0,
      managerName: null,
    });
  }
  return bars;
}

// ---------------------------------------------------------------------------
// 트리 검색
// ---------------------------------------------------------------------------

export interface OrgSearchResult {
  departmentIds: Set<string>;
  teamIds: Set<string>;
  employeeIds: Set<string>;
  matchedEmployees: number;
  matchedDepartments: number;
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

/**
 * 트리 검색 — 매칭된 노드까지의 경로를 전부 열어 준다.
 *
 * 예전에는 조직도 뷰에 검색 자체가 없었고 3뎁스부터는 접힌 채로 시작해서,
 * 깊은 조직의 인원은 화면에 나타나지도 않고 찾을 방법도 없었다.
 */
export function searchOrg(index: OrgIndex, query: string): OrgSearchResult {
  const q = normalize(query.trim());
  const departmentIds = new Set<string>();
  const teamIds = new Set<string>();
  const employeeIds = new Set<string>();

  if (!q) {
    return {
      departmentIds,
      teamIds,
      employeeIds,
      matchedEmployees: 0,
      matchedDepartments: 0,
    };
  }

  const includeDepartmentTree = (departmentId: string) => {
    if (departmentIds.has(departmentId)) return;
    departmentIds.add(departmentId);
    (index.directMembersByDepartment.get(departmentId) ?? []).forEach((e) =>
      employeeIds.add(e.id),
    );
    (index.teamsByDepartment.get(departmentId) ?? []).forEach((team) => {
      teamIds.add(team.id);
      (index.membersByTeam.get(team.id) ?? []).forEach((e) =>
        employeeIds.add(e.id),
      );
    });
    (index.childDepartments.get(departmentId) ?? []).forEach((child) =>
      includeDepartmentTree(child.id),
    );
  };

  const includeAncestors = (departmentId: string | null | undefined) => {
    if (!departmentId) return;
    departmentPath(index, departmentId).forEach((d) => departmentIds.add(d.id));
  };

  index.departments.forEach((department) => {
    if (normalize(department.name).includes(q)) {
      includeAncestors(department.parent_id);
      includeDepartmentTree(department.id);
    }
  });

  index.teams.forEach((team) => {
    if (!normalize(team.name).includes(q)) return;
    teamIds.add(team.id);
    includeAncestors(team.department_id);
    (index.membersByTeam.get(team.id) ?? []).forEach((e) =>
      employeeIds.add(e.id),
    );
  });

  let matchedEmployees = 0;
  const matchedDepartmentIds = new Set<string>();

  index.employees.forEach((employee) => {
    const haystack = [
      employee.name,
      employee.position ?? "",
      employee.email,
      employee.department_id
        ? (index.departmentById.get(employee.department_id)?.name ?? "")
        : "",
      employee.team_id
        ? (index.teamById.get(employee.team_id)?.name ?? "")
        : "",
    ]
      .join(" ")
      .toLowerCase();

    if (!haystack.includes(q)) return;

    matchedEmployees += 1;
    employeeIds.add(employee.id);
    if (employee.team_id) teamIds.add(employee.team_id);
    if (employee.department_id) {
      matchedDepartmentIds.add(employee.department_id);
      includeAncestors(employee.department_id);
    }
    const team = employee.team_id
      ? index.teamById.get(employee.team_id)
      : undefined;
    if (team?.department_id) {
      matchedDepartmentIds.add(team.department_id);
      includeAncestors(team.department_id);
    }
  });

  return {
    departmentIds,
    teamIds,
    employeeIds,
    matchedEmployees,
    matchedDepartments: matchedDepartmentIds.size,
  };
}
