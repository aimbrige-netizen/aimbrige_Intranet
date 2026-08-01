import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { PostEditor } from "@/features/boards/PostEditor";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getBoard } from "@/features/boards/data";
import { BOARD_TYPE_LABELS } from "@/features/boards/types";

export const metadata: Metadata = { title: "새 글 작성" };

export default async function NewPostPage({
  params,
}: {
  params: { boardId: string };
}) {
  const me = await requireSessionEmployee();
  const board = await getBoard(params.boardId);
  if (!board) notFound();

  // 동호회 글쓰기는 가입 여부를 봐야 한다 — 그 판정은 /community 쪽 한 곳에만 둔다
  if (board.board_type === "community") redirect(`/community/${board.id}/new`);

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
            <span>{BOARD_TYPE_LABELS[board.board_type]}</span>
          </>
        }
      />

      <PostEditor
        board={board}
        basePath={`/board/${board.id}`}
        authUserId={me.auth_user_id}
      />
    </>
  );
}
