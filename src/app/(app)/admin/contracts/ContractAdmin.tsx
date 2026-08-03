"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSignature, Paperclip, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { SectionHeader } from "@/components/ui/Card";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import { Field, Input, Select } from "@/components/ui/Field";
import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TONES,
  ContractOpenButton,
  type ContractStatusModel,
} from "@/features/ess/ContractList";
import { createClient } from "@/lib/supabase/client";
import { createContract } from "@/server/actions/ess";

/**
 * 계약 관리 화면 본문 (13-ess.md /admin/contracts) — 등록 폼 + 전사 목록.
 *
 * 파일은 브라우저에서 employment-contracts 비공개 버킷으로 직접 올린다
 * (게시판 첨부와 같은 경로). 업로드 자체가 권한 판정이다 — 스토리지 insert
 * 정책이 system_admin + 경로 첫 세그먼트(<employee_id>)의 실재 직원 여부를
 * 검사한다(마이그레이션 30). 행 등록(createContract)이 실패하면 방금 올린
 * 파일을 바로 치운다 — 어느 화면에서도 참조되지 않는 유령 파일을 남기지
 * 않는다.
 */

/* 버킷 allowed_mime_types(마이그레이션 30)와 같은 목록 — 어긋나면 업로드가 날것 에러로 죽는다 */
const CONTRACT_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/x-hwp",
  "application/haansofthwp",
  "application/vnd.hancom.hwp",
];
const CONTRACT_MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.docx,.hwp";

export interface ContractEmployeeModel {
  employeeId: string;
  name: string;
  position: string | null;
  departmentName: string | null;
}

export interface AdminContractRowModel {
  id: string;
  employeeName: string;
  title: string;
  status: ContractStatusModel;
  /** YYYY-MM-DD */
  signedAt: string | null;
  hasFile: boolean;
  /** YYYY-MM-DD */
  createdAt: string;
}

/** 통과하면 null, 아니면 사용자에게 보일 문장 */
function checkContractFile(file: File): string | null {
  // hwp는 브라우저가 MIME을 모르는 경우가 많다 — 확장자로 한 번 더 받아준다
  const typeOk =
    CONTRACT_MIME_TYPES.includes(file.type) || /\.hwp$/i.test(file.name);
  if (!typeOk) {
    return `${file.name}: PDF·이미지(PNG/JPG/WebP)·DOCX·HWP만 올릴 수 있습니다.`;
  }
  if (file.size > CONTRACT_MAX_BYTES) {
    return `${file.name}: 10MB 이하만 올릴 수 있습니다.`;
  }
  return null;
}

function employeeLabel(employee: ContractEmployeeModel): string {
  const belong = [employee.departmentName, employee.position]
    .filter(Boolean)
    .join(" · ");
  return belong ? `${employee.name} (${belong})` : employee.name;
}

/* ── 등록 폼 ─────────────────────────────────────────────────────── */

