"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Paperclip, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { createClient } from "@/lib/supabase/client";
import {
  getAttachmentUrl,
  registerAttachment,
  removeAttachment,
} from "@/server/actions/approvals";
import type { ApprovalAttachment } from "./types";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
];

/**
 * 결재 문서 첨부파일 (스펙 04 · 3.3 / 3.4)
 *
 * 업로드 경로는 `<auth uid>/<문서id>/<파일명>` 규칙을 지킨다 —
 * 스토리지 조회 권한이 이 경로로 판정되므로(마이그레이션 11) 형식이 곧 보안이다.
 * 비공개 버킷이라 다운로드는 서명 URL을 그때그때 발급받아 연다.
 */
export function AttachmentPanel({
  documentId,
  authUserId,
  attachments,
  canUpload,
}: {
  documentId: string;
  authUserId: string | null;
  attachments: ApprovalAttachment[];
  canUpload: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const upload = async (files: FileList) => {
    setMessage(null);
    if (!authUserId) {
      setMessage("세션 정보가 없습니다. 다시 로그인해 주세요.");
      return;
    }

    const supabase = createClient();
    for (const file of Array.from(files)) {
      if (!ALLOWED.includes(file.type)) {
        setMessage(`${file.name}: 이미지(PNG/JPG/WebP) 또는 PDF만 첨부할 수 있습니다.`);
        return;
      }
      if (file.size > MAX_BYTES) {
        setMessage(`${file.name}: 10MB 이하만 첨부할 수 있습니다.`);
        return;
      }

      // 같은 이름을 다시 올려도 덮어쓰지 않도록 접두사를 붙인다
      const safeName = file.name.replace(/[^\w.\-가-힣 ]/g, "_");
      const path = `${authUserId}/${documentId}/${Date.now()}-${safeName}`;

      const { error } = await supabase.storage
        .from("approval-attachments")
        .upload(path, file, { contentType: file.type, upsert: false });

      if (error) {
        setMessage(`${file.name}: 업로드 실패 — ${error.message}`);
        return;
      }

      const result = await registerAttachment(
        documentId,
        path,
        file.name,
        file.size,
      );
      if (!result.ok) {
        setMessage(result.message ?? "첨부 등록에 실패했습니다.");
        return;
      }
    }

    router.refresh();
  };

  const download = (path: string) => {
    startTransition(async () => {
      const result = await getAttachmentUrl(path);
      if (!result.ok || !result.url) {
        setMessage(result.message ?? "다운로드 링크를 만들지 못했습니다.");
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  };

  const remove = (id: string, name: string) => {
    if (!window.confirm(`"${name}" 첨부를 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      const result = await removeAttachment(id, documentId);
      if (!result.ok) {
        setMessage(result.message ?? "삭제하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div>
      {attachments.length === 0 ? (
        <p className="text-caption">첨부된 파일이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-line">
          {attachments.map((file) => (
            <li key={file.id} className="flex items-center gap-2 py-2.5">
              <Paperclip className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-body text-ink">
                {file.file_name ?? "첨부파일"}
              </span>
              {file.file_size ? (
                <span className="shrink-0 text-caption">
                  {Math.round(file.file_size / 1024)}KB
                </span>
              ) : null}
              <IconButton
                label={`${file.file_name ?? "첨부"} 다운로드`}
                onClick={() => download(file.file_url)}
                disabled={pending}
                className="shrink-0 hover:bg-canvas hover:text-primary-ink"
              >
                <Download className="size-4" />
              </IconButton>
              {canUpload ? (
                <IconButton
                  label="첨부 삭제"
                  danger
                  onClick={() => remove(file.id, file.file_name ?? "첨부")}
                  disabled={pending}
                  className="shrink-0"
                >
                  <Trash2 className="size-4" />
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canUpload ? (
        <div className="mt-3">
          <Button
            size="small"
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
          >
            <Upload className="size-3.5" />
            파일 첨부
          </Button>
          <span className="ml-2 text-caption">
            이미지·PDF, 건당 10MB 이하. 진행중 문서에만 추가할 수 있습니다.
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ALLOWED.join(",")}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      ) : null}

      {message ? (
        <p className="mt-2 text-label text-danger">{message}</p>
      ) : null}
    </div>
  );
}
