"use client";

import { useRef, useState } from "react";
import { Paperclip, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { registerPostAttachment } from "@/server/actions/boards";
import { formatFileSize } from "./format";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MIME_TYPES,
  type PostAttachment,
} from "./types";

const ACCEPT = ATTACHMENT_MIME_TYPES.join(",");

/** 허용 형식·크기 확인. 통과하면 null, 아니면 사용자에게 보일 문장 */
export function checkAttachment(file: File): string | null {
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    return `${file.name}: 이미지(PNG/JPG/WebP/GIF) 또는 PDF만 첨부할 수 있습니다.`;
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return `${file.name}: 10MB 이하만 첨부할 수 있습니다.`;
  }
  return null;
}

/**
 * 스토리지에 올리고 글에 등록한다.
 *
 * 경로는 `<auth uid>/<글 id>/<시각>-<파일명>` 규칙을 지킨다 — 스토리지 정책이
 * 경로 첫 세그먼트를 auth.uid()와 대조하므로 이 형식 자체가 권한 판정이다
 * (마이그레이션 09). 결재 첨부와 같은 규칙이다.
 */
export async function uploadPostAttachment(input: {
  postId: string;
  boardId: string;
  authUserId: string;
  file: File;
}): Promise<{ ok: boolean; attachment?: PostAttachment; message?: string }> {
  const { postId, boardId, authUserId, file } = input;

  const invalid = checkAttachment(file);
  if (invalid) return { ok: false, message: invalid };

  // 같은 이름을 다시 올려도 덮어쓰지 않도록 시각을 접두사로 붙인다
  const safeName = file.name.replace(/[^\w.\-가-힣 ]/g, "_");
  const path = `${authUserId}/${postId}/${Date.now()}-${safeName}`;

  const supabase = createClient();
  const { error } = await supabase.storage
    .from("post-attachments")
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    return { ok: false, message: `${file.name}: 업로드 실패 — ${error.message}` };
  }

  const result = await registerPostAttachment(
    postId,
    boardId,
    path,
    file.name,
    file.size,
  );
  if (!result.ok) {
    // 메타 등록에 실패한 파일은 아무 데서도 참조되지 않는다 — 바로 치운다
    await supabase.storage.from("post-attachments").remove([path]);
    return { ok: false, message: result.message ?? "첨부 등록에 실패했습니다." };
  }

  return { ok: true, attachment: result.attachment };
}

/**
 * 글 작성·수정 화면의 첨부 영역.
 *
 * 수정 중인 글은 id가 있어 고른 즉시 올라가고, 새 글은 id가 없어서
 * 목록에 담아 두었다가 등록 직후에 올린다(결재 첨부가 문서 생성 뒤에만
 * 붙는 것과 같은 제약을, 작성자가 순서를 신경 쓰지 않도록 감춘 것이다).
 */
export function PostAttachmentField({
  saved,
  queued,
  busy,
  immediate,
  progress,
  error,
  onPick,
  onRemoveSaved,
  onRemoveQueued,
}: {
  saved: PostAttachment[];
  queued: File[];
  busy: boolean;
  /** 수정 중인 글 — 고른 즉시 저장된다 */
  immediate: boolean;
  progress: string | null;
  error: string | null;
  onPick: (files: File[]) => void;
  onRemoveSaved: (attachment: PostAttachment) => void;
  onRemoveQueued: (index: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const count = saved.length + queued.length;
  /** 용량 표시(16 실측 "0MB") — 지금 담긴 파일 크기의 합 */
  const totalBytes =
    saved.reduce((sum, file) => sum + (file.file_size ?? 0), 0) +
    queued.reduce((sum, file) => sum + file.size, 0);

  return (
    <div>
      {count > 0 ? (
        <ul className="mb-2 divide-y divide-line border-y border-line">
          {saved.map((file) => (
            <li key={file.id} className="flex items-center gap-2 py-2">
              <Paperclip className="size-4 shrink-0 text-muted" aria-hidden />
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
                onClick={() => onRemoveSaved(file)}
                disabled={busy}
                aria-label={`${file.file_name ?? "첨부"} 삭제`}
                className="shrink-0 rounded-sm p-1.5 text-muted transition-colors hover:bg-danger-light hover:text-danger disabled:opacity-50"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}

          {queued.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center gap-2 py-2"
            >
              <Paperclip className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-body text-ink">
                {file.name}
              </span>
              <span className="shrink-0 rounded-pill bg-info-light px-2 py-0.5 text-caption text-info-ink">
                등록 시 함께 올라감
              </span>
              {formatFileSize(file.size) ? (
                <span className="shrink-0 tabular-nums text-caption">
                  {formatFileSize(file.size)}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onRemoveQueued(index)}
                disabled={busy}
                aria-label={`${file.name} 목록에서 빼기`}
                className="shrink-0 rounded-sm p-1.5 text-muted transition-colors hover:bg-danger-light hover:text-danger disabled:opacity-50"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        드롭존 문법(16 실측): "이 곳에 파일을 드래그 하세요. 또는 파일선택"
        + 용량 표시. 업로드 로직(onPick 이후)은 그대로고 고르는 UI만 바꿨다 —
        드래그가 안 되는 환경(터치)을 위해 파일선택 버튼이 같은 onPick을 연다.
      */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (busy) return;
          const files = Array.from(e.dataTransfer.files);
          if (files.length) onPick(files);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded-card border border-dashed px-4 py-6 text-center transition-colors duration-fast ease-standard",
          dragOver
            ? "border-primary bg-primary-light"
            : "border-line-strong bg-subtle",
        )}
      >
        <p className="text-body text-muted">
          이 곳에 파일을 드래그 하세요. 또는{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="font-medium text-primary-ink underline underline-offset-2 transition-colors duration-fast ease-standard hover:text-primary-ink disabled:opacity-50"
          >
            파일선택
          </button>
        </p>
        <p className="text-caption tabular-nums">
          첨부 {count}건 · {formatFileSize(totalBytes) ?? "0 MB"} · 이미지·PDF
          건당 10MB 이하{immediate ? " · 고르면 바로 저장됩니다" : ""}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onPick(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
      </div>

      {progress ? (
        <p className="mt-1.5 text-label text-info-ink">{progress}</p>
      ) : null}
      {error ? <p className="mt-1.5 text-label text-danger">{error}</p> : null}
    </div>
  );
}
