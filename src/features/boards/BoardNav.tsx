import Link from "next/link";
import { Megaphone, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardBody } from "@/components/ui/Card";
import type { BoardWithDepartment } from "./types";

/** 게시판 목록 사이드 내비 (스펙 3.1) */
export function BoardNav({
  boards,
  activeBoardId,
}: {
  boards: BoardWithDepartment[];
  activeBoardId?: string;
}) {
  const notices = boards.filter((b) => b.board_type === "notice");
  const discussions = boards.filter((b) => b.board_type === "discussion");

  const renderGroup = (
    label: string,
    icon: typeof Megaphone,
    items: BoardWithDepartment[],
  ) => {
    if (items.length === 0) return null;
    const Icon = icon;
    return (
      <div className="mb-3 last:mb-0">
        <p className="mb-1 flex items-center gap-1.5 px-2 text-label font-semibold text-muted">
          <Icon className="size-3.5" aria-hidden />
          {label}
        </p>
        <ul>
          {items.map((board) => (
            <li key={board.id}>
              <Link
                href={`/board/${board.id}`}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-body transition-colors",
                  board.id === activeBoardId
                    ? "bg-primary-light font-medium text-primary"
                    : "text-ink hover:bg-canvas",
                )}
              >
                <span className="truncate">{board.name}</span>
                {board.department ? (
                  <span className="shrink-0 text-caption">
                    {board.department.name}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <Card>
      <CardBody className="p-3">
        {renderGroup("공지", Megaphone, notices)}
        {renderGroup("자유게시판", MessagesSquare, discussions)}
      </CardBody>
    </Card>
  );
}
