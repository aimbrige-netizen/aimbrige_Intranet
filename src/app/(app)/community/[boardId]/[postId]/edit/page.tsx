import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { PostEditor } from "@/features/boards/PostEditor";
import { getBoard, getPostDetail } from "@/features/boards/data";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "게시글 수정" };

/**
 * 동호회 게시글 수정 (스펙 05 · 3.3의 규칙 그대로)
 *
 * 가입 여부를 다시 묻지 않는다. "쓸 수 있는가"와 "고칠 수 있는가"는 다른
 * 규칙이라, 탈퇴했거나 동호회가 보관된 뒤에도 작성자는 자기 글의 오타를
 * 고칠 수 있어야 한다(마이그레이션 24가 posts_update의 WITH CHECK에
 * can_post_to_board()를 얹지 않은 것과 같은 이유).
 */
export default async function EditCommunityPostPage({
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

  const basePath = `/community/${board.id}`;

  if (post.author_id !== me.id && !me.isSystemAdmin) {
    redirect(`${basePath}/${post.id}`);
  }

  return (
    <>
      <PageHeader
        title="게시글 수정"
        backHref={`${basePath}/${post.id}`}
        backLabel="글로 돌아가기"
        meta={
          <>
            <span>{board.name}</span>
            <span>·</span>
            <span className="truncate">{post.title}</span>
          </>
        }
      />

      <PostEditor
        board={board}
        basePath={basePath}
        post={post}
        attachments={post.attachments}
        authUserId={me.auth_user_id}
      />
    </>
  );
}
