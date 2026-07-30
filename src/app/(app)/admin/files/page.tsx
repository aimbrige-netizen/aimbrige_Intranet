import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  FileAdmin,
  type FolderLinkRow,
  type LibraryAdminRow,
} from "@/features/files/FileAdmin";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "파일함 관리" };

export default async function AdminFilesPage() {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const [
    { data: links },
    { data: docs },
    { data: teams },
    { data: departments },
  ] = await Promise.all([
    supabase
      .from("drive_folder_links")
      .select("id, scope_type, scope_id, drive_folder_id, label")
      .order("scope_type"),
    supabase
      .from("library_documents")
      .select("id, display_name, category, drive_file_id")
      .order("category")
      .order("display_name"),
    supabase.from("teams").select("id, name").order("name"),
    supabase.from("departments").select("id, name").order("name"),
  ]);

  const teamList = (teams ?? []) as { id: string; name: string }[];
  const departmentList = (departments ?? []) as { id: string; name: string }[];
  const nameOf = (scopeType: string, scopeId: string) =>
    (scopeType === "team" ? teamList : departmentList).find(
      (o) => o.id === scopeId,
    )?.name ?? "(삭제된 조직)";

  const folderLinks: FolderLinkRow[] = (
    (links ?? []) as {
      id: string;
      scope_type: "team" | "department";
      scope_id: string;
      drive_folder_id: string;
      label: string | null;
    }[]
  ).map((row) => ({
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    scopeName: nameOf(row.scope_type, row.scope_id),
    driveFolderId: row.drive_folder_id,
    label: row.label,
  }));

  const libraryDocs: LibraryAdminRow[] = (
    (docs ?? []) as {
      id: string;
      display_name: string;
      category: string | null;
      drive_file_id: string;
    }[]
  ).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    category: row.category,
    driveFileId: row.drive_file_id,
  }));

  return (
    <>
      <PageHeader
        title="파일함 관리"
        description="팀 공유폴더와 사내 규정 문서를 Drive와 연결합니다. 파일 자체는 Drive에 있고 여기서는 연결만 관리합니다."
      />

      <FileAdmin
        folderLinks={folderLinks}
        libraryDocs={libraryDocs}
        teams={teamList}
        departments={departmentList}
      />
    </>
  );
}
