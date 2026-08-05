"use client";

import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { downloadCsv } from "@/lib/csv";
import { formatDate } from "@/lib/utils";
import type {
  EmployeeExportResult,
  EmployeeExportRow,
} from "@/features/employees/export";
import type { EmploymentStatus } from "@/types/db";

const STATUS_LABELS: Record<EmploymentStatus, string> = {
  active: "재직중",
  leave: "휴직",
  terminated: "퇴사",
};

/**
 * 행을 받는 길은 둘이다.
 * - rows: 이미 만들어 둔 배열을 그대로 넘긴다. 조직도(PeopleBoard)는 전 인원을
 *   메모리에 들고 필터·정렬까지 끝낸 뒤라 다시 조회할 이유가 없다.
 * - fetchRows: **서버 액션만** 넘긴다. 관리자 목록이 조건을 bind해 쓰는 길로,
 *   페이지 로드마다 최대 1000명을 미리 읽던 자리를 클릭 시점으로 미룬 것이다.
 *
 * 둘로 나눈 이유: 서버 컴포넌트는 인라인 클로저를 fetchRows로 넘길 수 없다.
 * RSC 경계를 넘어가는 함수는 "use server" 액션뿐이라 직렬화에서 던지는데,
 * 빌드도 tsc도 이걸 잡지 못하고 그 화면을 열어야만 드러난다. "이미 메모리에
 * 있으니 클로저로 감싸 넘기자"가 자연스러운 자리라 배열 길을 따로 뒀다.
 */
type RowSource =
  | { fetchRows: () => Promise<EmployeeExportResult>; rows?: never }
  | { rows: EmployeeExportRow[]; fetchRows?: never };

/**
 * 임직원 목록 내보내기.
 * 내보내기가 근태 화면에만 있어서 명부를 뽑으려면 화면을 복사해야 했다.
 *
 * 조직도 목록과 관리자 목록이 같은 버튼을 쓴다. 관리자 목록만 역할·계정
 * 연결 컬럼이 더 붙는데, 두 파일로 나누면 컬럼 순서가 다시 갈라진다.
 *
 * 건수는 목록 질의에 딸려 온 count로 이미 알고 있으므로 라벨을 위해 다시
 * 조회하지 않는다.
 */
type EmployeeExportButtonProps = RowSource & {
  /** 현재 필터에 걸린 인원 수 */
  total: number;
  /** 한 번에 내려받을 수 있는 상한. 화면이 이미 배열을 갖고 있으면 없다 */
  limit?: number;
  filename?: string;
  /** 역할·계정 연결 컬럼을 덧붙인다 (관리자 목록) */
  withAdminColumns?: boolean;
  /**
   * 조직도 표 위 툴바는 주소록 실측 문법(10)이 고스트 나열이라 ghost를 넘긴다.
   * 기본은 secondary — 관리자 목록은 종전 모습 그대로 둔다.
   */
  variant?: "secondary" | "ghost";
};

export function EmployeeExportButton(props: EmployeeExportButtonProps) {
  const {
    total,
    limit,
    filename = "임직원명부",
    withAdminColumns = false,
    variant = "secondary",
  } = props;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 받을 게 없는 버튼은 회색으로 두지 않고 아예 내지 않는다
  if (total === 0) return null;

  const count = limit ? Math.min(total, limit) : total;
  const capped = limit ? total > limit : false;

  const header = [
    "이름",
    "직위",
    "부서",
    "팀",
    "재직상태",
    ...(withAdminColumns ? ["역할", "계정연결"] : []),
    "이메일",
    "전화",
    "입사일",
    "근속",
  ];

  const run = () =>
    startTransition(async () => {
      const result: EmployeeExportResult = props.rows
        ? { ok: true, rows: props.rows }
        : await props.fetchRows();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      downloadCsv(
        filename,
        header,
        result.rows.map((row) => [
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
      );
    });

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-label text-warn-ink">{error}</span> : null}
      <Button
        size="small"
        variant={variant}
        disabled={pending}
        title={
          capped
            ? `현재 필터의 앞부분 ${count}명만 내려받습니다. 조건을 좁히면 전부 받을 수 있습니다.`
            : `현재 필터에 걸린 ${count}명을 CSV로 내려받습니다`
        }
        onClick={run}
      >
        <Download className="size-3.5" aria-hidden />
        {pending ? "내보내는 중" : "내보내기"}
        <span className="tabular-nums opacity-70">
          {count}
          {capped ? "+" : ""}
        </span>
      </Button>
    </div>
  );
}
