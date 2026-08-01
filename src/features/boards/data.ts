import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import { addDaysYmd, todayYmd, toSeoulYmd, weekdayOf } from "@/features/calendar/date";
import type {
  Board,
  BoardWithDepartment,
  CommunityMember,
  CommunitySummary,
  PostDetail,
  PostListItem,
  ReactionEmoji,
  ReactionSummary,
  ReadStatusRow,
} from "./types";
import { REACTION_EMOJIS } from "./types";

/** 한 페이지에 담는 글 수 */
export const BOARD_PAGE_SIZE = 20;

/**
 * 요약·칩 건수를 뽑을 때 훑는 최대 행 수.
 * 총 건수는 count로 정확히 받고, 주/월·카테고리 분해만 이 범위에서 센다.
 */
const OVERVIEW_SCAN_LIMIT = 500;

/** PostgREST or() 구문에서 콤마·괄호는 구분자라 제거한다 */
function keywordOf(q?: string): string {
  return (q ?? "").replace(/[,()]/g, "").trim();
}

interface ReadCountRow {
  post_id: string;
  read_count: number;
  target_count: number;
}

/** 게시판 전체의 글별 읽음 집계 (공지 타입 전용 RPC) */
async function readCountsOf(
  supabase: ReturnType<typeof createServerSupabase>,
  boardId: string,
): Promise<ReadCountRow[]> {
  const { data, error } = await supabase.rpc("board_post_read_counts", {
    p_board_id: boardId,
  });
  if (error) {
    console.error("[boards] 읽음 집계 실패:", error.message);
    return [];
  }
  return ((data ?? []) as ReadCountRow[]).map((row) => ({
    post_id: row.post_id,
    read_count: Number(row.read_count),
    target_count: Number(row.target_count),
  }));
}

/** 게시판·동호회에 공통으로 쓰는 boards 컬럼 목록 */
const BOARD_COLUMNS =
  "id, name, board_type, department_id, sort_order, created_at, description, created_by, archived_at";

/**
 * 게시판 목록 (스펙 3.1)
 *
 * 동호회는 여기서 제외한다. 이 함수 하나가 게시판 모듈의 사이드 패널·인덱스
 * 리다이렉트·관리 화면의 유일한 출처라, 걸러내지 않으면 board_type 알파벳순
 * (community < discussion < notice)에 따라 /board 인덱스가 남의 동호회로
 * 떨어진다. 동호회 목록은 getCommunities()가 따로 낸다.
 */
export async function getBoards(): Promise<BoardWithDepartment[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("boards")
    .select(`${BOARD_COLUMNS}, department:departments!department_id(id, name)`)
    .neq("board_type", "community")
    .order("board_type")
    .order("sort_order")
    .order("name");

  if (error) {
    console.error("[boards] 게시판 조회 실패:", error.message);
    return [];
  }
  return (data ?? []) as never;
}

/**
 * 보드 한 건. 동호회 상세도 이 함수를 쓰므로 타입 필터를 걸지 않는다.
 *
 * 조회 실패를 반드시 로그로 남긴다. 이 함수의 null은 화면에서 404가 되는데,
 * BOARD_COLUMNS가 마이그레이션 24의 새 컬럼(description·created_by·archived_at)을
 * 요구하므로 마이그레이션 전에는 모든 게시판 URL이 "없는 글"로 보인다 —
 * 로그가 없으면 원인이 스키마라는 걸 화면에서도 서버에서도 알 수 없다.
 */
export async function getBoard(id: string): Promise<Board | null> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("boards")
    .select(BOARD_COLUMNS)
    .eq("id", id)
    .maybeSingle<Board>();

  if (error) {
    console.error("[boards] 게시판 조회 실패:", error.message);
    return null;
  }
  return data ?? null;
}

/**
 * 동호회 목록 (스펙 16 · 3.1)
 * 보관된 동호회는 기본적으로 감춘다 — 관리 화면만 includeArchived로 함께 본다.
 */
export async function getCommunities(
  includeArchived = false,
): Promise<CommunitySummary[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("list_communities", {
    p_include_archived: includeArchived,
  });

  if (error) {
    console.error("[boards] 동호회 목록 조회 실패:", error.message);
    return [];
  }
  return ((data ?? []) as CommunitySummary[]).map((row) => ({
    ...row,
    member_count: Number(row.member_count),
    post_count: Number(row.post_count),
  }));
}

