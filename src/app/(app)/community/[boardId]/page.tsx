import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Archive, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { AvatarWithName } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  JoinCommunityButton,
  LeaveCommunityButton,
} from "@/features/boards/CommunityActions";
import { PostList } from "@/features/boards/PostList";
import {
  BOARD_PAGE_SIZE,
  getBoard,
  getBoardOverview,
  getCommunityMembers,
  getPosts,
} from "@/features/boards/data";
import {
  BOARD_DEFAULT_RANGE,
  BOARD_RANGES,
  BOARD_RANGE_LABELS,
  relativeTime,
  type BoardRange,
} from "@/features/boards/format";
import { requireSessionEmployee } from "@/lib/auth/session";
import { parsePeriod, periodHref } from "@/lib/period";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "동호회" };

/**
 * 동호회 상세 (스펙 16 · 3.2)
 *
 * 글 목록·상세·에디터는 스펙 05의 컴포넌트를 그대로 쓴다 — 동호회는
 * "가입이 필요한 게시판"이라 표 구성이 자유게시판과 같아야 한다.
 * 이 화면이 더하는 것은 멤버 명단과 가입/탈퇴, 그리고 보관 안내뿐이다.
 *
 * 조회는 비가입자도 할 수 있다(어떤 모임인지 미리 볼 수 있게).
 * 글쓰기·댓글·반응만 가입 여부로 갈린다.
 */
export default async function CommunityBoardPage({
  params,
  searchParams,
}: {
  params: { boardId: string };
  searchParams: { q?: string; period?: string; range?: string; page?: string };
}) {
  const me = await requireSessionEmployee();

  const board = await getBoard(params.boardId);
  if (!board || board.board_type !== "community") notFound();

  const archivedAt = board.archived_at;
  const archived = !!archivedAt;
  const q = (searchParams.q ?? "").trim();
  const period = parsePeriod(
    { period: searchParams.period, range: searchParams.range },
    { units: BOARD_RANGES, defaultUnit: BOARD_DEFAULT_RANGE },
  );
  const range: BoardRange = period.unit;
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);

  const [members, overview, { posts, total }] = await Promise.all([
    getCommunityMembers(params.boardId),
    getBoardOverview(params.boardId, me.id),
    getPosts(params.boardId, me.id, {
      q,
      since: period.from ?? undefined,
      page,
      pageSize: BOARD_PAGE_SIZE,
    }),
  ]);

  /*
   * 멤버 판정은 이미 받아 온 명단에서 낸다 — 같은 답을 얻으려고 질의를 한 번
   * 더 쏠 이유가 없다. 보관된 동호회에서는 멤버여도 글을 쓸 수 없다
   * (can_post_to_board()와 같은 규칙).
   */
  const isMember = members.some((m) => m.employee_id === me.id);
  const canWrite = isMember && !archived;
  const basePath = `/community/${board.id}`;

  const rangeHref = (next: BoardRange) =>
    periodHref(
      basePath,
      { unit: next, cursor: null },
      { defaultUnit: BOARD_DEFAULT_RANGE, extra: { q } },
    );

  const rangeCount: Record<BoardRange, number> = {
    week: overview.thisWeek,
    month: overview.thisMonth,
    all: overview.total,
  };

  return (
    <>
      <PageHeader
        title={board.name}
        description={board.description ?? undefined}
        meta={
          <>
            <span>동호회</span>
            <span>·</span>
            <span>회원 {members.length}명</span>
            <span>·</span>
            <span>글 {overview.total}건</span>
            {overview.latestAt ? (
              <>
                <span>·</span>
                <span>최근 갱신 {relativeTime(overview.latestAt)}</span>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            {/*
              가입·탈퇴는 상태에 따라 하나만 렌더한다(눌러도 안 되는 버튼을
              두지 않는 규약). 보관된 동호회는 가입만 막고 탈퇴는 남긴다 —
              막으면 이미 가입한 사람이 영영 나가지 못한다.
            */}
            {isMember ? (
              <LeaveCommunityButton boardId={board.id} />
            ) : archived ? null : (
              <JoinCommunityButton boardId={board.id} />
            )}
            {/* 같은 줄의 가입·탈퇴가 small이라 높이를 맞춘다(wiki 상세와 같은 규칙) */}
            {canWrite ? (
              <LinkButton href={`${basePath}/new`} size="small">
                <Plus className="size-4" />새 글 쓰기
              </LinkButton>
            ) : null}
          </>
        }
        toolbar={
          <SegmentedControl
            options={BOARD_RANGES.map((value) => ({
              value,
              label: BOARD_RANGE_LABELS[value],
              href: rangeHref(value),
              badge: rangeCount[value],
            }))}
            value={range}
            ariaLabel="조회 범위"
          />
        }
      />

      {/*
        보관된 동호회도 URL은 살아 있다 — 사내 문서에 남은 링크가 죽으면
        참조가 끊긴다. 대신 지금 상태를 화면에서 분명히 말한다.
      */}
      {archivedAt ? (
        <Callout
          tone="warn"
          icon={Archive}
          title="보관된 동호회입니다"
          className="mb-5"
        >
          {formatDate(archivedAt)}에 보관되어 새 글·댓글·가입을 받지 않습니다.
          지난 글은 그대로 남아 있습니다.
        </Callout>
      ) : null}

      <Card className="mb-5">
        <CardHeader
          title="회원"
          description={`${members.length}명이 활동하고 있습니다.`}
          density="compact"
        />
        <CardBody density="compact">
          {members.length === 0 ? (
            <p className="text-caption">아직 회원이 없습니다.</p>
          ) : (
            <ul className="flex flex-wrap gap-x-5 gap-y-3">
              {members.map((member) => (
                <li
                  key={member.employee_id}
                  className="flex items-center gap-1.5"
                >
                  <AvatarWithName
                    name={member.employee_name}
                    sub={
                      member.employee_position ??
                      member.department_name ??
                      undefined
                    }
                    src={member.profile_image_url}
                    size="small"
                  />
                  {member.is_owner ? <Badge tone="neutral">개설자</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <PostList
        board={board}
        basePath={basePath}
        posts={posts}
        total={total}
        pageSize={BOARD_PAGE_SIZE}
        boardTotal={overview.total}
        categoryCounts={overview.categoryCounts}
        uncategorized={overview.uncategorized}
        canWrite={canWrite}
        filters={{ category: "", q, range, page }}
      />
    </>
  );
}
