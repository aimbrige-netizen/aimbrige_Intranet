import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Eye, FilePlus2, PenLine, Plus, ScrollText } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Meter } from "@/components/ui/Progress";
import { Chip } from "@/components/ui/ChipStrip";
import { PostList } from "@/features/boards/PostList";
import { requireSessionEmployee } from "@/lib/auth/session";
import {
  BOARD_PAGE_SIZE,
  getBoard,
  getBoardOverview,
  getPosts,
} from "@/features/boards/data";
import {
  BOARD_RANGES,
  BOARD_RANGE_LABELS,
  parseRange,
  percent,
  relativeTime,
  rangeSince,
  type BoardRange,
} from "@/features/boards/format";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "게시판" };

/**
 * 게시판 글 목록.
 *
 * 구성은 근태 화면과 같은 골격 — 헤더(범위 세그먼트) → 분모 있는 요약 밴드
 * → 열람 게이지·미열람 칩 → 조밀한 표.
 * 예전에는 지표가 "{posts.length}건" 하나뿐이었고, 그 숫자마저 .limit(100)에
 * 잘린 배열 길이였다.
 */
export default async function BoardPage({
  params,
  searchParams,
}: {
  params: { boardId: string };
  searchParams: {
    category?: string;
    q?: string;
    range?: string;
    page?: string;
  };
}) {
  const me = await requireSessionEmployee();

  const board = await getBoard(params.boardId);
  if (!board) notFound();

  const isNotice = board.board_type === "notice";
  // 공지 게시판은 팀장 이상만 작성 (스펙 3.2)
  const canWrite = !isNotice || me.isManager;

  // 카테고리는 공지 타입에만 있다 (스펙 3.2)
  const category = isNotice ? (searchParams.category ?? "") : "";
  const q = (searchParams.q ?? "").trim();
  const range: BoardRange = parseRange(searchParams.range);
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);

  const [overview, { posts, total }] = await Promise.all([
    getBoardOverview(params.boardId, me.id),
    getPosts(params.boardId, me.id, {
      category,
      q,
      since: rangeSince(range),
      page,
      pageSize: BOARD_PAGE_SIZE,
    }),
  ]);

  const rangeHref = (next: BoardRange) => {
    const search = new URLSearchParams();
    if (category) search.set("category", category);
    if (q) search.set("q", q);
    if (next !== "all") search.set("range", next);
    const query = search.toString();
    return query ? `/board/${board.id}?${query}` : `/board/${board.id}`;
  };

  const rangeCount: Record<BoardRange, number> = {
    week: overview.thisWeek,
    month: overview.thisMonth,
    all: overview.total,
  };

  const readRate = percent(overview.readTotal ?? 0, overview.targetTotal ?? 0);

  const weekDelta = overview.thisWeek - overview.lastWeek;

  return (
    <>
      <PageHeader
        title={board.name}
        meta={
          <>
            <span>{isNotice ? "공지 게시판" : "자유게시판"}</span>
            <span>·</span>
            <span>전체 {overview.total}건</span>
            {overview.unread > 0 ? (
              <>
                <span>·</span>
                <span>내 미열람 {overview.unread}건</span>
              </>
            ) : null}
            {overview.latestAt ? (
              <>
                <span>·</span>
                <span>최근 갱신 {relativeTime(overview.latestAt)}</span>
              </>
            ) : null}
          </>
        }
        action={
          canWrite ? (
            <LinkButton href={`/board/${board.id}/new`}>
              <Plus className="size-4" />새 글 쓰기
            </LinkButton>
          ) : null
        }
        toolbar={
          <SegmentedControl
            options={BOARD_RANGES.map((value) => ({
              value,
              label: BOARD_RANGE_LABELS[value],
              href: rangeHref(value),
              badge: rangeCount[value],
            }))}
            value={range}
            ariaLabel="조회 범위"
          />
        }
      />

      {/* 요약 밴드 — 맨숫자 대신 분모와 진행바를 붙인다 */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="전체 글"
          value={overview.total}
          unit="건"
          tone="neutral"
          icon={ScrollText}
          sub={`이번 달 ${overview.thisMonth}건`}
        />
        <StatCard
          label="이번 주 새 글"
          value={overview.thisWeek}
          unit="건"
          tone="neutral"
          icon={FilePlus2}
          delta={{
            label: weekDelta === 0 ? "동일" : `${weekDelta > 0 ? "+" : ""}${weekDelta}`,
            direction: weekDelta > 0 ? "up" : weekDelta < 0 ? "down" : "flat",
          }}
          sub={`지난주 ${overview.lastWeek}건`}
        />
        <StatCard
          label="내 미열람"
          value={overview.unread}
          unit="건"
          denominator={overview.total}
          denominatorUnit="건"
          tone="informative"
          icon={Eye}
          max={overview.total || 1}
          meterValue={overview.unread}
          sub={
            overview.unread === 0
              ? "모두 읽었습니다"
              : `읽음 ${overview.total - overview.unread}건`
          }
        />
        {isNotice ? (
          <StatCard
            label="평균 열람률"
            value={readRate}
            unit="%"
            tone="positive"
            icon={Eye}
            max={100}
            meterValue={readRate}
            state={overview.targetTotal ? "ok" : "empty"}
            sub={
              overview.targetPerPost
                ? `대상 ${overview.targetPerPost}명 · 전원 열람 ${overview.fullyRead ?? 0}건`
                : "열람 대상이 없습니다"
            }
          />
        ) : (
          <StatCard
            label="내 글"
            value={overview.myPosts}
            unit="건"
            denominator={overview.total}
            denominatorUnit="건"
            tone="neutral"
            icon={PenLine}
            max={overview.total || 1}
            meterValue={overview.myPosts}
            sub={`전체의 ${percent(overview.myPosts, overview.total)}%`}
          />
        )}
      </div>

      {/* 시각화 블록 — 표만으로는 "누가 안 읽었나"가 보이지 않는다 */}
      {overview.total > 0 && (isNotice || overview.unread > 0) ? (
        <Card className="mb-5">
          <CardHeader
            title={isNotice ? "열람 현황" : "내 미열람"}
            description={
              isNotice
                ? `공지 ${overview.total}건 · 전원 열람 ${overview.fullyRead ?? 0}건 · 내 미열람 ${overview.unread}건`
                : `아직 열어보지 않은 글 ${overview.unread}건`
            }
            density="compact"
          />
          <CardBody density="compact">
            {isNotice && overview.targetTotal ? (
              <Meter
                value={overview.readTotal ?? 0}
                max={overview.targetTotal}
                tone="positive"
                thresholds={[{ at: overview.targetTotal, tone: "positive" }]}
                label={`전사 열람 (대상 ${overview.targetPerPost ?? 0}명 × ${overview.total}건)`}
                valueLabel={`${overview.readTotal ?? 0} / ${overview.targetTotal}`}
                showScale
                maxLabel={`${overview.targetTotal}`}
                className="mb-3"
              />
            ) : null}

            {overview.unreadRecent.length > 0 ? (
              <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
                {overview.unreadRecent.map((item) => (
                  <Link
                    key={item.id}
                    href={`/board/${board.id}/${item.id}`}
                    className="block rounded-sm transition-opacity duration-fast ease-standard hover:opacity-80"
                  >
                    <Chip
                      lines={[
                        item.title,
                        { text: formatDate(item.created_at), dim: true },
                      ]}
                      tone="info"
                      title={item.title}
                    />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-caption">
                이 게시판의 글은 모두 열어보셨습니다.
              </p>
            )}
          </CardBody>
        </Card>
      ) : null}

      <PostList
        board={board}
        posts={posts}
        total={total}
        pageSize={BOARD_PAGE_SIZE}
        boardTotal={overview.total}
        categoryCounts={overview.categoryCounts}
        uncategorized={overview.uncategorized}
        canWrite={canWrite}
        filters={{ category, q, range, page }}
      />
    </>
  );
}
