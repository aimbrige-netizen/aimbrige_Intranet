"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Clock3,
  ExternalLink,
  Files,
  HardDrive,
  Layers,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Meter } from "@/components/ui/Progress";
import { StatCard } from "@/components/ui/StatCard";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import {
  FilterChip,
  TableToolbar,
  ToolbarSearch,
} from "@/components/ui/TableToolbar";
import { DriveReauthBanner } from "@/features/files/DriveReauthBanner";
import {
  FILE_KINDS,
  FILE_KIND_ORDER,
  folderHref,
  formatBytes,
  formatGigabytes,
  kindOf,
  percentOf,
  relativeDay,
  toGigabytes,
  type FileKind,
} from "@/features/files/format";
import { uploadToFolder } from "@/server/actions/files";
import { cn, formatDateTime } from "@/lib/utils";

export interface FileRow {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  size: number | null;
  modifiedTime: string | null;
  ownerName: string | null;
}

export interface QuotaInfo {
  /** 무제한 계정이면 null */
  limit: number | null;
  usage: number;
}

type SortKey = "name" | "kind" | "size" | "owner" | "modified";
type SortDir = "asc" | "desc";

/** 표시 한도 — google-drive.ts의 DRIVE_PAGE_SIZE와 같은 값 */
const PAGE_LIMIT = 200;

/**
 * 폴더 브라우저 — 지표 밴드 + 유형 칩 + 정렬 가능한 표.
 *
 * 예전에는 헤더 없는 ul 4열이라 정렬도 필터도 걸 수 없었고, 폴더를 누르면
 * 인트라넷을 벗어나 Drive 새 탭으로 튕겼다. 이제 폴더는 같은 화면에서
 * 내려가고(브레드크럼이 돌아올 길을 만든다), 파일만 Drive로 보낸다.
 */
