"use client";

import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { downloadCsv } from "@/lib/csv";
import type { AuditExportResult } from "@/features/audit/export";

/**
 * 감사 로그 내보내기.
 *
 * 감사 요청이 오면 "이 기간의 권한 변경 전부"를 화면 밖으로 넘겨야 하는데
 * 지금까지 수단이 화면 복사뿐이었다. 현재 필터·정렬이 걸린 모수를 그대로
 * 내려받는다(페이지가 아니라 조건 전체, 상한 있음).
 *
 * 행은 누를 때 가져온다. 예전에는 페이지가 로드될 때마다 미리 받아 뒀는데,
 * 그건 표에 그리지도 않는 수백 행을 아무도 버튼을 안 눌러도 매번 읽는 일이었다.
 * 대신 건수는 목록 질의에 딸려 온 total로 미리 안다 — 버튼이 "몇 건 받는지"를
 * 말하려고 다시 조회하면 없애려던 왕복이 그대로 돌아온다.
 */
export function AuditExportButton({
  fetchRows,
  filename,
  total,
  limit,
}: {
  /** 서버 액션을 조건에 bind해 넘긴다 (page.tsx) */
  fetchRows: () => Promise<AuditExportResult>;
  filename: string;
  /** 현재 조건에 걸린 전체 건수 */
  total: number;
  /** 한 번에 내려받을 수 있는 상한. total이 넘으면 앞부분만 받는다 */
  limit: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 받을 게 없는 버튼은 회색으로 두지 않고 아예 내지 않는다
  if (total === 0) return null;

  const count = Math.min(total, limit);
  const capped = total > limit;

  const run = () =>
    startTransition(async () => {
      const result = await fetchRows();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      downloadCsv(
        filename,
        ["시각", "행위자", "행위자 이메일", "액션", "대상", "상세"],
        result.rows.map((row) => [
          row.at,
          row.actor,
          row.actorEmail,
          row.action,
          row.target,
          row.detail,
        ]),
      );
    });

  return (
    <div className="flex items-center gap-2">
      {error ? (
        <span className="text-label text-warn-ink">{error}</span>
      ) : null}
      <Button
        size="small"
        variant="secondary"
        disabled={pending}
        title={
          capped
            ? `현재 조건의 앞부분 ${count}건만 내려받습니다. 기간을 좁히면 전부 받을 수 있습니다.`
            : `현재 조건에 걸린 ${count}건을 CSV로 내려받습니다`
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
