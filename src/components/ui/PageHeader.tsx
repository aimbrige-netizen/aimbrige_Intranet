import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 페이지 헤더.
 *
 * 슬롯이 title/description/action 세 개뿐이라 두 가지 문제가 있었다.
 *  1. 브레드크럼(뒤로가기)을 담을 자리가 없어서 9개 파일에 ChevronLeft 링크가
 *     헤더 바깥 위쪽으로 손수 복제됐다.
 *  2. "주요 액션" 자리인 action 슬롯에 네비게이션 링크가 들어가면서,
 *     "승인함으로 이동" 같은 모듈 내부 이동이 본문 우측 상단에 떠 있었다.
 *     그건 이제 모듈 패널의 몫이다.
 *
 * 슬롯 순서는 고정한다: 브레드크럼 → 제목/메타 → 액션 → 툴바.
 */
export function PageHeader({
  title,
  description,
  meta,
  backHref,
  backLabel = "목록으로",
  action,
  actions,
  toolbar,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  /** 제목 아래 한 줄 메타. description과 달리 값들을 나열하는 자리 */
  meta?: React.ReactNode;
  /** 있으면 제목 위에 뒤로가기 링크를 그린다 */
  backHref?: string;
  backLabel?: string;
  /** 단수형은 기존 호출부 호환용. 새 코드는 actions를 쓴다 */
  action?: React.ReactNode;
  actions?: React.ReactNode;
  /** 헤더 아래 붙는 기간 네비게이터·탭·필터 */
  toolbar?: React.ReactNode;
  className?: string;
}) {
  const right = actions ?? action;

  return (
    <div className={cn("mb-5", className)}>
      {backHref ? (
        <Link
          href={backHref}
          className="mb-2 inline-flex items-center gap-1 text-label text-muted transition-colors duration-fast ease-standard hover:text-ink"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          {backLabel}
        </Link>
      ) : null}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {/*
            실측: 콘텐츠 영역 제목은 20px/600이다(홈 위젯 제목 20/600,
            대시보드 탭 18/600). 24px h1은 원본 어디에도 없는 단이라
            화면마다 제목만 크게 떠 보였다.
          */}
          <h1 className="text-[20px] font-semibold leading-tight text-ink">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-caption">{description}</p>
          ) : null}
          {meta ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted">
              {meta}
            </div>
          ) : null}
        </div>
        {right ? (
          <div className="flex shrink-0 items-center gap-2">{right}</div>
        ) : null}
      </header>

      {toolbar ? <div className="mt-4">{toolbar}</div> : null}
    </div>
  );
}
