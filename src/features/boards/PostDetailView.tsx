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
import { IconButton } from "@/components/ui/IconButton";
import { SectionHeader } from "@/components/ui/Card";
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
            className="text-primary-ink underline underline-offset-2"
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
  basePath,
  currentEmployeeId,
  isSystemAdmin,
  readStatus,
  canEngage = true,
  engageHint,
}: {
  post: PostDetail;
  /** 수정·삭제 후 돌아갈 뿌리 경로 (/board/:id 또는 /community/:id) */
  basePath: string;
  currentEmployeeId: string;
  isSystemAdmin: boolean;
  readStatus: ReadStatusRow[];
  /**
   * 댓글·반응을 남길 수 있는지. 동호회 글은 가입자만이고 보관되면 아무도
   * 남길 수 없다(마이그레이션 24의 can_comment_on_post와 같은 규칙).
   * 서버에서 판정해 넘긴다 — 눌러도 안 되는 입력을 그리지 않기 위해서다.
   */
  canEngage?: boolean;
  /** 남길 수 없을 때 그 자리에 대신 보여줄 한 줄 */
  engageHint?: string;
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
      router.push(basePath);
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
      {/*
        08 흰 시트: md+에서는 본문 카드를 걷고 제목·메타·본문을 시트에 직접
        놓는다(10-modules2 스윕 지침). md 미만은 캔버스 위 카드 문법이라
        카드 면(p-4)을 유지한다 — CalendarBoard와 같은 패턴.
      */}
      <article className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {post.category ? (
                  <Badge tone="neutral">{post.category}</Badge>
                ) : null}
                {/* 고정은 위반이 아니다 — 빨강은 실제 위반·파괴적 동작에만 */}
                {post.is_pinned ? (
                  <Badge tone="neutral">
                    <Pin className="mr-1 size-3 text-primary-ink" aria-hidden />
                    고정
                  </Badge>
                ) : null}
              </div>
              {/*
                콘텐츠 제목 20/500 (10-modules2 화면 문법). 종전 text-h1(24/600)은
                원본에 없는 단이고 PageHeader(20/600)와도 위계가 어긋났다.
                줄높이 30px은 06 heading-l 실측.
              */}
              <h1 className="text-title-l text-ink">
                {post.title}
              </h1>
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
                  같은 사람이 같은 날 여러 번 열어도 1회이고 본인 글은 세지
                  않으므로, 그 뜻을 한 줄 캡션으로 붙여 오해를 막는다.
                */}
                <span
                  className="inline-flex items-center gap-1 text-caption tabular-nums"
                  title="같은 사람이 같은 날 여러 번 열어도 1회로 셉니다. 본인 글 조회는 세지 않습니다."
                >
                  <Eye className="size-3.5 text-muted" aria-hidden />
                  조회 {post.view_count}회
                  <span className="text-muted">(하루 1인 1회)</span>
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
                  <Link href={`${basePath}/${post.id}/edit`}>
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
                    <IconButton
                      label={`${file.file_name ?? "첨부"} 내려받기`}
                      onClick={() => download(file.file_url)}
                      disabled={pending}
                      className="shrink-0 hover:text-primary-ink"
                    >
                      <Download className="size-4" />
                    </IconButton>
                  </li>
                ))}
              </ul>
              {fileError ? (
                <p className="mt-1.5 text-label text-danger">{fileError}</p>
              ) : null}
            </div>
          ) : null}

          {/*
            이모지 반응 4종 고정 (스펙 3.3).
            남길 수 없는 상태에서는 버튼 대신 집계만 보여준다 — 눌러도 안 되는
            버튼을 두지 않는 것이 이 프로젝트의 규약이고, 그렇다고 이미 달린
            반응까지 감추면 "아무도 반응하지 않은 글"로 보인다.
          */}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            {post.reactions.map((reaction) =>
              canEngage ? (
                <button
                  key={reaction.emoji}
                  type="button"
                  onClick={() => react(reaction.emoji)}
                  disabled={pending}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-body transition-colors disabled:opacity-50",
                    reaction.mine
                      ? "border-primary bg-primary-light text-primary-ink"
                      : "border-line text-muted hover:bg-subtle",
                  )}
                  aria-pressed={reaction.mine}
                >
                  <span aria-hidden>{reaction.emoji}</span>
                  {reaction.count > 0 ? (
                    <span className="tabular-nums">{reaction.count}</span>
                  ) : null}
                </button>
              ) : reaction.count > 0 ? (
                <span
                  key={reaction.emoji}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-body text-muted"
                >
                  <span aria-hidden>{reaction.emoji}</span>
                  <span className="tabular-nums">{reaction.count}</span>
                </span>
              ) : null,
            )}
            {!canEngage && engageHint ? (
              <span className="text-caption">{engageHint}</span>
            ) : null}
          </div>
      </article>

      {/* 댓글 — 흰 시트 위라 카드가 아니라 섹션 제목 + 직접 배치(08 문법) */}
      <section>
        <SectionHeader
          title={
            <span className="flex items-center gap-2">
              <MessageSquare className="size-4 text-primary-ink" aria-hidden />
              댓글 {post.comments.length}
            </span>
          }
        />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
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
                        <IconButton
                          label="댓글 삭제"
                          danger
                          onClick={() => removeComment(c.id)}
                          disabled={pending}
                          className="ml-auto"
                        >
                          <Trash2 className="size-3.5" />
                        </IconButton>
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

          {canEngage ? (
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
          ) : engageHint ? (
            <p className="mt-4 border-t border-line pt-4 text-caption">
              {engageHint}
            </p>
          ) : null}
        </div>
      </section>

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
