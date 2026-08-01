import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { PostEditor } from "@/features/boards/PostEditor";
import { getBoard, isCommunityMember } from "@/features/boards/data";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "새 글 작성" };

/**
 * 동호회 글 작성 (스펙 16 · 3.2)
 *
 * 가입 여부를 화면 진입에서 확인한다. RLS(can_post_to_board)가 최종 관문이지만
 * 그쪽에 맡기면 비가입자가 폼을 다 채운 뒤 저장 버튼에서야 실패한다.
 */
export default async function NewCommunityPostPage({
  params,
}: {
  params: { boardId: string };
}) {
  const me = await requireSessionEmployee();
  const board = await getBoard(params.boardId);
  if (!board || board.board_type !== "community") notFound();

  const basePath = `/community/${board.id}`;

  // 보관된 동호회에는 멤버도 쓸 수 없다 (마이그레이션 24와 같은 규칙)
  if (board.archived_at) redirect(basePath);
  if (!(await isCommunityMember(board.id, me.id))) redirect(basePath);

  return (
    <>
      <PageHeader
        title="새 글 작성"
        backHref={basePath}
        meta={
          <>
            <span>{board.name}</span>
            <span>·</span>
            <span>동호회</span>
          </>
        }
      />

      <PostEditor
        board={board}
        basePath={basePath}
        authUserId={me.auth_user_id}
      />
    </>
  );
}
