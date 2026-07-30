"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Field";
import { setFinalApprover } from "@/server/actions/approvals";
import { DOCUMENT_TYPE_META, type DocumentType } from "./types";

interface Row {
  documentType: DocumentType;
  approverId: string | null;
  approverName: string | null;
}

/** 결재라인 설정 (스펙 3.5) — 1차는 규칙 고정이라 최종 승인자만 지정한다 */
export function ApprovalLineEditor({
  rows,
  employees,
}: {
  rows: Row[];
  employees: { id: string; name: string; position: string | null }[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const change = (documentType: DocumentType, approverId: string) => {
    setSaving(documentType);
    setMessage(null);
    startTransition(async () => {
      const result = await setFinalApprover(
        documentType,
        approverId === "" ? null : approverId,
      );
      setSaving(null);
      if (!result.ok) {
        setMessage(result.message ?? "저장하지 못했습니다.");
        return;
      }
      setMessage(`${DOCUMENT_TYPE_META[documentType].label} 저장됨`);
      router.refresh();
    });
  };

  return (
    <div>
      <div className="mb-3 min-h-5">
        {message ? (
          <p className="text-label text-success">{message}</p>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table className="ab-table min-w-[720px]">
          <thead>
            <tr>
              <th>문서유형</th>
              <th>1차 검토</th>
              <th>최종 승인자</th>
              <th className="w-32">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.documentType}>
                <td className="font-medium text-ink">
                  {DOCUMENT_TYPE_META[row.documentType].label}
                </td>
                <td className="text-caption">
                  기안자 팀의 팀장 (규칙 고정)
                </td>
                <td>
                  <Select
                    aria-label={`${DOCUMENT_TYPE_META[row.documentType].label} 최종 승인자`}
                    value={row.approverId ?? ""}
                    onChange={(e) => change(row.documentType, e.target.value)}
                    disabled={saving === row.documentType}
                    className="max-w-64"
                  >
                    <option value="">미지정</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}
                        {employee.position ? ` (${employee.position})` : ""}
                      </option>
                    ))}
                  </Select>
                </td>
                <td>
                  {row.approverId ? (
                    <Badge tone="success">지정됨</Badge>
                  ) : (
                    <Badge tone="danger">미지정</Badge>
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
