import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { PostEditor } from "@/features/boards/PostEditor";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getBoard } from "@/features/boards/data";

export const metadata: Metadata = { title: "새 글 작성" };

export default async function NewPostPage({
  params,
}: {
  params: { boardId: string };
}) {
  const me = await requireSessionEmployee();
  const board = await getBoard(params.boardId);
  if (!board) notFound();

  // 공지 게시판은 팀장 이상만 (스펙 3.2). RLS도 막지만 화면 접근부터 차단한다.
  if (board.board_type === "notice" && !me.isManager) {
    redirect(`/board/${board.id}`);
  }

  return (
    <>
      <PageHeader
        title="새 글 작성"
        meta={
          <>
            <span>{board.name}</span>
            <span>·</span>
            <span>
              {board.board_type === "notice" ? "공지 게시판" : "자유게시판"}
            </span>
          </>
        }
      />

      <PostEditor board={board} />
    </>
  );
}
