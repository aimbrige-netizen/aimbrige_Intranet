"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquare, Pin, Plus, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Field";
import { AvatarWithName } from "@/components/ui/Avatar";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { POST_CATEGORIES, type Board, type PostListItem } from "./types";

/** 게시판 글 목록 (스펙 3.1) */
export function PostList({
  board,
  posts,
  canWrite,
  activeCategory,
}: {
  board: Board;
  posts: PostListItem[];
  canWrite: boolean;
  activeCategory: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNotice = board.board_type === "notice";

  const setCategory = (category: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (category) params.set("category", category);
    else params.delete("category");
    const q = params.toString();
    router.push(q ? `/board/${board.id}?${q}` : `/board/${board.id}`);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* 카테고리 필터는 공지 타입에서 주로 쓴다 (스펙 3.1) */}
        {isNotice ? (
          <Select
            aria-label="카테고리 필터"
            value={activeCategory}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 w-auto min-w-32 py-0"
          >
            <option value="">전체 카테고리</option>
            {POST_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        ) : null}

        <span className="text-caption">{posts.length}건</span>

        {canWrite ? (
          <Link href={`/board/${board.id}/new`} className="ml-auto">
            <Button size="small">
              <Plus className="size-3.5" />새 글
            </Button>
          </Link>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        <CardBody className="p-0">
          {posts.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="게시글이 없습니다"
              description={
                canWrite
                  ? "첫 글을 작성해 보세요."
                  : isNotice
                    ? "공지 게시판은 팀장/매니저 이상만 작성할 수 있습니다."
                    : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {posts.map((post) => (
                <li key={post.id}>
                  <Link
                    href={`/board/${board.id}/${post.id}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 transition-colors hover:bg-canvas"
                  >
                    {post.is_pinned ? (
                      <Pin
                        className="size-3.5 shrink-0 text-danger"
                        aria-label="고정"
                      />
                    ) : null}

                    {post.category ? (
                      <Badge tone="primary">{post.category}</Badge>
                    ) : null}

                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-body",
                        post.isRead ? "text-muted" : "font-bold text-ink",
                      )}
                    >
                      {post.title}
                    </span>

                    {post.commentCount > 0 ? (
                      <span className="flex shrink-0 items-center gap-1 text-caption">
                        <MessageSquare className="size-3.5" aria-hidden />
                        {post.commentCount}
                      </span>
                    ) : null}

                    {/* 공지 타입만 읽음 배지 (스펙 3.1) */}
                    {isNotice && post.readCount !== null ? (
                      <Badge
                        tone={
                          post.readCount === post.targetCount
                            ? "success"
                            : "neutral"
                        }
                      >
                        읽음 {post.readCount}/{post.targetCount}
                      </Badge>
                    ) : null}

                    <span className="shrink-0">
                      <AvatarWithName
                        name={post.author?.name ?? "-"}
                        src={post.author?.profile_image_url}
                        size="small"
                      />
                    </span>

                    <span className="w-24 shrink-0 text-right text-caption">
                      {formatDate(post.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
