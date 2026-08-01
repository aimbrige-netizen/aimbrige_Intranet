import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { PostDetailView } from "@/features/boards/PostDetailView";
import {
  getBoard,
  getPostDetail,
  isCommunityMember,
} from "@/features/boards/data";
import { incrementPostView, markPostRead } from "@/server/actions/boards";
import { requireSessionEmployee } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "동호회 게시글" };

/**
 * 동호회 게시글 상세 (스펙 16 · 3.2)
 *
 * 스펙 05의 PostDetailView를 그대로 쓴다. 다른 점은 댓글·반응을 남길 수
 * 있는지를 서버에서 판정해 넘긴다는 것뿐이다 — 이번 마이그레이션이
 * comments_insert/reactions_insert에 can_comment_on_post()를 얹었으므로,
 * 비가입자에게 입력창을 그려 주면 누르는 순간 RLS로 실패한다.
 *
 * 읽음 현황(post_reads 집계)은 공지 전용이라 여기서는 빈 배열이다.
 */
export default async function CommunityPostPage({
  params,
}: {
  params: { boardId: string; postId: string };
}) {
  const me = await requireSessionEmployee();

  const [board, post] = await Promise.all([
    getBoard(params.boardId),
    getPostDetail(params.postId, me.id),
  ]);
  if (!board || board.board_type !== "community" || !post) notFound();
  if (post.board_id !== board.id) notFound();

  await incrementPostView(params.postId);
  await markPostRead(params.postId);

  const archived = !!board.archived_at;
  const isMember = archived
    ? false
    : await isCommunityMember(board.id, me.id);

  const basePath = `/community/${board.id}`;

  /*
   * /board 상세는 뒤로가기를 두지 않는다 — 모듈 패널에 게시판 이름이 꽂혀 있어
   * 활성 항목이 위치를 말해 주기 때문이다(board/layout.tsx). /community에는 그
   * 레이아웃이 없어서 패널에는 '동호회'(목록)만 활성이고, 사내 문서에 남은
   * 링크로 바로 들어오면 어느 동호회의 글인지도, 돌아갈 길도 화면에 없다.
   * 보관 여부도 여기서 말한다 — 아니면 한참 아래 댓글 영역의 안내 한 줄이
   * 유일한 단서가 된다.
   */
  return (
    <>
      <PageHeader
        title={board.name}
        backHref={basePath}
        backLabel="글 목록"
        meta={
          <>
            <span>동호회</span>
            {board.archived_at ? (
              <>
                <span>·</span>
                <span>{formatDate(board.archived_at)} 보관됨</span>
              </>
            ) : null}
          </>
        }
      />

      <PostDetailView
        post={post}
        basePath={basePath}
        currentEmployeeId={me.id}
        isSystemAdmin={me.isSystemAdmin}
        readStatus={[]}
        canEngage={isMember}
        engageHint={
          archived
            ? "보관된 동호회입니다. 댓글과 반응을 남길 수 없습니다."
            : "가입한 회원만 댓글과 반응을 남길 수 있습니다."
        }
      />
    </>
  );
}
