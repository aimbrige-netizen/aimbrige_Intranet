import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { BoardNav } from "@/features/boards/BoardNav";
import { PostList } from "@/features/boards/PostList";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getBoard, getBoards, getPosts } from "@/features/boards/data";

export const metadata: Metadata = { title: "게시판" };

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: { boardId: string };
  searchParams: { category?: string };
}) {
  const me = await requireSessionEmployee();

  const [board, boards] = await Promise.all([
    getBoard(params.boardId),
    getBoards(),
  ]);
  if (!board) notFound();

  const posts = await getPosts(params.boardId, me.id, {
    category: searchParams.category,
  });

  // 공지 게시판은 팀장 이상만 작성 (스펙 3.2)
  const canWrite = board.board_type === "discussion" || me.isManager;

  return (
    <>
      <PageHeader
        title={board.name}
        description={
          board.board_type === "notice"
            ? "공지 게시판입니다. 읽음 여부가 기록됩니다."
            : "자유롭게 소통하는 공간입니다."
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_1fr]">
        <BoardNav boards={boards} activeBoardId={board.id} />
        <div>
          <PostList
            board={board}
            posts={posts}
            canWrite={canWrite}
            activeCategory={searchParams.category ?? ""}
          />
        </div>
      </div>
    </>
  );
}
