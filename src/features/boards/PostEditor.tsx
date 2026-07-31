"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { FormRow, Input, Textarea } from "@/components/ui/Field";
import { FilterChip } from "@/components/ui/TableToolbar";
import {
  createPost,
  removePostAttachment,
  updatePost,
} from "@/server/actions/boards";
import {
  PostAttachmentField,
  checkAttachment,
  uploadPostAttachment,
} from "./PostAttachmentField";
import {
  POST_CATEGORIES,
  type Board,
  type Post,
  type PostAttachment,
} from "./types";

/** 글 작성·수정 (스펙 3.2) */
export function PostEditor({
  board,
  post,
  attachments = [],
  authUserId,
}: {
  board: Board;
  post?: Post;
  /** 수정 중인 글에 이미 붙어 있는 첨부 */
  attachments?: PostAttachment[];
  /** 스토리지 경로의 첫 세그먼트로 쓴다(= 업로드 권한) */
  authUserId: string | null;
}) {
  const router = useRouter();
  const isNotice = board.board_type === "notice";

  const [title, setTitle] = useState(post?.title ?? "");
  const [content, setContent] = useState(post?.content ?? "");
  const [category, setCategory] = useState(post?.category ?? "");
  const [isPinned, setIsPinned] = useState(post?.is_pinned ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 첨부 — 수정 중인 글은 즉시 올라가고, 새 글은 등록 직후에 올라간다
  const [saved, setSaved] = useState<PostAttachment[]>(attachments);
  const [queued, setQueued] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /**
   * 글은 등록됐는데 첨부만 실패한 상태. 여기서 등록 버튼을 다시 누르면
   * 같은 글이 하나 더 생기므로, 버튼을 "게시글 열기"로 바꿔 막는다.
   */
  const [createdPostId, setCreatedPostId] = useState<string | null>(null);

  const busy = pending || uploading;

  /**
   * 고른 파일을 첨부로 만든다.
   * 새 글이면 아직 post_id가 없어 목록에만 담아 둔다(등록 시 함께 올라간다).
   */
  const pickFiles = (files: File[]) => {
    setFileError(null);

    const invalid = files.map(checkAttachment).find((m) => m !== null);
    if (invalid) {
      setFileError(invalid);
      return;
    }

    if (!authUserId) {
      setFileError("세션 정보가 없습니다. 다시 로그인해 주세요.");
      return;
    }

    if (!post) {
      setQueued((prev) => [...prev, ...files]);
      return;
    }

    setUploading(true);
    void (async () => {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        setProgress(`${files.length}개 중 ${i + 1}번째 올리는 중 — ${file.name}`);
        const result = await uploadPostAttachment({
          postId: post.id,
          boardId: board.id,
          authUserId,
          file,
        });
        if (!result.ok || !result.attachment) {
          setFileError(result.message ?? "첨부하지 못했습니다.");
          break;
        }
        const added = result.attachment;
        setSaved((prev) => [...prev, added]);
      }
      setProgress(null);
      setUploading(false);
      router.refresh();
    })();
  };

  const removeSaved = (file: PostAttachment) => {
    if (!post) return;
    if (!window.confirm(`"${file.file_name ?? "첨부"}"를 삭제하시겠습니까?`)) {
      return;
    }
    setFileError(null);
    startTransition(async () => {
      const result = await removePostAttachment(file.id, post.id, board.id);
      if (!result.ok) {
        setFileError(result.message ?? "삭제하지 못했습니다.");
        return;
      }
      setSaved((prev) => prev.filter((row) => row.id !== file.id));
      router.refresh();
    });
  };

  const removeQueued = (index: number) => {
    setQueued((prev) => prev.filter((_, i) => i !== index));
  };

  /** 새 글 등록 직후, 담아 둔 파일을 실제 경로에 올린다 */
  const flushQueued = async (postId: string): Promise<string[]> => {
    if (queued.length === 0) return [];
    if (!authUserId) return queued.map((f) => f.name);

    const failed: string[] = [];
    setUploading(true);
    for (let i = 0; i < queued.length; i += 1) {
      const file = queued[i];
      setProgress(`첨부 ${queued.length}건 중 ${i + 1}번째 올리는 중 — ${file.name}`);
      const result = await uploadPostAttachment({
        postId,
        boardId: board.id,
        authUserId,
        file,
      });
      if (!result.ok) failed.push(file.name);
    }
    setProgress(null);
    setUploading(false);
    setQueued([]);
    return failed;
  };

  const submit = () => {
    setErrors({});
    setMessage(null);
    const payload = {
      boardId: board.id,
      title,
      content,
      category: isNotice ? category : null,
      isPinned: isNotice ? isPinned : false,
    };

    startTransition(async () => {
      const result = post
        ? await updatePost(post.id, payload)
        : await createPost(payload);

      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message ?? null);
        return;
      }

      const postId = result.postId ?? post?.id;
      if (!postId) {
        setMessage("저장은 됐지만 글 위치를 찾지 못했습니다. 목록에서 확인해 주세요.");
        return;
      }

      const failed = post ? [] : await flushQueued(postId);
      if (failed.length > 0) {
        // 글은 이미 등록됐다 — 다시 누르면 중복이라 이동만 남긴다
        setCreatedPostId(postId);
        setMessage(
          `글은 등록됐지만 ${failed.join(", ")}은(는) 첨부하지 못했습니다. 글 수정에서 다시 첨부해 주세요.`,
        );
        return;
      }

      router.push(`/board/${board.id}/${postId}`);
    });
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="p-0">
          <div className="ab-form-grid !rounded-none !border-0">
            <FormRow label="게시판">
              <span className="text-body text-ink">
                {board.name}
                <span className="ml-2 text-caption">
                  {isNotice ? "공지" : "자유게시판"}
                </span>
              </span>
            </FormRow>

            <FormRow label="제목" required htmlFor="p-title" error={errors.title}>
              <Input
                id="p-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
                invalid={!!errors.title}
                maxLength={200}
              />
            </FormRow>

            {/* 카테고리·상단고정은 공지 타입만 (스펙 3.2) */}
            {isNotice ? (
              <>
                {/* 목록의 필터 칩과 같은 조작으로 맞춘다 — 5개뿐이라 접을 이유가 없다 */}
                <FormRow label="카테고리">
                  <div className="flex flex-wrap gap-2">
                    <FilterChip
                      active={!category}
                      onClick={() => setCategory("")}
                    >
                      선택 안 함
                    </FilterChip>
                    {POST_CATEGORIES.map((c) => (
                      <FilterChip
                        key={c}
                        active={category === c}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </FilterChip>
                    ))}
                  </div>
                </FormRow>

                <FormRow label="상단 고정">
                  <label className="flex cursor-pointer items-center gap-2 text-body text-ink">
                    <input
                      type="checkbox"
                      checked={isPinned}
                      onChange={(e) => setIsPinned(e.target.checked)}
                      disabled={busy}
                      className="size-4 accent-[#ff6f0f]"
                    />
                    목록 상단에 고정
                  </label>
                </FormRow>
              </>
            ) : null}

            <FormRow label="내용" required htmlFor="p-content" error={errors.content}>
              <Textarea
                id="p-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={busy}
                invalid={!!errors.content}
                className="min-h-64"
                placeholder="줄바꿈은 그대로 표시되고, http로 시작하는 주소는 링크가 됩니다."
              />
            </FormRow>

            <FormRow label="첨부파일">
              <PostAttachmentField
                saved={saved}
                queued={queued}
                busy={busy}
                immediate={!!post}
                progress={progress}
                error={fileError}
                onPick={pickFiles}
                onRemoveSaved={removeSaved}
                onRemoveQueued={removeQueued}
              />
            </FormRow>
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {message ? (
          <p className="mr-auto text-label text-danger">{message}</p>
        ) : null}
        {createdPostId ? (
          <Button onClick={() => router.push(`/board/${board.id}/${createdPostId}`)}>
            게시글 열기
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => router.back()}
              disabled={busy}
            >
              취소
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? "저장 중…" : post ? "수정" : "등록"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