export function FileBrowser({
  files,
  folderId,
  basePath,
  canUpload,
  uploadHint,
  truncated = false,
  quota = null,
  connected = true,
  canConfigure = false,
}: {
  files: FileRow[];
  /** 업로드 대상 = 지금 보고 있는 폴더 */
  folderId: string | null;
  /** 폴더 링크의 기준 경로 ("/files" | "/files/team") */
  basePath: string;
  canUpload: boolean;
  /** 업로드 버튼에 붙는 규칙 안내 (예: 팀원 누구나 업로드 가능) */
  uploadHint?: string;
  truncated?: boolean;
  quota?: QuotaInfo | null;
  /** Drive 연결 상태. 끊겨도 골격은 그대로 두고 배너만 띄운다 */
  connected?: boolean;
  canConfigure?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [keyword, setKeyword] = useState("");
  const [kind, setKind] = useState<FileKind | "all">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "modified",
    dir: "desc",
  });
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    name: string;
  } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  /** 폴더 요약 — 표 위에서 "이 폴더가 어떤 폴더인지"를 먼저 답한다 */
  const stats = useMemo(() => {
    let folders = 0;
    let totalSize = 0;
    let latest: FileRow | null = null;

    for (const file of files) {
      if (kindOf(file.mimeType) === "folder") {
        folders += 1;
      } else if (file.size) {
        totalSize += file.size;
      }
      if (
        file.modifiedTime &&
        (!latest ||
          !latest.modifiedTime ||
          file.modifiedTime > latest.modifiedTime)
      ) {
        latest = file;
      }
    }

    return {
      folders,
      fileCount: files.length - folders,
      totalSize,
      latest,
    };
  }, [files]);

  /** 유형별 건수 — 필터 칩의 분모이자 이 폴더의 구성 */
  const kindCounts = useMemo(() => {
    const counts = new Map<FileKind, number>();
    for (const file of files) {
      const k = kindOf(file.mimeType);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [files]);

  const rows = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const filtered = files.filter((file) => {
      if (kind !== "all" && kindOf(file.mimeType) !== kind) return false;
      if (!q) return true;
      return (
        file.name.toLowerCase().includes(q) ||
        (file.ownerName ?? "").toLowerCase().includes(q)
      );
    });

    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      // 정렬 기준이 무엇이든 폴더가 먼저 — 탐색 단위와 파일 단위를 섞지 않는다
      const aFolder = kindOf(a.mimeType) === "folder";
      const bFolder = kindOf(b.mimeType) === "folder";
      if (aFolder !== bFolder) return aFolder ? -1 : 1;

      switch (sort.key) {
        case "name":
          return a.name.localeCompare(b.name, "ko") * dir;
        case "kind":
          return (
            FILE_KINDS[kindOf(a.mimeType)].label.localeCompare(
              FILE_KINDS[kindOf(b.mimeType)].label,
              "ko",
            ) * dir
          );
        case "size":
          return ((a.size ?? 0) - (b.size ?? 0)) * dir;
        case "owner":
          return (a.ownerName ?? "").localeCompare(b.ownerName ?? "", "ko") * dir;
        default:
          return (
            (a.modifiedTime ?? "").localeCompare(b.modifiedTime ?? "") * dir
          );
      }
    });
  }, [files, keyword, kind, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" || key === "owner" ? "asc" : "desc" },
    );

  const openPicker = () => inputRef.current?.click();

  const upload = async (selected: File[]) => {
    if (!folderId || selected.length === 0) return;
    setResult(null);

    for (let i = 0; i < selected.length; i += 1) {
      const file = selected[i];
      setProgress({ done: i, total: selected.length, name: file.name });

      const formData = new FormData();
      formData.set("folderId", folderId);
      formData.append("files", file);

      const response = await uploadToFolder(formData);
      if (!response.ok) {
        setProgress(null);
        setResult({
          ok: false,
          text: response.message ?? "업로드에 실패했습니다.",
        });
        router.refresh();
        return;
      }
    }

    setProgress(null);
    setResult({
      ok: true,
      text:
        selected.length === 1
          ? `${selected[0].name}을(를) 업로드했습니다.`
          : `${selected.length}개 파일을 업로드했습니다.`,
    });
    router.refresh();
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!canUpload || progress) return;
    const dropped = Array.from(event.dataTransfer.files ?? []);
    if (dropped.length > 0) void upload(dropped);
  };

  const usageGb = quota ? toGigabytes(quota.usage) : 0;
  const limitGb = quota?.limit ? toGigabytes(quota.limit) : null;
  const usageRate = quota?.limit ? percentOf(quota.usage, quota.limit) : null;

  return (
    <>
      {!connected ? <DriveReauthBanner canConfigure={canConfigure} /> : null}

      {/*
        요약 밴드 — 용량은 분모(총 할당량) 없이는 판단할 수 없는 숫자다.
        10 스윕 판단: StatCard hairline은 시트와 같은 흰 면 위 유일한
        구분선(1겹)이라 이중 테두리가 아니다 — border 유지.
      */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Drive 사용량"
          value={quota ? formatGigabytes(quota.usage) : "—"}
          denominator={limitGb ? formatGigabytes(quota?.limit ?? 0) : undefined}
          tone="brand"
          icon={HardDrive}
          emphasis
          state={quota ? "ok" : "disconnected"}
          max={limitGb ?? undefined}
          meterValue={limitGb ? usageGb : undefined}
          thresholds={
            limitGb
              ? [
                  {
                    at: limitGb * 0.8,
                    label: `${Math.round(limitGb * 0.8)}GB`,
                    tone: "warning",
                  },
                  { at: limitGb * 0.95, tone: "critical" },
                ]
              : undefined
          }
          scale={!!limitGb}
          scaleMaxLabel={limitGb ? formatGigabytes(quota?.limit ?? 0) : undefined}
          sub={
            quota
              ? usageRate !== null
                ? `사용률 ${usageRate}%`
                : "용량 무제한 계정"
              : undefined
          }
        />
        <StatCard
          label="이 폴더 용량"
          value={stats.totalSize > 0 ? formatBytes(stats.totalSize) : "0B"}
          denominator={quota ? formatGigabytes(quota.usage) : undefined}
          tone="neutral"
          icon={Layers}
          // 연결이 끊겼을 때의 0은 "비었다"가 아니라 "모른다"다
          state={connected ? "ok" : "disconnected"}
          max={quota && quota.usage > 0 ? toGigabytes(quota.usage) : undefined}
          meterValue={
            quota && quota.usage > 0 ? toGigabytes(stats.totalSize) : undefined
          }
          sub={
            !connected
              ? undefined
              : quota && quota.usage > 0
                ? `Drive 사용량의 ${percentOf(stats.totalSize, quota.usage)}%`
                : "Drive 문서는 용량을 차지하지 않습니다"
          }
        />
        {/* 색 절제(17 준용): 표시 건수는 정보지 상태가 아니다 — 중립 톤.
            이 화면에서 색을 갖는 값은 Drive 사용량(brand) 하나다. */}
        <StatCard
          label="표시 중 항목"
          value={files.length}
          unit="개"
          denominator={PAGE_LIMIT}
          denominatorUnit="개"
          tone="neutral"
          icon={Files}
          max={PAGE_LIMIT}
          meterValue={files.length}
          state={connected ? "ok" : "disconnected"}
          sub={
            connected
              ? `폴더 ${stats.folders}개 · 파일 ${stats.fileCount}개`
              : undefined
          }
        />
        <StatCard
          label="마지막 변경"
          value={relativeDay(stats.latest?.modifiedTime)}
          tone="neutral"
          icon={Clock3}
          state={!connected ? "disconnected" : stats.latest ? "ok" : "empty"}
          sub={
            connected
              ? (stats.latest?.name ?? "아직 변경 이력이 없습니다")
              : undefined
          }
        />
      </div>

      {truncated ? (
        <Callout tone="info" className="mb-4">
          이 폴더에는 {PAGE_LIMIT}개가 넘는 항목이 있어 최근 수정순으로{" "}
          {PAGE_LIMIT}개까지만 표시합니다. 검색으로 범위를 좁혀 보세요.
        </Callout>
      ) : null}

      <TableToolbar
        search={
          <ToolbarSearch
            value={keyword}
            onChange={setKeyword}
            placeholder="파일명·소유자 검색"
          />
        }
        filters={
          <>
            <FilterChip
              active={kind === "all"}
              count={files.length}
              onClick={() => setKind("all")}
            >
              전체
            </FilterChip>
            {FILE_KIND_ORDER.filter((k) => kindCounts.get(k)).map((k) => (
              <FilterChip
                key={k}
                active={kind === k}
                count={kindCounts.get(k)}
                onClick={() => setKind(kind === k ? "all" : k)}
              >
                {FILE_KINDS[k].label}
              </FilterChip>
            ))}
          </>
        }
        count={
          rows.length === files.length
            ? `${files.length}개 항목`
            : `${rows.length} / ${files.length}개 항목`
        }
        actions={
          canUpload ? (
            <Button
              size="small"
              onClick={openPicker}
              disabled={!!progress || !folderId}
              title={uploadHint}
            >
              <Upload className="size-3.5" />
              {progress
                ? `업로드 중 ${progress.done + 1}/${progress.total}`
                : "업로드"}
            </Button>
          ) : null
        }
      />

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (picked.length > 0) void upload(picked);
        }}
      />

      {progress ? (
        <Meter
          className="mb-3"
          value={progress.done}
          max={progress.total}
          tone="informative"
          label={`업로드 중 · ${progress.name}`}
          valueLabel={`${progress.total}개 중 ${progress.done + 1}번째`}
        />
      ) : null}

      {result ? (
        <p
          className={cn(
            "mb-3 text-label",
            result.ok ? "text-success-ink" : "text-danger-ink",
          )}
          role="status"
        >
          {result.text}
        </p>
      ) : null}

      {/*
        드롭 존은 표 전체다 — 업로드하려고 버튼을 찾아 올라가지 않게 한다.
        md+ 흰 시트에서는 .ab-card 테두리를 걷고 표를 시트에 직접 놓는다
        (10 스윕). 드래그 강조는 border 대신 ring — md+에서 border-0과
        충돌하지 않고 양쪽 브레이크포인트에서 같은 모습으로 켜진다.
      */}
      <section
        className={cn(
          "ab-card overflow-hidden transition-colors duration-fast ease-standard md:rounded-none md:border-0",
          dragging &&
            canUpload &&
            "bg-primary-light/40 ring-1 ring-inset ring-primary",
        )}
        onDragOver={(event) => {
          if (!canUpload) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="overflow-x-auto">
            {/* --compact는 규칙 없는 클래스 — 화면을 손대는 사이클에 정리(Table.tsx 주석) */}
            <table className="ab-table min-w-[720px]">
              <thead>
                <tr>
                  <SortableHead
                    label="이름"
                    sortKey="name"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHead
                    label="유형"
                    sortKey="kind"
                    sort={sort}
                    onSort={toggleSort}
                    className="w-32"
                  />
                  <SortableHead
                    label="크기"
                    sortKey="size"
                    sort={sort}
                    onSort={toggleSort}
                    className="w-28"
                  />
                  <SortableHead
                    label="소유자"
                    sortKey="owner"
                    sort={sort}
                    onSort={toggleSort}
                    className="w-32"
                  />
                  <SortableHead
                    label="수정일시"
                    sortKey="modified"
                    sort={sort}
                    onSort={toggleSort}
                    className="w-40"
                  />
                  <th className="w-10" aria-label="열기" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <TableEmptyRow
                    colSpan={6}
                    icon={FILE_KINDS.folder.icon}
                    title={
                      files.length === 0
                        ? connected
                          ? "이 폴더는 비어 있습니다"
                          : "연결이 복구되면 목록이 채워집니다"
                        : "조건에 맞는 파일이 없습니다"
                    }
                    description={
                      files.length === 0 && canUpload && connected
                        ? "파일을 이 표 위로 끌어다 놓거나 업로드 버튼을 누르세요."
                        : files.length > 0
                          ? "검색어나 유형 필터를 지우면 전체가 다시 보입니다."
                          : undefined
                    }
                    action={
                      files.length === 0 ? (
                        canUpload && connected ? (
                          <Button
                            size="small"
                            onClick={openPicker}
                            disabled={!folderId}
                          >
                            <Upload className="size-3.5" />
                            파일 업로드
                          </Button>
                        ) : null
                      ) : (
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => {
                            setKeyword("");
                            setKind("all");
                          }}
                        >
                          필터 지우기
                        </Button>
                      )
                    }
                  />
                ) : (
                  rows.map((file) => (
                    <FileTableRow key={file.id} file={file} basePath={basePath} />
                  ))
                )}
              </tbody>
            </table>
        </div>
      </section>
    </>
  );
}

