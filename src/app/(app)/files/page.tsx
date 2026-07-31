import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { FileBrowser, type FileRow } from "@/features/files/FileBrowser";
import {
  FolderBreadcrumb,
  type Crumb,
} from "@/features/files/FolderBreadcrumb";
import { requireSessionEmployee } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  INTRANET_FOLDER_NAME,
  ensureIntranetFolder,
  getFolderTrail,
  getStorageQuota,
  listFolderFiles,
  type DriveFile,
} from "@/lib/google-drive";

export const metadata: Metadata = { title: "개인 파일함" };

/**
 * 개인 파일함.
 *
 * 구성은 기준 화면과 같다: 헤더(브레드크럼) → 분모 있는 요약 밴드 →
 * 유형 칩 → 조밀 표. 폴더는 ?folder= 로 같은 화면에서 내려가고,
 * 경로는 Drive의 parents를 거슬러 복원하므로 링크를 그대로 공유해도 된다.
 */
export default async function FilesPage({
  searchParams,
}: {
  searchParams: { folder?: string };
}) {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  // 저장된 매핑이 있으면 재사용, 없으면 Drive에서 찾거나 만든다 (스펙 3.1 / 5장)
  const { data: mapping } = await supabase
    .from("employee_drive_folders")
    .select("drive_folder_id")
    .eq("employee_id", me.id)
    .maybeSingle<{ drive_folder_id: string }>();

  let rootId = mapping?.drive_folder_id ?? null;

  if (!rootId) {
    const ensured = await ensureIntranetFolder();
    if (ensured.ok) {
      rootId = ensured.data;
      const { error } = await supabase.rpc("set_my_drive_folder", {
        p_folder_id: ensured.data,
      });
      if (error) console.error("[files] 폴더 매핑 저장 실패:", error.message);
    }
  }

  let currentId = rootId;
  let trail: Crumb[] = rootId
    ? [{ id: rootId, name: INTRANET_FOLDER_NAME }]
    : [];

  /*
   * folder 파라미터는 사용자가 고칠 수 있으니 루트 아래인지 확인한다.
   * 경로가 루트에 닿지 않으면 브레드크럼이 인트라넷 폴더 밖으로 새기 때문에
   * 조용히 루트로 되돌린다.
   */
  const requested = searchParams.folder;
  if (rootId && requested && requested !== rootId) {
    const walked = await getFolderTrail(requested, rootId);
    if (walked.ok && walked.data.some((crumb) => crumb.id === rootId)) {
      currentId = requested;
      trail = walked.data;
    }
  }

  const [listing, quota] = await Promise.all([
    currentId ? listFolderFiles(currentId) : null,
    getStorageQuota(),
  ]);

  const files: FileRow[] = listing?.ok ? listing.data.files.map(toRow) : [];
  const connected = !!currentId && !!listing?.ok;

  return (
    <>
      <PageHeader
        title="개인 파일함"
        meta={
          <>
            <span>{me.name}</span>
            <span>·</span>
            <span>Google Drive 연동</span>
            <span>·</span>
            <span>이름변경·이동·삭제는 Drive에서 처리합니다</span>
          </>
        }
        toolbar={
          <FolderBreadcrumb
            trail={trail}
            basePath="/files"
            driveHref={
              currentId
                ? `https://drive.google.com/drive/folders/${currentId}`
                : undefined
            }
          />
        }
      />

      <FileBrowser
        files={files}
        folderId={currentId}
        basePath="/files"
        canUpload
        uploadHint="현재 열려 있는 폴더에 업로드됩니다"
        truncated={listing?.ok ? listing.data.truncated : false}
        quota={quota.ok ? { limit: quota.data.limit, usage: quota.data.usage } : null}
        connected={connected}
        canConfigure={me.isSystemAdmin}
      />
    </>
  );
}

function toRow(file: DriveFile): FileRow {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink,
    size: file.size,
    modifiedTime: file.modifiedTime,
    ownerName: file.ownerName,
  };
}
