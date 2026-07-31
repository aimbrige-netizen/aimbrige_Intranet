"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { AvatarWithName } from "@/components/ui/Avatar";
import { EmploymentStatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Field";
import { formatDate } from "@/lib/utils";
import type { Department, Team } from "@/types/db";
import type { DirectoryEmployee } from "@/features/directory/data";

/**
 * 임직원 목록 뷰 (스펙 02 · 3.1)
 * 데이터가 이미 서버에서 전부 내려와 있어 검색·필터는 클라이언트에서 처리한다.
 * useDeferredValue로 입력 반응성을 유지한다(디바운스 대체).
 */
export function EmployeeListView({
  employees,
  departments,
  teams,
  canToggleInactive,
  includeInactive,
  onToggleInactive,
}: {
  employees: DirectoryEmployee[];
  departments: Department[];
  teams: Team[];
  canToggleInactive: boolean;
  includeInactive: boolean;
  onToggleInactive: (next: boolean) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [teamId, setTeamId] = useState("");
  const deferredKeyword = useDeferredValue(keyword);

  const departmentName = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments],
  );
  const teamName = useMemo(
    () => new Map(teams.map((t) => [t.id, t.name])),
    [teams],
  );

  const teamOptions = useMemo(
    () =>
      departmentId
        ? teams.filter((team) => team.department_id === departmentId)
        : teams,
    [teams, departmentId],
  );

  const filtered = useMemo(() => {
    const q = deferredKeyword.trim().toLowerCase();
    return employees.filter((employee) => {
      if (departmentId && employee.department_id !== departmentId) return false;
      if (teamId && employee.team_id !== teamId) return false;
      if (!q) return true;
      // 이름·부서·직책·이메일 통합검색 (스펙 3.1)
      const haystack = [
        employee.name,
        employee.email,
        employee.position ?? "",
        employee.department_id
          ? (departmentName.get(employee.department_id) ?? "")
          : "",
        employee.team_id ? (teamName.get(employee.team_id) ?? "") : "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [
    employees,
    deferredKeyword,
    departmentId,
    teamId,
    departmentName,
    teamName,
  ]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 md:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="이름·부서·직책·이메일 검색"
            aria-label="임직원 통합검색"
            className="h-9 w-full rounded-card border border-line-strong bg-surface pl-9 pr-3 text-body placeholder:text-muted focus:border-primary"
          />
        </div>

        <Select
          aria-label="부서 필터"
          value={departmentId}
          onChange={(event) => {
            setDepartmentId(event.target.value);
            setTeamId("");
          }}
          className="h-9 w-auto min-w-32 py-0"
        >
          <option value="">전체 부서</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>

        <Select
          aria-label="팀 필터"
          value={teamId}
          onChange={(event) => setTeamId(event.target.value)}
          className="h-9 w-auto min-w-32 py-0"
        >
          <option value="">전체 팀</option>
          {teamOptions.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </Select>

        {/* 휴직·퇴사 포함 토글은 관리자에게만 (스펙 3.1) */}
        {canToggleInactive ? (
          <label className="flex cursor-pointer items-center gap-1.5 text-label text-ink">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => onToggleInactive(event.target.checked)}
              className="size-3.5 accent-[#ff6f0f]"
            />
            휴직·퇴사 포함
          </label>
        ) : null}

        <span className="ml-auto text-caption">{filtered.length}명</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="조건에 맞는 임직원이 없습니다"
          description="검색어나 필터를 바꿔보세요."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="ab-table min-w-[760px]">
            <thead>
              <tr>
                <th>이름</th>
                <th>직급</th>
                <th>부서</th>
                <th>팀</th>
                <th>이메일</th>
                <th>전화번호</th>
                <th>입사일</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((employee) => (
                <tr key={employee.id}>
                  <td>
                    <Link
                      href={`/directory/${employee.id}`}
                      className="inline-flex items-center gap-2 hover:underline"
                    >
                      <AvatarWithName
                        name={employee.name}
                        src={employee.profile_image_url}
                        size="small"
                      />
                      {employee.employment_status !== "active" ? (
                        <EmploymentStatusBadge
                          status={employee.employment_status}
                        />
                      ) : null}
                    </Link>
                  </td>
                  <td>{employee.position ?? "-"}</td>
                  <td>
                    {employee.department_id
                      ? (departmentName.get(employee.department_id) ?? "-")
                      : "-"}
                  </td>
                  <td>
                    {employee.team_id
                      ? (teamName.get(employee.team_id) ?? "-")
                      : "-"}
                  </td>
                  <td className="text-muted">{employee.email}</td>
                  <td className="text-muted">{employee.phone ?? "-"}</td>
                  <td className="whitespace-nowrap text-muted">
                    {formatDate(employee.hire_date)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
