import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * URL 쿼리 기반 페이지네이션 (서버 컴포넌트에서 그대로 렌더 가능)
 * 감사 로그는 50건 단위 (스펙 3.6)
 */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  /** 현재 필터 등 유지할 쿼리 */
  params?: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const hrefFor = (target: number) => {
    const search = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    if (target > 1) search.set("page", String(target));
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const linkClass = (disabled: boolean) =>
    cn(
      "inline-flex h-8 items-center gap-1 rounded-md border border-line px-2.5 text-label transition-colors",
      disabled
        ? "pointer-events-none text-muted opacity-50"
        : "text-ink hover:bg-primary-light",
    );

  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 px-1 py-3">
      <p className="text-caption">
        전체 {total.toLocaleString()}건 중 {from.toLocaleString()}–
        {to.toLocaleString()}
      </p>
      <div className="flex items-center gap-1.5">
        <Link
          href={hrefFor(page - 1)}
          className={linkClass(page <= 1)}
          aria-disabled={page <= 1}
        >
          <ChevronLeft className="size-3.5" />
          이전
        </Link>
        <span className="px-1 text-label text-muted">
          {page} / {totalPages}
        </span>
        <Link
          href={hrefFor(page + 1)}
          className={linkClass(page >= totalPages)}
          aria-disabled={page >= totalPages}
        >
          다음
          <ChevronRight className="size-3.5" />
        </Link>
      </div>
    </nav>
  );
}
