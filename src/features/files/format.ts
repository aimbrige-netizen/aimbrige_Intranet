import {
  File as FileIcon,
  FileArchive,
  FileSpreadsheet,
  FileText,
  FileType,
  Film,
  Folder,
  Image as ImageIcon,
  Presentation,
  type LucideIcon,
} from "lucide-react";

/**
 * 파일함 표시 규칙.
 *
 * 목록이 이름·크기·수정일 세 덩어리 텍스트였을 때는 "무슨 파일인지"가
 * 확장자에 묻혀 있었다. mimeType을 유형으로 접어 배지·아이콘·필터를
 * 같은 어휘로 쓴다.
 *
 * 이 모듈은 서버·클라이언트 양쪽에서 쓰므로 server-only인 google-drive.ts를
 * 참조하지 않는다. 폴더 판별에 쓰는 mimeType 상수도 여기에 둔다.
 */

export const FOLDER_MIME = "application/vnd.google-apps.folder";

export type FileKind =
  | "folder"
  | "doc"
  | "sheet"
  | "slide"
  | "pdf"
  | "image"
  | "video"
  | "archive"
  | "other";

export interface FileKindMeta {
  label: string;
  icon: LucideIcon;
}

export const FILE_KINDS: Record<FileKind, FileKindMeta> = {
  folder: { label: "폴더", icon: Folder },
  doc: { label: "문서", icon: FileText },
  sheet: { label: "스프레드시트", icon: FileSpreadsheet },
  slide: { label: "프레젠테이션", icon: Presentation },
  pdf: { label: "PDF", icon: FileType },
  image: { label: "이미지", icon: ImageIcon },
  video: { label: "동영상", icon: Film },
  archive: { label: "압축", icon: FileArchive },
  other: { label: "기타", icon: FileIcon },
};

/** 필터 칩에 노출할 순서 — "기타"까지 포함해 분류가 새는 곳이 없게 한다 */
export const FILE_KIND_ORDER: FileKind[] = [
  "folder",
  "doc",
  "sheet",
  "slide",
  "pdf",
  "image",
  "video",
  "archive",
  "other",
];

export function kindOf(mimeType: string | null | undefined): FileKind {
  const mime = (mimeType ?? "").toLowerCase();
  if (!mime) return "other";
  if (mime === FOLDER_MIME) return "folder";

  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "video";

  if (mime.includes("spreadsheet") || mime.includes("excel")) return "sheet";
  if (mime.includes("presentation") || mime.includes("powerpoint")) {
    return "slide";
  }
  if (
    mime.includes("document") ||
    mime.includes("word") ||
    mime.startsWith("text/")
  ) {
    return "doc";
  }
  if (
    mime.includes("zip") ||
    mime.includes("compressed") ||
    mime.includes("tar") ||
    mime.includes("rar")
  ) {
    return "archive";
  }
  return "other";
}

/** Drive 문서(구글 형식)는 용량을 차지하지 않아 size가 없다 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "-";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

/** Meter의 max·value는 GB 단위로 맞춘다 — 바이트를 그대로 쓰면 눈금이 안 읽힌다 */
export function toGigabytes(bytes: number): number {
  return bytes / 1024 / 1024 / 1024;
}

export function formatGigabytes(bytes: number): string {
  const gb = toGigabytes(bytes);
  if (gb >= 100) return `${Math.round(gb)}GB`;
  if (gb >= 1) return `${gb.toFixed(1)}GB`;
  return formatBytes(bytes);
}

/**
 * "3일 전"처럼 최근 변경을 사람이 읽는 단위로.
 * 일주일이 넘어가면 상대 표현이 오히려 흐려져 날짜를 그대로 쓴다.
 */
export function relativeDay(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";

  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return "오늘";
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return iso.slice(0, 10);
}

/**
 * 폴더 드릴다운 링크.
 * basePath에 이미 쿼리(?scope=team)가 붙어 있을 수 있어 구분자를 계산한다.
 */
export function folderHref(
  basePath: string,
  folderId?: string | null,
): string {
  if (!folderId) return basePath;
  return `${basePath}${basePath.includes("?") ? "&" : "?"}folder=${folderId}`;
}

/** 0으로 나누지 않는 백분율 (표시용 정수) */
export function percentOf(value: number, max: number): number {
  if (!max || max <= 0) return 0;
  return Math.round((value / max) * 100);
}
