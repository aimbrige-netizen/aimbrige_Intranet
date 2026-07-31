"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { FilterChip, TableToolbar } from "@/components/ui/TableToolbar";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTION_OPTIONS,
  actionsOfGroup,
} from "@/features/audit/constants";

/**
 * 감사 로그 필터.
 *
 * 예전에는 액션이 15개짜리 드롭다운 하나였다. 닫혀 있는 동안 무엇을 고를 수
 * 있는지 보이지 않아 "권한 변경만 보기" 같은 가장 흔한 조회가 두세 번의
 * 탐색을 거쳤다. 요약 밴드(그룹)에서 좁힌 뒤 그룹 안의 액션을 칩으로 편다 —
 * 그룹 밖 액션을 골라 결과가 0건이 되는 조합 자체가 만들어지지 않는다.
 *
 * 기간은 URL에 from/to가 없어도 서버가 최근 30일로 잡는다. 여기 오는
 * from/to는 그렇게 확정된 값이라 입력칸이 항상 실제 조회 구간을 보여 준다.
 */
export function AuditFilters({
  presets,
  from,
  to,
  today,
  targetLabel,
  actions,
}: {
  /** [라벨, 시작일] 조합. 서버가 오늘 기준으로 계산해 넘긴다 */
  presets: { label: string; from: string }[];
  /** 실제 조회 중인 구간 (서버가 확정한 값) */
  from: string;
  to: string;
  today: string;
  /** target 필터가 걸려 있을 때 그 대상의 이름 */
  targetLabel?: string | null;
  /** 내보내기 등 우측 액션 */
  actions?: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const group = searchParams.get("group") ?? "";
  const action = searchParams.get("action") ?? "";
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
    : [];

  const isDefaultRange = !searchParams.get("from") && !searchParams.get("to");
  const hasFilter = !!(group || action || target) || !isDefaultRange;

  return (
    <TableToolbar
      filters={
        <>
          {presets.map((preset) => (
            <FilterChip
              key={preset.label}
              active={from === preset.from && to === today}
              onClick={() => apply({ from: preset.from, to: today })}
            >
              {preset.label}
            </FilterChip>
          ))}

          {/* 그룹을 좁힌 뒤에만 액션 칩을 편다 — 15개를 한 줄에 늘어놓지 않는다 */}
          {actionOptions.length > 0 ? (
            <>
              <span className="ml-2 text-nano text-muted">액션</span>
              <FilterChip active={!action} onClick={() => apply({ action: "" })}>
                그룹 전체
              </FilterChip>
              {actionOptions.map((option) => (
                <FilterChip
                  key={option.value}
                  active={action === option.value}
                  onClick={() =>
                    apply({
                      action: action === option.value ? "" : option.value,
                    })
                  }
                >
                  {option.label}
                </FilterChip>
              ))}
            </>
          ) : action ? (
            /* 그룹 없이 액션만 걸린 링크로 들어온 경우에도 풀 수단은 있어야 한다 */
            <FilterChip active onClick={() => apply({ action: "" })}>
              {AUDIT_ACTION_LABELS[action] ?? action} ×
            </FilterChip>
          ) : null}

          {target ? (
            <FilterChip active onClick={() => apply({ target: "" })}>
              {targetLabel ?? "특정 대상"}의 기록만 ×
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
            max={to}
            onChange={(event) => apply({ from: event.target.value, to })}
            className="h-9 w-auto py-0"
          />
          <span className="text-caption">~</span>
          <Input
            type="date"
            aria-label="종료일"
            value={to}
            min={from}
            onChange={(event) => apply({ from, to: event.target.value })}
            className="h-9 w-auto py-0"
          />
        </div>
      }
      actions={
        <>
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
                  sort: "",
                  dir: "",
                })
              }
            >
              필터 초기화
            </Button>
          ) : null}
          {actions}
        </>
      }
    />
  );
}
