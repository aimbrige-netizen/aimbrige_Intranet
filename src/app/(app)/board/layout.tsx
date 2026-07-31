import {
  PanelPortal,
  PanelLinkList,
  PANEL_EXTRA_SLOT,
} from "@/components/layout/ModulePanel";
import { getBoards } from "@/features/boards/data";
import { requireSessionEmployee } from "@/lib/auth/session";

/**
 * 게시판 모듈 레이아웃.
 *
 * 게시판 목록은 DB에서 오므로 정적 nav에 넣을 수 없다.
 * 모듈 패널의 동적 슬롯에 꽂아 넣어, 본문 안에 있던 BoardNav를 대체한다.
 */
export default async function BoardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSessionEmployee();
  const boards = await getBoards();

  const notices = boards.filter((b) => b.board_type === "notice");
  const free = boards.filter((b) => b.board_type !== "notice");

  return (
    <>
      <PanelPortal slot={PANEL_EXTRA_SLOT}>
        <>
          {notices.length > 0 ? (
            <PanelLinkList
              title="공지"
              items={notices.map((b) => ({
                key: b.id,
                label: b.name,
                href: `/board/${b.id}`,
                // 글 상세(/board/:id/:postId)에서도 해당 게시판이 활성이어야 한다
                prefixes: [`/board/${b.id}`],
              }))}
            />
          ) : null}
          {free.length > 0 ? (
            <PanelLinkList
              title="게시판"
              items={free.map((b) => ({
                key: b.id,
                label: b.name,
                href: `/board/${b.id}`,
                // 글 상세(/board/:id/:postId)에서도 해당 게시판이 활성이어야 한다
                prefixes: [`/board/${b.id}`],
              }))}
            />
          ) : null}
        </>
      </PanelPortal>
      {children}
    </>
  );
}
