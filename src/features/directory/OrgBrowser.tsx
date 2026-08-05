"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  ChevronsDownUp,
  ChevronsUpDown,
  Network,
  Pencil,
  Users,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SectionHeader } from "@/components/ui/Card";
import { Meter } from "@/components/ui/Progress";
import { TableToolbar, ToolbarSearch } from "@/components/ui/TableToolbar";
import { OrgEditor } from "@/features/directory/OrgEditor";
import { OrgTree } from "@/features/directory/OrgTree";
import {
  EmployeeTable,
  toEmployeeRow,
} from "@/features/directory/EmployeeTable";
import {
  departmentBars,
  departmentMembers,
  departmentPath,
  managerOf,
  searchOrg,
  tenureLabel,
  tenureMonths,
  type DirectoryEmployee,
  type OrgIndex,
  type OrgSelection,
} from "@/features/directory/org";
import { cn } from "@/lib/utils";

/**
 * 조직도 마스터-디테일.
 *
 * 예전에는 폭 100% 카드 안에 들여쓰기 텍스트 트리 하나만 있어서 실제 점유 폭이
 * 300~400px, 1400px 캔버스의 2/3가 흰 여백이었다. 좌측 트리에서 고른 부서·팀의
 * 인원을 우측에서 바로 펼친다.
 */
