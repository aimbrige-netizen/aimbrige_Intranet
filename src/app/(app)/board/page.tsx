import { redirect } from "next/navigation";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getBoards } from "@/features/boards/data";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";
import { Megaphone } from "lucide-react";

export default async function BoardIndexPage() {
  const me = await requireSessionEmployee();
  const boards = await getBoards();

  // 첫 게시판으로 바로 보낸다 — 게시판 없는 목록 화면은 의미가 없다
  if (boards.length > 0) redirect(`/board/${boards[0].id}`);

  return (
    <>
      <PageHeader title="게시판" />
      {/*
        md+ 흰 시트에서는 빈 상태를 시트에 직접, md 미만은 canvas 위라
        faint 문구가 뜨지 않게 카드 면을 유지한다 (LibraryList와 동일).
      */}
      <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
        <EmptyState
          icon={Megaphone}
          title="개설된 게시판이 없습니다"
          description={
            me.isSystemAdmin
              ? "전사 공지나 팀별 게시판을 먼저 만들어 주세요."
              : "관리자에게 게시판 개설을 요청하세요."
          }
          action={
            me.isSystemAdmin ? (
              <LinkButton href="/admin/boards" size="small">
                게시판 만들기
              </LinkButton>
            ) : undefined
          }
        />
      </div>
    </>
  );
}
