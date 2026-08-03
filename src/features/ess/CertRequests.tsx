"use client";

import { useState, useTransition } from "react";
import { Check, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { SectionHeader } from "@/components/ui/Card";
import {
  cancelCertificateRequest,
  issueCertificate,
  rejectCertificate,
  requestCertificate,
} from "@/server/actions/ess";

/**
 * 증명서 발급 신청 (13-ess.md #hr/cert-isu).
 *
 * 다우 원본은 조회 필터 + 결과 표 + 버튼 4개(조회·발급 요청·삭제·전자결재)다.
 * 우리 구현 결정은 그중 "신청 → 관리자 처리" 흐름만 동작으로 세우고,
 * PDF 양식은 스펙 08 대기라 발급되면 상태로만 말한다 — 안내 문구가 그 사정을
 * 화면에서 설명한다(개발 사정이 아니라 수령 방법 안내로 쓴다).
 */

export type CertKind = "employment" | "career";
export type CertStatus = "requested" | "issued" | "rejected";

export interface CertRequestRow {
  id: string;
  kind: CertKind;
  purpose: string;
  status: CertStatus;
  rejection_reason: string | null;
  created_at: string;
  processed_at: string | null;
}

export const CERT_KIND_LABELS: Record<CertKind, string> = {
  employment: "재직증명서",
  career: "경력증명서",
};

export const CERT_STATUS_LABELS: Record<CertStatus, string> = {
  requested: "신청",
  issued: "발급 완료",
  rejected: "반려",
};

/*
 * 신청은 오류가 아니라 진행 중이라 브랜드 톤, 반려만 danger.
 * (Badge 원칙 — 빨강은 실제 거절·위반에만.)
 */
const CERT_STATUS_TONES: Record<
  CertStatus,
  "primary" | "success" | "danger"
> = {
  requested: "primary",
  issued: "success",
  rejected: "danger",
};

function ymd(value: string | null): string {
  return value ? value.slice(0, 10) : "-";
}

/* ── 내 화면 (/hr?tab=certificates) ──────────────────────────────── */

function CertRequestForm() {
  const [kind, setKind] = useState<CertKind>("employment");
  const [purpose, setPurpose] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      // 액션(서버) 스키마의 필드명은 certType — 화면 상태명 kind를 매핑한다
      const result = await requestCertificate({ certType: kind, purpose });
      if (result.ok) {
        setPurpose("");
        setErrors({});
        setMessage(null);
      } else {
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message ?? null);
      }
    });

  return (
    <div className="space-y-3">
      {message ? (
        <Callout tone="warn" title="신청하지 못했습니다">
          {message}
        </Callout>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_auto] sm:items-end">
        <Field label="종류" required htmlFor="cert-kind">
          <Select
            id="cert-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as CertKind)}
          >
            <option value="employment">재직증명서</option>
            <option value="career">경력증명서</option>
          </Select>
        </Field>

        <Field
          label="용도"
          required
          htmlFor="cert-purpose"
          error={errors.purpose}
        >
          <Input
            id="cert-purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="예) 은행 대출 제출용"
            invalid={Boolean(errors.purpose)}
          />
        </Field>

        <Button disabled={pending || !purpose.trim()} onClick={submit}>
          발급 신청
        </Button>
      </div>

      <p className="text-caption">
        발급이 완료되면 아래 목록에 상태로 표시됩니다. PDF 파일 다운로드는
        준비 중이라, 실물 수령은 경영지원 담당자가 별도로 안내합니다.
      </p>
    </div>
  );
}

function CertCancelButton({ requestId }: { requestId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex items-center gap-2">
      {message ? (
        <span className="text-label text-warn-ink">{message}</span>
      ) : null}
      <Button
        size="small"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await cancelCertificateRequest(requestId);
            setMessage(
              result.ok ? null : (result.message ?? "취소하지 못했습니다."),
            );
          })
        }
      >
        취소
      </Button>
    </span>
  );
}

