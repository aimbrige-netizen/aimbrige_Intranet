import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { PostEditor } from "@/features/boards/PostEditor";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getBoard, getPostDetail } from "@/features/boards/data";

export const metadata: Metadata = { title: "게시글 수정" };

export default async function EditPostPage({
  params,
}: {
  params: { boardId: string; postId: string };
}) {
  const me = await requireSessionEmployee();

  const [board, post] = await Promise.all([
    getBoard(params.boardId),
    getPostDetail(params.postId, me.id),
  ]);
  if (!board || !post) notFound();

  // 작성자 본인 또는 관리자만 (스펙 3.3)
  if (post.author_id !== me.id && !me.isSystemAdmin) {
    redirect(`/board/${board.id}/${post.id}`);
  }

  return (
    <>
      <PageHeader
        title="게시글 수정"
        meta={
          <>
            <span>{board.name}</span>
            <span>·</span>
            <span className="truncate">{post.title}</span>
          </>
        }
      />

      <PostEditor board={board} post={post} />
    </>
  );
}
