import { cn } from "@/lib/utils";

/**
 * 표 프리미티브.
 *
 * 실측(daou-survey/03-approval.md)의 표는 우리와 정반대였다.
 *   th   14px / 400 / 배경 투명 / 아래 1px 거의 검정
 *   td   14px / padding 8px … 16px
 *   행 구분선 없음
 * 색·치수는 globals.css의 `.ab-table`이 한 곳에서 정의한다. 여기서 다시
 * 선언하면 두 벌이 되어 다음에 한쪽만 고쳐진다 — 이 파일은 **구조**만 맡는다:
 * 가로 스크롤 컨테이너, table-fixed, 최소 폭, 셀 정렬.
 *
 * 코드베이스의 <table>은 29곳이고 전부 아래 두 줄을 손으로 복제해 왔다.
 *   <div className="overflow-x-auto">
 *     <table className="ab-table ab-table--compact min-w-[860px]">
 * 스크롤 컨테이너를 빠뜨린 표는 좁은 화면에서 카드를 밀어내고, min-w를 빠뜨린
 * 표는 컬럼이 눌려 붙는다. 구조를 컴포넌트가 쥐면 그 실수가 나올 자리가 없다.
 *
 * 이번 사이클에서는 컴포넌트만 세우고 대표 화면 두 곳(게시판 목록·기안 목록)에만
 * 적용한다. 나머지 화면은 `.ab-table` 클래스만으로도 같은 모양이 나오므로
 * 마크업 이전은 각 화면을 손대는 사이클에 함께 한다.
 *
 * 훅을 쓰지 않으므로 서버 컴포넌트에서도 그대로 렌더된다.
 */

export type CellAlign = "left" | "center" | "right";

const ALIGN: Record<CellAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export function DataTable({
  minWidth,
  fixed,
  className,
  children,
}: {
  /**
   * 이 폭 아래로는 줄이지 않고 가로 스크롤로 넘긴다.
   * 클래스(min-w-[860px])가 아니라 style로 받는 이유: 호출부가 조건에 따라
   * 값을 고르면(공지 940 / 일반 700) Tailwind JIT가 그 클래스를 만들지 못한다.
   */
  minWidth?: number;
  /** 컬럼 폭을 못 박아 조건부 셀이 붙고 빠져도 제목의 시작 x가 밀리지 않게 한다 */
  fixed?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className={cn("ab-table", fixed && "table-fixed", className)}
        style={minWidth ? { minWidth } : undefined}
      >
        {children}
      </table>
    </div>
  );
}

/**
 * 헤더 셀. 폭은 className으로 준다(w-24 등) — 컬럼 폭은 화면마다 다르고
 * 열거할 수 있는 값이 아니라서 prop으로 감싸면 이름만 늘어난다.
 */
export function Th({
  align = "left",
  className,
  children,
  ...props
}: Omit<React.ThHTMLAttributes<HTMLTableCellElement>, "align"> & {
  align?: CellAlign;
}) {
  return (
    <th className={cn(ALIGN[align], className)} {...props}>
      {children}
    </th>
  );
}

export function Td({
  align = "left",
  numeric,
  nowrap,
  className,
  children,
  ...props
}: Omit<React.TdHTMLAttributes<HTMLTableCellElement>, "align"> & {
  align?: CellAlign;
  /**
   * 숫자 컬럼. 고정폭 숫자로 자릿수를 세로로 맞춘다.
   * 우측 정렬까지 자동으로 하지는 않는다 — 날짜처럼 좌측에 두는 숫자도 있다.
   */
  numeric?: boolean;
  nowrap?: boolean;
}) {
  return (
    <td
      className={cn(
        ALIGN[align],
        numeric && "tabular-nums",
        nowrap && "whitespace-nowrap",
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}
