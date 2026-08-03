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
 *
 * 활성 칩은 **검정 알약**이다(실측 05-board.md). 종전에는 primary-light —
 * 브랜드색의 옅은 틴트라서, 옆에 있는 비활성 흰 칩과 명도 차이가 거의 없었다.
 * "지금 무엇으로 걸러 보고 있는지"는 한 화면에서 가장 자주 확인하는 상태인데
 * 그게 가장 흐리게 그려져 있었다. 검정 면은 어떤 배경 위에서도 즉시 읽힌다.
 *
 * 브랜드 시안을 쓰지 않는 것도 의도다 — 시안은 "누를 것"(주요 액션) 자리이고,
 * 칩은 "지금 상태"다. 같은 색을 쓰면 칩이 버튼처럼 보인다.
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
    // 실측 radius 20px 이상 → rounded-chip(20px), 높이 32px
    "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-chip border px-3.5 text-body transition-colors duration-fast ease-standard",
    active
      ? "border-ink bg-ink text-white"
      : // 비활성은 흰 면 + 연한 테두리. 글자는 muted가 아니라 보조 먹색이다 —
        // muted(#9b9c9e)로 두면 흰 배경에서 2.7:1이라 라벨을 읽기 어렵다.
        "border-line-strong bg-surface text-ink-sub hover:bg-subtle",
  );

  const inner = (
    <>
      {children}
      {count !== undefined ? (
        <span className={cn("tabular-nums", active ? "opacity-60" : "text-muted")}>
          {count}
        </span>
      ) : null}
    </>
  );

  /*
   * 링크 칩과 버튼 칩은 접근성 상태 표기가 다르다.
   * role=link는 aria-pressed를 지원하지 않아 스크린리더가 그냥 무시한다 —
   * 시각적으로는 검정 알약으로 또렷한 "지금 이걸로 걸러 보는 중"이
   * 비시각 사용자에게만 사라졌다. 링크는 aria-current로 표기한다.
   */
  if (href) {
    return (
      <Link
        href={href}
        aria-current={active ? "true" : undefined}
        className={className}
      >
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
