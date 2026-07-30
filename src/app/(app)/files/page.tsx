import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { FileTabs } from "@/features/files/FileTabs";
import { FileList } from "@/features/files/FileList";
import { DriveReauthNotice } from "@/features/files/DriveReauthNotice";
import { requireSessionEmployee } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  INTRANET_FOLDER_NAME,
  ensureIntranetFolder,
  listFolderFiles,
} from "@/lib/google-drive";

export const metadata: Metadata = { title: "개인 파일함" };

export default async function FilesPage() {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  // 저장된 매핑이 있으면 재사용, 없으면 Drive에서 찾거나 만든다 (스펙 3.1 / 5장)
  const { data: mapping } = await supabase
    .from("employee_drive_folders")
    .select("drive_folder_id")
    .eq("employee_id", me.id)
    .maybeSingle<{ drive_folder_id: string }>();

  let folderId = mapping?.drive_folder_id ?? null;
  let notice: string | null = null;

  if (!folderId) {
    const ensured = await ensureIntranetFolder();
    if (ensured.ok) {
      folderId = ensured.data;
      const { error } = await supabase.rpc("set_my_drive_folder", {
        p_folder_id: ensured.data,
      });
      if (error) console.error("[files] 폴더 매핑 저장 실패:", error.message);
    } else {
      notice = ensured.message;
    }
  }

  const listing = folderId ? await listFolderFiles(folderId) : null;
  if (listing && !listing.ok) notice = listing.message;

  return (
    <>
      <PageHeader
        title="개인 파일함"
        description={`내 Google Drive의 "${INTRANET_FOLDER_NAME}" 폴더와 연결됩니다. 이름변경·삭제·공유는 Drive에서 처리하세요.`}
      />

      <FileTabs active="/files" />

      {notice || !folderId || !listing?.ok ? (
        <DriveReauthNotice
          message={notice ?? "Drive 폴더를 준비하지 못했습니다."}
        />
      ) : (
        <FileList
          files={listing.data}
          folderId={folderId}
          canUpload
        />
      )}
    </>
  );
}
