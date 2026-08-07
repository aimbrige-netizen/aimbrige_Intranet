import type { Metadata } from "next";
import Link from "next/link";
import { MessagesSquare, UserRoundCheck, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable, Td, Th } from "@/components/ui/Table";
import {
  CreateCommunityButton,
  JoinCommunityButton,
  LeaveCommunityButton,
} from "@/features/boards/CommunityActions";
import { BOARD_PAGE_SIZE, getCommunities } from "@/features/boards/data";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "동호회" };

/**
 * 동호회 홈 (daou-survey/17-todo-community.md "커뮤니티 홈" 실측 재구축).
 *
 * 다우 커뮤니티 홈 구성 그대로 — 콘텐츠 제목 "동호회 홈" 20/500 아래
 *  1. "전체 동호회 정보" 요약(다우 "전체 커뮤니티 정보" 대응)
 *  2. "전체 동호회 (총n개)" 표 — 동호회명 · 회원수 · 운영자 · 가입(버튼)
 * 종전 카드 그리드(CommunityCard)를 07 표 문법으로 전환했다.
 *
 * 다우는 "커뮤니티 만들기" 주요 버튼을 좌측 패널에 두지만 셸은 이번 범위
 * 밖이다 — 개설 진입점을 잃지 않도록 제목 행 우측에 남긴다(종전 PageHeader
 * actions 자리 그대로). 이 화면의 진한 오렌지는 이 버튼 하나다(원칙 1).
 *
 * 데이터 경로는 그대로다 — getCommunities() 한 번, 가입/탈퇴도 기존 액션
 * 재사용. 표시 계층만 바꿨다(e2e:community 불변의 근거).
 */
