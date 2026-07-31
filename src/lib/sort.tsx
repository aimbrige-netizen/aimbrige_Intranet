import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 표 정렬의 URL 규약.
 *
 * 정렬 상태를 컴포넌트 state가 아니라 ?sort=&dir= 에 둔다. 이 앱의 검색·필터·
 * 페이지가 이미 전부 URL 파라미터라, 정렬만 state로 두면 한 화면 안에 상태
 * 저장 방식이 두 개가 되고 공유·뒤로가기에서 정렬만 사라진다.
 *
 * 헤더는 링크다. 서버 정렬이라 실제로 다른 URL로 이동하고, 새 탭·북마크·
 * JS 없는 환경에서도 그대로 동작한다. 접근성은 <th aria-sort>가 담당한다.
 * 훅을 쓰지 않아 서버 컴포넌트에서 그대로 렌더된다.
 */

export type SortDir = "asc" | "desc";

/** ?dir= 파싱. 알 수 없는 값은 오름차순으로 떨어뜨린다 */
export function parseSortDir(value: string | undefined | null): SortDir {
  return value === "desc" ? "desc" : "asc";
}

/**
 * ?sort= 파싱. 허용 목록 밖의 값은 첫 번째 키(= 기본 정렬)로 떨어뜨린다.
 * 조회 계층이 감당 못 하는 키가 URL로 들어와도 화면이 깨지지 않게 한다.
 */
export function parseSortKey<T extends string>(
  value: string | undefined | null,
  allowed: readonly T[],
): T {
  return allowed.includes(value as T) ? (value as T) : allowed[0];
}

/** 같은 헤더를 다시 누르면 방향이 뒤집히고, 다른 헤더면 initial부터 */
export function toggledDir(
  isCurrent: boolean,
  currentDir: SortDir,
  /** 처음 눌렀을 때의 방향. 시각·날짜 컬럼은 내림차순이 자연스럽다 */
  initial: SortDir = "asc",
): SortDir {
  if (!isCurrent) return initial;
  return currentDir === "asc" ? "desc" : "asc";
}

/** <th aria-sort> 값 */
export function ariaSortOf(
  isCurrent: boolean,
  dir: SortDir,
): "ascending" | "descending" | "none" {
  if (!isCurrent) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

/**
 * 정렬 가능한 표 헤더 셀의 내용물.
 * <th aria-sort={ariaSortOf(...)}> 안에 넣어 쓴다.
 */
export function SortHeaderLink({
  href,
  label,
  active,
  dir,
}: {
  href: string;
  label: React.ReactNode;
  active: boolean;
  dir: SortDir;
}) {
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex items-center gap-1 whitespace-nowrap transition-colors duration-fast ease-standard hover:text-ink",
        active && "text-ink",
      )}
    >
      {label}
      <Icon
        className={cn(
          "size-3 transition-opacity duration-fast ease-standard",
          // 키보드로 헤더를 탭 이동하는 사용자에게도 정렬 가능 여부가 보여야 한다.
          // hover에만 걸어두면 sr-only 텍스트 외에 시각적 단서가 전혀 없다.
          active
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-60 group-focus-within:opacity-60",
        )}
        aria-hidden
      />
      <span className="sr-only">
        {active
          ? dir === "asc"
            ? "오름차순 정렬됨, 누르면 내림차순"
            : "내림차순 정렬됨, 누르면 오름차순"
          : "이 열로 정렬"}
      </span>
    </Link>
  );
}
