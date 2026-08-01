import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
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
   * URL의 boardId와 글이 실제로 붙어 있는 게시판이 어긋나면 아래 판정이 전부
   * 엉뚱한 보드를 본다 — /board/<자유게시판>/<동호회 글>은 community
   * 리다이렉트를 피해 가입 여부를 묻지 않은 채 댓글창까지 그려 준다.
   */
  if (post.board_id !== board.id) notFound();

  // 동호회 글은 /community 쪽에서 본다 — 링크는 살려 두고 넘긴다
  if (board.board_type === "community") {
    redirect(`/community/${board.id}/${post.id}`);
  }

  /*
   * 조회수는 글이 실제로 존재하고 볼 수 있다고 확인된 뒤에 올린다.
   * 앞에 두면 없는 postId로도 RPC가 나가고, 무엇보다 접근 권한이 없는
   * 글에도 카운트 호출이 발생한다(UPDATE는 0행이라 피해는 없지만 의미가 틀렸다).
   *
   * 화면에는 서버가 준 값을 그대로 보여준다. 조회는 사람·날짜 단위로 묶여
   * 같은 날 두 번째부터는 오르지 않고, 함수가 반영 여부를 돌려주지 않아
   * 여기서 더한 +1은 새로고침마다 틀린 값이 된다. 같은 날 첫 조회에서만
   * 내 한 번이 다음 진입에 반영되는데, 실제보다 부풀리는 쪽보다 낫다.
   */
  await incrementPostView(params.postId);

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
      post={post}
      basePath={`/board/${board.id}`}
      currentEmployeeId={me.id}
      isSystemAdmin={me.isSystemAdmin}
      readStatus={readStatus}
    />
  );
}
