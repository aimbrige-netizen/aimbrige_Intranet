import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FileText, History, Pencil } from "lucide-react";
import { SectionHeader } from "@/components/ui/Card";
import { Callout } from "@/components/ui/Callout";
import { LinkButton } from "@/components/ui/Button";
import { Markdown } from "@/features/wiki/Markdown";
import {
  getWikiPage,
  getWikiRevisions,
  getWikiTree,
} from "@/features/wiki/data";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "위키 문서" };

/**
 * 문서 보기 (스펙 14 · 3.2)
 *
 * 수정 이력은 별도 화면이 아니라 ?history=1로 같은 화면에서 펼친다.
 * 라우트를 하나 더 만들면 "본문 → 이력 → 본문"을 오갈 때마다 문서 전체를
 * 다시 받아야 하는데, 이력을 보는 이유가 대개 지금 본문과 비교하는 것이다.
 *
 * 복원 기능은 없다(스펙 6장에서 미룬 항목). 과거 버전을 보고 손으로
 * 복사하는 방식이라, 이력 카드에 본문 전문을 그대로 펼쳐 둔다 —
 * 접혀 있으면 복사할 수가 없다.
 */
export default async function WikiPageView({
  params,
  searchParams,
}: {
  params: { pageId: string };
  searchParams: { history?: string };
}) {
  await requireSessionEmployee();

  const showHistory = searchParams.history === "1";

  const [{ data: page, error }, { data: nodes }] = await Promise.all([
    getWikiPage(params.pageId),
    getWikiTree(),
  ]);

  if (error) {
    return (
      <>
        <div className="mb-5">
          <BackToWiki />
          <h1 className="text-[20px] font-medium leading-[30px] text-ink">
            위키 문서
          </h1>
        </div>
        <Callout tone="danger" title="문서를 불러오지 못했습니다">
          {error}
        </Callout>
      </>
    );
  }
  if (!page) notFound();

  const parent = page.parent_id
    ? (nodes.find((n) => n.id === page.parent_id) ?? null)
    : null;
  const children = nodes.filter((n) => n.parent_id === page.id);

  const { data: revisions } = showHistory
    ? await getWikiRevisions(page.id)
    : { data: [] };

  return (
    <>
      {/*
        문서 제목 20/500 — PageHeader급 밴드 없음(확립 문법, 게시글 상세와
        같은 단). 상위 문서·수정 정보는 문서 메타라 제목 아래 한 줄로 남긴다 —
        장식이 아니라 "지금 보는 판이 언제 것인가"라는 내용이다.
      */}
      <div className="mb-5">
        <BackToWiki />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 text-[20px] font-medium leading-[30px] text-ink">
            {page.title}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            <LinkButton
              href={showHistory ? `/wiki/${page.id}` : `/wiki/${page.id}?history=1`}
              size="small"
              variant="secondary"
            >
              <History className="size-4" />
              {showHistory ? "본문 보기" : "수정 이력"}
            </LinkButton>
            <LinkButton href={`/wiki/${page.id}/edit`} size="small">
              <Pencil className="size-4" />
              편집
            </LinkButton>
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted">
          {parent ? (
            <Link href={`/wiki/${parent.id}`} className="hover:underline">
              {parent.title}
            </Link>
          ) : (
            <span>최상위 문서</span>
          )}
          <span>
            {page.updated_at.slice(0, 10)} 수정
            {page.updated_by_name ? ` · ${page.updated_by_name}` : null}
          </span>
        </div>
      </div>

      {showHistory ? (
        <div className="space-y-5">
          {revisions.length === 0 ? (
            <Callout tone="neutral" title="수정 이력이 없습니다">
              문서를 만든 뒤 아직 수정된 적이 없습니다. 저장할 때마다 직전 내용이
              여기에 쌓입니다.
            </Callout>
          ) : (
            /*
              흰 시트 위 카드 래퍼 제거(08) — 이력 한 건 = 섹션 제목 + 원문.
              pre의 subtle 면·테두리는 카드가 아니라 "코드 원문" 인셋이라 남긴다.
            */
            revisions.map((revision) => (
              <section key={revision.id}>
                <SectionHeader
                  title={revision.title}
                  description={`${revision.edited_at.slice(0, 16).replace("T", " ")} · ${revision.editor_name}가 저장하기 직전 내용`}
                />
                {/*
                  이력은 원문 그대로 보여준다. 마크다운으로 렌더하면 지금 본문과
                  나란히 놓고 비교하기 좋지만, 복원이 손 복사인 이상 원문이 필요하다.
                */}
                {/* md 미만 canvas 위 카드 면 유지 — 본문 article과 같은 md-해체 래퍼 */}
                <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-card border border-line bg-subtle p-3 text-micro text-ink">
                    {revision.content || "(내용 없음)"}
                  </pre>
                </div>
              </section>
            ))
          )}
        </div>
      ) : (
        <>
          {/*
            08 흰 시트: md+에서는 본문 카드를 걷고 마크다운을 시트에 직접
            놓는다. md 미만은 캔버스 위 카드 문법이라 카드 면(p-4)을 유지한다.
          */}
          <article className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
            <Markdown text={page.content} />
          </article>

          {children.length > 0 ? (
            /* 흰 시트 위 카드 래퍼 제거(08) — 섹션 제목 + 목록 직접 배치 */
            <section className="mt-5">
              <SectionHeader
                title="하위 문서"
                description={`${children.length}건`}
              />
              {/*
                md 미만 canvas 위 카드 면 유지 — divide-line은 canvas와 동색이라
                면 없이는 행 구분선이 안 보이고, hover:bg-subtle은 canvas보다
                밝아 hover 방향이 역전된다. 카드 면(흰색) 위에서는 둘 다 유효.
              */}
              <div className="ab-card p-2 md:rounded-none md:border-0 md:p-0">
                <ul className="divide-y divide-line">
                  {children.map((child) => (
                    <li key={child.id}>
                      <Link
                        href={`/wiki/${child.id}`}
                        className="flex items-center gap-2 rounded-sm px-1 py-2 transition-colors duration-fast ease-standard hover:bg-subtle"
                      >
                        <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-body-sm text-ink">
                          {child.title}
                        </span>
                        <span className="shrink-0 text-nano tabular-nums text-muted">
                          {child.updated_at.slice(0, 10)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

/** 위키 홈 브레드크럼 — ESS 상세와 같은 단(20/500 제목 위 라벨 링크) */
function BackToWiki() {
  return (
    <Link
      href="/wiki"
      className="mb-2 inline-flex items-center gap-1 text-label text-muted transition-colors duration-fast ease-standard hover:text-ink"
    >
      <ChevronLeft className="size-3.5" aria-hidden />
      위키 홈으로
    </Link>
  );
}
