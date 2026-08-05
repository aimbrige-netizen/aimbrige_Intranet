"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
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
  BOARD_TYPE_LABELS,
  POST_CATEGORIES,
  type Board,
  type Post,
  type PostAttachment,
} from "./types";

/** 글 작성·수정 (스펙 3.2) */
export function PostEditor({
  board,
  basePath,
  post,
  attachments = [],
  authUserId,
}: {
  board: Board;
  /** 저장 후 돌아갈 뿌리 경로 (/board/:id 또는 /community/:id) */
  basePath: string;
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

      router.push(`${basePath}/${postId}`);
    });
  };

  return (
    <div className="space-y-5">
      {/*
        폼 카드 정리(10-modules2 스윕): 종전 Card 안에 .ab-form-grid를 넣고
        !border-0로 안쪽 테두리를 죽이는 이중 구조였다 — 그리드를 직접 놓는다.
        ab-form-grid 자체의 테두리는 카드 장식이 아니라 라벨/필드 칸을 닫는
        표 구조선이라 흰 시트 위에서도 유지한다(결재 폼과 같은 문법).

        행 구성은 16-board-write-contact.md 실측 순서 그대로 —
        To.(게시판) → 제목 → 파일 첨부 → 본문 → 등록 옵션 → 하단 등록·취소.
        실측의 공개 설정(공개/비공개)·알림(메일·푸시)·임시저장은 우리 데이터에
        그 개념이 없어 행 자체를 세우지 않는다(빈 껍데기 금지). "공지로 등록"
        체크는 기존 is_pinned 플래그에 매핑한다 — 비밀글 플래그는 없다.

        폼 라벨 14/400 잉크(16 실측 — 폼 라벨이 굵지 않다). ab-form-label의
        13/500(text-label font-bold)과 다른 이 화면 한정 값이라, 전역 클래스는
        건드리지 않고 arbitrary variant로 이 그리드 안에서만 덮는다.
      */}
      <div className="ab-form-grid [&_.ab-form-label]:text-body [&_.ab-form-label]:font-normal [&_.ab-form-label]:text-ink">
        {/*
          실측 1행 "To." — 게시판 선택. 우리는 패널에서 게시판을 고르고
          들어오므로 선택 트리 대신 이미 정해진 대상 게시판을 보여준다.
        */}
        <FormRow label="To.">
          <span className="text-body text-ink">
            {board.name}
            <span className="ml-2 text-caption">
              {BOARD_TYPE_LABELS[board.board_type]}
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

        {/* 실측 3행 — 파일 첨부가 본문보다 위다. UI만 드롭존 문법으로 갔다 */}
        <FormRow label="파일 첨부">
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

        <FormRow label="본문" required htmlFor="p-content" error={errors.content}>
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

        {/* 등록 옵션(실측 5~7행 자리) — 공지 타입만 (스펙 3.2) */}
        {isNotice ? (
          <>
            {/*
              카테고리는 실측 행엔 없는 우리 데이터 개념이다 — 걷어내면 공지
              분류 입력 길이 사라지므로 등록 옵션 자리에 세운다.
              목록의 필터 칩과 같은 조작 — 5개뿐이라 접을 이유가 없다.
            */}
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

            {/* 실측 "공지로 등록" 체크 = 우리 is_pinned(목록 상단 고정) */}
            <FormRow label="공지로 등록">
              <label className="flex cursor-pointer items-center gap-2 text-body text-ink">
                <input
                  type="checkbox"
                  checked={isPinned}
                  onChange={(e) => setIsPinned(e.target.checked)}
                  disabled={busy}
                  className="size-4 accent-primary"
                />
                목록 상단에 고정
              </label>
            </FormRow>
          </>
        ) : null}
      </div>

      {/*
        하단 실측(16 스펙 8번)은 등록(주 버튼)·임시저장·"임시 저장된 글(n)"
        뿐이다. 임시저장은 우리에게 없는 개념이라 세우지 않고, 취소는 실측에
        없는 우리 UX 관례 버튼 — 배치는 사내 폼 문법(ApprovalForm·WikiEditor의
        "주 버튼 = 맨 오른쪽")을 따라 취소 → 등록 순으로 둔다.
      */}
      <div className="flex items-center justify-end gap-3">
        {message ? (
          <p className="mr-auto text-label text-danger">{message}</p>
        ) : null}
        {createdPostId ? (
          <Button onClick={() => router.push(`${basePath}/${createdPostId}`)}>
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
