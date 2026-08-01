import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { BoardManager } from "@/features/boards/BoardManager";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { getBoards } from "@/features/boards/data";

export const metadata: Metadata = { title: "게시판 관리" };

export default async function AdminBoardsPage() {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const [boards, { data: departments }] = await Promise.all([
    getBoards(),
    supabase.from("departments").select("id, name").order("name"),
  ]);

  return (
    <>
      <PageHeader
        title="게시판 관리"
        description="공지 게시판은 팀장/매니저 이상만 글을 쓸 수 있고, 자유게시판은 전 임직원이 씁니다."
        meta={
          <>
            <span>전체 {boards.length}개</span>
            <span>·</span>
            <span>
              공지 {boards.filter((b) => b.board_type === "notice").length}개
            </span>
            <span>·</span>
            <span>
              자유게시판{" "}
              {boards.filter((b) => b.board_type === "discussion").length}개
            </span>
          </>
        }
      />

      <Card>
        <CardBody>
          <BoardManager
            boards={boards}
            departments={(departments ?? []) as { id: string; name: string }[]}
          />
        </CardBody>
      </Card>
    </>
  );
}
