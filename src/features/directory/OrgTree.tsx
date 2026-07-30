"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Building2, Users, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import type { Department, Team } from "@/types/db";
import type { DirectoryEmployee } from "@/features/directory/data";

/**
 * 조직도 트리 (스펙 02 · 3.1)
 * departments → teams → employees 계층. 외부 라이브러리 없이 재귀 렌더링한다.
 *
 * 부서가 없는 임직원(대표·이사 등)은 스펙대로 회사 최상단에 바로 붙인다.
 */
export function OrgTree({
  departments,
  teams,
  employees,
  companyName = "에임브릿지",
}: {
  departments: Department[];
  teams: Team[];
  employees: DirectoryEmployee[];
  companyName?: string;
}) {
  const index = useMemo(() => {
    const childDepartments = new Map<string | null, Department[]>();
    departments.forEach((department) => {
      const key = department.parent_id;
      childDepartments.set(key, [
        ...(childDepartments.get(key) ?? []),
        department,
      ]);
    });

    const teamsByDepartment = new Map<string, Team[]>();
    teams.forEach((team) => {
      if (!team.department_id) return;
      teamsByDepartment.set(team.department_id, [
        ...(teamsByDepartment.get(team.department_id) ?? []),
        team,
      ]);
    });

    const employeesByTeam = new Map<string, DirectoryEmployee[]>();
    // 부서에는 속하지만 팀은 없는 사람
    const employeesByDepartmentOnly = new Map<string, DirectoryEmployee[]>();
    // 부서도 팀도 없는 사람 → 회사 최상단
    const topLevel: DirectoryEmployee[] = [];

    employees.forEach((employee) => {
      if (employee.team_id) {
        employeesByTeam.set(employee.team_id, [
          ...(employeesByTeam.get(employee.team_id) ?? []),
          employee,
        ]);
      } else if (employee.department_id) {
        employeesByDepartmentOnly.set(employee.department_id, [
          ...(employeesByDepartmentOnly.get(employee.department_id) ?? []),
          employee,
        ]);
      } else {
        topLevel.push(employee);
      }
    });

    return {
      childDepartments,
      teamsByDepartment,
      employeesByTeam,
      employeesByDepartmentOnly,
      topLevel,
    };
  }, [departments, teams, employees]);

  const roots = index.childDepartments.get(null) ?? [];

  return (
    <div className="text-body">
      <div className="flex items-center gap-2 rounded-lg bg-primary-light px-3 py-2 font-semibold text-primary">
        <Building2 className="size-4" aria-hidden />
        {companyName}
      </div>

      <div className="mt-1 border-l border-line pl-3">
        {index.topLevel.map((employee) => (
          <EmployeeRow key={employee.id} employee={employee} />
        ))}

        {roots.length === 0 && index.topLevel.length === 0 ? (
          <p className="py-6 text-caption">
            등록된 조직이 없습니다. 편집 모드에서 부서를 추가하세요.
          </p>
        ) : null}

        {roots.map((department) => (
          <DepartmentNode
            key={department.id}
            department={department}
            index={index}
            depth={0}
          />
        ))}
      </div>
    </div>
  );
}

type TreeIndex = {
  childDepartments: Map<string | null, Department[]>;
  teamsByDepartment: Map<string, Team[]>;
  employeesByTeam: Map<string, DirectoryEmployee[]>;
  employeesByDepartmentOnly: Map<string, DirectoryEmployee[]>;
  topLevel: DirectoryEmployee[];
};

function DepartmentNode({
  department,
  index,
  depth,
}: {
  department: Department;
  index: TreeIndex;
  depth: number;
}) {
  // 상위 2단계는 기본 펼침 — 처음 들어왔을 때 조직 윤곽이 바로 보이도록
  const [open, setOpen] = useState(depth < 2);

  const childDepartments = index.childDepartments.get(department.id) ?? [];
  const teams = index.teamsByDepartment.get(department.id) ?? [];
  const directMembers =
    index.employeesByDepartmentOnly.get(department.id) ?? [];

  const memberCount =
    directMembers.length +
    teams.reduce(
      (sum, team) => sum + (index.employeesByTeam.get(team.id)?.length ?? 0),
      0,
    );

  const hasChildren =
    childDepartments.length > 0 || teams.length > 0 || directMembers.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-canvas"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted transition-transform",
            open && "rotate-90",
            !hasChildren && "invisible",
          )}
          aria-hidden
        />
        <Building2 className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="font-medium text-ink">{department.name}</span>
        {memberCount > 0 ? (
          <span className="text-caption">{memberCount}명</span>
        ) : null}
      </button>

      {open ? (
        <div className="ml-[9px] border-l border-line pl-3">
          {directMembers.map((employee) => (
            <EmployeeRow key={employee.id} employee={employee} />
          ))}
          {teams.map((team) => (
            <TeamNode key={team.id} team={team} index={index} />
          ))}
          {childDepartments.map((child) => (
            <DepartmentNode
              key={child.id}
              department={child}
              index={index}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TeamNode({ team, index }: { team: Team; index: TreeIndex }) {
  const [open, setOpen] = useState(true);
  const members = index.employeesByTeam.get(team.id) ?? [];

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-canvas"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted transition-transform",
            open && "rotate-90",
            members.length === 0 && "invisible",
          )}
          aria-hidden
        />
        <Users className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="text-ink">{team.name}</span>
        {members.length > 0 ? (
          <span className="text-caption">{members.length}명</span>
        ) : null}
      </button>

      {open && members.length > 0 ? (
        <div className="ml-[9px] border-l border-line pl-3">
          {members.map((employee) => (
            <EmployeeRow key={employee.id} employee={employee} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmployeeRow({ employee }: { employee: DirectoryEmployee }) {
  return (
    <Link
      href={`/directory/${employee.id}`}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-canvas"
    >
      <UserRound className="size-3.5 shrink-0 text-transparent" aria-hidden />
      <Avatar
        name={employee.name}
        src={employee.profile_image_url}
        size="sm"
      />
      <span className="truncate text-ink">{employee.name}</span>
      {employee.position ? (
        <span className="truncate text-caption">{employee.position}</span>
      ) : null}
      {employee.employment_status !== "active" ? (
        <Badge tone={employee.employment_status === "leave" ? "warn" : "neutral"}>
          {employee.employment_status === "leave" ? "휴직" : "퇴사"}
        </Badge>
      ) : null}
    </Link>
  );
}
