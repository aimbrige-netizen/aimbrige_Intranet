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
}

/**
 * 임직원 목록 내보내기.
 * 내보내기가 근태 화면에만 있어서 조직도에서 명부를 뽑으려면 화면을 복사해야 했다.
 */
export function EmployeeExportButton({ rows }: { rows: EmployeeExportRow[] }) {
  return (
    <Button
      size="small"
      variant="secondary"
      disabled={rows.length === 0}
      onClick={() =>
        downloadCsv(
          "임직원명부",
          [
            "이름",
            "직급",
            "부서",
            "팀",
            "재직상태",
            "이메일",
            "전화",
            "입사일",
            "근속",
          ],
          rows.map((row) => [
            row.name,
            row.position ?? "",
            row.department ?? "",
            row.team ?? "",
            STATUS_LABELS[row.status],
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
    </Button>
  );
}
