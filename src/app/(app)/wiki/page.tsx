import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, ChevronRight, FilePlus2, Search } from "lucide-react";
import { SectionHeader } from "@/components/ui/Card";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import {
  buildWikiTree,
  getWikiTree,
  searchWiki,
  type WikiTreeNode,
} from "@/features/wiki/data";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "위키" };

/**
 * 위키 홈 (스펙 14 · 3.1)
 *
 * 검색어가 있으면 트리 대신 결과 목록을 보여준다. 둘을 같이 띄우면 좁은 폭에서
 * "지금 보고 있는 게 검색 결과인지 전체 목록인지"가 흐려진다.
 *
 * 검색은 GET 폼이다. 결과 URL이 주소창에 남아야 공유하거나 뒤로 갈 수 있다 —
 * 클라이언트 상태로만 들고 있으면 새로고침 한 번에 사라진다.
 */
export default async function WikiPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  await requireSessionEmployee();

  const query = (searchParams.q ?? "").trim();

  const [{ data: nodes, error: treeError }, search] = await Promise.all([
    getWikiTree(),
    query ? searchWiki(query) : Promise.resolve({ data: [], error: null }),
  ]);

  const tree = buildWikiTree(nodes);
  const error = treeError ?? search.error;

  return (
    <>
      {/*
        콘텐츠 제목 "위키" 20/500 — PageHeader급 밴드 없음(확립 문법).
        종전 메타(문서 n건·검색 n건)는 트리/결과 섹션 제목이 분모로 든다.
        이 화면의 진한 오렌지는 "새 문서" 버튼 하나다(원칙 1).
      */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-medium leading-[30px] text-ink">
          위키
        </h1>
        <LinkButton href="/wiki/new" size="small">
          <FilePlus2 className="size-4" />새 문서
        </LinkButton>
      </div>

      <form method="get" action="/wiki" className="relative mb-5 max-w-xl">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="제목·본문 검색"
          aria-label="위키 검색"
          className="pl-10"
        />
      </form>

      {error ? (
        <Callout tone="danger" title="위키를 불러오지 못했습니다">
          {error}
        </Callout>
      ) : query ? (
        search.data.length === 0 ? (
          /* md+ 흰 시트에서는 빈 상태를 시트에 직접, md 미만은 canvas 위라 카드 면 유지 */
          <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
            <EmptyState
              icon={Search}
              title={`"${query}" 검색 결과가 없습니다`}
              description="다른 단어로 찾아보거나 새 문서를 만들어 보세요."
              action={
                <LinkButton href="/wiki/new" size="small" variant="secondary">
                  새 문서 만들기
                </LinkButton>
              }
            />
          </div>
        ) : (
          <section>
            {/* 분모는 제목이 든다(07·16 문법) — 검색 중임을 섹션이 말한다 */}
            <SectionHeader title={`"${query}" 검색 결과 (총${search.data.length}건)`} />
            <ul className="space-y-2">
              {search.data.map((hit) => (
              <li key={hit.id}>
                {/*
                  08 흰 시트: md+에서는 결과 행의 카드 테두리가 흰 면 위
                  흰 카드가 된다 — 테두리를 걷고 hover 면(subtle)만 남긴다.
                  md 미만은 캔버스 위 카드 문법이라 카드 면을 유지한다.
                */}
                <Link
                  href={`/wiki/${hit.id}`}
                  className="block rounded-card border border-line bg-surface px-4 py-3 transition-colors duration-fast ease-standard hover:bg-canvas md:border-0 md:bg-transparent md:hover:bg-subtle"
                >
                  <p className="text-body-sm font-bold text-ink">{hit.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-label text-muted">
                    {hit.snippet}
                  </p>
                  <p className="mt-1 text-nano text-muted">
                    {hit.updated_at.slice(0, 10)} · {hit.updated_by_name ?? "—"}
                  </p>
                </Link>
              </li>
              ))}
            </ul>
          </section>
        )
      ) : nodes.length === 0 ? (
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <EmptyState
            icon={BookOpen}
            title="아직 문서가 없습니다"
            description="사내 매뉴얼·회의록을 문서로 정리해 두면 여기에 쌓입니다."
            action={
              <LinkButton href="/wiki/new" size="small" variant="secondary">
                첫 문서 만들기
              </LinkButton>
            }
          />
        </div>
      ) : (
        <section>
          <SectionHeader title={`전체 문서 (총${nodes.length}건)`} />
          <nav aria-label="문서 트리">
            <TreeList nodes={tree} depth={0} />
          </nav>
        </section>
      )}
    </>
  );
}

/**
 * 트리는 details/summary로 그린다.
 *
 * 접기·펼치기에 자바스크립트가 필요 없고, 키보드와 스크린리더에서 이미
 * 동작이 정의된 요소다. 직접 만들면 그 동작을 전부 다시 구현해야 한다.
 *
 * 제목 링크는 summary 안에 둔다. 링크를 누르면 토글도 함께 일어나지만
 * 그 순간 문서로 이동하므로 눈에 보이지 않는다 — 반대로 링크를 밖으로 빼면
 * 제목이 늘 보여야 하는 자리에서 사라진다.
 */
function TreeList({ nodes, depth }: { nodes: WikiTreeNode[]; depth: number }) {
  return (
    <ul
      className={
        depth === 0 ? "space-y-1" : "ml-4 mt-1 space-y-1 border-l border-line pl-3"
      }
    >
      {nodes.map((node) => (
        <li key={node.id}>
          {node.children.length === 0 ? (
            /* 하위가 없으면 화살표 자리만큼 들여써서 제목 줄이 맞도록 한다 */
            <NodeRow node={node} className="pl-[1.625rem]" />
          ) : (
            /* 최상위는 펼친 채로 시작한다 — 처음 들어와서 빈 목록을 보게 하지 않는다 */
            <details className="group" open={depth === 0}>
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <NodeRow
                  node={node}
                  icon={
                    <ChevronRight
                      className="size-3.5 shrink-0 text-muted transition-transform duration-fast ease-standard group-open:rotate-90"
                      aria-hidden
                    />
                  }
                />
              </summary>
              <TreeList nodes={node.children} depth={depth + 1} />
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

function NodeRow({
  node,
  icon,
  className,
}: {
  node: WikiTreeNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-card px-2 py-1.5 transition-colors duration-fast ease-standard hover:bg-subtle ${className ?? ""}`}
    >
      {icon}
      <Link
        href={`/wiki/${node.id}`}
        className="min-w-0 flex-1 truncate text-body-sm text-ink hover:underline"
      >
        {node.title}
      </Link>
      {node.child_count > 0 ? (
        <span className="shrink-0 text-nano tabular-nums text-muted">
          하위 {node.child_count}
        </span>
      ) : null}
      <span className="shrink-0 text-nano tabular-nums text-muted">
        {node.updated_at.slice(0, 10)}
      </span>
    </div>
  );
}
