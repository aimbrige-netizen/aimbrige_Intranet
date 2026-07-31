import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { LibraryList, type LibraryRow } from "@/features/files/LibraryList";
import { requireSessionEmployee } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { getFileMetas } from "@/lib/google-drive";

export const metadata: Metadata = { title: "사내 규정" };

export default async function LibraryPage() {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { data } = await supabase
    .from("library_documents")
    .select("id, drive_file_id, display_name, category, description, created_at")
    .order("category")
    .order("display_name");

  const rows = (data ?? []) as {
    id: string;
    drive_file_id: string;
    display_name: string;
    category: string | null;
    description: string | null;
    created_at: string | null;
  }[];

  /*
   * 링크·형식·개정일은 Drive가 원본이다. 실패해도 목록은 그대로 보여주고
   * 카드에서 "개정일 확인 불가"로만 표시한다 — 문서 자체는 열 수 있다.
   */
  const metas = await getFileMetas(rows.map((row) => row.drive_file_id));

  const documents: LibraryRow[] = rows.map((row) => {
    const meta = metas[row.drive_file_id];
    return {
      id: row.id,
      driveFileId: row.drive_file_id,
      displayName: row.display_name,
      category: row.category,
      description: row.description,
      webViewLink: meta?.webViewLink ?? null,
      mimeType: meta?.mimeType ?? null,
      modifiedTime: meta?.modifiedTime ?? null,
      registeredAt: row.created_at,
    };
  });

  return (
    <>
      <PageHeader
        title="사내 규정"
        meta={
          <>
            <span>계약서 템플릿 · 사규 · 복지제도</span>
            <span>·</span>
            <span>표시이름은 관리자가 등록한 이름입니다</span>
            <span>·</span>
            <span>클릭하면 Drive에서 열립니다</span>
          </>
        }
      />

      <LibraryList documents={documents} canManage={me.isSystemAdmin} />
    </>
  );
}