function FileTableRow({
  file,
  basePath,
}: {
  file: FileRow;
  basePath: string;
}) {
  const kind = kindOf(file.mimeType);
  const meta = FILE_KINDS[kind];
  const Icon = meta.icon;
  const isFolder = kind === "folder";

  const name = (
    <span className="flex min-w-0 items-center gap-2">
      <Icon
        className={cn("size-4 shrink-0", isFolder ? "text-primary-ink" : "text-muted")}
        aria-hidden
      />
      <span className="truncate text-ink">{file.name}</span>
    </span>
  );

  return (
    <tr>
      <td className="max-w-0">
        {isFolder ? (
          // 폴더는 인트라넷 안에서 내려간다 — 새 탭으로 튕기지 않는다
          <Link
            href={folderHref(basePath, file.id)}
            className="block min-w-0 hover:text-primary-ink"
          >
            {name}
          </Link>
        ) : file.webViewLink ? (
          <a
            href={file.webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className="block min-w-0 hover:text-primary-ink"
          >
            {name}
          </a>
        ) : (
          name
        )}
      </td>
      {/*
        07 표 문법 — 배지·아이콘·게이지 없는 순수 텍스트 셀. 유형 배지(회색
        틴트)와 행마다 붙던 크기 미니 게이지를 걷었다(10 색 절제). 유형은
        "유형" 헤더가, 크기 비교는 크기 정렬이 이미 그 일을 한다.
      */}
      <td>{meta.label}</td>
      <td>
        {isFolder ? (
          <span className="text-muted">-</span>
        ) : file.size ? (
          <span className="tabular-nums">{formatBytes(file.size)}</span>
        ) : (
          <span className="text-muted" title="Drive 문서는 용량을 차지하지 않습니다">
            —
          </span>
        )}
      </td>
      <td className="truncate">{file.ownerName ?? "-"}</td>
      <td className="whitespace-nowrap tabular-nums" title={file.modifiedTime ?? ""}>
        {file.modifiedTime ? formatDateTime(file.modifiedTime) : "-"}
      </td>
      <td>
        {isFolder ? null : file.webViewLink ? (
          <a
            href={file.webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${file.name} Drive에서 열기`}
            className="inline-grid size-7 place-items-center rounded-sm text-muted transition-colors duration-fast ease-standard hover:bg-subtle hover:text-ink"
          >
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </td>
    </tr>
  );
}

function SortableHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <th
      className={className}
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors duration-fast ease-standard hover:text-ink",
          active && "text-ink",
        )}
      >
        {label}
        <Icon
          className={cn("size-3", active ? "text-primary-ink" : "text-line-strong")}
          aria-hidden
        />
      </button>
    </th>
  );
}
