"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  File as FileIcon,
  Folder,
  RefreshCw,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { uploadToFolder } from "@/server/actions/files";
import { formatDateTime } from "@/lib/utils";

export interface FileRow {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  size: number | null;
  modifiedTime: string | null;
}

/**
 * Drive 폴더 파일 목록 + 업로드 (스펙 3.1 / 3.2)
 * 이름변경·이동·삭제는 Drive에서 처리한다(스펙 7장) — 여기서는 목록·업로드만.
 */
export function FileList({
  files,
  folderId,
  canUpload,
  emptyDescription,
}: {
  files: FileRow[];
  folderId: string;
  canUpload: boolean;
  emptyDescription?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const upload = (selected: FileList) => {
    setMessage(null);
    const formData = new FormData();
    formData.set("folderId", folderId);
    Array.from(selected).forEach((file) => formData.append("files", file));

    startTransition(async () => {
      const result = await uploadToFolder(formData);
      if (result.ok) {
        setMessage(`${selected.length}개 파일을 업로드했습니다.`);
        router.refresh();
        return;
      }
      setMessage(result.message ?? "업로드에 실패했습니다.");
    });
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-caption">{files.length}개 항목</span>
        <div className="ml-auto flex gap-2">
          <Button
            variant="ghost"
            size="small"
            onClick={() => router.refresh()}
            disabled={pending}
          >
            <RefreshCw className="size-3.5" />
            새로고침
          </Button>
          {canUpload ? (
            <Button
              size="small"
              onClick={() => inputRef.current?.click()}
              disabled={pending}
            >
              <Upload className="size-3.5" />
              {pending ? "업로드 중…" : "업로드"}
            </Button>
          ) : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {message ? (
        <p className="mb-3 text-label text-ink">{message}</p>
      ) : null}

      <Card className="overflow-hidden">
        <CardBody className="p-0">
          {files.length === 0 ? (
            <EmptyState
              icon={FileIcon}
              title="파일이 없습니다"
              description={
                emptyDescription ??
                (canUpload
                  ? "업로드 버튼으로 파일을 추가할 수 있습니다."
                  : undefined)
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {files.map((file) => {
                const folder =
                  file.mimeType === "application/vnd.google-apps.folder";
                return (
                  <li key={file.id}>
                    <a
                      href={file.webViewLink ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-canvas"
                    >
                      {folder ? (
                        <Folder
                          className="size-4 shrink-0 text-primary"
                          aria-hidden
                        />
                      ) : (
                        <FileIcon
                          className="size-4 shrink-0 text-muted"
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate text-body text-ink">
                        {file.name}
                      </span>
                      <span className="w-20 shrink-0 text-right text-caption">
                        {folder ? "폴더" : formatSize(file.size)}
                      </span>
                      <span className="w-36 shrink-0 text-right text-caption">
                        {file.modifiedTime
                          ? formatDateTime(file.modifiedTime)
                          : "-"}
                      </span>
                      <ExternalLink
                        className="size-3.5 shrink-0 text-muted"
                        aria-hidden
                      />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
