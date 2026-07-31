import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { LibraryList, type LibraryRow } from "@/features/files/LibraryList";
import { requireSessionEmployee } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { getFileLinks } from "@/lib/google-drive";

export const metadata: Metadata = { title: "사내 규정" };

export default async function LibraryPage() {
  await requireSessionEmployee();
  const supabase = createServerSupabase();

  const { data } = await supabase
    .from("library_documents")
    .select("id, drive_file_id, display_name, category, description")
    .order("category")
    .order("display_name");

  const rows = (data ?? []) as {
    id: string;
    drive_file_id: string;
    display_name: string;
    category: string | null;
    description: string | null;
  }[];

  // 링크 조회는 실패해도 무방하다 — 파일 ID로 표준 Drive URL을 만들어 대체한다
  const links = await getFileLinks(rows.map((r) => r.drive_file_id));

  const documents: LibraryRow[] = rows.map((r) => ({
    id: r.id,
    driveFileId: r.drive_file_id,
    displayName: r.display_name,
    category: r.category,
    description: r.description,
    webViewLink: links[r.drive_file_id] ?? null,
  }));

  return (
    <>
      <PageHeader
        title="사내 규정 라이브러리"
        description="계약서 템플릿·사규·복지제도 안내 문서입니다. 클릭하면 Drive에서 열립니다."
      />

      <LibraryList documents={documents} />
    </>
  );
}