export function OrgBrowser({
  index,
  today,
  isSystemAdmin,
  initialSelection,
  companyName = "에임브릿지",
}: {
  index: OrgIndex;
  today: string;
  isSystemAdmin: boolean;
  initialSelection: OrgSelection;
  companyName?: string;
}) {
  const [selection, setSelection] = useState<OrgSelection>(initialSelection);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(() =>
    defaultOpenIds(index, initialSelection),
  );

  const search = useMemo(
    () => (query.trim() ? searchOrg(index, query) : null),
    [index, query],
  );

  const bars = useMemo(() => departmentBars(index), [index]);
  const maxBar = Math.max(1, ...bars.map((bar) => bar.count));

  /** 부서장·팀장으로 지정된 사람에게 트리에서 역할을 표시한다 */
  const managerRoles = useMemo(() => {
    const roles = new Map<string, string>();
    index.departments.forEach((d) => {
      if (d.manager_id) roles.set(d.manager_id, "부서장");
    });
    index.teams.forEach((t) => {
      if (t.manager_id) roles.set(t.manager_id, "팀장");
    });
    return roles;
  }, [index]);

  const allNodeIds = useMemo(
    () => [
      ...index.departments.map((d) => d.id),
      ...index.teams.map((t) => t.id),
    ],
    [index],
  );

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const select = (next: OrgSelection) => {
    setSelection(next);
    // 고른 노드는 항상 펼쳐 준다 — 닫힌 채로 선택되면 하위가 안 보인다
    if (next.kind !== "company") {
      setOpenIds((prev) => new Set(prev).add(next.id));
    }
  };

  const detail = describeSelection(index, selection, companyName);

  return (
    <div className="space-y-5">
      {/*
        08·10 흰 시트 스윕: md+에서 .ab-card는 흰 면 위 이중 테두리다.
        카드 헤더+바디를 섹션 제목 + 직접 배치로 바꾸고, md 미만(회청 canvas)
        은 카드 면을 유지한다 — CalendarBoard와 같은 전환.
      */}
      <section>
        <SectionHeader
          title="부서별 인원"
          description={`전체 ${index.employees.length}명 · 부서 ${index.departments.length}개 · 팀 ${index.teams.length}개`}
        />
        <div className="ab-card p-3 md:rounded-none md:border-0 md:p-0">
          {bars.length === 0 ? (
            <p className="py-3 text-caption">
              등록된 부서가 없습니다. 조직 구조가 등록되면 부서별 인원이 여기에
              쌓입니다.
            </p>
          ) : (
            <div className="grid gap-x-6 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
              {bars.map((bar) => {
                const active =
                  bar.id !== null &&
                  selection.kind === "department" &&
                  selection.id === bar.id;
                const share =
                  index.employees.length > 0
                    ? Math.round((bar.count / index.employees.length) * 100)
                    : 0;

                return (
                  <button
                    key={bar.id ?? "unassigned"}
                    type="button"
                    disabled={bar.id === null}
                    onClick={() =>
                      bar.id
                        ? select({ kind: "department", id: bar.id })
                        : undefined
                    }
                    className={cn(
                      "rounded-card p-2 text-left transition-colors duration-fast ease-standard",
                      active ? "bg-primary-light" : "hover:bg-subtle",
                      bar.id === null && "cursor-default",
                    )}
                  >
                    <Meter
                      value={bar.count}
                      max={maxBar}
                      tone={
                        bar.id === null
                          ? "neutral"
                          : active
                            ? "brand"
                            : "informative"
                      }
                      label={
                        <span className="truncate">
                          {bar.name}
                          {bar.managerName ? (
                            <span className="ml-1.5 text-nano">
                              {bar.managerName}
                            </span>
                          ) : null}
                        </span>
                      }
                      valueLabel={`${bar.count}명 · ${share}%`}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <TableToolbar
        className="mb-0"
        search={
          <ToolbarSearch
            value={query}
            onChange={setQuery}
            placeholder="이름·직위·부서 검색"
            ariaLabel="조직도 검색"
          />
        }
        count={
          search
            ? `${search.matchedDepartments}개 부서에서 ${search.matchedEmployees}명`
            : `${index.employees.length}명`
        }
        actions={
          <>
            {/* 표 위 액션 툴바 = 고스트 h-8 나열 (10 주소록 실측 문법) */}
            <Button
              size="small"
              variant="ghost"
              onClick={() => setOpenIds(new Set(allNodeIds))}
            >
              <ChevronsUpDown className="size-3.5" aria-hidden />
              모두 펼치기
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => setOpenIds(new Set())}
            >
              <ChevronsDownUp className="size-3.5" aria-hidden />
              모두 접기
            </Button>
            {isSystemAdmin ? (
              <Button
                size="small"
                variant={editing ? "primary" : "primary-low"}
                onClick={() => setEditing((v) => !v)}
              >
                <Pencil className="size-3.5" aria-hidden />
                {editing ? "편집 종료" : "조직 구조 편집"}
              </Button>
            ) : null}
          </>
        }
      />

      {editing ? (
        <section>
          <SectionHeader
            title="조직 구조 편집"
            description="부서·팀의 이름, 상위 조직, 담당 매니저를 지정합니다."
          />
          <div className="ab-card p-3 md:rounded-none md:border-0 md:p-0">
            <OrgEditor
              departments={index.departments}
              teams={index.teams}
              managerOptions={index.employees.map((e) => ({
                id: e.id,
                name: e.name,
              }))}
            />
          </div>
        </section>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <section className="self-start">
          <SectionHeader title="조직 구조" />
          <div className="ab-card max-h-[640px] overflow-y-auto p-3 md:rounded-none md:border-0 md:p-0">
            <OrgTree
              index={index}
              companyName={companyName}
              selected={selection}
              onSelect={select}
              openIds={openIds}
              onToggle={toggle}
              search={search}
              managerRoles={managerRoles}
            />
          </div>
        </section>

        <section className="min-w-0">
          <SectionHeader
            title={
              <span className="flex items-center gap-2">
                {detail.kind === "company" ? (
                  <Building2 className="size-4 text-muted" aria-hidden />
                ) : detail.kind === "department" ? (
                  <Network className="size-4 text-muted" aria-hidden />
                ) : (
                  <Users className="size-4 text-muted" aria-hidden />
                )}
                {detail.title}
              </span>
            }
            description={detail.path}
            action={
              detail.manager ? (
                <span className="flex items-center gap-1.5">
                  <Avatar
                    name={detail.manager.name}
                    src={detail.manager.profile_image_url}
                    size="small"
                  />
                  <span className="text-label text-ink">
                    {detail.manager.name}
                  </span>
                  <Badge tone="info">{detail.managerLabel}</Badge>
                </span>
              ) : (
                <Badge tone="neutral">
                  {detail.kind === "company" ? "전사" : "책임자 미지정"}
                </Badge>
              )
            }
          />

          <div className="ab-card md:rounded-none md:border-0">
            {/* 지표 줄 padding은 표의 셀 padding(px-4=16px)과 좌측을 맞춘다 */}
            <div className="border-b border-line px-4 py-3">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Figure
                  label="소속 인원"
                  value={detail.members.length}
                  unit="명"
                  denominator={index.employees.length}
                  denominatorUnit="명"
                />
                <Figure
                  label="하위 팀"
                  value={detail.teamCount}
                  unit="개"
                  denominator={index.teams.length}
                  denominatorUnit="개"
                />
                <Figure
                  label="하위 부서"
                  value={detail.departmentCount}
                  unit="개"
                  denominator={index.departments.length}
                  denominatorUnit="개"
                />
                <Figure
                  label="평균 근속"
                  value={tenureLabel(averageTenure(detail.members, today))}
                />
              </dl>
            </div>

            <EmployeeTable
              rows={detail.members.map((employee) =>
                toEmployeeRow(
                  employee,
                  (id) =>
                    id ? (index.departmentById.get(id)?.name ?? null) : null,
                  (id) => (id ? (index.teamById.get(id)?.name ?? null) : null),
                ),
              )}
              today={today}
              /* 주소록 표 문법(16): th 높이 48px — 이 화면 한정 */
              thClassName="h-12 align-middle"
              columns={{ department: detail.kind !== "team", phone: false }}
              minWidth="min-w-[760px]"
              emptyTitle="소속 인원이 없습니다"
              emptyDescription="이 조직에 배치된 임직원이 아직 없습니다. 인원이 배치되면 여기에 표시됩니다."
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  unit,
  denominator,
  denominatorUnit,
}: {
  label: string;
  value: string | number;
  unit?: string;
  denominator?: number;
  denominatorUnit?: string;
}) {
  return (
    <div>
      <dt className="text-nano text-muted">{label}</dt>
      <dd className="mt-0.5 flex items-baseline gap-1">
        <span className="text-body font-bold tabular-nums text-ink">
          {value}
        </span>
        {unit ? <span className="text-nano text-muted">{unit}</span> : null}
        {denominator !== undefined ? (
          <span className="text-nano tabular-nums text-muted">
            /{denominator}
            {denominatorUnit ?? ""}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

interface SelectionDetail {
  kind: OrgSelection["kind"];
  title: string;
  path: string;
  manager: DirectoryEmployee | null;
  managerLabel: string;
  members: DirectoryEmployee[];
  teamCount: number;
  departmentCount: number;
}

function describeSelection(
  index: OrgIndex,
  selection: OrgSelection,
  companyName: string,
): SelectionDetail {
  if (selection.kind === "department") {
    const department = index.departmentById.get(selection.id);
    if (department) {
      const path = departmentPath(index, department.id);
      return {
        kind: "department",
        title: department.name,
        path: [companyName, ...path.slice(0, -1).map((d) => d.name)].join(" › "),
        manager: managerOf(index, department.manager_id),
        managerLabel: "부서장",
        members: departmentMembers(index, department.id),
        teamCount: (index.teamsByDepartment.get(department.id) ?? []).length,
        departmentCount: (index.childDepartments.get(department.id) ?? []).length,
      };
    }
  }

  if (selection.kind === "team") {
    const team = index.teamById.get(selection.id);
    if (team) {
      const parent = team.department_id
        ? index.departmentById.get(team.department_id)
        : undefined;
      return {
        kind: "team",
        title: team.name,
        path: [companyName, parent?.name].filter(Boolean).join(" › "),
        manager: managerOf(index, team.manager_id),
        managerLabel: "팀장",
        members: index.membersByTeam.get(team.id) ?? [],
        teamCount: 0,
        departmentCount: 0,
      };
    }
  }

  return {
    kind: "company",
    title: companyName,
    path: "회사 전체",
    manager: null,
    managerLabel: "",
    members: index.employees,
    teamCount: index.teams.length,
    departmentCount: index.departments.length,
  };
}

function averageTenure(members: DirectoryEmployee[], today: string) {
  let sum = 0;
  let count = 0;
  members.forEach((member) => {
    const months = tenureMonths(member.hire_date, today);
    if (months !== null) {
      sum += months;
      count += 1;
    }
  });
  return count > 0 ? Math.round(sum / count) : null;
}

/** 최상위 2단계 + 선택된 노드까지의 경로를 펼친 상태로 시작한다 */
function defaultOpenIds(index: OrgIndex, selection: OrgSelection) {
  const open = new Set<string>();

  index.roots.forEach((root) => {
    open.add(root.id);
    (index.teamsByDepartment.get(root.id) ?? []).forEach((t) => open.add(t.id));
    (index.childDepartments.get(root.id) ?? []).forEach((child) =>
      open.add(child.id),
    );
  });

  if (selection.kind === "department") {
    departmentPath(index, selection.id).forEach((d) => open.add(d.id));
  }
  if (selection.kind === "team") {
    open.add(selection.id);
    const team = index.teamById.get(selection.id);
    if (team?.department_id) {
      departmentPath(index, team.department_id).forEach((d) => open.add(d.id));
    }
  }

  return open;
}
