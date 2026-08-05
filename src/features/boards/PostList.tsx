import Link from "next/link";
import { Pin, ScrollText, Search, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import { MiniMeter } from "@/components/ui/Progress";
import { Pagination } from "@/components/ui/Pagination";
import { DataTable, Td, Th } from "@/components/ui/Table";
import {
  FilterChip,
  TableToolbar,
  ToolbarSearch,
} from "@/components/ui/TableToolbar";
import { AvatarWithName } from "@/components/ui/Avatar";
import { periodFields, periodHref } from "@/lib/period";
import { cn, formatDate } from "@/lib/utils";
import {
  POST_CATEGORIES,
  type Board,
  type BoardType,
  type PostListItem,
} from "./types";
import { BOARD_DEFAULT_RANGE, type BoardRange } from "./format";

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
  basePath,
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
  /**
   * 목록·글 상세·글쓰기 링크의 뿌리. 같은 컴포넌트가 게시판(/board/:id)과
   * 동호회(/community/:id) 두 라우트에서 쓰이므로 호출부가 정한다.
   */
  basePath: string;
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
  const { category, q, range } = filters;

  /** 기간은 lib/period가, 나머지 조건은 extra가 유지한다 */
  const hrefWith = (next: Partial<PostListFilters>) => {
    const merged = { ...filters, page: 1, ...next };
    return periodHref(
      basePath,
      { unit: merged.range, cursor: null },
      {
        defaultUnit: BOARD_DEFAULT_RANGE,
        extra: {
          category: merged.category,
          q: merged.q,
          page: merged.page > 1 ? merged.page : undefined,
        },
      },
    );
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
            {periodFields({ unit: range }, BOARD_DEFAULT_RANGE).map((field) => (
              <input
                key={field.name}
                type="hidden"
                name={field.name}
                value={field.value}
              />
            ))}
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

      {/*
        08 흰 시트: md+에서는 본문 전체가 흰 면이라 카드 래퍼가 흰 면 위
        이중 테두리가 된다 — 표를 시트에 직접 놓는다(10-modules2 "표는 카드
        안이 아니라 흰 면 위에 그대로"). md 미만은 캔버스 위 카드 문법이
        그대로라 카드 면을 유지한다 — CalendarBoard와 같은 패턴.
      */}
      <Card className="overflow-hidden md:rounded-none md:border-0">
        <DataTable fixed minWidth={isNotice ? 940 : 700}>
          <thead>
            <tr>
              <Th className="w-9">
                <span className="sr-only">상태</span>
              </Th>
              {isNotice ? <Th className="w-20">카테고리</Th> : null}
              <Th>제목</Th>
              <Th align="right" className="w-14">
                댓글
              </Th>
              {/* 열람률(대상자 중 몇 명)과 다른 숫자다 — 이건 열린 횟수 */}
              <Th
                align="right"
                className="w-14"
                title="같은 사람이 같은 날 여러 번 열어도 1회로 셉니다"
              >
                조회
              </Th>
              {isNotice ? <Th className="w-32">열람률</Th> : null}
              <Th className="w-32">작성자</Th>
              <Th className="w-24">작성일</Th>
            </tr>
          </thead>
          <tbody>
            {posts.length === 0 ? (
              <EmptyRow
                columns={columns}
                boardType={board.board_type}
                archived={!!board.archived_at}
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
                    /*
                      행 구분선이 사라졌으므로(실측: 표는 헤더 밑줄 하나뿐)
                      고정글 그룹의 끝은 여기서 선을 직접 긋는다.
                      "선이 없는 표"에서 딱 한 줄 있는 선은 그 자체가 뜻이 된다.
                    */
                    i === lastPinned &&
                      i < posts.length - 1 &&
                      "[&>td]:border-b [&>td]:border-line-strong",
                  )}
                >
                  <Td align="center">
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
                  </Td>

                  {isNotice ? (
                    <Td>
                      {post.category ? (
                        <Badge tone="neutral">{post.category}</Badge>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </Td>
                  ) : null}

                  <Td>
                    <Link
                      href={`${basePath}/${post.id}`}
                      className={cn(
                        "block truncate hover:underline",
                        post.isRead ? "text-muted" : "font-bold text-ink",
                      )}
                    >
                      {post.title}
                    </Link>
                  </Td>

                  <Td align="right" numeric>
                    {post.commentCount > 0 ? (
                      post.commentCount
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </Td>

                  <Td align="right" numeric>
                    {post.view_count > 0 ? (
                      post.view_count
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </Td>

                  {isNotice ? (
                    <Td>
                      <ReadRateCell post={post} />
                    </Td>
                  ) : null}

                  <Td>
                    <AvatarWithName
                      name={post.author?.name ?? "-"}
                      src={post.author?.profile_image_url}
                      size="small"
                    />
                  </Td>

                  <Td numeric nowrap className="text-muted">
                    {formatDate(post.created_at)}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>

        <Pagination
          page={filters.page}
          pageSize={pageSize}
          total={total}
          basePath={basePath}
          params={{
            category: category || undefined,
            q: q || undefined,
            period: range === BOARD_DEFAULT_RANGE ? undefined : range,
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
  boardType,
  archived,
  canWrite,
  filters,
  basePath,
  hrefWith,
}: {
  columns: number;
  boardType: BoardType;
  /** 보관된 동호회 — 가입 자체가 막혀 있어 안내 문구가 갈린다 */
  archived: boolean;
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
          : boardType === "notice"
            ? "공지는 팀장·매니저 이상이 작성합니다. 새 공지가 올라오면 여기에 표시됩니다."
            : boardType === "community"
              ? archived
                ? "보관된 동호회라 새 글을 받지 않습니다. 글이 올라온 적 없이 보관되었습니다."
                : "글은 가입한 회원이 씁니다. 가입하면 여기에 첫 글을 올릴 수 있습니다."
              : undefined
      }
      /*
        여기서만 cta(브랜드색 채운 버튼)를 쓴다 — 실측의 `새 글 작성하기`와
        같은 자리·같은 문구다(05-board.md). 위쪽 세 갈래("첫 페이지로"·
        "검색 해제"·"전체 보기")는 앞세울 액션이 아니라 필터를 되돌리는 문이라
        secondary로 둔다. canWrite가 아니면 아무것도 렌더하지 않는다 —
        눌러도 안 되는 버튼은 두지 않는다는 이 프로젝트의 규약.
      */
      cta={
        canWrite ? { label: "새 글 작성하기", href: `${basePath}/new` } : undefined
      }
    />
  );
}
