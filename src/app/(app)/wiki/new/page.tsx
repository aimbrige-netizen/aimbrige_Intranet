import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Callout } from "@/components/ui/Callout";
import { WikiEditor } from "@/features/wiki/WikiEditor";
import { buildParentOptions } from "@/features/wiki/options";
import { getWikiTree } from "@/features/wiki/data";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "새 문서" };

/** 새 문서 (스펙 14 · 3.3) */
export default async function NewWikiPage({
  searchParams,
}: {
  searchParams: { parent?: string };
}) {
  await requireSessionEmployee();

  const { data: nodes, error } = await getWikiTree();

  return (
    <>
      <PageHeader title="새 문서" backHref="/wiki" />

      {error ? (
        <Callout tone="warn" title="문서 목록을 불러오지 못했습니다">
          상위 문서를 고를 수 없습니다. 최상위 문서로 저장한 뒤 나중에 옮길 수 있습니다.
        </Callout>
      ) : null}

      <WikiEditor
        initialTitle=""
        initialContent=""
        initialParentId={searchParams.parent ?? null}
        parents={buildParentOptions(nodes)}
        canDelete={false}
      />
    </>
  );
}
