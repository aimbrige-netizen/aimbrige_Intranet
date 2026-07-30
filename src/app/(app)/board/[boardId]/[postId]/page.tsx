import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PostDetailView } from "@/features/boards/PostDetailView";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getBoard, getPostDetail, getReadStatus } from "@/features/boards/data";
import { markPostRead } from "@/server/actions/boards";

export const metadata: Metadata = { title: "게시글" };

export default async function PostPage({
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

  // 조회 시 읽음 기록 (스펙 3.3). 실패해도 화면은 정상 표시된다.
  await markPostRead(params.postId);

  // 읽음 현황은 작성자·관리자만 조회된다(RPC가 권한을 강제, 아니면 빈 배열)
  const readStatus =
    board.board_type === "notice" &&
    (post.author_id === me.id || me.isSystemAdmin)
      ? await getReadStatus(params.postId)
      : [];

  return (
    <>
      <Link
        href={`/board/${board.id}`}
        className="mb-3 inline-flex items-center gap-1 text-label text-primary hover:underline"
      >
        <ChevronLeft className="size-3.5" />
        {board.name}
      </Link>

      <PostDetailView
        post={post}
        currentEmployeeId={me.id}
        isSystemAdmin={me.isSystemAdmin}
        readStatus={readStatus}
      />
    </>
  );
}
