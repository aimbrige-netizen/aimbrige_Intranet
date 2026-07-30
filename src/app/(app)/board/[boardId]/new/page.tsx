import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
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
      <Link
        href={`/board/${board.id}`}
        className="mb-3 inline-flex items-center gap-1 text-label text-primary hover:underline"
      >
        <ChevronLeft className="size-3.5" />
        {board.name}
      </Link>

      <PageHeader title="새 글 작성" description={board.name} />

      <PostEditor board={board} />
    </>
  );
}
