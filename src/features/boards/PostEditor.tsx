"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { FormRow, Input, Select, Textarea } from "@/components/ui/Field";
import { createPost, updatePost } from "@/server/actions/boards";
import { POST_CATEGORIES, type Board, type Post } from "./types";

/** 글 작성·수정 (스펙 3.2) */
export function PostEditor({
  board,
  post,
}: {
  board: Board;
  post?: Post;
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

      if (result.ok) {
        router.push(`/board/${board.id}/${result.postId ?? post?.id}`);
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message ?? null);
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
                disabled={pending}
                invalid={!!errors.title}
                maxLength={200}
              />
            </FormRow>

            {/* 카테고리·상단고정은 공지 타입만 (스펙 3.2) */}
            {isNotice ? (
              <>
                <FormRow label="카테고리" htmlFor="p-category">
                  <Select
                    id="p-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    disabled={pending}
                    className="md:max-w-52"
                  >
                    <option value="">선택 안 함</option>
                    {POST_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </FormRow>

                <FormRow label="상단 고정">
                  <label className="flex cursor-pointer items-center gap-2 text-body text-ink">
                    <input
                      type="checkbox"
                      checked={isPinned}
                      onChange={(e) => setIsPinned(e.target.checked)}
                      disabled={pending}
                      className="size-4 accent-[#1D4E8F]"
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
                disabled={pending}
                invalid={!!errors.content}
                className="min-h-64"
                placeholder="줄바꿈은 그대로 표시됩니다."
              />
            </FormRow>
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {message ? (
          <p className="mr-auto text-label text-danger">{message}</p>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => router.back()}
          disabled={pending}
        >
          취소
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending ? "저장 중…" : post ? "수정" : "등록"}
        </Button>
      </div>
    </div>
  );
}
