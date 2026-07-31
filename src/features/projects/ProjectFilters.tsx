import {
  FilterChip,
  TableToolbar,
  ToolbarSearch,
} from "@/components/ui/TableToolbar";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
  type ProjectTeam,
} from "./types";

/**
 * 프로젝트 목록의 검색·상태·팀 필터 (스펙 10 · 3.1)
 *
 * 드롭다운 대신 건수 붙은 칩을 쓴다 — 닫혀 있는 드롭다운은 선택지도, 각
 * 선택지가 몇 건인지도 감춘다(임직원 관리 목록과 같은 규칙).
 * 전부 URL 파라미터라 공유·뒤로가기가 그대로 동작한다.
 *
 * 훅을 쓰지 않으므로 서버 컴포넌트에서 그대로 렌더된다.
 */
export interface ProjectFilterParams {
  q?: string;
  status?: string;
  team?: string;
}

export function ProjectFilters({
  params,
  teams,
  statusCounts,
  teamCounts,
  total,
  shown,
  actions,
}: {
  params: ProjectFilterParams;
  teams: ProjectTeam[];
  statusCounts: Record<ProjectStatus, number>;
  teamCounts: Map<string, number>;
  total: number;
  shown: number;
  actions?: React.ReactNode;
}) {
  const href = (patch: ProjectFilterParams) => {
    const search = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q: params.q,
      status: params.status,
      team: params.team,
      ...patch,
    };
    Object.entries(merged).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    const query = search.toString();
    return query ? `/projects?${query}` : "/projects";
  };

  // 팀 미지정 프로젝트가 하나도 없으면 칩을 그리지 않는다
  const noTeamCount = teamCounts.get("") ?? 0;

  return (
    <>
      <TableToolbar
        search={
          <form action="/projects" className="contents">
            {params.status ? (
              <input type="hidden" name="status" value={params.status} />
            ) : null}
            {params.team ? (
              <input type="hidden" name="team" value={params.team} />
            ) : null}
            <ToolbarSearch
              name="q"
              defaultValue={params.q}
              placeholder="프로젝트명 검색"
              ariaLabel="프로젝트명 검색"
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
            {PROJECT_STATUSES.map((status) => (
              <FilterChip
                key={status}
                href={href({ status })}
                active={params.status === status}
                count={statusCounts[status]}
              >
                {PROJECT_STATUS_LABELS[status]}
              </FilterChip>
            ))}
          </>
        }
        count={`${shown}건 표시 / 전체 ${total}건`}
        actions={actions}
      />

      {teams.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-nano text-muted">담당팀</span>
          <FilterChip href={href({ team: undefined })} active={!params.team}>
            전체
          </FilterChip>
          {teams.map((team) => (
            <FilterChip
              key={team.id}
              href={href({ team: team.id })}
              active={params.team === team.id}
              count={teamCounts.get(team.id) ?? 0}
            >
              {team.name}
            </FilterChip>
          ))}
          {noTeamCount > 0 ? (
            <FilterChip
              href={href({ team: "none" })}
              active={params.team === "none"}
              count={noTeamCount}
            >
              팀 미지정
            </FilterChip>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
