"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import {
  FilterChip,
  TableToolbar,
  ToolbarSearch,
} from "@/components/ui/TableToolbar";
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
 * 검색은 행위자 이름·이메일·액션을 기간 안에서 찾는다. "이 사람이 한 일
 * 전부"를 보려면 지금까지 대상 링크를 타고 들어가는 길밖에 없었다.
 * 검색과 그룹·대상은 함께 걸리지 않으므로(조회 함수가 액션 하나까지만
 * 받는다) 검색을 시작하면 그 둘은 URL에서 떨어진다.
 *
 * 기간은 공용 규약(lib/period)의 ?period=custom&from=&to= 로 싣는다. URL에
 * 아무것도 없으면 서버가 최근 30일로 잡는다. 여기 오는 from/to는 그렇게
 * 확정된 값이라 입력칸이 항상 실제 조회 구간을 보여 준다.
 */
export function AuditFilters({
  presets,
  from,
  to,
  today,
  q,
  actionCounts,
  targetLabel,
  actions,
}: {
  /** [라벨, 시작일] 조합. 서버가 오늘 기준으로 계산해 넘긴다 */
  presets: { label: string; from: string }[];
  /** 실제 조회 중인 구간 (서버가 확정한 값) */
  from: string;
  to: string;
  today: string;
  /** 적용 중인 검색어 */
  q: string;
  /** 기간 안의 액션별 건수 — 칩의 분모. 못 받았으면 건수를 붙이지 않는다 */
  actionCounts?: Record<string, number> | null;
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
  const urlPeriod = searchParams.get("period") ?? "";
  const urlCursor = searchParams.get("cursor") ?? "";
  const urlFrom = searchParams.get("from") ?? "";
  const urlTo = searchParams.get("to") ?? "";

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

  /**
   * 날짜를 직접 고르면 임의 구간이 된다 — 규약상 from/to는 period=custom
   * 일 때만 유효하므로, 달력 단위(period=month&cursor=)로 들어와 있던 링크의
   * 기준점을 함께 떨어뜨린다. 남겨 두면 파서가 cursor를 먼저 보고 고른 날짜를
   * 버린다.
   */
  const applyRange = (nextFrom: string, nextTo: string) =>
    apply({ period: "custom", cursor: "", from: nextFrom, to: nextTo });

  const allowed = actionsOfGroup(group);
  const actionOptions =
    allowed && !q
      ? AUDIT_ACTION_OPTIONS.filter((option) => allowed.includes(option.value))
      : [];
  const groupTotal = actionCounts
    ? actionOptions.reduce(
        (sum, option) => sum + (actionCounts[option.value] ?? 0),
        0,
      )
    : undefined;

  const isDefaultRange = !urlPeriod && !urlCursor && !urlFrom && !urlTo;
  const hasFilter = !!(q || group || action || target) || !isDefaultRange;

  return (
    <TableToolbar
      filters={
        <>
          {presets.map((preset) => (
            <FilterChip
              key={preset.label}
              active={from === preset.from && to === today}
              onClick={() => applyRange(preset.from, today)}
            >
              {preset.label}
            </FilterChip>
          ))}

          {/* 그룹을 좁힌 뒤에만 액션 칩을 편다 — 15개를 한 줄에 늘어놓지 않는다 */}
          {actionOptions.length > 0 ? (
            <>
              <span className="ml-2 text-nano text-muted">액션</span>
              <FilterChip
                active={!action}
                count={groupTotal}
                onClick={() => apply({ action: "" })}
              >
                그룹 전체
              </FilterChip>
              {actionOptions.map((option) => (
                <FilterChip
                  key={option.value}
                  active={action === option.value}
                  count={actionCounts?.[option.value] ?? undefined}
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

          {q ? (
            <FilterChip active onClick={() => apply({ q: "" })}>
              &apos;{q}&apos; 검색 중 ×
            </FilterChip>
          ) : null}

          {/* 검색 중에는 대상이 걸려 있지 않다 — 걸린 척하는 칩을 띄우지 않는다 */}
          {target && !q ? (
            <FilterChip active onClick={() => apply({ target: "" })}>
              {targetLabel ?? "특정 대상"}의 기록만 ×
            </FilterChip>
          ) : null}
        </>
      }
      search={
        <>
          {/*
            검색은 GET 폼이다. 그룹·대상은 검색과 함께 걸리지 않지만(서버가
            무시한다) hidden으로 들고 간다 — 빈 칸에서 엔터를 쳤을 때 보고
            있던 필터가 통째로 날아가지 않고, 검색을 풀면 그대로 돌아온다.
          */}
          <form action="/admin/audit-logs" className="contents">
            {urlPeriod ? (
              <input type="hidden" name="period" value={urlPeriod} />
            ) : null}
            {urlCursor ? (
              <input type="hidden" name="cursor" value={urlCursor} />
            ) : null}
            {urlFrom ? (
              <input type="hidden" name="from" value={urlFrom} />
            ) : null}
            {urlTo ? <input type="hidden" name="to" value={urlTo} /> : null}
            {action ? (
              <input type="hidden" name="action" value={action} />
            ) : null}
            {group ? <input type="hidden" name="group" value={group} /> : null}
            {target ? (
              <input type="hidden" name="target" value={target} />
            ) : null}
            <ToolbarSearch
              name="q"
              defaultValue={q}
              placeholder="행위자 이름·이메일·액션"
              ariaLabel="감사 로그 검색"
            />
          </form>

          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="시작일"
              value={from}
              max={to}
              onChange={(event) => applyRange(event.target.value, to)}
              className="h-9 w-auto py-0"
            />
            <span className="text-caption">~</span>
            <Input
              type="date"
              aria-label="종료일"
              value={to}
              min={from}
              onChange={(event) => applyRange(from, event.target.value)}
              className="h-9 w-auto py-0"
            />
          </div>
        </>
      }
      actions={
        <>
          {hasFilter ? (
            <Button
              variant="ghost"
              size="small"
              onClick={() =>
                apply({
                  q: "",
                  group: "",
                  action: "",
                  period: "",
                  cursor: "",
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
