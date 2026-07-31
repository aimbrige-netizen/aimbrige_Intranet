import Link from "next/link";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 목록 위 툴바 — 검색 / 필터 / 건수 / 내보내기.
 *
 * 필터 UI가 화면마다 별도 컴포넌트로 흩어져 있어서, 한 화면에서 배운 조작
 * 방식이 다음 화면으로 전이되지 않았다. 정렬은 전 앱에 하나도 없었고
 * 내보내기는 근태에만 있었다.
 *
 * 훅을 쓰지 않으므로 서버·클라이언트 양쪽에서 쓸 수 있다.
 * 검색은 form(GET)으로도, onChange로도 붙일 수 있게 열어둔다.
 */
export function TableToolbar({
  search,
  filters,
  count,
  actions,
  className,
}: {
  search?: React.ReactNode;
  /** 필터 칩·셀렉트 묶음 */
  filters?: React.ReactNode;
  /** "전체 128건" 같은 결과 수 */
  count?: React.ReactNode;
  /** 내보내기·새로 만들기 등 우측 액션 */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-2", className)}>
      {search}
      {filters}
      {count !== undefined && count !== null ? (
        <span className="text-caption tabular-nums">{count}</span>
      ) : null}
      {actions ? (
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/**
 * 툴바용 검색 입력.
 * name을 주고 form으로 감싸면 서버 컴포넌트에서 GET 검색으로 동작한다.
 */
export function ToolbarSearch({
  name = "q",
  defaultValue,
  value,
  onChange,
  placeholder = "검색",
  ariaLabel,
  className,
}: {
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative min-w-52 flex-1 md:max-w-xs", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
        aria-hidden
      />
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="h-9 w-full rounded-card border border-line-strong bg-surface pl-9 pr-3 text-body-sm text-ink placeholder:text-muted transition-colors duration-fast ease-standard focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}

/**
 * 필터 칩 — 건수를 달고 켜고 끄는 토글.
 * 드롭다운과 달리 "무엇을 고를 수 있고 각각 몇 건인지"가 접히지 않는다.
 */
export function FilterChip({
  active,
  count,
  href,
  onClick,
  children,
}: {
  active?: boolean;
  count?: number;
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const className = cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 py-1 text-label transition-colors duration-fast ease-standard",
    active
      ? "border-primary bg-primary-light font-bold text-primary"
      : "border-line-strong bg-surface text-muted hover:text-ink",
  );

  const inner = (
    <>
      {children}
      {count !== undefined ? (
        <span className="tabular-nums opacity-70">{count}</span>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} aria-pressed={active} className={className}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={className}
    >
      {inner}
    </button>
  );
}
