import Link from "next/link";
import { ChevronRight, ExternalLink, FolderOpen } from "lucide-react";
import { folderHref } from "@/features/files/format";
import { cn } from "@/lib/utils";

export interface Crumb {
  id: string;
  name: string;
}

/**
 * 폴더 경로.
 *
 * 폴더 드릴다운을 열면서 함께 들어온 부품이다. "어디에 있는지"와
 * "어떻게 돌아가는지"가 같은 줄에 없으면, 한 단계만 내려가도 사용자는
 * 브라우저 뒤로가기 말고는 길이 없다.
 *
 * 훅을 쓰지 않으므로 서버 컴포넌트(PageHeader toolbar)에서 그대로 렌더한다.
 */
export function FolderBreadcrumb({
  trail,
  basePath,
  driveHref,
  right,
  className,
}: {
  /** 루트 → 현재 순서 */
  trail: Crumb[];
  basePath: string;
  /** 현재 폴더를 Drive에서 여는 링크 */
  driveHref?: string;
  right?: React.ReactNode;
  className?: string;
}) {
  const last = trail.length - 1;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <nav
        aria-label="폴더 경로"
        className="flex min-w-0 flex-wrap items-center gap-0.5"
      >
        <FolderOpen className="mr-1 size-4 shrink-0 text-muted" aria-hidden />
        {trail.length === 0 ? (
          <span className="text-body-sm text-muted">폴더 정보 없음</span>
        ) : null}
        {trail.map((crumb, index) => {
          const href = index === 0 ? basePath : folderHref(basePath, crumb.id);
          const current = index === last;

          return (
            <span key={crumb.id} className="flex min-w-0 items-center gap-0.5">
              {index > 0 ? (
                <ChevronRight
                  className="size-3.5 shrink-0 text-line-strong"
                  aria-hidden
                />
              ) : null}
              {current ? (
                <span
                  aria-current="page"
                  className="max-w-56 truncate rounded-sm px-1.5 py-1 text-body-sm font-bold text-ink"
                >
                  {crumb.name}
                </span>
              ) : (
                <Link
                  href={href}
                  className="max-w-40 truncate rounded-sm px-1.5 py-1 text-body-sm text-muted transition-colors duration-fast ease-standard hover:bg-subtle hover:text-ink"
                >
                  {crumb.name}
                </Link>
              )}
            </span>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {right}
        {driveHref ? (
          <a
            href={driveHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-label text-muted transition-colors duration-fast ease-standard hover:bg-subtle hover:text-ink"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            Drive에서 열기
          </a>
        ) : null}
      </div>
    </div>
  );
}
