import type { Employee } from "@/types/db";

export type BoardType = "notice" | "discussion";

/** 공지 카테고리 (스펙 3.1 — notice 타입에서 주로 사용) */
export const POST_CATEGORIES = ["인사", "총무", "제품", "재무", "기타"] as const;
export type PostCategory = (typeof POST_CATEGORIES)[number];

/** 이모지 반응 4종 고정 (스펙 3.3) */
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export const BOARD_TYPE_LABELS: Record<BoardType, string> = {
  notice: "공지",
  discussion: "자유게시판",
};

export interface Board {
  id: string;
  name: string;
  board_type: BoardType;
  department_id: string | null;
  sort_order: number;
  created_at: string;
}

export interface BoardWithDepartment extends Board {
  department: { id: string; name: string } | null;
}

export interface Post {
  id: string;
  board_id: string;
  title: string;
  content: string;
  category: string | null;
  is_pinned: boolean;
  author_id: string;
  /**
   * 총 조회수. 열람률(post_reads)과 다른 지표다 —
   * post_reads는 "대상자 중 누가 읽었나", view_count는 "몇 번 열렸나".
   * 본인 글 조회는 DB 함수가 세지 않는다.
   */
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface PostListItem extends Post {
  author: Pick<Employee, "id" | "name" | "profile_image_url"> | null;
  commentCount: number;
  /** 공지 타입만 채워진다 */
  readCount: number | null;
  targetCount: number | null;
  /** 본인이 읽었는지 */
  isRead: boolean;
}

export interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface CommentWithAuthor extends Comment {
  author: Pick<Employee, "id" | "name" | "profile_image_url"> | null;
}

/**
 * 첨부파일.
 * file_url에는 공개 URL이 아니라 스토리지 경로가 들어간다
 * (`<auth uid>/<글 id>/<파일명>`). 버킷이 비공개라 열 때마다 서명 URL을 받는다.
 */
export interface PostAttachment {
  id: string;
  post_id: string;
  file_url: string;
  file_name: string | null;
  file_size: number | null;
  uploaded_at: string;
}

/** 첨부 허용 형식 — 버킷 정책(post-attachments)과 같은 값이어야 한다 */
export const ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;

/** 건당 10MB — 버킷의 file_size_limit과 같은 값 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export interface ReactionSummary {
  emoji: ReactionEmoji;
  count: number;
  mine: boolean;
}

export interface PostDetail extends Post {
  author: Pick<Employee, "id" | "name" | "position" | "profile_image_url"> | null;
  board: Board | null;
  comments: CommentWithAuthor[];
  attachments: PostAttachment[];
  reactions: ReactionSummary[];
  readCount: number | null;
  targetCount: number | null;
}

export interface ReadStatusRow {
  employee_id: string;
  employee_name: string;
  department_name: string | null;
  read_at: string | null;
}

export function isBoardType(value: unknown): value is BoardType {
  return value === "notice" || value === "discussion";
}
