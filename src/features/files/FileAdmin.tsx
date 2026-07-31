"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Library, Plus, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  addLibraryDocument,
  deleteFolderLink,
  deleteLibraryDocument,
  saveFolderLink,
} from "@/server/actions/files";

export interface FolderLinkRow {
  id: string;
  scopeType: "team" | "department";
  scopeId: string;
  scopeName: string;
  driveFolderId: string;
  label: string | null;
}

export interface LibraryAdminRow {
  id: string;
  displayName: string;
  category: string | null;
  driveFileId: string;
}

/** 파일함 관리 (스펙 3.4) — 시스템 관리자 전용 */
export function FileAdmin({
  folderLinks,
  libraryDocs,
  teams,
  departments,
}: {
  folderLinks: FolderLinkRow[];
  libraryDocs: LibraryAdminRow[];
  teams: { id: string; name: string }[];
  departments: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [folderOpen, setFolderOpen] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  // 폴더 등록 폼
  const [scopeType, setScopeType] = useState<"team" | "department">("team");
  const [scopeId, setScopeId] = useState("");
  const [link, setLink] = useState("");
  const [label, setLabel] = useState("");
  // 라이브러리 폼
  const [docLink, setDocLink] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");

  const scopeOptions = scopeType === "team" ? teams : departments;

  const submitFolder = () => {
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await saveFolderLink({ scopeType, scopeId, link, label });
      if (result.ok) {
        setFolderOpen(false);
        setLink("");
        setLabel("");
        setScopeId("");
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message ?? null);
    });
  };

  const submitDoc = () => {
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await addLibraryDocument({
        link: docLink,
        displayName,
        category,
        description,
      });
      if (result.ok) {
        setLibOpen(false);
        setDocLink("");
        setDisplayName("");
        setCategory("");
        setDescription("");
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message ?? null);
    });
  };

  const removeFolder = (row: FolderLinkRow) => {
    if (!window.confirm(`${row.scopeName} 공유폴더 연결을 해제하시겠습니까?`)) return;
    startTransition(async () => {
      const result = await deleteFolderLink(row.id);
      if (!result.ok) {
        window.alert(result.message ?? "삭제하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  const removeDoc = (row: LibraryAdminRow) => {
    if (
      !window.confirm(
        `"${row.displayName}"을 라이브러리에서 제외하시겠습니까? Drive의 실제 파일은 삭제되지 않습니다.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteLibraryDocument(row.id);
      if (!result.ok) {
        window.alert(result.message ?? "삭제하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Users className="size-4 text-primary" aria-hidden />팀 공유폴더
            </span>
          }
          description="Drive 폴더 주소를 붙여넣으면 폴더 ID를 자동으로 추출합니다."
          action={
            <Button
              size="small"
              onClick={() => {
                setErrors({});
                setMessage(null);
                setFolderOpen(true);
              }}
            >
              <Plus className="size-3.5" />
              폴더 등록
            </Button>
          }
        />
        <CardBody className="p-0">
          {folderLinks.length === 0 ? (
            <EmptyState icon={Users} title="등록된 공유폴더가 없습니다" compact />
          ) : (
            <div className="overflow-x-auto">
              <table className="ab-table min-w-[600px]">
                <thead>
                  <tr>
                    <th>대상</th>
                    <th>구분</th>
                    <th>폴더 ID</th>
                    <th className="w-20">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {folderLinks.map((row) => (
                    <tr key={row.id}>
                      <td className="font-bold text-ink">
                        {row.label ?? row.scopeName}
                      </td>
                      <td>
                        <Badge tone="neutral">
                          {row.scopeType === "team" ? "팀" : "부서"}
                        </Badge>
                      </td>
                      <td className="max-w-56 truncate text-caption">
                        {row.driveFolderId}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => removeFolder(row)}
                          disabled={pending}
                          aria-label="연결 해제"
                          className="rounded-sm p-1.5 text-muted transition-colors hover:bg-danger-light hover:text-danger disabled:opacity-50"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Library className="size-4 text-primary" aria-hidden />
              사내 규정 라이브러리
            </span>
          }
          description="삭제하면 목록에서만 빠지고 Drive의 실제 파일은 그대로 남습니다."
          action={
            <Button
              size="small"
              onClick={() => {
                setErrors({});
                setMessage(null);
                setLibOpen(true);
              }}
            >
              <Plus className="size-3.5" />
              문서 등록
            </Button>
          }
        />
        <CardBody className="p-0">
          {libraryDocs.length === 0 ? (
            <EmptyState icon={Library} title="등록된 문서가 없습니다" compact />
          ) : (
            <div className="overflow-x-auto">
              <table className="ab-table min-w-[600px]">
                <thead>
                  <tr>
                    <th>표시이름</th>
                    <th>카테고리</th>
                    <th>파일 ID</th>
                    <th className="w-20">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {libraryDocs.map((row) => (
                    <tr key={row.id}>
                      <td className="font-bold text-ink">{row.displayName}</td>
                      <td>{row.category ?? "기타"}</td>
                      <td className="max-w-56 truncate text-caption">
                        {row.driveFileId}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => removeDoc(row)}
                          disabled={pending}
                          aria-label="목록에서 제외"
                          className="rounded-sm p-1.5 text-muted transition-colors hover:bg-danger-light hover:text-danger disabled:opacity-50"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={folderOpen}
        onClose={() => setFolderOpen(false)}
        title="팀 공유폴더 등록"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setFolderOpen(false)}
              disabled={pending}
            >
              취소
            </Button>
            <Button onClick={submitFolder} disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="구분" required htmlFor="fa-scope-type">
            <Select
              id="fa-scope-type"
              value={scopeType}
              onChange={(e) => {
                setScopeType(e.target.value as "team" | "department");
                setScopeId("");
              }}
              disabled={pending}
              className="md:max-w-40"
            >
              <option value="team">팀</option>
              <option value="department">부서</option>
            </Select>
          </Field>

          <Field
            label={scopeType === "team" ? "팀" : "부서"}
            required
            htmlFor="fa-scope"
            error={errors.scopeId}
          >
            <Select
              id="fa-scope"
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              disabled={pending}
              invalid={!!errors.scopeId}
            >
              <option value="">선택하세요</option>
              {scopeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Drive 폴더 링크"
            required
            htmlFor="fa-link"
            error={errors.link}
            hint="예) https://drive.google.com/drive/folders/1AbC..."
          >
            <Input
              id="fa-link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              disabled={pending}
              invalid={!!errors.link}
            />
          </Field>

          <Field label="표시 이름" htmlFor="fa-label" hint="비우면 팀·부서명을 씁니다.">
            <Input
              id="fa-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={pending}
            />
          </Field>

          {message ? <p className="text-label text-danger">{message}</p> : null}
        </div>
      </Modal>

      <Modal
        open={libOpen}
        onClose={() => setLibOpen(false)}
        title="라이브러리 문서 등록"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setLibOpen(false)}
              disabled={pending}
            >
              취소
            </Button>
            <Button onClick={submitDoc} disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field
            label="Drive 파일 링크"
            required
            htmlFor="fa-doc-link"
            error={errors.link}
            hint="예) https://drive.google.com/file/d/1AbC.../view"
          >
            <Input
              id="fa-doc-link"
              value={docLink}
              onChange={(e) => setDocLink(e.target.value)}
              disabled={pending}
              invalid={!!errors.link}
            />
          </Field>

          <Field
            label="표시이름"
            required
            htmlFor="fa-doc-name"
            error={errors.displayName}
            hint="실제 파일명이 아니라 이 이름으로 노출됩니다."
          >
            <Input
              id="fa-doc-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={pending}
              invalid={!!errors.displayName}
              placeholder="예) 표준 근로계약서"
            />
          </Field>

          <Field label="카테고리" htmlFor="fa-doc-category">
            <Input
              id="fa-doc-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={pending}
              placeholder="계약서 / 사규 / 복지제도"
            />
          </Field>

          <Field label="설명" htmlFor="fa-doc-desc">
            <Textarea
              id="fa-doc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={pending}
            />
          </Field>

          {message ? <p className="text-label text-danger">{message}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
