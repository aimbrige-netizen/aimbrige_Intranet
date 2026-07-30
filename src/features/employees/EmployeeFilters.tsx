"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Select } from "@/components/ui/Field";
import type { OrgOption } from "@/features/employees/EmployeeFields";

/** 목록 상단 검색 + 부서/역할/재직상태 필터 (스펙 3.4) */
export function EmployeeFilters({
  departments,
}: {
  departments: OrgOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
  }, [searchParams]);

  const apply = (patch: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(patch).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    params.delete("page");
    const search = params.toString();
    router.push(search ? `/admin/employees?${search}` : "/admin/employees");
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply({ q: query.trim() });
        }}
        className="relative min-w-56 flex-1 md:max-w-xs"
      >
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="이름 또는 이메일 검색"
          className="h-9 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-body placeholder:text-muted focus:border-primary"
          aria-label="이름 또는 이메일 검색"
        />
      </form>

      <Select
        aria-label="부서 필터"
        value={searchParams.get("department") ?? ""}
        onChange={(event) => apply({ department: event.target.value })}
        className="h-9 w-auto min-w-32 py-0"
      >
        <option value="">전체 부서</option>
        {departments.map((department) => (
          <option key={department.id} value={department.id}>
            {department.name}
          </option>
        ))}
      </Select>

      <Select
        aria-label="역할 필터"
        value={searchParams.get("role") ?? ""}
        onChange={(event) => apply({ role: event.target.value })}
        className="h-9 w-auto min-w-32 py-0"
      >
        <option value="">전체 역할</option>
        <option value="system_admin">시스템 관리자</option>
        <option value="manager">팀장/매니저</option>
        <option value="employee">일반직원</option>
      </Select>

      <Select
        aria-label="재직상태 필터"
        value={searchParams.get("status") ?? ""}
        onChange={(event) => apply({ status: event.target.value })}
        className="h-9 w-auto min-w-32 py-0"
      >
        <option value="">전체 상태</option>
        <option value="active">재직중</option>
        <option value="leave">휴직</option>
        <option value="terminated">퇴사</option>
      </Select>
    </div>
  );
}
