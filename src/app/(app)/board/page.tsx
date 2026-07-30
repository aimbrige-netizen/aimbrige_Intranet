import { redirect } from "next/navigation";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getBoards } from "@/features/boards/data";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card, CardBody } from "@/components/ui/Card";
import { Megaphone } from "lucide-react";

export default async function BoardIndexPage() {
  await requireSessionEmployee();
  const boards = await getBoards();

  // 첫 게시판으로 바로 보낸다 — 게시판 없는 목록 화면은 의미가 없다
  if (boards.length > 0) redirect(`/board/${boards[0].id}`);

  return (
    <>
      <PageHeader title="게시판" />
      <Card>
        <CardBody>
          <EmptyState
            icon={Megaphone}
            title="게시판이 없습니다"
            description="시스템 관리자가 게시판 관리에서 게시판을 추가해야 합니다. 마이그레이션을 실행하면 전사공지·자유게시판이 자동 생성됩니다."
          />
        </CardBody>
      </Card>
    </>
  );
}
