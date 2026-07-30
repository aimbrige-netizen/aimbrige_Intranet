import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type {
  Board,
  BoardWithDepartment,
  PostDetail,
  PostListItem,
  ReactionEmoji,
  ReactionSummary,
  ReadStatusRow,
} from "./types";
import { REACTION_EMOJIS } from "./types";

/** 게시판 목록 (스펙 3.1) */
export async function getBoards(): Promise<BoardWithDepartment[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("boards")
    .select(
      "id, name, board_type, department_id, sort_order, created_at, department:departments!department_id(id, name)",
    )
    .order("board_type")
    .order("sort_order")
    .order("name");

  if (error) {
    console.error("[boards] 게시판 조회 실패:", error.message);
    return [];
  }
  return (data ?? []) as never;
}

export async function getBoard(id: string): Promise<Board | null> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("boards")
    .select("id, name, board_type, department_id, sort_order, created_at")
    .eq("id", id)
    .maybeSingle<Board>();
  return data ?? null;
}

/**
 * 게시판의 글 목록 (스펙 3.1)
 * 고정글이 위로, 나머지는 최신순.
 */
export async function getPosts(
  boardId: string,
  employeeId: string,
  options?: { category?: string },
): Promise<PostListItem[]> {
  const supabase = createServerSupabase();

  let query = supabase
    .from("posts")
    .select(
      `id, board_id, title, content, category, is_pinned, author_id,
       created_at, updated_at,
       author:employees!author_id(id, name, profile_image_url),
       comments:comments(count)`,
    )
    .eq("board_id", boardId)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (options?.category) query = query.eq("category", options.category);

  const [{ data, error }, board] = await Promise.all([
    query,
    getBoard(boardId),
  ]);

  if (error) {
    console.error("[boards] 글 목록 조회 실패:", error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as (PostListItem & {
    comments: { count: number }[];
  })[];
  const postIds = rows.map((r) => r.id);

  // 공지 타입만 읽음 집계를 붙인다 (스펙 3.1)
  const readCounts = new Map<string, { read: number; target: number }>();
  if (board?.board_type === "notice" && postIds.length > 0) {
    const { data: counts, error: countError } = await supabase.rpc(
      "board_post_read_counts",
      { p_board_id: boardId },
    );
    if (countError) {
      console.error("[boards] 읽음 집계 실패:", countError.message);
    }
    ((counts ?? []) as { post_id: string; read_count: number; target_count: number }[]).forEach(
      (c) =>
        readCounts.set(c.post_id, {
          read: Number(c.read_count),
          target: Number(c.target_count),
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

  return rows.map((row) => {
    const counts = readCounts.get(row.id);
    return {
      ...row,
      commentCount: row.comments?.[0]?.count ?? 0,
      readCount: counts?.read ?? null,
      targetCount: counts?.target ?? null,
      isRead: myReads.has(row.id),
    };
  });
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
      `id, board_id, title, content, category, is_pinned, author_id,
       created_at, updated_at,
       author:employees!author_id(id, name, position, profile_image_url),
       board:boards!board_id(id, name, board_type, department_id, sort_order, created_at),
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
export async function getUnreadNotices(
  employeeId: string,
  limit = 5,
): Promise<{ id: string; title: string; boardName: string; createdAt: string }[]> {
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
      title: p.title as string,
      boardName: boardNames.get(p.board_id as string) ?? "공지",
      createdAt: p.created_at as string,
    }));
}
