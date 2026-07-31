import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
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
        <PageHeader title="문서 편집" backHref="/wiki" />
        <Callout tone="danger" title="문서를 불러오지 못했습니다">
          {error}
        </Callout>
      </>
    );
  }
  if (!page) notFound();

  return (
    <>
      <PageHeader
        title="문서 편집"
        meta={<span>{page.title}</span>}
        backHref={`/wiki/${page.id}`}
      />

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