/** 신청 폼 + 내 신청 목록 표 — /hr?tab=certificates 본문 전체 */
export function CertRequests({ rows }: { rows: CertRequestRow[] }) {
  return (
    <div className="space-y-5">
      <section>
        <SectionHeader
          title="발급 신청"
          description="재직·경력증명서를 신청하면 관리자가 확인 후 발급합니다."
        />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <CertRequestForm />
        </div>
      </section>

      <section>
        <SectionHeader title="내 신청 목록" description={`${rows.length}건`} />
        {rows.length === 0 ? (
          <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
            <EmptyState
              icon={FileText}
              title="신청한 증명서가 없습니다"
              description="위 폼에서 종류와 용도를 적어 신청하면 여기에 쌓입니다."
              compact
            />
          </div>
        ) : (
          <div className="ab-card overflow-hidden md:rounded-none md:border-0">
            <div className="overflow-x-auto">
              <table className="ab-table min-w-[560px]">
                <thead>
                  <tr>
                    <th>신청일</th>
                    <th>종류</th>
                    <th>용도</th>
                    <th>상태</th>
                    <th className="text-right">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap text-label tabular-nums text-muted">
                        {ymd(row.created_at)}
                      </td>
                      <td className="whitespace-nowrap text-body-sm text-ink">
                        {CERT_KIND_LABELS[row.kind]}
                      </td>
                      <td className="max-w-[280px] truncate text-label text-muted">
                        {row.purpose}
                      </td>
                      <td>
                        <Badge tone={CERT_STATUS_TONES[row.status]}>
                          {CERT_STATUS_LABELS[row.status]}
                        </Badge>
                      </td>
                      <td className="text-right">
                        {row.status === "requested" ? (
                          <CertCancelButton requestId={row.id} />
                        ) : row.status === "rejected" ? (
                          <span className="text-label text-muted">
                            {row.rejection_reason ?? "사유 미기재"}
                          </span>
                        ) : (
                          <span className="text-label tabular-nums text-muted">
                            {ymd(row.processed_at)} 발급
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/* ── 관리자 화면 (/admin/hr) ─────────────────────────────────────── */

export interface CertAdminRow extends CertRequestRow {
  employee_name: string;
  department_name: string | null;
  position: string | null;
}

function CertAdminButtons({ requestId }: { requestId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const issue = () =>
    startTransition(async () => {
      const result = await issueCertificate(requestId);
      setMessage(result.ok ? null : (result.message ?? "처리하지 못했습니다."));
    });

  const reject = () =>
    startTransition(async () => {
      const result = await rejectCertificate(requestId, reason);
      if (result.ok) {
        setRejectOpen(false);
        setReason("");
        setReasonError(null);
        setMessage(null);
      } else {
        setReasonError(result.fieldErrors?.reason ?? null);
        setMessage(result.message ?? null);
      }
    });

  return (
    <div className="flex items-center justify-end gap-2">
      {message && !rejectOpen ? (
        <span className="text-label text-warn-ink">{message}</span>
      ) : null}
      <Button size="small" disabled={pending} onClick={issue}>
        <Check className="size-3.5" />
        발급
      </Button>
      <Button
        size="small"
        variant="ghost"
        disabled={pending}
        onClick={() => setRejectOpen(true)}
      >
        <X className="size-3.5" />
        반려
      </Button>

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="증명서 신청 반려"
        description="사유는 신청자 화면에 그대로 표시됩니다."
      >
        <div className="space-y-3">
          {message ? (
            <Callout tone="warn" title="반려하지 못했습니다">
              {message}
            </Callout>
          ) : null}

          <Field
            label="반려 사유"
            required
            htmlFor={`cert-reject-${requestId}`}
            error={reasonError}
          >
            <Textarea
              id={`cert-reject-${requestId}`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예) 용도가 확인되지 않습니다 — 제출처를 적어 다시 신청해 주세요."
              invalid={Boolean(reasonError)}
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setRejectOpen(false)}
              disabled={pending}
            >
              닫기
            </Button>
            <Button
              variant="danger"
              disabled={pending || !reason.trim()}
              onClick={reject}
            >
              반려
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * 관리자 처리 표. 대기 행에만 발급/반려 버튼이 붙고,
 * 처리된 행은 처리일·반려 사유가 그 자리를 받는다.
 */
export function CertAdminTable({ rows }: { rows: CertAdminRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
        <p className="text-label text-muted">해당하는 신청이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="ab-card overflow-hidden md:rounded-none md:border-0">
      <div className="overflow-x-auto">
        <table className="ab-table min-w-[720px]">
          <thead>
            <tr>
              <th>신청일</th>
              <th>신청자</th>
              <th>종류</th>
              <th>용도</th>
              <th>상태</th>
              <th className="text-right">처리</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="whitespace-nowrap text-label tabular-nums text-muted">
                  {ymd(row.created_at)}
                </td>
                <td className="whitespace-nowrap">
                  <span className="text-body-sm text-ink">
                    {row.employee_name}
                  </span>
                  <span className="ml-1.5 text-nano text-muted">
                    {[row.department_name, row.position]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </td>
                <td className="whitespace-nowrap text-body-sm text-ink">
                  {CERT_KIND_LABELS[row.kind]}
                </td>
                <td className="max-w-[240px] truncate text-label text-muted">
                  {row.purpose}
                </td>
                <td>
                  <Badge tone={CERT_STATUS_TONES[row.status]}>
                    {CERT_STATUS_LABELS[row.status]}
                  </Badge>
                </td>
                <td className="text-right">
                  {row.status === "requested" ? (
                    <CertAdminButtons requestId={row.id} />
                  ) : (
                    <span className="text-label text-muted">
                      {ymd(row.processed_at)}
                      {row.status === "rejected" && row.rejection_reason
                        ? ` · ${row.rejection_reason}`
                        : ""}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
