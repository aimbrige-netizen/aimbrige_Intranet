import type { Metadata } from "next";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FileList } from "@/features/files/FileList";
import { DriveReauthNotice } from "@/features/files/DriveReauthNotice";
import { requireSessionEmployee } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { listFolderFiles } from "@/lib/google-drive";

export const metadata: Metadata = { title: "팀 공유폴더" };

export default async function TeamFilesPage() {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  // 팀 폴더가 없으면 부서 폴더로 대체한다 — 팀 미배정자도 공유 문서를 볼 수 있게
  const candidates: { type: "team" | "department"; id: string }[] = [];
  if (me.team_id) candidates.push({ type: "team", id: me.team_id });
  if (me.department_id)
    candidates.push({ type: "department", id: me.department_id });

  let folderId: string | null = null;
  let scopeLabel: string | null = null;

  for (const candidate of candidates) {
    const { data } = await supabase
      .from("drive_folder_links")
      .select("drive_folder_id, label")
      .eq("scope_type", candidate.type)
      .eq("scope_id", candidate.id)
      .maybeSingle<{ drive_folder_id: string; label: string | null }>();

    if (data?.drive_folder_id) {
      folderId = data.drive_folder_id;
      scopeLabel =
        data.label ??
        (candidate.type === "team"
          ? (me.team?.name ?? "팀")
          : (me.department?.name ?? "부서"));
      break;
    }
  }

  const listing = folderId ? await listFolderFiles(folderId) : null;

  return (
    <>
      <PageHeader
        title="팀 공유폴더"
        description={
          scopeLabel
            ? `${scopeLabel} 공유폴더입니다. 팀원 누구나 업로드할 수 있습니다.`
            : "관리자가 등록한 팀 공유폴더를 표시합니다."
        }
      />

      {!folderId ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={Users}
              title="아직 팀 공유폴더가 설정되지 않았습니다"
              description="시스템 관리자에게 문의하세요. 관리자는 파일함 관리에서 팀별 Drive 폴더를 등록할 수 있습니다."
            />
          </CardBody>
        </Card>
      ) : !listing?.ok ? (
        <DriveReauthNotice
          message={listing?.message ?? "폴더 목록을 불러오지 못했습니다."}
        />
      ) : (
        <FileList files={listing.data} folderId={folderId} canUpload />
      )}
    </>
  );
}
