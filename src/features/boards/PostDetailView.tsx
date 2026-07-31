"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Eye, MessageSquare, Pencil, Send, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Field";
import { AvatarWithName, Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  createComment,
  deleteComment,
  deletePost,
  toggleReaction,
} from "@/server/actions/boards";
import { formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { PostDetail, ReadStatusRow } from "./types";

/** 게시글 상세 (스펙 3.3) */
export function PostDetailView({
  post,
  currentEmployeeId,
  isSystemAdmin,
  readStatus,
}: {
  post: PostDetail;
  currentEmployeeId: string;
  isSystemAdmin: boolean;
  readStatus: ReadStatusRow[];
}) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [readOpen, setReadOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isAuthor = post.author_id === currentEmployeeId;
  const canEdit = isAuthor || isSystemAdmin;
  const isNotice = post.board?.board_type === "notice";
  // 읽음 현황은 작성자·관리자만 볼 수 있다(RPC가 강제, 여기선 UI 노출만 판단)
  const canSeeReads = isNotice && readStatus.length > 0;

  const submitComment = () => {
    setError(null);
    startTransition(async () => {
      const result = await createComment(
        { postId: post.id, content: comment },
        post.board_id,
      );
      if (!result.ok) {
        setError(
          result.fieldErrors?.content ?? result.message ?? "등록하지 못했습니다.",
        );
        return;
      }
      setComment("");
      router.refresh();
    });
  };

  const removeComment = (commentId: string) => {
    if (!window.confirm("댓글을 삭제하시겠습니까?")) return;
    startTransition(async () => {
      const result = await deleteComment(commentId, post.board_id, post.id);
      if (!result.ok) {
        window.alert(result.message ?? "삭제하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  const removePost = () => {
    if (!window.confirm("이 게시글을 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;
    startTransition(async () => {
      const result = await deletePost(post.id, post.board_id);
      if (!result.ok) {
        window.alert(result.message ?? "삭제하지 못했습니다.");
        return;
      }
      router.push(`/board/${post.board_id}`);
    });
  };

  const react = (emoji: string) => {
    startTransition(async () => {
      await toggleReaction(post.id, emoji, post.board_id);
      router.refresh();
    });
  };

  const unread = readStatus.filter((r) => !r.read_at);

  return (
    <div className="space-y-5">
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {post.category ? (
                  <Badge tone="primary">{post.category}</Badge>
                ) : null}
                {post.is_pinned ? <Badge tone="danger">고정</Badge> : null}
              </div>
              <h1 className="text-h1 text-ink">{post.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <AvatarWithName
                  name={post.author?.name ?? "-"}
                  src={post.author?.profile_image_url}
                  sub={post.author?.position ?? undefined}
                  size="medium"
                />
                <span className="text-caption">
                  {formatDateTime(post.created_at)}
                  {post.updated_at !== post.created_at
                    ? ` (수정 ${formatDateTime(post.updated_at)})`
                    : ""}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {isNotice && post.readCount !== null ? (
                canSeeReads ? (
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => setReadOpen(true)}
                  >
                    <Eye className="size-3.5" />
                    읽음 {post.readCount}/{post.targetCount}
                  </Button>
                ) : (
                  <Badge tone="neutral">
                    읽음 {post.readCount}/{post.targetCount}
                  </Badge>
                )
              ) : null}

              {canEdit ? (
                <>
                  <Link href={`/board/${post.board_id}/${post.id}/edit`}>
                    <Button size="small" variant="secondary">
                      <Pencil className="size-3.5" />
                      수정
                    </Button>
                  </Link>
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={removePost}
                    disabled={pending}
                    className="!text-danger hover:!bg-danger/10"
                  >
                    <Trash2 className="size-3.5" />
                    삭제
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-5 whitespace-pre-wrap border-t border-line pt-5 text-body leading-relaxed text-ink">
            {post.content}
          </div>

          {post.attachments.length > 0 ? (
            <ul className="mt-5 divide-y divide-line border-t border-line pt-3">
              {post.attachments.map((file) => (
                <li key={file.id} className="py-2 text-body text-ink">
                  {file.file_name ?? file.file_url}
                </li>
              ))}
            </ul>
          ) : null}

          {/* 이모지 반응 4종 고정 (스펙 3.3) */}
          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
            {post.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                onClick={() => react(reaction.emoji)}
                disabled={pending}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-body transition-colors disabled:opacity-50",
                  reaction.mine
                    ? "border-primary bg-primary-light text-primary"
                    : "border-line text-muted hover:bg-canvas",
                )}
                aria-pressed={reaction.mine}
              >
                <span aria-hidden>{reaction.emoji}</span>
                {reaction.count > 0 ? (
                  <span className="tabular-nums">{reaction.count}</span>
                ) : null}
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <MessageSquare className="size-4 text-primary" aria-hidden />
              댓글 {post.comments.length}
            </span>
          }
        />
        <CardBody>
          {post.comments.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="첫 댓글을 남겨보세요"
              compact
            />
          ) : (
            <ul className="divide-y divide-line">
              {post.comments.map((c) => (
                <li key={c.id} className="flex gap-3 py-3">
                  <Avatar
                    name={c.author?.name ?? "-"}
                    src={c.author?.profile_image_url}
                    size="medium"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-body font-bold text-ink">
                        {c.author?.name ?? "-"}
                      </span>
                      <span className="text-caption">
                        {formatDateTime(c.created_at)}
                      </span>
                      {c.author_id === currentEmployeeId || isSystemAdmin ? (
                        <button
                          type="button"
                          onClick={() => removeComment(c.id)}
                          disabled={pending}
                          className="ml-auto rounded-sm p-1 text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                          aria-label="댓글 삭제"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-body text-ink">
                      {c.content}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 border-t border-line pt-4">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={pending}
              placeholder="댓글을 입력하세요"
              className="min-h-20"
              aria-label="댓글 입력"
            />
            {error ? (
              <p className="mt-1 text-label text-danger">{error}</p>
            ) : null}
            <div className="mt-2 flex justify-end">
              <Button
                onClick={submitComment}
                disabled={pending || !comment.trim()}
              >
                <Send className="size-3.5" />
                {pending ? "등록 중…" : "댓글 등록"}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* 읽음 현황 (스펙 3.3 — 작성자·관리자만) */}
      <Modal
        open={readOpen}
        onClose={() => setReadOpen(false)}
        title="읽음 현황"
        description={`읽음 ${post.readCount}명 · 미열람 ${unread.length}명`}
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setReadOpen(false)}>
            닫기
          </Button>
        }
      >
        <div className="space-y-4">
          {unread.length > 0 ? (
            <div className="rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-body text-ink">
              <p className="flex items-center gap-2 font-bold">
                <Users className="size-4 text-warn" aria-hidden />
                미열람 {unread.length}명
              </p>
              <p className="mt-1 text-label">
                리마인드 이메일 발송은 메일 서비스(Resend) 연동 후 활성화됩니다.
                현재는 미열람자 목록 확인만 가능합니다.
              </p>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="ab-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>부서</th>
                  <th className="w-40">읽은 시각</th>
                </tr>
              </thead>
              <tbody>
                {readStatus.map((row) => (
                  <tr key={row.employee_id}>
                    <td>{row.employee_name}</td>
                    <td>{row.department_name ?? "-"}</td>
                    <td>
                      {row.read_at ? (
                        <span className="text-caption">
                          {formatDateTime(row.read_at)}
                        </span>
                      ) : (
                        <Badge tone="warn">미열람</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
}
