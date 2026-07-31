import type { Metadata } from "next";
import {
  Building2,
  CalendarClock,
  Contact,
  Handshake,
  UserPlus,
  UserRoundCheck,
  Users,
  UsersRound,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StatCard } from "@/components/ui/StatCard";
import { ExternalContacts } from "@/features/directory/ExternalContacts";
import { OrgBrowser } from "@/features/directory/OrgBrowser";
import { PeopleBoard } from "@/features/directory/PeopleBoard";
import {
  getDirectory,
  getExternalContacts,
} from "@/features/directory/data";
import {
  buildOrgIndex,
  computeOrgStats,
  tenureLabel,
  RECENT_HIRE_DAYS,
  type OrgSelection,
} from "@/features/directory/org";
import { requireSessionEmployee } from "@/lib/auth/session";
import { todayInSeoul } from "@/lib/utils";

export const metadata: Metadata = { title: "조직도·임직원" };

type Tab = "org" | "people" | "external";

const COMPANY_NAME = "에임브릿지";

interface SearchParams {
  tab?: string;
  dept?: string;
  team?: string;
  q?: string;
  sort?: string;
  dir?: string;
  inactive?: string;
}

/**
 * 조직도·임직원.
 *
 * 예전에는 PageHeader 다음이 곧바로 인라인 탭바였고 그 아래 폭 100% 카드 하나에
 * 들여쓰기 텍스트 트리만 있었다. 하위 화면 이동은 모듈 패널이 맡으므로 탭바를
 * 없애고, 그 자리에 분모 있는 요약 밴드와 부서별 인원 막대를 놓는다.
 */
export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const me = await requireSessionEmployee();

  const tab: Tab =
    searchParams.tab === "people" || searchParams.tab === "list"
      ? "people"
      : searchParams.tab === "external"
        ? "external"
        : "org";

  // 휴직·퇴사 포함은 관리자만 (스펙 3.1) — 일반 사용자는 파라미터를 넣어도 무시
  const includeInactive = me.isSystemAdmin && searchParams.inactive === "1";

  const [directory, contacts] = await Promise.all([
    getDirectory({ includeInactive }),
    tab === "external" ? getExternalContacts() : Promise.resolve([]),
  ]);

  const today = todayInSeoul();
  const index = buildOrgIndex(
    directory.departments,
    directory.teams,
    directory.employees,
  );
  const stats = computeOrgStats(index, today);

  const myDepartmentSize = me.department_id
    ? (index.totalByDepartment.get(me.department_id) ?? 0)
    : 0;
  const myTeamSize = me.team_id
    ? (index.membersByTeam.get(me.team_id)?.length ?? 0)
    : 0;

  const scopeHref = (patch: { dept?: string; team?: string }) => {
    const params = new URLSearchParams();
    if (tab !== "org") params.set("tab", tab);
    if (patch.dept) params.set("dept", patch.dept);
    if (patch.team) params.set("team", patch.team);
    if (searchParams.inactive) params.set("inactive", searchParams.inactive);
    const query = params.toString();
    return query ? `/directory?${query}` : "/directory";
  };

  const scope =
    searchParams.team && searchParams.team === me.team_id
      ? "team"
      : searchParams.dept && searchParams.dept === me.department_id
        ? "dept"
        : searchParams.dept || searchParams.team
          ? "custom"
          : "all";

  const initialSelection: OrgSelection = searchParams.team
    ? { kind: "team", id: searchParams.team }
    : searchParams.dept && searchParams.dept !== "none"
      ? { kind: "department", id: searchParams.dept }
      : { kind: "company" };

  const title =
    tab === "people"
      ? "임직원 목록"
      : tab === "external"
        ? "외부 연락처"
        : "조직도";

  return (
    <>
      <PageHeader
        title={title}
        meta={
          tab === "external" ? (
            <>
              <span>{COMPANY_NAME}</span>
              <span>·</span>
              <span>벤더·거래처·파트너 {contacts.length}건</span>
              <span>·</span>
              <span>전 직원 조회 가능</span>
            </>
          ) : (
            <>
              <span>{COMPANY_NAME}</span>
              <span>·</span>
              <span>재직 {stats.active}명</span>
              <span>·</span>
              <span>
                부서 {stats.departmentCount}개 · 팀 {stats.teamCount}개
              </span>
              <span>·</span>
              <span>기준 {today}</span>
            </>
          )
        }
        toolbar={
          tab === "external" ? undefined : (
            <div className="flex justify-end">
              <SegmentedControl
                ariaLabel="조회 범위"
                value={scope}
                options={[
                  {
                    value: "all",
                    label: "전체 회사",
                    href: scopeHref({}),
                    badge: stats.total,
                  },
                  {
                    value: "dept",
                    label: "내 부서",
                    href: scopeHref({ dept: me.department_id ?? undefined }),
                    badge: myDepartmentSize,
                    disabled: !me.department_id,
                  },
                  {
                    value: "team",
                    label: "내 팀",
                    href: scopeHref({ team: me.team_id ?? undefined }),
                    badge: myTeamSize,
                    disabled: !me.team_id,
                  },
                ]}
              />
            </div>
          )
        }
      />

      {tab === "external" ? (
        <ContactStatBand contacts={contacts} currentEmployeeId={me.id} />
      ) : (
        <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="재직 인원"
            value={stats.active}
            unit="명"
            denominator={stats.total}
            denominatorUnit="명"
            tone="brand"
            icon={UserRoundCheck}
            emphasis
            max={stats.total || 1}
            meterValue={stats.active}
            sub={
              includeInactive
                ? `휴직 ${stats.onLeave}명 · 퇴사 ${stats.terminated}명 포함`
                : `부서 ${stats.departmentCount}개 · 팀 ${stats.teamCount}개에 배치`
            }
          />
          <StatCard
            label="팀 배치 인원"
            value={stats.inTeam}
            unit="명"
            denominator={stats.total}
            denominatorUnit="명"
            tone="informative"
            icon={UsersRound}
            max={stats.total || 1}
            meterValue={stats.inTeam}
            sub={
              stats.unassigned > 0
                ? `조직 미배정 ${stats.unassigned}명`
                : "전원 부서·팀 배치 완료"
            }
          />
          <StatCard
            label="평균 근속"
            value={tenureLabel(stats.avgTenureMonths)}
            tone="neutral"
            icon={CalendarClock}
            state={stats.avgTenureMonths === null ? "empty" : "ok"}
            max={stats.maxTenureMonths ?? undefined}
            meterValue={stats.avgTenureMonths ?? undefined}
            scale
            scaleMaxLabel={tenureLabel(stats.maxTenureMonths)}
            sub={`최장 근속 ${tenureLabel(stats.maxTenureMonths)}`}
          />
          <StatCard
            label={`최근 ${RECENT_HIRE_DAYS}일 입사`}
            value={stats.recentHires}
            unit="명"
            denominator={stats.total}
            denominatorUnit="명"
            tone="neutral"
            icon={UserPlus}
            max={stats.total || 1}
            meterValue={stats.recentHires}
            sub={
              stats.largestDepartment > 0
                ? `최대 부서 ${stats.largestDepartment}명`
                : "부서 배치 전"
            }
          />
        </div>
      )}

      {tab === "org" ? (
        <OrgBrowser
          index={index}
          today={today}
          isSystemAdmin={me.isSystemAdmin}
          initialSelection={initialSelection}
          companyName={COMPANY_NAME}
        />
      ) : null}

      {tab === "people" ? (
        <PeopleBoard
          index={index}
          today={today}
          params={{
            q: searchParams.q,
            dept: searchParams.dept,
            team: searchParams.team,
            sort: searchParams.sort,
            dir: searchParams.dir,
            inactive: searchParams.inactive,
          }}
          canToggleInactive={me.isSystemAdmin}
          includeInactive={includeInactive}
        />
      ) : null}

      {tab === "external" ? (
        <ExternalContacts
          contacts={contacts}
          currentEmployeeId={me.id}
          isSystemAdmin={me.isSystemAdmin}
        />
      ) : null}
    </>
  );
}

