"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Inbox } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import {
  FilterChip,
  TableToolbar,
  ToolbarSearch,
} from "@/components/ui/TableToolbar";
import { processApprovalStep } from "@/server/actions/approvals";
import { ApprovalStepBar, type StripStep } from "./ApprovalStepStrip";
import { AGING_LATE_DAYS, AGING_WARN_DAYS } from "./format";
import type { DocumentHighlight } from "./format";

export interface InboxRow {
  id: string;
  title: string;
  typeShort: string;
  requesterName: string;
  requesterSub: string | null;
  highlight: DocumentHighlight | null;
  /** 서버에서 계산해 넘긴 경과일 — 클라이언트가 다시 계산하면 시각이 어긋난다 */
  waitingDays: number;
  createdAt: string;
  steps: StripStep[];
}

type AgingFilter = "all" | "aging" | "late";

/**
 * 결재 대기 목록.
 *
 * 예전 표의 컬럼은 기안자·유형·제목·내 단계·기안일 다섯 개뿐이라
 * 결재 여부를 판단할 근거(금액·기간·며칠 묵었는지)가 하나도 없었고,
 * 10건이면 10번 문서를 열었다 닫아야 했다. 핵심값을 목록으로 끌어올리고
 * 확실한 건은 선택해서 한 번에 승인한다.
 */
export function ApprovalInbox({ rows }: { rows: InboxRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [aging, setAging] = useState<AgingFilter>("all");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const counts = useMemo(
    () => ({
      all: rows.length,
      aging: rows.filter((r) => r.waitingDays >= AGING_WARN_DAYS).length,
      late: rows.filter((r) => r.waitingDays >= AGING_LATE_DAYS).length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (aging === "aging" && row.waitingDays < AGING_WARN_DAYS) return false;
      if (aging === "late" && row.waitingDays < AGING_LATE_DAYS) return false;
      if (!needle) return true;
      return (
        row.title.toLowerCase().includes(needle) ||
        row.requesterName.toLowerCase().includes(needle)
      );
    });
  }, [rows, query, aging]);

  const visibleIds = visible.map((row) => row.id);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));
  const allChecked =
    visibleIds.length > 0 && selectedVisible.length === visibleIds.length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  /**
   * 일괄 승인.
   * 서버 액션은 문서 하나씩 처리하므로 순차로 호출하고, 실패한 건만 남긴다.
   * (반려는 문서마다 사유가 달라야 하므로 일괄로 묶지 않는다)
   */
  const approveSelected = () => {
    const ids = selectedVisible;
    if (ids.length === 0) return;
    if (!window.confirm(`선택한 ${ids.length}건을 승인합니다. 계속하시겠습니까?`)) {
      return;
    }

    setMessage(null);
    startTransition(async () => {
      const failed: string[] = [];
      for (const id of ids) {
        const result = await processApprovalStep(id, true);
        if (!result.ok) failed.push(id);
      }
      setSelected(new Set(failed));
      setMessage(
        failed.length === 0
          ? `${ids.length}건을 승인했습니다.`
          : `${ids.length - failed.length}건 승인 · ${failed.length}건 실패 (선택으로 남겨 두었습니다)`,
      );
      router.refresh();
    });
  };

  return (
    <>
      <TableToolbar
        search={
          <ToolbarSearch
            value={query}
            onChange={setQuery}
            placeholder="제목·기안자 검색"
          />
        }
        filters={
          <>
            <FilterChip
              active={aging === "all"}
              count={counts.all}
              onClick={() => setAging("all")}
            >
              전체
            </FilterChip>
            <FilterChip
              active={aging === "aging"}
              count={counts.aging}
              onClick={() => setAging("aging")}
            >
              3일 이상
            </FilterChip>
            <FilterChip
              active={aging === "late"}
              count={counts.late}
              onClick={() => setAging("late")}
            >
              7일 이상
            </FilterChip>
          </>
        }
        count={`${visible.length}건 표시`}
        actions={
          <>
            {message ? (
              <span className="text-label text-muted">{message}</span>
            ) : null}
            <Button
              size="small"
              onClick={approveSelected}
              disabled={pending || selectedVisible.length === 0}
            >
              <Check className="size-3.5" />
              {pending
                ? "처리 중…"
                : `선택 ${selectedVisible.length}건 승인`}
            </Button>
          </>
        }
      />

      <Card>
        <CardBody className="!p-0">
          <div className="overflow-x-auto">
            <table className="ab-table ab-table--compact min-w-[900px]">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      disabled={visibleIds.length === 0 || pending}
                      aria-label="표시된 문서 전체 선택"
                      className="size-3.5 accent-[color:var(--seed-primary)]"
                    />
                  </th>
                  <th className="w-40">기안자</th>
                  <th className="w-20">유형</th>
                  <th>제목</th>
                  <th className="w-44">핵심값</th>
                  <th className="w-36">결재 진행</th>
                  <th className="w-28">경과</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <TableEmptyRow
                    colSpan={7}
                    icon={Inbox}
                    title={
                      rows.length === 0
                        ? "지금 결재할 문서가 없습니다"
                        : "조건에 맞는 문서가 없습니다"
                    }
                    description="본인 차례가 된 문서는 오래된 순으로 이 표에 쌓입니다."
                  />
                ) : (
                  visible.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggle(row.id)}
                          disabled={pending}
                          aria-label={`${row.title} 선택`}
                          className="size-3.5 accent-[color:var(--seed-primary)]"
                        />
                      </td>
                      <td>
                        <span className="block truncate text-ink">
                          {row.requesterName}
                        </span>
                        {row.requesterSub ? (
                          <span className="block truncate text-nano text-muted">
                            {row.requesterSub}
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap">{row.typeShort}</td>
                      <td>
                        <Link
                          href={`/approvals/${row.id}`}
                          className="text-ink hover:text-primary hover:underline"
                        >
                          {row.title}
                        </Link>
                      </td>
                      <td className="tabular-nums">
                        {row.highlight ? (
                          <>
                            <span className="block text-body-sm text-ink">
                              {row.highlight.text}
                            </span>
                            {row.highlight.sub ? (
                              <span className="block truncate text-nano text-muted">
                                {row.highlight.sub}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        <ApprovalStepBar steps={row.steps} />
                      </td>
                      <td className="whitespace-nowrap tabular-nums">
                        <WaitingCell days={row.waitingDays} />
                        <span className="block text-nano text-muted">
                          {row.createdAt}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

/** 경과일 — 7일 이상만 빨강. 3~6일은 주의, 그 이하는 평범한 값이다 */
function WaitingCell({ days }: { days: number }) {
  if (days >= AGING_LATE_DAYS) {
    return <Badge tone="danger">{days}일 경과</Badge>;
  }
  if (days >= AGING_WARN_DAYS) {
    return <Badge tone="warn">{days}일 경과</Badge>;
  }
  return <span className="text-ink">{days}일 경과</span>;
}