function ContractForm({ employees }: { employees: ContractEmployeeModel[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [employeeId, setEmployeeId] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<ContractStatusModel>("draft");
  const [signedAt, setSignedAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pickFile = (picked: File | null) => {
    if (!picked) return;
    const invalid = checkContractFile(picked);
    if (invalid) {
      setErrors((prev) => ({ ...prev, file: invalid }));
      return;
    }
    setErrors((prev) => ({ ...prev, file: "" }));
    setFile(picked);
  };

  const submit = () =>
    startTransition(async () => {
      setSuccess(null);

      const local: Record<string, string> = {};
      if (!employeeId) local.employeeId = "대상 직원을 선택하세요.";
      if (!title.trim()) local.title = "계약서명을 입력하세요.";
      if (status === "signed" && !signedAt) {
        local.signedAt = "서명완료 계약은 체결일이 필요합니다.";
      }
      if (Object.keys(local).length > 0) {
        setErrors(local);
        setMessage(null);
        return;
      }

      /* 1) 파일 먼저 — 경로 첫 세그먼트가 대상 직원 id여야 열람 권한이 선다 */
      let filePath: string | null = null;
      if (file) {
        const safeName = file.name.replace(/[^\w.\-가-힣 ]/g, "_");
        filePath = `${employeeId}/${Date.now()}-${safeName}`;
        const contentType = CONTRACT_MIME_TYPES.includes(file.type)
          ? file.type
          : "application/x-hwp";

        const supabase = createClient();
        const { error } = await supabase.storage
          .from("employment-contracts")
          .upload(filePath, file, { contentType, upsert: false });

        if (error) {
          setErrors({});
          setMessage(`파일 업로드에 실패했습니다 — ${error.message}`);
          return;
        }
      }

      /* 2) 행 등록 — 실패하면 방금 올린 파일을 바로 치운다 */
      const result = await createContract({
        employeeId,
        title: title.trim(),
        status,
        signedAt: signedAt || null,
        filePath,
      });

      if (!result.ok) {
        if (filePath) {
          await createClient()
            .storage.from("employment-contracts")
            .remove([filePath]);
        }
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message ?? null);
        return;
      }

      setEmployeeId("");
      setTitle("");
      setStatus("draft");
      setSignedAt("");
      setFile(null);
      setErrors({});
      setMessage(null);
      setSuccess("계약을 등록했습니다. 대상 직원의 계약 모듈에 바로 보입니다.");
      router.refresh();
    });

  return (
    <section>
      <SectionHeader
        title="계약 등록"
        description="파일은 대상 직원과 시스템 관리자만 열람할 수 있는 비공개 저장소에 올라갑니다."
      />
      <div className="ab-card space-y-3 p-4">
        {message ? (
          <Callout tone="warn" title="등록하지 못했습니다">
            {message}
          </Callout>
        ) : null}
        {success ? (
          <p className="text-label text-success-ink">{success}</p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="대상 직원"
            required
            htmlFor="ct-employee"
            error={errors.employeeId}
          >
            <Select
              id="ct-employee"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              invalid={Boolean(errors.employeeId)}
            >
              <option value="">직원을 선택하세요</option>
              {employees.map((employee) => (
                <option key={employee.employeeId} value={employee.employeeId}>
                  {employeeLabel(employee)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="계약서명" required htmlFor="ct-title" error={errors.title}>
            <Input
              id="ct-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예) 2026년 근로계약서"
              invalid={Boolean(errors.title)}
            />
          </Field>

          <Field label="상태" required htmlFor="ct-status" error={errors.status}>
            <Select
              id="ct-status"
              value={status}
              onChange={(e) => {
                const next = e.target.value;
                setStatus(
                  next === "signed" || next === "expired" ? next : "draft",
                );
              }}
            >
              <option value="draft">작성중</option>
              <option value="signed">서명완료</option>
              <option value="expired">만료</option>
            </Select>
          </Field>

          <Field
            label="체결일"
            required={status === "signed"}
            htmlFor="ct-signed-at"
            error={errors.signedAt}
          >
            <Input
              id="ct-signed-at"
              type="date"
              value={signedAt}
              onChange={(e) => setSignedAt(e.target.value)}
              invalid={Boolean(errors.signedAt)}
            />
          </Field>
        </div>

        <div>
          <p className="mb-1 text-label font-bold text-ink">계약 파일</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Button
              size="small"
              variant="secondary"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-3.5" aria-hidden />
              파일 선택
            </Button>
            {file ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Paperclip className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="max-w-[280px] truncate text-body-sm text-ink">
                  {file.name}
                </span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  disabled={pending}
                  aria-label="선택한 파일 빼기"
                  className="rounded-sm p-1 text-muted transition-colors hover:bg-danger-light hover:text-danger"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ) : (
              <span className="text-caption">
                PDF·이미지·DOCX·HWP, 10MB 이하 (선택)
              </span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                pickFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </div>
          {errors.file ? (
            <p className="mt-1 text-label text-danger">{errors.file}</p>
          ) : null}
        </div>

        <div className="flex justify-end">
          <Button disabled={pending} onClick={submit}>
            계약 등록
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ── 전사 계약 목록 ──────────────────────────────────────────────── */

function ContractTable({ rows }: { rows: AdminContractRowModel[] }) {
  return (
    <section>
      <SectionHeader title="전사 계약 목록" description={`${rows.length}건`} />
      <div className="ab-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="ab-table min-w-[760px]">
            <thead>
              <tr>
                <th>등록일</th>
                <th>직원</th>
                <th>계약서명</th>
                <th>상태</th>
                <th>체결일</th>
                <th className="text-right">파일</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <TableEmptyRow
                  colSpan={6}
                  icon={FileSignature}
                  title="등록된 계약이 없습니다"
                  description="위 폼에서 직원·계약서명·파일을 등록하면 여기에 쌓입니다."
                />
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap text-label tabular-nums text-muted">
                      {row.createdAt}
                    </td>
                    <td className="whitespace-nowrap text-body-sm text-ink">
                      {row.employeeName}
                    </td>
                    <td className="max-w-[280px] truncate text-body-sm text-ink">
                      {row.title}
                    </td>
                    <td>
                      <Badge tone={CONTRACT_STATUS_TONES[row.status]}>
                        {CONTRACT_STATUS_LABELS[row.status]}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap text-label tabular-nums text-muted">
                      {row.signedAt ?? "-"}
                    </td>
                    <td className="text-right">
                      {row.hasFile ? (
                        <ContractOpenButton contractId={row.id} />
                      ) : (
                        <span className="text-label text-muted">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function ContractAdmin({
  employees,
  rows,
}: {
  employees: ContractEmployeeModel[];
  rows: AdminContractRowModel[];
}) {
  return (
    <div className="space-y-5">
      <ContractForm employees={employees} />
      <ContractTable rows={rows} />
    </div>
  );
}