export default async function CommunityPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  await requireSessionEmployee();
  const communities = await getCommunities();

  const total = communities.length;

  if (total === 0) {
    return (
      <>
        {/* 빈 화면의 주요 버튼은 빈 상태 CTA 하나만 — 제목 행에 겹치지 않는다 */}
        <h1 className="mb-5 text-title-l text-ink">
          동호회 홈
        </h1>
        {/*
          md+ 흰 시트에서는 빈 상태를 시트에 직접, md 미만은 canvas 위라
          faint 문구가 뜨지 않게 카드 면을 유지한다 (LibraryList와 동일).
          문구는 다우 원문 대응("생성된 커뮤니티가 없습니다.") 그대로.
          만들기 흐름은 기존 로직 — 개설은 전 임직원(스펙 16 · 3.1)이라
          버튼을 권한으로 가리지 않는다.
        */}
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <EmptyState
            icon={UsersRound}
            title="생성된 동호회가 없습니다."
            description="관심사가 맞는 사람을 모으려면 먼저 하나 만들어 보세요. 만든 사람이 첫 회원이 됩니다."
            action={<CreateCommunityButton />}
          />
        </div>
      </>
    );
  }

  const joined = communities.filter((c) => c.is_member).length;
  const totalPosts = communities.reduce((sum, c) => sum + c.post_count, 0);
  const totalMembers = communities.reduce((sum, c) => sum + c.member_count, 0);

  /*
   * 가장 활발한 동호회 — 글 수 우선, 같으면 회원 수.
   * 글이 아직 한 건도 없는 초기 상태에서는 회원 수 비교만 남아
   * 다우 원문 카드("가장 회원이 많은 커뮤니티")와 같은 판정이 된다.
   */
  const mostActive = communities.reduce((top, c) =>
    c.post_count !== top.post_count
      ? c.post_count > top.post_count
        ? c
        : top
      : c.member_count > top.member_count
        ? c
        : top,
  );

  /* 페이지네이션 기존 규약 — URL ?page + 게시판과 같은 페이지 크기(20) */
  const totalPages = Math.max(1, Math.ceil(total / BOARD_PAGE_SIZE));
  const page = Math.min(
    Math.max(1, Number(searchParams.page) || 1),
    totalPages,
  );
  const pageRows = communities.slice(
    (page - 1) * BOARD_PAGE_SIZE,
    page * BOARD_PAGE_SIZE,
  );

  return (
    <>
      {/*
        콘텐츠 제목 "동호회 홈" 20/500 — PageHeader급 밴드 없음(17 실측).
        줄높이 30px은 06 heading-l 실측(결재 홈과 같은 단).
      */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title-l text-ink">
          동호회 홈
        </h1>
        <CreateCommunityButton />
      </div>

      {/*
        1. 전체 동호회 정보 — 다우 요약 카드 4장 중 "최근글"은 세우지 않는다.
        list_communities()에 최근 글 시각·제목이 없고, 새 조회는 이번 범위
        밖이다 — 없는 지표를 지어내지 않는다(17 규칙). 나머지 셋만 만든다:
        가장 활발한 동호회 · 내 가입 · 전체 동호회.
      */}
      <section className="mb-6">
        <SectionHeader title="전체 동호회 정보" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {/*
            동호회명은 최대 60자 자유 텍스트인데 StatCard 값 자리(28px)에는
            truncate가 없다 — 길면 여러 줄로 꺾여 3카드 밴드 높이가 깨진다.
            표시 전에 자른다. 전체 이름은 href 상세에서 읽힌다.
          */}
          <StatCard
            label="가장 활발한 동호회"
            value={
              mostActive.name.length > 18
                ? `${mostActive.name.slice(0, 18)}…`
                : mostActive.name
            }
            tone="informative"
            icon={MessagesSquare}
            href={`/community/${mostActive.id}`}
            sub={`글 ${mostActive.post_count}건 · 회원 ${mostActive.member_count}명`}
          />
          <StatCard
            label="내 가입"
            value={joined}
            unit="개"
            denominator={total}
            tone="positive"
            icon={UserRoundCheck}
            max={total || 1}
            meterValue={joined}
            sub={
              joined > 0
                ? "가입한 동호회에만 글을 쓸 수 있습니다"
                : "아직 가입한 동호회가 없습니다"
            }
          />
          <StatCard
            label="전체 동호회"
            value={total}
            unit="개"
            tone="neutral"
            icon={UsersRound}
            sub={`글 ${totalPosts}건 · 가입 연인원 ${totalMembers}명`}
          />
        </div>
      </section>

      {/* 2. 전체 동호회 표 — 분모는 제목이 든다("총"과 숫자 사이 공백 없음, 16·10 실측) */}
      <section>
        <SectionHeader title={`전체 동호회 (총${total}개)`} />
        <div className="ab-card md:rounded-none md:border-0">
          {/* fixed — 소개 한 줄 말줄임(truncate)은 컬럼 폭이 잡혀야 동작한다 */}
          <DataTable minWidth={680} fixed>
            <thead>
              <tr>
                <Th>동호회명</Th>
                <Th className="w-24">회원수</Th>
                <Th className="w-40">운영자</Th>
                <Th className="w-28">가입</Th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((community) => (
                <tr key={community.id}>
                  <Td>
                    <Link
                      href={`/community/${community.id}`}
                      className="block truncate text-ink hover:text-primary-ink hover:underline"
                    >
                      {community.name}
                    </Link>
                    {community.description ? (
                      <span className="block truncate text-nano text-muted">
                        {community.description}
                      </span>
                    ) : null}
                  </Td>
                  {/* 07 표 문법 — 순수 텍스트 셀. 단위는 "회원수" 헤더가 맥락이다 */}
                  <Td numeric>{community.member_count}</Td>
                  <Td>
                    {community.created_by_name ? (
                      <span className="block truncate">
                        {community.created_by_name}
                      </span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </Td>
                  <Td>
                    {/*
                      기존 가입/탈퇴 액션 재사용 — 상태에 따라 하나만 렌더한다
                      (눌러도 안 되는 버튼을 두지 않는 규약). 가입 버튼은 행마다
                      반복되므로 secondary로 내린다(원칙 1 — 종전 카드와 같은
                      판단). 보관 분기는 이 화면에선 항상 거짓이지만
                      (getCommunities가 보관본을 감춘다), includeArchived로
                      바뀌는 날 RLS가 막는 가입 버튼을 그리지 않기 위해 남긴다.
                    */}
                    {community.archived_at ? (
                      <Badge tone="neutral">보관됨</Badge>
                    ) : community.is_member ? (
                      <LeaveCommunityButton boardId={community.id} />
                    ) : (
                      <JoinCommunityButton
                        boardId={community.id}
                        size="small"
                        variant="secondary"
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>

          <Pagination
            page={page}
            pageSize={BOARD_PAGE_SIZE}
            total={total}
            basePath="/community"
          />
        </div>
      </section>
    </>
  );
}
