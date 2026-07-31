"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { downloadCsv } from "@/lib/csv";

export interface AuditExportRow {
  at: string;
  actor: string;
  actorEmail: string;
  action: string;
  target: string;
  detail: string;
}

/**
 * 감사 로그 내보내기.
 *
 * 감사 요청이 오면 "이 기간의 권한 변경 전부"를 화면 밖으로 넘겨야 하는데
 * 지금까지 수단이 화면 복사뿐이었다. 현재 필터·정렬이 걸린 모수를 그대로
 * 내려받는다(페이지가 아니라 조건 전체, 상한 있음).
 */
export function AuditExportButton({
  rows,
  filename,
  capped,
}: {
  rows: AuditExportRow[];
  filename: string;
  /** 상한에 걸려 잘렸으면 그 사실을 버튼에 적는다 */
  capped?: boolean;
}) {
  return (
    <Button
      size="small"
      variant="secondary"
      disabled={rows.length === 0}
      title={
        capped
          ? `현재 조건의 앞부분 ${rows.length}건만 내려받습니다. 기간을 좁히면 전부 받을 수 있습니다.`
          : `현재 조건에 걸린 ${rows.length}건을 CSV로 내려받습니다`
      }
      onClick={() =>
        downloadCsv(
          filename,
          ["시각", "행위자", "행위자 이메일", "액션", "대상", "상세"],
          rows.map((row) => [
            row.at,
            row.actor,
            row.actorEmail,
            row.action,
            row.target,
            row.detail,
          ]),
        )
      }
    >
      <Download className="size-3.5" aria-hidden />
      내보내기
      {rows.length > 0 ? (
        <span className="tabular-nums opacity-70">
          {rows.length}
          {capped ? "+" : ""}
        </span>
      ) : null}
    </Button>
  );
}
