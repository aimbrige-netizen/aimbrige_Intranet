import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { LinkButton } from "@/components/ui/Button";

/**
 * 빈 상태.
 *
 * action 슬롯은 원래도 있었는데 12곳 전부 비워둔 채로 썼다. 그래서 사용자가
 * 빈 화면에 도착하면 다음 행동으로 갈 버튼이 없었다. 빈 상태는 막다른 길이
 * 아니라 시작점이어야 한다.
 *
 * 다음 문제는 채워 넣은 뒤에 나왔다 — 호출부가 전부 variant="secondary"를
 * 골랐다. 실측(05-board.md)의 빈 상태 CTA는 **브랜드색을 채운 버튼**이다.
 * 화면에 아무것도 없을 때 유일하게 있는 버튼을 회색으로 두면, 갈 곳이 하나뿐인
 * 화면에서 그 하나가 가장 약하게 보인다.
 *
 * 그래서 `cta`를 1급 prop으로 둔다 — 라벨과 경로만 주면 기본이 primary다.
 * `action`은 그대로 남긴다: "첫 페이지로"·"검색 해제"처럼 되돌리는 동작은
 * 앞세울 액션이 아니라 빠져나가는 문이라서 secondary가 맞다.
 * 둘 다 주면 cta가 먼저 오고 action이 옆에 붙는다.
 */
export interface EmptyStateCta {
  label: string;
  href: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  cta,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  /** 이 빈 화면에서 할 수 있는 단 하나의 일. 브랜드색 채운 버튼으로 나간다 */
  cta?: EmptyStateCta;
  /** 보조 액션(되돌리기·필터 해제) 또는 링크가 아닌 커스텀 버튼 */
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-1.5 py-6" : "gap-2 py-12",
        className,
      )}
    >
      {Icon ? (
        <Icon
          className={cn("text-line-strong", compact ? "size-6" : "size-8")}
          aria-hidden
        />
      ) : null}
      {/*
        빈 상태 문구는 14px/500 rgb(170,170,170) — 07-modules.md L15 실측
        (faint 토큰). 원본 빈 상태는 흐린 문구 한 줄이 전부라 title이 그
        자리를 받는다. 우리 확장인 description(선택)은 같은 faint 색의
        13px로 한 단 아래 — muted(#969799)를 쓰면 보조 설명이 제목보다
        진해져 위계가 뒤집힌다.
      */}
      <p className="text-body font-medium text-faint">{title}</p>
      {description ? (
        <p className="max-w-sm text-label text-faint">{description}</p>
      ) : null}
      {cta || action ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {/*
            실측 빈 상태 CTA(07-modules.md 게시판 "새 글 작성하기")는
            32px(size=small) 단 하나다 — 밀도(compact)에 따라 medium으로
            커지지 않는다. action 슬롯에 들어오는 커스텀 버튼 크기는 여기서
            강제하지 않는다(호출부 몫) — 컨테이너에 크기 관련 클래스 없음.
          */}
          {cta ? (
            <LinkButton href={cta.href} size="small" variant="primary">
              {cta.label}
            </LinkButton>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 표가 비었을 때 쓰는 행.
 *
 * EmptyState로 표 전체를 갈아끼우면 thead까지 사라져서, 신규 계정은
 * 이 표가 무엇을 추적하는 표인지 알 방법이 없어진다. 컬럼 구조는 남기고
 * 본문 자리에만 안내를 넣는다.
 */
export function TableEmptyRow({
  colSpan,
  icon,
  title,
  description,
  cta,
  action,
}: {
  colSpan: number;
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  cta?: EmptyStateCta;
  action?: React.ReactNode;
}) {
  /*
   * hover:bg-transparent — 빈 안내 행은 hover로 강조할 대상이 아니다.
   * 본문 행에는 hover:bg-subtle이 걸려 있어서, 커서를 스치면 안내문이
   * "누를 수 있는 것"처럼 반응한다.
   */
  return (
    <tr className="hover:bg-transparent">
      <td colSpan={colSpan} className="px-4 py-10">
        <EmptyState
          icon={icon}
          title={title}
          description={description}
          cta={cta}
          action={action}
          compact
        />
      </td>
    </tr>
  );
}
