import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Callout } from "@/components/ui/Callout";
import { WikiEditor } from "@/features/wiki/WikiEditor";
import { buildParentOptions } from "@/features/wiki/options";
import { getWikiPage, getWikiTree } from "@/features/wiki/data";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "문서 편집" };

/**
 * 문서 편집 (스펙 14 · 3.3)
 *
 * 상위 문서 목록에서 자기 자신과 자기 하위를 뺀다. 넣어두면 고를 수 있는데
 * 그건 문서가 자기 아래로 들어가는 순환이라, DB 트리거가 막고 화면에는
 * 오류만 뜬다 — 애초에 고를 수 없게 하는 편이 낫다.
 */
export default async function EditWikiPage({
  params,
}: {
  params: { pageId: string };
}) {
  const me = await requireSessionEmployee();

  const [{ data: page, error }, { data: nodes }] = await Promise.all([
    getWikiPage(params.pageId),
    getWikiTree(),
  ]);

  if (error) {
    return (
      <>
        <div className="mb-5">
          <BackLink href="/wiki" />
          <h1 className="text-title-l text-ink">
            문서 편집
          </h1>
        </div>
        <Callout tone="danger" title="문서를 불러오지 못했습니다">
          {error}
        </Callout>
      </>
    );
  }
  if (!page) notFound();

  return (
    <>
      {/*
        콘텐츠 제목 20/500 — PageHeader급 밴드 없음(확립 문법).
        어느 문서를 고치는 중인지는 제목 아래 메타 한 줄이 말한다.
      */}
      <div className="mb-5">
        <BackLink href={`/wiki/${page.id}`} />
        <h1 className="text-title-l text-ink">
          문서 편집
        </h1>
        <p className="mt-1.5 text-label text-muted">{page.title}</p>
      </div>

      <WikiEditor
        pageId={page.id}
        initialTitle={page.title}
        initialContent={page.content}
        initialParentId={page.parent_id}
        parents={buildParentOptions(nodes, page.id)}
        canDelete={me.isSystemAdmin}
      />
    </>
  );
}

/** 문서/홈 브레드크럼 — ESS 상세와 같은 단(20/500 제목 위 라벨 링크) */
function BackLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="mb-2 inline-flex items-center gap-1 text-label text-muted transition-colors duration-fast ease-standard hover:text-ink"
    >
      <ChevronLeft className="size-3.5" aria-hidden />
      {href === "/wiki" ? "위키 홈으로" : "문서로 돌아가기"}
    </Link>
  );
}