/** 동호회 멤버 명단 — 개설자가 맨 위 (스펙 16 · 3.2) */
export async function getCommunityMembers(
  boardId: string,
): Promise<CommunityMember[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("community_member_list", {
    p_board_id: boardId,
  });

  if (error) {
    console.error("[boards] 동호회 멤버 조회 실패:", error.message);
    return [];
  }
  return (data ?? []) as CommunityMember[];
}

/**
 * 내가 이 동호회 멤버인지.
 * PK 조회라 임베드가 없다 — boards→employees 임베드의 FK 모호성 문제를 피한다.
 */
export async function isCommunityMember(
  boardId: string,
  employeeId: string,
): Promise<boolean> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("community_members")
    .select("board_id")
    .eq("board_id", boardId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  return !!data;
}

export interface PostQuery {
  category?: string;
  /** 제목·본문 검색어 */
  q?: string;
  /** YYYY-MM-DD. 이 날짜(서울 기준) 00:00 이후 글만 */
  since?: string;
  page?: number;
  pageSize?: number;
}

export interface PostPage {
  posts: PostListItem[];
  /** 필터를 적용한 전체 건수. 페이지네이터의 분모 */
  total: number;
}

/**
 * 게시판의 글 목록 (스펙 3.1)
 * 고정글이 위로, 나머지는 최신순.
 *
 * 예전에는 .limit(100)으로 잘라 오고 화면은 잘린 배열 길이를 "100건"으로
 * 찍어서, 101번째 글에는 도달 경로 자체가 없었다. 이제 range로 페이지를
 * 끊고 count로 실제 총 건수를 함께 받는다.
 */
export async function getPosts(
  boardId: string,
  employeeId: string,
  options: PostQuery = {},
): Promise<PostPage> {
  const supabase = createServerSupabase();

  const pageSize = options.pageSize ?? BOARD_PAGE_SIZE;
  const page = Math.max(1, options.page ?? 1);
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("posts")
    .select(
      `id, board_id, title, content, category, is_pinned, author_id, view_count,
       created_at, updated_at,
       author:employees!author_id(id, name, profile_image_url),
       comments:comments(count)`,
      { count: "exact" },
    )
    .eq("board_id", boardId)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (options.category) query = query.eq("category", options.category);
  if (options.since) {
    query = query.gte("created_at", `${options.since}T00:00:00+09:00`);
  }

  const keyword = keywordOf(options.q);
  if (keyword) {
    query = query.or(`title.ilike.%${keyword}%,content.ilike.%${keyword}%`);
  }

  const [{ data, count, error }, board] = await Promise.all([
    query,
    getBoard(boardId),
  ]);

  if (error) {
    console.error("[boards] 글 목록 조회 실패:", error.message);
    return { posts: [], total: 0 };
  }

  const rows = (data ?? []) as unknown as (PostListItem & {
    comments: { count: number }[];
  })[];
  const postIds = rows.map((r) => r.id);

  // 공지 타입만 읽음 집계를 붙인다 (스펙 3.1)
  const readCounts = new Map<string, { read: number; target: number }>();
  if (board?.board_type === "notice" && postIds.length > 0) {
    (await readCountsOf(supabase, boardId)).forEach((c) =>
      readCounts.set(c.post_id, {
        read: c.read_count,
        target: c.target_count,
      }),
    );
  }

  // 본인 읽음 여부
  const myReads = new Set<string>();
  if (postIds.length > 0) {
    const { data: mine } = await supabase
      .from("post_reads")
      .select("post_id")
      .eq("employee_id", employeeId)
      .in("post_id", postIds);
    (mine ?? []).forEach((r) => myReads.add(r.post_id as string));
  }

  return {
    posts: rows.map((row) => {
      const counts = readCounts.get(row.id);
      return {
        ...row,
        commentCount: row.comments?.[0]?.count ?? 0,
        readCount: counts?.read ?? null,
        targetCount: counts?.target ?? null,
        isRead: myReads.has(row.id),
      };
    }),
    total: count ?? rows.length,
  };
}

export interface BoardOverview {
  /** 필터와 무관한 게시판 전체 건수 */
  total: number;
  thisWeek: number;
  lastWeek: number;
  thisMonth: number;
  /** 내가 아직 열어보지 않은 글 */
  unread: number;
  /** 내가 쓴 글 */
  myPosts: number;
  /**
   * 조회수 합 — 열람률과 다른 지표라 라벨을 "조회"로 구분한다.
   * 한 사람의 같은 날 재방문은 1회로 묶여 들어온다(마이그레이션 16).
   */
  viewTotal: number;
  latestAt: string | null;
  /** 카테고리별 건수 (필터 칩의 분모) */
  categoryCounts: Record<string, number>;
  uncategorized: number;
  /** 아래 넷은 공지 타입만 채워진다 */
  readTotal: number | null;
  targetTotal: number | null;
  targetPerPost: number | null;
  fullyRead: number | null;
  /** 미열람 글 중 최신 몇 건 — 칩 스트립용 */
  unreadRecent: { id: string; title: string; created_at: string }[];
}

