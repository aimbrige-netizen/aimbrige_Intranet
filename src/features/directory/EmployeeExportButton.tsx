"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { downloadCsv } from "@/lib/csv";
import { formatDate } from "@/lib/utils";
import type { EmploymentStatus } from "@/types/db";

const STATUS_LABELS: Record<EmploymentStatus, string> = {
  active: "재직중",
  leave: "휴직",
  terminated: "퇴사",
};

export interface EmployeeExportRow {
  name: string;
  position: string | null;
  department: string | null;
  team: string | null;
  status: EmploymentStatus;
  email: string;
  phone: string | null;
  hireDate: string | null;
  tenure: string;
  /** 관리자 목록에서만 채운다 */
  role?: string | null;
  hasAccount?: boolean;
}

/**
 * 임직원 목록 내보내기.
 * 내보내기가 근태 화면에만 있어서 명부를 뽑으려면 화면을 복사해야 했다.
 *
 * 조직도 목록과 관리자 목록이 같은 버튼을 쓴다. 관리자 목록만 역할·계정
 * 연결 컬럼이 더 붙는데, 두 파일로 나누면 컬럼 순서가 다시 갈라진다.
 */
export function EmployeeExportButton({
  rows,
  filename = "임직원명부",
  withAdminColumns = false,
}: {
  rows: EmployeeExportRow[];
  filename?: string;
  /** 역할·계정 연결 컬럼을 덧붙인다 (관리자 목록) */
  withAdminColumns?: boolean;
}) {
  const header = [
    "이름",
    "직급",
    "부서",
    "팀",
    "재직상태",
    ...(withAdminColumns ? ["역할", "계정연결"] : []),
    "이메일",
    "전화",
    "입사일",
    "근속",
  ];

  return (
    <Button
      size="small"
      variant="secondary"
      disabled={rows.length === 0}
      title={`현재 필터에 걸린 ${rows.length}명을 CSV로 내려받습니다`}
      onClick={() =>
        downloadCsv(
          filename,
          header,
          rows.map((row) => [
            row.name,
            row.position ?? "",
            row.department ?? "",
            row.team ?? "",
            STATUS_LABELS[row.status],
            ...(withAdminColumns
              ? [row.role ?? "", row.hasAccount ? "연결됨" : "미연결"]
              : []),
            row.email,
            row.phone ?? "",
            row.hireDate ? formatDate(row.hireDate) : "",
            row.tenure,
          ]),
        )
      }
    >
      <Download className="size-3.5" aria-hidden />
      내보내기
      {rows.length > 0 ? (
        <span className="tabular-nums opacity-70">{rows.length}</span>
      ) : null}
    </Button>
  );
}
