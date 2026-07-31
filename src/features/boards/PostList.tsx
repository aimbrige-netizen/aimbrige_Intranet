import Link from "next/link";
import { Pin, ScrollText, Search, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import { MiniMeter } from "@/components/ui/Progress";
import { Pagination } from "@/components/ui/Pagination";
import {
  FilterChip,
  TableToolbar,
  ToolbarSearch,
} from "@/components/ui/TableToolbar";
import { AvatarWithName } from "@/components/ui/Avatar";
import { cn, formatDate } from "@/lib/utils";
import { POST_CATEGORIES, type Board, type PostListItem } from "./types";
import type { BoardRange } from "./format";

export interface PostListFilters {
  category: string;
  q: string;
  range: BoardRange;
  page: number;
}

/**
 * 게시판 글 목록 (스펙 3.1)
 *
 * 예전에는 ul + flex 행이라 고정핀·카테고리 배지가 조건부로 붙고 빠지면서
 * 제목의 시작 x좌표가 행마다 0/20/70/90px로 밀렸다. 컬럼 정렬이 성립하지 않아
 * 제목을 세로로 훑을 수 없었다. 지금은 table-fixed로 폭을 못 박고,
 * 조건부 요소는 셀을 비우되 셀 자체는 항상 렌더한다.
 */
export function PostList({
  board,
  posts,
  total,
  pageSize,
  boardTotal,
  categoryCounts,
  uncategorized,
  canWrite,
  filters,
}: {
  board: Board;
  posts: PostListItem[];
  /** 현재 필터 기준 전체 건수 (페이지네이터 분모) */
  total: number;
  pageSize: number;
  /** 필터와 무관한 게시판 전체 건수 ("전체" 칩) */
  boardTotal: number;
  categoryCounts: Record<string, number>;
  uncategorized: number;
  canWrite: boolean;
  filters: PostListFilters;
}) {
  const isNotice = board.board_type === "notice";
  const basePath = `/board/${board.id}`;
  const { category, q, range } = filters;

  const hrefWith = (next: Partial<PostListFilters>) => {
    const merged = { ...filters, page: 1, ...next };
    const search = new URLSearchParams();
    if (merged.category) search.set("category", merged.category);
    if (merged.q) search.set("q", merged.q);
    if (merged.range !== "all") search.set("range", merged.range);
    if (merged.page > 1) search.set("page", String(merged.page));
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  const columns = isNotice ? 8 : 6;
  // 마지막 고정글 뒤에 한 줄 굵은 구분선 — 고정 그룹과 일반 글을 가른다
  const lastPinned = posts.reduce(
    (index, post, i) => (post.is_pinned ? i : index),
    -1,
  );

  return (
    <>
      <TableToolbar
        search={
          <form action={basePath} className="contents">
            {category ? (
              <input type="hidden" name="category" value={category} />
            ) : null}
            {range !== "all" ? (
              <input type="hidden" name="range" value={range} />
            ) : null}
            <ToolbarSearch
              name="q"
              defaultValue={q}
              placeholder="제목·내용 검색"
              ariaLabel="게시글 검색"
            />
          </form>
        }
        filters={
          isNotice ? (
            <CategoryChips
              activeCategory={category}
              boardTotal={boardTotal}
              counts={categoryCounts}
              uncategorized={uncategorized}
              hrefWith={hrefWith}
            />
          ) : null
        }
        actions={
          q ? (
            <LinkButton
              href={hrefWith({ q: "" })}
              size="small"
              variant="secondary"
            >
              검색 해제
            </LinkButton>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table
            className={cn(
              "ab-table ab-table--compact table-fixed",
              isNotice ? "min-w-[940px]" : "min-w-[700px]",
            )}
          >
            <thead>
              <tr>
                <th className="w-9">
                  <span className="sr-only">상태</span>
                </th>
                {isNotice ? <th className="w-20">카테고리</th> : null}
                <th>제목</th>
                <th className="w-14 !text-right">댓글</th>
                {/* 열람률(대상자 중 몇 명)과 다른 숫자다 — 이건 총 조회 횟수 */}
                <th className="w-14 !text-right">조회</th>
                {isNotice ? <th className="w-32">열람률</th> : null}
                <th className="w-32">작성자</th>
                <th className="w-24">작성일</th>
              </tr>
            </thead>
            <tbody>
              {posts.length === 0 ? (
                <EmptyRow
                  columns={columns}
                  isNotice={isNotice}
                  canWrite={canWrite}
                  filters={filters}
                  basePath={basePath}
                  hrefWith={hrefWith}
                />
              ) : (
                posts.map((post, i) => (
                  <tr
                    key={post.id}
                    className={cn(
                      i === lastPinned &&
                        i < posts.length - 1 &&
                        "[&>td]:border-b-line-strong",
                    )}
                  >
                    <td className="text-center">
                      {post.is_pinned ? (
                        <Pin
                          className="mx-auto size-3.5 text-primary"
                          aria-label="고정"
                        />
                      ) : !post.isRead ? (
                        <span
                          className="mx-auto block size-1.5 rounded-pill bg-info"
                          aria-label="미열람"
                          role="img"
                        />
                      ) : null}
                    </td>

                    {isNotice ? (
                      <td>
                        {post.category ? (
                          <Badge tone="neutral">{post.category}</Badge>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                    ) : null}

                    <td>
                      <Link
                        href={`/board/${board.id}/${post.id}`}
                        className={cn(
                          "block truncate hover:underline",
                          post.isRead ? "text-muted" : "font-bold text-ink",
                        )}
                      >
                        {post.title}
                      </Link>
                    </td>

                    <td className="text-right tabular-nums">
                      {post.commentCount > 0 ? (
                        post.commentCount
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>

                    <td className="text-right tabular-nums">
                      {post.view_count > 0 ? (
                        post.view_count
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>

                    {isNotice ? (
                      <td>
                        <ReadRateCell post={post} />
                      </td>
                    ) : null}

                    <td>
                      <AvatarWithName
                        name={post.author?.name ?? "-"}
                        src={post.author?.profile_image_url}
                        size="small"
                      />
                    </td>

                    <td className="whitespace-nowrap tabular-nums text-caption">
                      {formatDate(post.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={filters.page}
          pageSize={pageSize}
          total={total}
          basePath={basePath}
          params={{
            category: category || undefined,
            q: q || undefined,
            range: range === "all" ? undefined : range,
          }}
        />
      </Card>
    </>
  );
}

/**
 * 열람률 — 12/30과 28/30이 같은 회색 배지로 보이면 "누가 안 읽었나"를
 * 스캔할 수 없다. 막대 길이로 먼저 읽히고 숫자가 확인해 준다.
 */
function ReadRateCell({ post }: { post: PostListItem }) {
  if (post.readCount === null || post.targetCount === null) {
    return <span className="text-muted">-</span>;
  }
  const done = post.targetCount > 0 && post.readCount >= post.targetCount;
  return (
    <span className="flex items-center gap-2">
      <MiniMeter
        value={post.readCount}
        max={post.targetCount || 1}
        tone={done ? "positive" : "informative"}
        className="min-w-12 max-w-16"
        aria-label={`열람 ${post.readCount} / ${post.targetCount}`}
      />
      <span className="shrink-0 tabular-nums text-caption">
        {post.readCount}/{post.targetCount}
      </span>
    </span>
  );
}

/**
 * 카테고리는 5개로 고정돼 있어 접어둘 이유가 없다.
 * 드롭다운은 "무엇을 고를 수 있고 각각 몇 건인지"를 한 번 더 클릭하게 만든다.
 */
function CategoryChips({
  activeCategory,
  boardTotal,
  counts,
  uncategorized,
  hrefWith,
}: {
  activeCategory: string;
  boardTotal: number;
  counts: Record<string, number>;
  uncategorized: number;
  hrefWith: (next: Partial<PostListFilters>) => string;
}) {
  return (
    <>
      <FilterChip
        href={hrefWith({ category: "" })}
        active={!activeCategory}
        count={boardTotal}
      >
        전체
      </FilterChip>
      {POST_CATEGORIES.map((name) => {
        const count = counts[name] ?? 0;
        const active = activeCategory === name;

        if (count === 0 && !active) {
          // 0건 카테고리는 자리를 남겨두되 누를 수 없게 둔다
          return (
            <span key={name} className="pointer-events-none opacity-40">
              <FilterChip count={0}>{name}</FilterChip>
            </span>
          );
        }

        return (
          <FilterChip
            key={name}
            href={hrefWith({ category: name })}
            active={active}
            count={count}
          >
            {name}
          </FilterChip>
        );
      })}
      {uncategorized > 0 ? (
        <span className="text-caption tabular-nums">
          미분류 {uncategorized}
        </span>
      ) : null}
    </>
  );
}

/**
 * 빈 상태는 셋으로 갈린다.
 * 예전에는 검색·필터로 0건이 됐을 때도 "게시글이 없습니다 / 첫 글을
 * 작성해 보세요"가 떠서, 게시판이 텅 빈 것처럼 보이고 해제할 방법도 없었다.
 */
function EmptyRow({
  columns,
  isNotice,
  canWrite,
  filters,
  basePath,
  hrefWith,
}: {
  columns: number;
  isNotice: boolean;
  canWrite: boolean;
  filters: PostListFilters;
  basePath: string;
  hrefWith: (next: Partial<PostListFilters>) => string;
}) {
  // 범위를 벗어난 페이지 번호로 들어온 경우 — 되돌아갈 길을 준다
  if (filters.page > 1) {
    return (
      <TableEmptyRow
        colSpan={columns}
        icon={ScrollText}
        title="이 페이지에는 글이 없습니다"
        description="글이 삭제되었거나 페이지 범위를 벗어났습니다."
        action={
          <LinkButton
            href={hrefWith({ page: 1 })}
            size="small"
            variant="secondary"
          >
            첫 페이지로
          </LinkButton>
        }
      />
    );
  }

  if (filters.q) {
    return (
      <TableEmptyRow
        colSpan={columns}
        icon={Search}
        title={`'${filters.q}' 검색 결과가 없습니다`}
        description="제목과 본문에서 찾습니다. 다른 낱말로 줄여서 다시 찾아보세요."
        action={
          <LinkButton href={hrefWith({ q: "" })} size="small" variant="secondary">
            검색 해제
          </LinkButton>
        }
      />
    );
  }

  if (filters.category || filters.range !== "all") {
    const what = filters.category
      ? `'${filters.category}' 카테고리`
      : filters.range === "week"
        ? "이번 주"
        : "이번 달";
    return (
      <TableEmptyRow
        colSpan={columns}
        icon={SlidersHorizontal}
        title={`${what}에 올라온 글이 없습니다`}
        description="다른 카테고리나 기간에는 글이 있을 수 있습니다."
        action={
          <LinkButton href={basePath} size="small" variant="secondary">
            전체 보기
          </LinkButton>
        }
      />
    );
  }

  return (
    <TableEmptyRow
      colSpan={columns}
      icon={ScrollText}
      title="아직 올라온 글이 없습니다"
      description={
        canWrite
          ? "첫 글을 올리면 이 자리에 제목·작성자·작성일이 쌓입니다."
          : isNotice
            ? "공지는 팀장·매니저 이상이 작성합니다. 새 공지가 올라오면 여기에 표시됩니다."
            : undefined
      }
      action={
        canWrite ? (
          <LinkButton href={`${basePath}/new`} size="small" variant="secondary">
            첫 글 쓰기
          </LinkButton>
        ) : undefined
      }
    />
  );
}
