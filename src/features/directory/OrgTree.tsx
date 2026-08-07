"use client";

import Link from "next/link";
import { Building2, ChevronRight, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { MiniMeter } from "@/components/ui/Progress";
import type {
  DirectoryEmployee,
  OrgIndex,
  OrgSearchResult,
  OrgSelection,
} from "@/features/directory/org";
import type { Department, Team } from "@/types/db";

/**
 * 조직도 트리 (스펙 02 · 3.1)
 *
 * 예전 트리는 클릭하면 접기/펼치기만 됐고 사람을 보려면 풀 페이지 전환이었다.
 * 이제 부서·팀 노드가 선택 상태를 갖고, 우측 디테일 패널이 그 소속 인원을 받는다.
 * 펼침 상태는 상위(OrgBrowser)가 들고 있어 검색·전체펼치기와 한 곳에서 맞물린다.
 */
export function OrgTree({
  index,
  companyName = "에임브릿지",
  selected,
  onSelect,
  openIds,
  onToggle,
  search,
  managerRoles,
}: {
  index: OrgIndex;
  companyName?: string;
  selected: OrgSelection;
  onSelect: (selection: OrgSelection) => void;
  openIds: Set<string>;
  onToggle: (id: string) => void;
  /** 검색 중이면 매칭 경로만 렌더하고 전부 펼친다 */
  search: OrgSearchResult | null;
  managerRoles: Map<string, string>;
}) {
  const total = index.employees.length;
  const largest = Math.max(
    1,
    ...index.roots.map((d) => index.totalByDepartment.get(d.id) ?? 0),
  );

  const visibleRoots = search
    ? index.roots.filter((d) => search.departmentIds.has(d.id))
    : index.roots;
  const visibleUnassigned = search
    ? index.unassigned.filter((e) => search.employeeIds.has(e.id))
    : index.unassigned;
  const visibleOrphanTeams = search
    ? index.orphanTeams.filter((t) => search.teamIds.has(t.id))
    : index.orphanTeams;

  const nothingToShow =
    visibleRoots.length === 0 &&
    visibleUnassigned.length === 0 &&
    visibleOrphanTeams.length === 0;

  return (
    <div className="text-body-sm">
      <button
        type="button"
        onClick={() => onSelect({ kind: "company" })}
        aria-pressed={selected.kind === "company"}
        className={cn(
          "flex w-full items-center gap-2 rounded-card px-2 py-2 text-left transition-colors duration-fast ease-standard",
          selected.kind === "company"
            ? "bg-primary-light text-primary-ink"
            : "text-ink hover:bg-subtle",
        )}
      >
        <Building2 className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-bold">{companyName}</span>
        <span className="shrink-0 text-nano tabular-nums text-muted">
          {total}명
        </span>
      </button>

      <div className="mt-1 border-l border-line pl-2">
        {nothingToShow ? (
          <p className="px-2 py-6 text-caption">
            {search
              ? "검색 결과가 없습니다. 이름·직위·부서명으로 다시 찾아보세요."
              : "등록된 부서가 없습니다. 조직 구조가 등록되면 여기에 표시됩니다."}
          </p>
        ) : null}

        {visibleUnassigned.map((employee) => (
          <EmployeeRow
            key={employee.id}
            employee={employee}
            managerRoles={managerRoles}
          />
        ))}

        {visibleOrphanTeams.map((team) => (
          <TeamNode
            key={team.id}
            team={team}
            index={index}
            selected={selected}
            onSelect={onSelect}
            openIds={openIds}
            onToggle={onToggle}
            search={search}
            managerRoles={managerRoles}
          />
        ))}

        {visibleRoots.map((department) => (
          <DepartmentNode
            key={department.id}
            department={department}
            index={index}
            largest={largest}
            selected={selected}
            onSelect={onSelect}
            openIds={openIds}
            onToggle={onToggle}
            search={search}
            managerRoles={managerRoles}
          />
        ))}
      </div>
    </div>
  );
}

interface NodeProps {
  index: OrgIndex;
  selected: OrgSelection;
  onSelect: (selection: OrgSelection) => void;
  openIds: Set<string>;
  onToggle: (id: string) => void;
  search: OrgSearchResult | null;
  managerRoles: Map<string, string>;
}

function DepartmentNode({
  department,
  largest,
  ...props
}: NodeProps & { department: Department; largest: number }) {
  const { index, selected, onSelect, openIds, onToggle, search, managerRoles } =
    props;

  const childDepartments = (index.childDepartments.get(department.id) ?? []).filter(
    (d) => !search || search.departmentIds.has(d.id),
  );
  const teams = (index.teamsByDepartment.get(department.id) ?? []).filter(
    (t) => !search || search.teamIds.has(t.id),
  );
  const directMembers = (
    index.directMembersByDepartment.get(department.id) ?? []
  ).filter((e) => !search || search.employeeIds.has(e.id));

  const memberCount = index.totalByDepartment.get(department.id) ?? 0;
  const hasChildren =
    childDepartments.length > 0 || teams.length > 0 || directMembers.length > 0;
  // 검색 중에는 매칭 경로를 손으로 펼칠 필요가 없어야 한다
  const open = search ? true : openIds.has(department.id);
  const isSelected =
    selected.kind === "department" && selected.id === department.id;

  return (
    <div>
      <NodeRow
        icon={
          <Building2
            className={cn(
              "size-4 shrink-0",
              isSelected ? "text-primary-ink" : "text-muted",
            )}
            aria-hidden
          />
        }
        label={department.name}
        bold
        count={memberCount}
        meter={<MiniMeter value={memberCount} max={largest} tone="informative" />}
        open={open}
        hasChildren={hasChildren}
        selected={isSelected}
        onToggle={() => onToggle(department.id)}
        onSelect={() => onSelect({ kind: "department", id: department.id })}
        disableToggle={!!search}
      />

      {open && hasChildren ? (
        <div className="ml-[11px] border-l border-line pl-2">
          {directMembers.map((employee) => (
            <EmployeeRow
              key={employee.id}
              employee={employee}
              managerRoles={managerRoles}
            />
          ))}
          {teams.map((team) => (
            <TeamNode key={team.id} team={team} {...props} />
          ))}
          {childDepartments.map((child) => (
            <DepartmentNode
              key={child.id}
              department={child}
              largest={largest}
              {...props}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TeamNode({ team, ...props }: NodeProps & { team: Team }) {
  const { index, selected, onSelect, openIds, onToggle, search, managerRoles } =
    props;

  const members = (index.membersByTeam.get(team.id) ?? []).filter(
    (e) => !search || search.employeeIds.has(e.id),
  );
  const open = search ? true : openIds.has(team.id);
  const isSelected = selected.kind === "team" && selected.id === team.id;

  return (
    <div>
      <NodeRow
        icon={
          <Users
            className={cn(
              "size-4 shrink-0",
              isSelected ? "text-primary-ink" : "text-muted",
            )}
            aria-hidden
          />
        }
        label={team.name}
        count={index.membersByTeam.get(team.id)?.length ?? 0}
        open={open}
        hasChildren={members.length > 0}
        selected={isSelected}
        onToggle={() => onToggle(team.id)}
        onSelect={() => onSelect({ kind: "team", id: team.id })}
        disableToggle={!!search}
      />

      {open && members.length > 0 ? (
        <div className="ml-[11px] border-l border-line pl-2">
          {members.map((employee) => (
            <EmployeeRow
              key={employee.id}
              employee={employee}
              managerRoles={managerRoles}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 접기 버튼과 선택 버튼을 분리한다.
 * 하나의 button에 두 동작을 얹으면 "펼치려고 눌렀는데 디테일이 바뀌는" 상태가 된다.
 */
function NodeRow({
  icon,
  label,
  bold,
  count,
  meter,
  open,
  hasChildren,
  selected,
  onToggle,
  onSelect,
  disableToggle,
}: {
  icon: React.ReactNode;
  label: string;
  bold?: boolean;
  count: number;
  meter?: React.ReactNode;
  open: boolean;
  hasChildren: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  disableToggle?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center rounded-card pr-1.5 transition-colors duration-fast ease-standard",
        selected ? "bg-primary-light" : "hover:bg-subtle",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasChildren || disableToggle}
        aria-expanded={open}
        aria-label={open ? `${label} 접기` : `${label} 펼치기`}
        className="grid size-6 shrink-0 place-items-center rounded-sm text-muted disabled:opacity-0"
      >
        <ChevronRight
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
          aria-hidden
        />
      </button>

      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
      >
        {icon}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            selected ? "text-primary-ink" : "text-ink",
            bold && "font-bold",
          )}
        >
          {label}
        </span>
        {meter ? <span className="hidden w-10 shrink-0 lg:block">{meter}</span> : null}
        <span className="shrink-0 text-nano tabular-nums text-muted">
          {count}
        </span>
      </button>
    </div>
  );
}

function EmployeeRow({
  employee,
  managerRoles,
}: {
  employee: DirectoryEmployee;
  managerRoles: Map<string, string>;
}) {
  const role = managerRoles.get(employee.id);

  return (
    <Link
      href={`/directory/${employee.id}`}
      className="flex items-center gap-1.5 rounded-card py-1 pl-6 pr-1.5 transition-colors duration-fast ease-standard hover:bg-subtle"
    >
      <Avatar
        name={employee.name}
        src={employee.profile_image_url}
        size="small"
      />
      <span className="min-w-0 truncate text-ink">{employee.name}</span>
      {employee.position ? (
        <span className="min-w-0 truncate text-nano text-muted">
          {employee.position}
        </span>
      ) : null}
      {/*
        색 절제(10 스윕): 트리 안 배지 틴트(info-light·warn-light 면)를 걷어내고
        직위와 같은 텍스트 단으로 내린다. 휴직만 글자색(warn-ink)으로 남긴다 —
        면 없이도 상태는 읽혀야 한다.
      */}
      {role ? (
        <span className="ml-auto shrink-0 text-nano text-muted">{role}</span>
      ) : null}
      {employee.employment_status !== "active" ? (
        <span
          className={cn(
            "shrink-0 text-nano",
            !role && "ml-auto",
            employee.employment_status === "leave"
              ? "text-warn-ink"
              : "text-muted",
          )}
        >
          {employee.employment_status === "leave" ? "휴직" : "퇴사"}
        </span>
      ) : null}
    </Link>
  );
}
