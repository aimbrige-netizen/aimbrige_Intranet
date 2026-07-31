"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Download,
  Eye,
  MessageSquare,
  Paperclip,
  Pencil,
  Pin,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Meter } from "@/components/ui/Progress";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Field";
import { AvatarWithName, Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  createComment,
  deleteComment,
  deletePost,
  getPostAttachmentUrl,
  toggleReaction,
} from "@/server/actions/boards";
import { formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { formatFileSize, percent, splitLinks } from "./format";
import type { PostDetail, ReadStatusRow } from "./types";

/**
 * 평문 본문을 그대로 보여준다 — 줄바꿈은 whitespace-pre-wrap이 유지하고,
 * 주소는 눌러서 열 수 있게 끊어낸다. 에디터가 평문 textarea라
 * 여기서 처리하지 않으면 링크가 글자로만 남는다.
 */
function PostText({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn("whitespace-pre-wrap break-words", className)}>
      {splitLinks(text).map((segment, i) =>
        segment.kind === "link" ? (
          <a
            key={i}
            href={segment.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline underline-offset-2"
          >
            {segment.value}
          </a>
        ) : (
          <span key={i}>{segment.value}</span>
        ),
      )}
    </p>
  );
}

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
  const [fileError, setFileError] = useState<string | null>(null);
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

  /** 비공개 버킷이라 열 때마다 서명 URL을 받는다 (결재 첨부와 같은 방식) */
  const download = (storagePath: string) => {
    setFileError(null);
    startTransition(async () => {
      const result = await getPostAttachmentUrl(storagePath);
      if (!result.ok || !result.url) {
        setFileError(result.message ?? "다운로드 링크를 만들지 못했습니다.");
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
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
                  <Badge tone="neutral">{post.category}</Badge>
                ) : null}
                {/* 고정은 위반이 아니다 — 빨강은 실제 위반·파괴적 동작에만 */}
                {post.is_pinned ? (
                  <Badge tone="neutral">
                    <Pin className="mr-1 size-3 text-primary" aria-hidden />
                    고정
                  </Badge>
                ) : null}
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
                {/*
                  조회수는 열람률과 다른 숫자다 — 열람률은 "대상자 중 누가
                  읽었나"(명), 조회는 "몇 번 열렸나"(회). 라벨과 단위로 가른다.
                  본인 글 조회는 세지 않는다.
                */}
                <span className="inline-flex items-center gap-1 text-caption tabular-nums">
                  <Eye className="size-3.5 text-muted" aria-hidden />
                  조회 {post.view_count}회
                </span>
                {post.attachments.length > 0 ? (
                  <span className="inline-flex items-center gap-1 text-caption tabular-nums">
                    <Paperclip className="size-3.5 text-muted" aria-hidden />
                    첨부 {post.attachments.length}건
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
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
                    className="!text-danger hover:!bg-danger-light"
                  >
                    <Trash2 className="size-3.5" />
                    삭제
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          {/*
            열람률은 배지 하나로는 12/30과 28/30이 구분되지 않는다.
            막대가 먼저 읽히고 숫자가 확인해 준다.
          */}
          {isNotice && post.readCount !== null && post.targetCount !== null ? (
            <div className="mt-4 rounded-card border border-line bg-canvas px-4 py-3">
              <Meter
                value={post.readCount}
                max={post.targetCount || 1}
                tone={
                  post.targetCount > 0 && post.readCount >= post.targetCount
                    ? "positive"
                    : "informative"
                }
                label={`이 공지를 ${percent(post.readCount, post.targetCount)}% 읽었습니다`}
                valueLabel={`${post.readCount} / ${post.targetCount}명`}
              />
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-label text-muted">
                <span>열람 {post.readCount}명</span>
                <span>·</span>
                <span>미열람 {post.targetCount - post.readCount}명</span>
                <span>·</span>
                <span>대상 {post.targetCount}명</span>
                {canSeeReads ? (
                  <Button
                    size="xsmall"
                    variant="secondary"
                    className="ml-auto"
                    onClick={() => setReadOpen(true)}
                  >
                    <Users className="size-3.5" />
                    읽음 현황
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-5 border-t border-line pt-5 text-body leading-relaxed text-ink">
            <PostText text={post.content} />
          </div>

          {/*
            비공개 버킷이라 file_url은 열 수 있는 주소가 아니라 스토리지
            경로다. 누를 때 서명 URL을 받아 연다.
          */}
          {post.attachments.length > 0 ? (
            <div className="mt-5 border-t border-line pt-4">
              <p className="mb-1 text-label font-bold text-muted">
                첨부파일 {post.attachments.length}건
              </p>
              <ul className="divide-y divide-line">
                {post.attachments.map((file) => (
                  <li key={file.id} className="flex items-center gap-2 py-2">
                    <Paperclip
                      className="size-4 shrink-0 text-muted"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-body text-ink">
                      {file.file_name ?? "첨부파일"}
                    </span>
                    {formatFileSize(file.file_size) ? (
                      <span className="shrink-0 tabular-nums text-caption">
                        {formatFileSize(file.file_size)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => download(file.file_url)}
                      disabled={pending}
                      aria-label={`${file.file_name ?? "첨부"} 내려받기`}
                      className="shrink-0 rounded-sm p-1.5 text-muted transition-colors hover:bg-canvas hover:text-primary disabled:opacity-50"
                    >
                      <Download className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
              {fileError ? (
                <p className="mt-1.5 text-label text-danger">{fileError}</p>
              ) : null}
            </div>
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
                          className="ml-auto rounded-sm p-1 text-muted transition-colors hover:bg-danger-light hover:text-danger disabled:opacity-50"
                          aria-label="댓글 삭제"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                    <PostText
                      text={c.content}
                      className="mt-0.5 text-body text-ink"
                    />
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
          <Meter
            value={post.readCount ?? 0}
            max={readStatus.length || 1}
            tone={unread.length === 0 ? "positive" : "informative"}
            label="열람 진행"
            valueLabel={`${post.readCount ?? 0} / ${readStatus.length}명`}
          />

          {/* 미열람은 위반이 아니라 아직 오지 않은 상태다 — 파랑 */}
          {unread.length > 0 ? (
            <Callout tone="info" title={`미열람 ${unread.length}명`}>
              {unread
                .slice(0, 8)
                .map((row) => row.employee_name)
                .join(", ")}
              {unread.length > 8 ? ` 외 ${unread.length - 8}명` : ""}
            </Callout>
          ) : (
            <Callout tone="success" title="대상자 전원이 열람했습니다" />
          )}

          <div className="overflow-x-auto">
            <table className="ab-table ab-table--compact">
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
                        <Badge tone="info">미열람</Badge>
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
