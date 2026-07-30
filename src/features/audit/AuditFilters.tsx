"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { AUDIT_ACTION_OPTIONS } from "@/features/audit/constants";

/** 액션 종류 · 기간 필터 (스펙 3.6) */
export function AuditFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

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

  const hasFilter =
    !!searchParams.get("action") ||
    !!searchParams.get("from") ||
    !!searchParams.get("to");

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Select
        aria-label="액션 종류"
        value={searchParams.get("action") ?? ""}
        onChange={(event) => apply({ action: event.target.value })}
        className="h-9 w-auto min-w-40 py-0"
      >
        <option value="">전체 액션</option>
        {AUDIT_ACTION_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          aria-label="시작일"
          value={searchParams.get("from") ?? ""}
          onChange={(event) => apply({ from: event.target.value })}
          className="h-9 w-auto py-0"
        />
        <span className="text-caption">~</span>
        <Input
          type="date"
          aria-label="종료일"
          value={searchParams.get("to") ?? ""}
          onChange={(event) => apply({ to: event.target.value })}
          className="h-9 w-auto py-0"
        />
      </div>

      {hasFilter ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => apply({ action: "", from: "", to: "" })}
        >
          필터 초기화
        </Button>
      ) : null}
    </div>
  );
}
