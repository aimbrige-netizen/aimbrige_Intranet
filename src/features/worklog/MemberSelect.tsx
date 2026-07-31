"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/Field";

export interface MemberOption {
  /** 빈 문자열이면 본인 */
  value: string;
  label: string;
  href: string;
}

/**
 * 조회 대상 전환 (스펙 09 · 3.1 — 팀장은 팀원 워크로그를 조회만 할 수 있다).
 *
 * 이동 경로는 서버에서 이미 만들어 넘긴다. 여기서 기간 파라미터를 다시
 * 조립하면 lib/period 규약이 화면마다 갈라진다.
 */
export function MemberSelect({
  options,
  value,
}: {
  options: MemberOption[];
  value: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Select
      aria-label="조회 대상"
      value={value}
      disabled={pending}
      className="min-w-56"
      onChange={(event) => {
        const next = options.find((o) => o.value === event.target.value);
        if (!next) return;
        startTransition(() => router.push(next.href));
      }}
    >
      {options.map((option) => (
        <option key={option.value || "me"} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
