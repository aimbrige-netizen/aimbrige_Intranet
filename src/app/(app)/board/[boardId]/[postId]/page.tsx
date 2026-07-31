import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostDetailView } from "@/features/boards/PostDetailView";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getBoard, getPostDetail, getReadStatus } from "@/features/boards/data";
import { incrementPostView, markPostRead } from "@/server/actions/boards";

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

  /*
   * 조회수는 글이 실제로 존재하고 볼 수 있다고 확인된 뒤에 올린다.
   * 앞에 두면 없는 postId로도 RPC가 나가고, 무엇보다 접근 권한이 없는
   * 글에도 카운트 호출이 발생한다(UPDATE는 0행이라 피해는 없지만 의미가 틀렸다).
   *
   * 화면에는 이번 조회까지 더한 값을 보여준다 — 뒤에 올린 탓에 빠지면
   * 새로고침해야 반영되는 것처럼 보인다. 본인 글은 DB가 세지 않는다.
   */
  await incrementPostView(params.postId);
  const viewCount = post.author_id === me.id ? post.view_count : post.view_count + 1;

  // 조회 시 읽음 기록 (스펙 3.3). 실패해도 화면은 정상 표시된다.
  await markPostRead(params.postId);

  // 읽음 현황은 작성자·관리자만 조회된다(RPC가 권한을 강제, 아니면 빈 배열)
  const readStatus =
    board.board_type === "notice" &&
    (post.author_id === me.id || me.isSystemAdmin)
      ? await getReadStatus(params.postId)
      : [];

  // 목록으로 돌아가는 링크는 두지 않는다 — 모듈 패널의 활성 항목이 위치를 말한다
  return (
    <PostDetailView
      post={{ ...post, view_count: viewCount }}
      currentEmployeeId={me.id}
      isSystemAdmin={me.isSystemAdmin}
      readStatus={readStatus}
    />
  );
}
