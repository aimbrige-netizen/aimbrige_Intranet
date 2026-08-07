"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { SectionHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Textarea } from "@/components/ui/Field";
import { createClient } from "@/lib/supabase/client";
import {
  getProjectFileUrl,
  registerProjectFile,
  removeProjectFile,
  saveProjectResult,
} from "@/server/actions/projects";
import { formatDate } from "@/lib/utils";
import { formatFileSize } from "./format";
import {
  PROJECT_FILE_BUCKET,
  PROJECT_FILE_MAX_BYTES,
  PROJECT_FILE_MIME_TYPES,
  type ProjectFile,
} from "./types";

const ACCEPT = PROJECT_FILE_MIME_TYPES.join(",");

/** 허용 형식·크기 확인. 통과하면 null, 아니면 사용자에게 보일 문장 */
function checkFile(file: File): string | null {
  if (!(PROJECT_FILE_MIME_TYPES as readonly string[]).includes(file.type)) {
    return `${file.name}: 이미지·PDF·오피스 문서·CSV·ZIP만 첨부할 수 있습니다.`;
  }
  if (file.size > PROJECT_FILE_MAX_BYTES) {
    return `${file.name}: 20MB 이하만 첨부할 수 있습니다.`;
  }
  return null;
}

/**
 * 결과·산출물 탭 (스펙 10 · 3.3)
 *
 * 업로드 경로는 `<auth uid>/<프로젝트 id>/<시각>-<파일명>` 규칙을 지킨다 —
 * 스토리지 정책이 경로 첫 세그먼트를 auth.uid()와 대조하므로(마이그레이션 19)
 * 이 형식 자체가 권한 판정이다. 결재·게시판 첨부와 같은 규칙이다.
 * 비공개 버킷이라 다운로드는 그때그때 서명 URL을 발급해서 연다.
 */
