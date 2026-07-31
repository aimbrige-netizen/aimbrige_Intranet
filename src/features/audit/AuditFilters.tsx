"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { FilterChip, TableToolbar } from "@/components/ui/TableToolbar";
import {
  AUDIT_ACTION_OPTIONS,
  actionsOfGroup,
} from "@/features/audit/constants";

/**
 * 감사 로그 필터.
 *
 * 기간과 정밀 액션은 입력으로, 자주 쓰는 최근 구간은 칩으로 둔다.
 * 액션 드롭다운은 선택된 그룹 안의 항목만 보여준다 — 그룹을 고른 뒤
 * 그룹 밖 액션을 고르면 결과가 0건이 되는 조합을 만들지 않기 위해서다.
 */
export function AuditFilters({
  presets,
}: {
  /** [라벨, 시작일] 조합. 서버가 오늘 기준으로 계산해 넘긴다 */
  presets: { label: string; from: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const group = searchParams.get("group") ?? "";
  const action = searchParams.get("action") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const target = searchParams.get("target") ?? "";

  const apply = (patch: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(patch).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    params.delete("page");
    const search = params.toString();
    router.push(search ? `/admin/audit-logs?${search}` : "/admin/audit-logs");
  };

  const allowed = actionsOfGroup(group);
  const actionOptions = allowed
    ? AUDIT_ACTION_OPTIONS.filter((option) => allowed.includes(option.value))
    : AUDIT_ACTION_OPTIONS;

  const hasFilter = !!(group || action || from || to || target);

  return (
    <TableToolbar
      filters={
        <>
          {presets.map((preset) => (
            <FilterChip
              key={preset.label}
              active={from === preset.from && !to}
              onClick={() => apply({ from: preset.from, to: "" })}
            >
              {preset.label}
            </FilterChip>
          ))}
          {target ? (
            <FilterChip active onClick={() => apply({ target: "" })}>
              특정 대상만 보는 중 ×
            </FilterChip>
          ) : null}
        </>
      }
      search={
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label="시작일"
            value={from}
            onChange={(event) => apply({ from: event.target.value })}
            className="h-9 w-auto py-0"
          />
          <span className="text-caption">~</span>
          <Input
            type="date"
            aria-label="종료일"
            value={to}
            onChange={(event) => apply({ to: event.target.value })}
            className="h-9 w-auto py-0"
          />
        </div>
      }
      actions={
        <>
          <Select
            aria-label="액션 종류"
            value={action}
            onChange={(event) => apply({ action: event.target.value })}
            className="h-9 w-auto min-w-36 py-0"
          >
            <option value="">
              {allowed ? "그룹 내 전체 액션" : "전체 액션"}
            </option>
            {actionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          {hasFilter ? (
            <Button
              variant="ghost"
              size="small"
              onClick={() =>
                apply({
                  group: "",
                  action: "",
                  from: "",
                  to: "",
                  target: "",
                })
              }
            >
              필터 초기화
            </Button>
          ) : null}
        </>
      }
    />
  );
}