const EMPTY_OVERVIEW: BoardOverview = {
  total: 0,
  thisWeek: 0,
  lastWeek: 0,
  thisMonth: 0,
  unread: 0,
  myPosts: 0,
  viewTotal: 0,
  latestAt: null,
  categoryCounts: {},
  uncategorized: 0,
  readTotal: null,
  targetTotal: null,
  targetPerPost: null,
  fullyRead: null,
  unreadRecent: [],
};

/**
 * 게시판 요약 — 필터와 무관한 게시판 전체의 상태.
 *
 * 목록 쿼리는 페이지 단위로 잘려 있어서 "이번 주 몇 건", "내 미열람 몇 건"을
 * 만들 수 없다. 요약 밴드·카테고리 칩 건수·열람 게이지는 전부 이 함수가 낸다.
 */
export async function getBoardOverview(
  boardId: string,
  employeeId: string,
): Promise<BoardOverview> {
  const supabase = createServerSupabase();

  const [{ data, count, error }, board] = await Promise.all([
    supabase
      .from("posts")
      .select("id, title, category, author_id, view_count, created_at", {
        count: "exact",
      })
      .eq("board_id", boardId)
      .order("created_at", { ascending: false })
      .limit(OVERVIEW_SCAN_LIMIT),
    getBoard(boardId),
  ]);

  if (error) {
    console.error("[boards] 게시판 요약 조회 실패:", error.message);
    return EMPTY_OVERVIEW;
  }

  const rows = (data ?? []) as {
    id: string;
    title: string;
    category: string | null;
    author_id: string;
    view_count: number;
    created_at: string;
  }[];

  const today = todayYmd();
  const weekStart = addDaysYmd(today, -weekdayOf(today));
  const lastWeekStart = addDaysYmd(weekStart, -7);
  const monthStart = `${today.slice(0, 7)}-01`;

  const categoryCounts: Record<string, number> = {};
  let uncategorized = 0;
  let thisWeek = 0;
  let lastWeek = 0;
  let thisMonth = 0;
  let myPosts = 0;
  let viewTotal = 0;

  rows.forEach((row) => {
    const ymd = toSeoulYmd(row.created_at);
    if (ymd >= weekStart) thisWeek += 1;
    else if (ymd >= lastWeekStart) lastWeek += 1;
    if (ymd >= monthStart) thisMonth += 1;
    if (row.author_id === employeeId) myPosts += 1;
    viewTotal += row.view_count ?? 0;
    if (row.category) {
      categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1;
    } else {
      uncategorized += 1;
    }
  });

  // 본인 읽음 여부
  const myReads = new Set<string>();
  if (rows.length > 0) {
    const { data: mine } = await supabase
      .from("post_reads")
      .select("post_id")
      .eq("employee_id", employeeId)
      .in(
        "post_id",
        rows.map((r) => r.id),
      );
    (mine ?? []).forEach((r) => myReads.add(r.post_id as string));
  }

  const unreadRows = rows.filter((row) => !myReads.has(row.id));

  let readTotal: number | null = null;
  let targetTotal: number | null = null;
  let targetPerPost: number | null = null;
  let fullyRead: number | null = null;

  if (board?.board_type === "notice" && rows.length > 0) {
    const counts = await readCountsOf(supabase, boardId);
    readTotal = counts.reduce((sum, c) => sum + c.read_count, 0);
    targetTotal = counts.reduce((sum, c) => sum + c.target_count, 0);
    targetPerPost = counts.reduce((max, c) => Math.max(max, c.target_count), 0);
    fullyRead = counts.filter(
      (c) => c.target_count > 0 && c.read_count >= c.target_count,
    ).length;
  }

  return {
    total: count ?? rows.length,
    thisWeek,
    lastWeek,
    thisMonth,
    unread: unreadRows.length,
    myPosts,
    viewTotal,
    latestAt: rows[0]?.created_at ?? null,
    categoryCounts,
    uncategorized,
    readTotal,
    targetTotal,
    targetPerPost,
    fullyRead,
    unreadRecent: unreadRows.slice(0, 6).map((row) => ({
      id: row.id,
      title: row.title,
      created_at: row.created_at,
    })),
  };
}

