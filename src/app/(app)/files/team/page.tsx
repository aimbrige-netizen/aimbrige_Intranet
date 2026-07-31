import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { LinkButton } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { FileBrowser, type FileRow } from "@/features/files/FileBrowser";
import {
  FolderBreadcrumb,
  type Crumb,
} from "@/features/files/FolderBreadcrumb";
import { requireSessionEmployee } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getFolderTrail,
  getStorageQuota,
  listFolderFiles,
  type DriveFile,
} from "@/lib/google-drive";

export const metadata: Metadata = { title: "팀 공유폴더" };

type ScopeType = "team" | "department";

interface Scope {
  type: ScopeType;
  label: string;
  folderId: string;
}

/**
 * 팀 공유폴더.
 *
 * 예전에는 team → department 순으로 첫 매치만 잡고 멈춰서, 두 폴더에 모두
 * 접근할 수 있는 사람도 하나만 볼 수 있었다. 이제 후보를 모두 모아
 * 헤더의 세그먼티드 컨트롤로 전환한다.
 */
export default async function TeamFilesPage({
  searchParams,
}: {
  searchParams: { folder?: string; scope?: string };
}) {
  const me = await requireSessionEmployee();
  const supabase = createServerSupabase();

  const candidates: { type: ScopeType; id: string; name: string }[] = [];
  if (me.team_id) {
    candidates.push({
      type: "team",
      id: me.team_id,
      name: me.team?.name ?? "팀",
    });
  }
  if (me.department_id) {
    candidates.push({
      type: "department",
      id: me.department_id,
      name: me.department?.name ?? "부서",
    });
  }

  const { data: links } = candidates.length
    ? await supabase
        .from("drive_folder_links")
        .select("scope_type, scope_id, drive_folder_id, label")
        .in(
          "scope_id",
          candidates.map((c) => c.id),
        )
    : { data: [] };

  const rows = (links ?? []) as {
    scope_type: ScopeType;
    scope_id: string;
    drive_folder_id: string;
    label: string | null;
  }[];

  const scopes: Scope[] = candidates.flatMap((candidate) => {
    const match = rows.find(
      (row) =>
        row.scope_id === candidate.id && row.scope_type === candidate.type,
    );
    if (!match?.drive_folder_id) return [];
    return [
      {
        type: candidate.type,
        label: match.label ?? candidate.name,
        folderId: match.drive_folder_id,
      },
    ];
  });

  const active =
    scopes.find((scope) => scope.type === searchParams.scope) ?? scopes[0];

  const rootId = active?.folderId ?? null;
  let currentId = rootId;
  let trail: Crumb[] = active ? [{ id: active.folderId, name: active.label }] : [];

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
  const connected = !rootId || !!listing?.ok;
  const basePath = active ? `/files/team?scope=${active.type}` : "/files/team";

  return (
    <>
      <PageHeader
        title="팀 공유폴더"
        meta={
          <>
            {active ? (
              <Badge tone="primary">{active.label}</Badge>
            ) : (
              <span>연결된 폴더 없음</span>
            )}
            <span>·</span>
            <span>{active?.type === "department" ? "부서 공유" : "팀 공유"}</span>
            <span>·</span>
            <span>팀원 누구나 업로드할 수 있습니다</span>
          </>
        }
        toolbar={
          <FolderBreadcrumb
            trail={trail}
            basePath={basePath}
            driveHref={
              currentId
                ? `https://drive.google.com/drive/folders/${currentId}`
                : undefined
            }
            right={
              scopes.length > 1 && active ? (
                <SegmentedControl
                  size="small"
                  ariaLabel="공유 범위"
                  value={active.type}
                  options={scopes.map((scope) => ({
                    value: scope.type,
                    label: scope.label,
                    href: `/files/team?scope=${scope.type}`,
                  }))}
                />
              ) : null
            }
          />
        }
      />

      {!rootId ? (
        <Callout
          tone="info"
          title="공유폴더가 아직 연결되지 않았습니다"
          className="mb-4"
          action={
            me.isSystemAdmin ? (
              <LinkButton href="/admin/files" size="small" variant="secondary">
                공유폴더 등록
              </LinkButton>
            ) : null
          }
        >
          {me.isSystemAdmin
            ? "파일함 관리에서 팀·부서 Drive 폴더를 연결하면 아래 표가 채워집니다."
            : "시스템 관리자가 팀 Drive 폴더를 연결하면 아래 표가 채워집니다."}
        </Callout>
      ) : null}

      <FileBrowser
        files={files}
        folderId={currentId}
        basePath={basePath}
        canUpload={!!rootId}
        uploadHint="팀원 누구나 이 폴더에 업로드할 수 있습니다"
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
