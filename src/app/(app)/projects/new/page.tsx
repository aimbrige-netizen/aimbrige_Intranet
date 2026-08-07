import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProjectForm } from "@/features/projects/ProjectForm";
import { getOwnerOptions, getTeams } from "@/features/projects/data";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "새 프로젝트" };

/**
 * 새 프로젝트 등록 (스펙 10 · 3.2)
 *
 * 등록 권한은 팀장/매니저 이상이다. RLS(projects_insert → is_manager_or_admin())가
 * 최종 판정하지만, 권한 없는 사람에게 폼을 보여 놓고 마지막에 막는 대신
 * 여기서 목록으로 돌려보낸다 — 화면에서도 버튼을 숨기는 것과 같은 기준이다.
 */
export default async function NewProjectPage() {
  const me = await requireSessionEmployee();
  if (!me.isManager) redirect("/projects");

  const [teams, owners] = await Promise.all([getTeams(), getOwnerOptions()]);

  return (
    <>
      {/*
        콘텐츠 제목 "새 프로젝트" 20/500 — PageHeader급 밴드 없음(확립 문법,
        결재 홈 축). 안내문·등록자는 제목 아래 한 줄씩 남긴다.
      */}
      <div className="mb-5">
        <h1 className="text-title-l text-ink">
          새 프로젝트
        </h1>
        <p className="mt-1 text-caption">
          프로젝트명만 있으면 등록됩니다. 나머지는 진행하면서 채워도 됩니다.
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted">
          <span>등록자 {me.name}</span>
          <span>·</span>
          <span>{me.department?.name ?? "부서 미지정"}</span>
          {me.team?.name ? (
            <>
              <span>·</span>
              <span>{me.team.name}</span>
            </>
          ) : null}
        </div>
      </div>

      <ProjectForm
        teams={teams}
        owners={owners}
        defaultOwnerId={me.id}
        defaultTeamId={me.team_id}
      />
    </>
  );
}
