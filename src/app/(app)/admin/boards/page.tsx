import type { Metadata } from "next";
import { SectionHeader } from "@/components/ui/Card";
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

  const noticeCount = boards.filter((b) => b.board_type === "notice").length;
  const discussionCount = boards.filter(
    (b) => b.board_type === "discussion",
  ).length;

  return (
    <>
      {/*
        콘텐츠 제목 "게시판 관리" 20/500 — PageHeader급 밴드 없음(확립 문법).
        종전 메타(공지·자유 개수)와 권한 설명은 섹션 제목·설명이 든다.
      */}
      <h1 className="mb-5 text-[20px] font-medium leading-[30px] text-ink">
        게시판 관리
      </h1>

      <section>
        <SectionHeader
          title={`전체 게시판 (총${boards.length}개)`}
          description={`공지 ${noticeCount}개 · 자유게시판 ${discussionCount}개 — 공지는 팀장/매니저 이상만, 자유게시판은 전 임직원이 씁니다.`}
        />
        {/* 08 흰 시트: md+에서는 시트에 직접, md 미만은 canvas 위 카드 유지 */}
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <BoardManager
            boards={boards}
            departments={(departments ?? []) as { id: string; name: string }[]}
          />
        </div>
      </section>
    </>
  );
}