/** 게시글 상세 (스펙 3.3) */
export async function getPostDetail(
  postId: string,
  employeeId: string,
): Promise<PostDetail | null> {
  const supabase = createServerSupabase();

  const { data, error } = await supabase
    .from("posts")
    .select(
      `id, board_id, title, content, category, is_pinned, author_id, view_count,
       created_at, updated_at,
       author:employees!author_id(id, name, position, profile_image_url),
       board:boards!board_id(${BOARD_COLUMNS}),
       comments:comments(
         id, post_id, author_id, content, created_at, updated_at,
         author:employees!author_id(id, name, profile_image_url)
       ),
       attachments:post_attachments(
         id, post_id, file_url, file_name, file_size, uploaded_at
       )`,
    )
    .eq("id", postId)
    .maybeSingle();

  if (error) {
    console.error("[boards] 게시글 조회 실패:", error.message);
    return null;
  }
  if (!data) return null;

  const post = data as unknown as PostDetail;
  post.comments = [...(post.comments ?? [])].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  // 임베드 순서는 보장되지 않는다 — 올린 순서로 고정한다
  post.attachments = [...(post.attachments ?? [])].sort((a, b) =>
    a.uploaded_at.localeCompare(b.uploaded_at),
  );

  // 반응 집계 — 4종 고정이라 전체를 가져와 세는 편이 단순하다
  const { data: reactionRows } = await supabase
    .from("reactions")
    .select("emoji, employee_id")
    .eq("post_id", postId);

  const reactions: ReactionSummary[] = REACTION_EMOJIS.map((emoji) => {
    const matching = (reactionRows ?? []).filter((r) => r.emoji === emoji);
    return {
      emoji: emoji as ReactionEmoji,
      count: matching.length,
      mine: matching.some((r) => r.employee_id === employeeId),
    };
  });
  post.reactions = reactions;

  // 공지 타입이면 읽음 집계
  post.readCount = null;
  post.targetCount = null;
  if (post.board?.board_type === "notice") {
    const { data: counts } = await supabase.rpc("board_post_read_counts", {
      p_board_id: post.board_id,
    });
    const row = (
      (counts ?? []) as { post_id: string; read_count: number; target_count: number }[]
    ).find((c) => c.post_id === postId);
    if (row) {
      post.readCount = Number(row.read_count);
      post.targetCount = Number(row.target_count);
    }
  }

  return post;
}

/** 읽음 현황 상세 — 작성자·관리자만 (스펙 3.3) */
export async function getReadStatus(
  postId: string,
): Promise<ReadStatusRow[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("post_read_status", {
    p_post_id: postId,
  });

  if (error) {
    // 권한이 없으면 함수가 예외를 던진다 — 화면에서는 섹션을 숨긴다
    return [];
  }
  return (data ?? []) as ReadStatusRow[];
}

/**
 * 홈 위젯 "공지사항" (스펙 7장)
 * 전사공지 게시판의 최근 미열람 글.
 */
/**
 * 미열람 공지.
 *
 * boardId를 함께 돌려준다 — 없으면 호출부가 /board 목록으로밖에 못 보내서
 * "안 읽은 공지 5건"을 보고도 그 글로 바로 갈 수 없다.
 */
export async function getUnreadNotices(
  employeeId: string,
  limit = 5,
): Promise<
  {
    id: string;
    boardId: string;
    title: string;
    boardName: string;
    createdAt: string;
  }[]
> {
  const supabase = createServerSupabase();

  const { data: boards } = await supabase
    .from("boards")
    .select("id, name")
    .eq("board_type", "notice");

  const boardIds = (boards ?? []).map((b) => b.id as string);
  if (boardIds.length === 0) return [];

  const boardNames = new Map(
    (boards ?? []).map((b) => [b.id as string, b.name as string]),
  );

  const [{ data: posts }, { data: reads }] = await Promise.all([
    supabase
      .from("posts")
      .select("id, title, board_id, created_at")
      .in("board_id", boardIds)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.from("post_reads").select("post_id").eq("employee_id", employeeId),
  ]);

  const read = new Set((reads ?? []).map((r) => r.post_id as string));

  return (posts ?? [])
    .filter((p) => !read.has(p.id as string))
    .slice(0, limit)
    .map((p) => ({
      id: p.id as string,
      boardId: p.board_id as string,
      title: p.title as string,
      boardName: boardNames.get(p.board_id as string) ?? "공지",
      createdAt: p.created_at as string,
    }));
}