/** 외부 연락처 요약 밴드 — 건수만 있던 자리에 분모를 붙인다 */
function ContactStatBand({
  contacts,
  currentEmployeeId,
}: {
  contacts: Awaited<ReturnType<typeof getExternalContacts>>;
  currentEmployeeId: string;
}) {
  const total = contacts.length;
  const categorized = contacts.filter((c) => !!c.category).length;
  const mine = contacts.filter((c) => c.created_by === currentEmployeeId).length;
  const companies = new Set(
    contacts.map((c) => c.company).filter((value): value is string => !!value),
  ).size;

  const cutoff = Date.now() - 30 * 86_400_000;
  const recent = contacts.filter(
    (c) => new Date(c.created_at).getTime() >= cutoff,
  ).length;

  return (
    <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard
        label="분류된 연락처"
        value={categorized}
        unit="건"
        denominator={total}
        denominatorUnit="건"
        tone="brand"
        icon={Contact}
        emphasis
        max={total || 1}
        meterValue={categorized}
        sub={
          total - categorized > 0
            ? `미분류 ${total - categorized}건`
            : "전 건 분류 완료"
        }
      />
      <StatCard
        label="내가 등록"
        value={mine}
        unit="건"
        denominator={total}
        denominatorUnit="건"
        tone="informative"
        icon={Users}
        max={total || 1}
        meterValue={mine}
        sub="등록자만 수정·삭제할 수 있습니다"
      />
      <StatCard
        label="거래 회사"
        value={companies}
        unit="곳"
        denominator={total}
        denominatorUnit="건"
        tone="neutral"
        icon={Building2}
        max={total || 1}
        meterValue={companies}
        sub={
          total > 0
            ? `회사당 평균 ${(total / Math.max(1, companies)).toFixed(1)}명`
            : "등록된 회사가 없습니다"
        }
      />
      <StatCard
        label="최근 30일 등록"
        value={recent}
        unit="건"
        denominator={total}
        denominatorUnit="건"
        tone="neutral"
        icon={Handshake}
        max={total || 1}
        meterValue={recent}
        sub={`전체 ${total}건 기준`}
      />
    </div>
  );
}