export function ProjectResultPanel({
  projectId,
  authUserId,
  resultSummary,
  files,
  canEdit,
  isCompleted,
}: {
  projectId: string;
  authUserId: string | null;
  resultSummary: string | null;
  files: ProjectFile[];
  canEdit: boolean;
  isCompleted: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [summary, setSummary] = useState(resultSummary ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = summary !== (resultSummary ?? "");

  const save = () => {
    setMessage(null);
    setNotice(null);
    startTransition(async () => {
      const result = await saveProjectResult(projectId, summary);
      if (!result.ok) {
        setFieldError(result.fieldErrors?.resultSummary ?? null);
        setMessage(
          result.fieldErrors?.resultSummary
            ? null
            : (result.message ?? "저장하지 못했습니다."),
        );
        return;
      }
      setFieldError(null);
      setNotice("결과 요약을 저장했습니다.");
      router.refresh();
    });
  };

  const upload = async (picked: FileList) => {
    setMessage(null);
    setNotice(null);

    if (!authUserId) {
      setMessage("세션 정보가 없습니다. 다시 로그인해 주세요.");
      return;
    }

    const supabase = createClient();
    for (const file of Array.from(picked)) {
      const invalid = checkFile(file);
      if (invalid) {
        setMessage(invalid);
        return;
      }

      // 같은 이름을 다시 올려도 덮어쓰지 않도록 시각을 접두사로 붙인다
      const safeName = file.name.replace(/[^\w.\-가-힣 ]/g, "_");
      const path = `${authUserId}/${projectId}/${Date.now()}-${safeName}`;

      const { error } = await supabase.storage
        .from(PROJECT_FILE_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });

      if (error) {
        setMessage(`${file.name}: 업로드 실패 — ${error.message}`);
        return;
      }

      const result = await registerProjectFile(
        projectId,
        path,
        file.name,
        file.size,
      );
      if (!result.ok) {
        // 메타 등록에 실패한 파일은 아무 데서도 참조되지 않는다 — 바로 치운다
        await supabase.storage.from(PROJECT_FILE_BUCKET).remove([path]);
        setMessage(result.message ?? "산출물 등록에 실패했습니다.");
        return;
      }
    }

    router.refresh();
  };

  const download = (path: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await getProjectFileUrl(path);
      if (!result.ok || !result.url) {
        setMessage(result.message ?? "다운로드 링크를 만들지 못했습니다.");
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  };

  const remove = (file: ProjectFile) => {
    const name = file.file_name ?? "산출물";
    if (!window.confirm(`"${name}" 파일을 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      const result = await removeProjectFile(file.id, projectId);
      if (!result.ok) {
        setMessage(result.message ?? "삭제하지 못했습니다.");
        return;
      }
      setMessage(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      {message ? (
        <Callout tone="danger" title="처리하지 못했습니다">
          {message}
        </Callout>
      ) : null}

      {/*
        08 흰 시트: md+에서 .ab-card는 흰 면 위 이중 테두리 — 섹션 제목 +
        직접 배치로 해체하고 md 미만만 카드 유지(10-modules2).
      */}
      <section>
        <SectionHeader
          title="결과 요약"
          description={
            isCompleted
              ? "완료 처리할 때 남긴 요약입니다. 언제든 보완할 수 있습니다."
              : "완료로 바꿀 때 입력을 요청합니다. 진행 중에도 미리 적어 둘 수 있습니다."
          }
        />
        <div className="ab-card px-4 py-3 md:rounded-none md:border-0 md:p-0">
          {canEdit ? (
            <>
              <Field
                label="무엇을 어디까지 해서 끝냈는가"
                htmlFor="project-result"
                error={fieldError}
              >
                <Textarea
                  id="project-result"
                  value={summary}
                  onChange={(e) => {
                    setSummary(e.target.value);
                    // 다시 고치기 시작하면 "저장했습니다"는 더 이상 참이 아니다
                    setNotice(null);
                  }}
                  placeholder="산출물, 남은 과제, 인수인계할 내용을 적어 둡니다."
                  maxLength={4000}
                  invalid={!!fieldError}
                  disabled={pending}
                  className="min-h-28"
                />
              </Field>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
                {notice ? (
                  <span className="text-label text-success-ink">{notice}</span>
                ) : (
                  <span className="text-caption tabular-nums">
                    {summary.length} / 4000자
                  </span>
                )}
                <Button onClick={save} disabled={pending || !dirty}>
                  결과 요약 저장
                </Button>
              </div>
            </>
          ) : summary ? (
            <p className="whitespace-pre-wrap text-body text-ink">{summary}</p>
          ) : (
            <EmptyState
              icon={FileText}
              title="아직 결과 요약이 없습니다"
              description="프로젝트를 완료로 바꾸면 담당자가 결과 요약을 남깁니다."
              compact
            />
          )}
        </div>
      </section>

      <section>
        <SectionHeader
          title="산출물 파일"
          description={`${files.length}건 · 건당 20MB 이하`}
          action={
            canEdit ? (
              <Button
                size="small"
                variant="secondary"
                onClick={() => inputRef.current?.click()}
                disabled={pending}
              >
                <Upload className="size-3.5" />
                파일 첨부
              </Button>
            ) : null
          }
        />
        <div className="ab-card px-4 py-3 md:rounded-none md:border-0 md:p-0">
          {files.length === 0 ? (
            <EmptyState
              icon={Paperclip}
              title="첨부된 산출물이 없습니다"
              description="결과 보고서·산출물 파일을 올려 두면 프로젝트가 끝난 뒤에도 여기서 찾을 수 있습니다."
              action={
                canEdit ? (
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => inputRef.current?.click()}
                    disabled={pending}
                  >
                    파일 첨부
                  </Button>
                ) : undefined
              }
              compact
            />
          ) : (
            <ul className="divide-y divide-line">
              {files.map((file) => (
                <li key={file.id} className="flex items-center gap-2 py-2.5">
                  <Paperclip
                    className="size-4 shrink-0 text-muted"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-body text-ink">
                    {file.file_name ?? "산출물"}
                  </span>
                  <span className="shrink-0 text-caption tabular-nums">
                    {formatDate(file.uploaded_at)}
                  </span>
                  {formatFileSize(file.file_size) ? (
                    <span className="shrink-0 text-caption tabular-nums">
                      {formatFileSize(file.file_size)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => download(file.file_url)}
                    disabled={pending}
                    aria-label={`${file.file_name ?? "산출물"} 다운로드`}
                    className="shrink-0 rounded-sm p-1.5 text-muted transition-colors duration-fast ease-standard hover:bg-subtle hover:text-primary-ink disabled:opacity-40"
                  >
                    <Download className="size-4" />
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => remove(file)}
                      disabled={pending}
                      aria-label={`${file.file_name ?? "산출물"} 삭제`}
                      className="shrink-0 rounded-sm p-1.5 text-muted transition-colors duration-fast ease-standard hover:bg-danger-light hover:text-danger disabled:opacity-40"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canEdit ? (
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void upload(e.target.files);
                e.target.value = "";
              }}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
