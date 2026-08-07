"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Shield, User, UserCog, Users } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Meter } from "@/components/ui/Progress";
import { OptionCardGrid } from "@/components/ui/OptionCardGrid";
import { AvatarWithName } from "@/components/ui/Avatar";
import { Badge, EmploymentStatusBadge } from "@/components/ui/Badge";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import { TableToolbar, ToolbarSearch } from "@/components/ui/TableToolbar";
import type { EmploymentStatus, RoleName } from "@/types/db";

export interface RoleMember {
  id: string;
  name: string;
  email: string;
  position: string | null;
  departmentName: string | null;
  teamName: string | null;
  employmentStatus: EmploymentStatus;
  profileImageUrl: string | null;
  roleName: RoleName;
  /** Google 계정과 연결됐는지 — 미연결이면 로그인 자체가 불가능하다 */
  linked: boolean;
}

/**
 * 역할이 실제로 무엇을 할 수 있는지.
 *
 * 이 설명은 원래도 있었지만 이 화면의 카드 부제로만 렌더되고, 정작 권한을
 * 부여하는 자리에는 아무 설명이 없었다. 선택 카드로 옮겨 "고르면 어떻게
 * 되는지"가 선택 시점에 보이게 한다.
 */
const ROLE_META: Record<
  RoleName,
  { icon: typeof Shield; scope: string; note: string; assignable: boolean }
> = {
  system_admin: {
    icon: Shield,
    scope: "역할 할당·회수, 전사 근태 조정, 시스템 전체 설정",
    note: "감사 로그에 남는 모든 관리 동작이 가능합니다",
    assignable: false,
  },
  manager: {
    icon: UserCog,
    scope: "팀원 데이터 조회, 결재 승인, 팀 공지 작성",
    note: "본인이 관리하는 팀 범위 안에서만 열람합니다",
    assignable: true,
  },
  employee: {
    icon: User,
    scope: "본인 데이터 조회·수정, 결재 기안, 공지 열람",
    note: "다른 임직원의 근태·인사정보는 볼 수 없습니다",
    assignable: true,
  },
};

const ROLE_ORDER: RoleName[] = ["system_admin", "manager", "employee"];

export function RoleBoard({
  labels,
  members,
}: {
  labels: Record<RoleName, string>;
  members: RoleMember[];
}) {
  const [selected, setSelected] = useState<RoleName>("manager");
  const [query, setQuery] = useState("");

  const countOf = (role: RoleName) =>
    members.filter((member) => member.roleName === role).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((member) => member.roleName === selected)
      .filter((member) => {
        if (!q) return true;
        return (
          member.name.toLowerCase().includes(q) ||
          member.email.toLowerCase().includes(q) ||
          (member.departmentName ?? "").toLowerCase().includes(q)
        );
      });
  }, [members, selected, query]);

  const total = members.length || 1;

  return (
    <>
      <Card className="mb-5">
        <CardHeader
          title="역할과 권한 범위"
          description="카드를 고르면 해당 역할이 배정된 임직원이 아래 표에 나옵니다"
          density="compact"
        />
        <CardBody density="compact">
          <Meter
            max={total}
            segments={ROLE_ORDER.map((role) => ({
              // 권한이 셀수록 진한 색 — 오렌지는 이 화면의 선택 상태에만 쓴다
              value: countOf(role),
              tone:
                role === "system_admin"
                  ? ("warning" as const)
                  : role === "manager"
                    ? ("informative" as const)
                    : ("neutral" as const),
              label: labels[role],
            }))}
            label="역할 분포 (권한이 넓은 순)"
            valueLabel={`${members.length}명`}
          />

          <OptionCardGrid
            className="mt-4"
            name="역할"
            value={selected}
            onChange={setSelected}
            options={ROLE_ORDER.map((role) => {
              const meta = ROLE_META[role];
              const count = countOf(role);
              return {
                value: role,
                title: labels[role],
                description: meta.scope,
                icon: meta.icon,
                meta: [
                  `${count}명 배정`,
                  `전체의 ${Math.round((count / total) * 100)}%`,
                  meta.assignable ? "임직원 상세에서 부여" : "이 화면에서 부여 불가",
                ],
              };
            })}
          />

          <p className="mt-3 text-caption">{ROLE_META[selected].note}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`${labels[selected]} 배정 인원`}
          description={ROLE_META[selected].scope}
          density="compact"
        />
        <CardBody density="compact" className="!pb-0">
          <TableToolbar
            search={
              <ToolbarSearch
                placeholder="이름·이메일·부서 검색"
                value={query}
                onChange={setQuery}
              />
            }
            count={`${visible.length}명`}
            className="mb-3"
          />
        </CardBody>
        <CardBody density="compact" className="!p-0">
          <div className="overflow-x-auto">
            <table className="ab-table ab-table--compact min-w-[720px]">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>부서·팀</th>
                  <th>직급</th>
                  <th>이메일</th>
                  <th className="w-28">로그인 계정</th>
                  <th className="w-24">재직상태</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <TableEmptyRow
                    colSpan={6}
                    icon={Users}
                    title={
                      query
                        ? "검색 결과가 없습니다"
                        : `${labels[selected]}으로 배정된 임직원이 없습니다`
                    }
                    description="역할 배정은 임직원 상세 화면에서 변경합니다."
                    action={
                      query ? undefined : (
                        <Link
                          href="/admin/employees"
                          className="text-label text-primary-ink hover:underline"
                        >
                          임직원 목록 열기
                        </Link>
                      )
                    }
                  />
                ) : (
                  visible.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <Link
                          href={`/admin/employees/${member.id}`}
                          className="hover:underline"
                        >
                          <AvatarWithName
                            name={member.name}
                            src={member.profileImageUrl}
                            size="small"
                          />
                        </Link>
                      </td>
                      <td className="text-muted">
                        {[member.departmentName, member.teamName]
                          .filter(Boolean)
                          .join(" · ") || "-"}
                      </td>
                      <td>{member.position ?? "-"}</td>
                      <td className="text-muted">{member.email}</td>
                      <td>
                        {member.linked ? (
                          <span className="text-muted">연결됨</span>
                        ) : (
                          <Badge tone="warn">미연결</Badge>
                        )}
                      </td>
                      <td>
                        <EmploymentStatusBadge status={member.employmentStatus} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
