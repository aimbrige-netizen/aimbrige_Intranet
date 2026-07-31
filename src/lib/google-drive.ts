import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
// 폴더 판별 상수는 화면(클라이언트)에서도 써야 해서 client-safe 모듈에 둔다
import { FOLDER_MIME } from "@/features/files/format";

/**
 * Google Drive API 연동 (스펙 06 · 5장)
 *
 * ⚠️ 알려진 제약 — 로그인 후 약 1시간
 * Supabase Auth의 provider_token은 액세스 토큰이 갱신되는 시점에 사라진다.
 * 캘린더(스펙 02)는 동기화가 부가 기능이라 조용히 건너뛰면 됐지만, 이 모듈은
 * 전체가 Drive API에 의존해서 토큰이 없으면 목록 자체를 못 불러온다.
 * 그래서 실패를 숨기지 않고 'reauth_required'로 구분해 화면에서
 * "다시 로그인" 안내를 띄운다.
 *
 * 근본 해결에는 refresh token 보관 + 서버 측 갱신이 필요한데, 유출 시 임직원
 * 드라이브 전체가 열리는 위험이 있어 별도 보안 검토가 필요하다(사용자 결정 대기).
 */

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_ABOUT = "https://www.googleapis.com/drive/v3/about";

export const INTRANET_FOLDER_NAME = "에임브릿지 인트라넷";

/** 한 번에 가져오는 최대 항목 수. 넘으면 listing.truncated가 true가 된다 */
export const DRIVE_PAGE_SIZE = 200;

const FILE_FIELDS =
  "id,name,mimeType,webViewLink,iconLink,size,modifiedTime,owners(displayName,emailAddress)";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  iconLink: string | null;
  size: number | null;
  modifiedTime: string | null;
  /** 소유자 표시이름. 공유폴더에서 "누가 올린 파일인지"를 구분한다 */
  ownerName: string | null;
}

export interface DriveFolderListing {
  files: DriveFile[];
  /** pageSize 상한에 걸려 뒤가 잘렸는지 */
  truncated: boolean;
}

export interface DriveCrumb {
  id: string;
  name: string;
}

export interface DriveStorage {
  /** 무제한 계정이면 null */
  limit: number | null;
  usage: number;
  usageInDrive: number;
  usageInTrash: number;
}

export type DriveResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "reauth_required" | "error"; message: string };

async function getToken(): Promise<string | null> {
  const supabase = createServerSupabase();
  const { data } = await supabase.auth.getSession();
  return data.session?.provider_token ?? null;
}

const REAUTH: DriveResult<never> = {
  ok: false,
  reason: "reauth_required",
  message:
    "Google Drive 접근 토큰이 만료되었습니다. 다시 로그인하면 파일 목록을 불러올 수 있습니다.",
};

async function driveFetch(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<DriveResult<unknown>> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

    if (response.status === 401 || response.status === 403) {
      const body = await response.text();
      console.error("[drive] 인증 거부", response.status, body);
      return {
        ok: false,
        reason: "reauth_required",
        message:
          "Drive 접근 권한이 없습니다. Drive 스코프를 허용한 상태로 다시 로그인해 주세요.",
      };
    }

    if (!response.ok) {
      const body = await response.text();
      console.error("[drive] 요청 실패", response.status, body);
      return {
        ok: false,
        reason: "error",
        message: `Drive 요청이 실패했습니다 (${response.status}).`,
      };
    }

    return { ok: true, data: await response.json() };
  } catch (error) {
    console.error("[drive] 예외", error);
    return { ok: false, reason: "error", message: "Drive 통신 중 오류가 발생했습니다." };
  }
}

function toDriveFile(f: Record<string, unknown>): DriveFile {
  const owners = (f.owners as { displayName?: string }[] | undefined) ?? [];
  return {
    id: String(f.id),
    name: String(f.name ?? ""),
    mimeType: String(f.mimeType ?? ""),
    webViewLink: (f.webViewLink as string) ?? null,
    iconLink: (f.iconLink as string) ?? null,
    size: f.size ? Number(f.size) : null,
    modifiedTime: (f.modifiedTime as string) ?? null,
    ownerName: owners[0]?.displayName ?? null,
  };
}

/**
 * 폴더 한 단계의 목록.
 *
 * 하위 폴더까지 한 번에 훑지 않는다 — 화면이 폴더를 눌러 들어가는 방식이라
 * 필요한 단계만 그때그때 부른다(브레드크럼은 getFolderTrail이 만든다).
 */
export async function listFolderFiles(
  folderId: string,
): Promise<DriveResult<DriveFolderListing>> {
  const token = await getToken();
  if (!token) return REAUTH;

  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    orderBy: "folder,modifiedTime desc",
    pageSize: String(DRIVE_PAGE_SIZE),
  });

  const result = await driveFetch(`${DRIVE_FILES}?${params}`, token);
  if (!result.ok) return result;

  const payload = result.data as {
    files?: Record<string, unknown>[];
    nextPageToken?: string;
  };
  return {
    ok: true,
    data: {
      files: (payload.files ?? []).map(toDriveFile),
      truncated: !!payload.nextPageToken,
    },
  };
}

/**
 * 현재 폴더에서 루트까지 거슬러 올라가 브레드크럼을 만든다.
 *
 * 폴더를 눌렀을 때 Drive 새 탭으로 튕기는 대신 같은 화면에서 내려가려면
 * "지금 어디에 있고 어떻게 돌아가는지"가 필요하다. 경로 이름을 URL에 싣지 않고
 * parents를 따라 올라가므로, 링크를 그대로 공유해도 경로가 복원된다.
 */
export async function getFolderTrail(
  folderId: string,
  rootId: string,
): Promise<DriveResult<DriveCrumb[]>> {
  const token = await getToken();
  if (!token) return REAUTH;

  const trail: DriveCrumb[] = [];
  let cursor: string | null = folderId;

  // 깊이 제한 — 순환하는 부모 관계는 없지만 무한 요청은 막는다
  for (let depth = 0; cursor && depth < 12; depth += 1) {
    const result = await driveFetch(
      `${DRIVE_FILES}/${cursor}?fields=id,name,parents`,
      token,
    );
    if (!result.ok) return result;

    const f = result.data as { id: string; name?: string; parents?: string[] };
    trail.unshift({ id: String(f.id), name: String(f.name ?? "폴더") });
    if (String(f.id) === rootId) break;
    cursor = f.parents?.[0] ?? null;
  }

  return { ok: true, data: trail };
}

/**
 * 저장용량. "내 파일함이 얼마나 찼는가"에 답하는 유일한 소스다.
 * 실패해도 목록은 그대로 보여야 하므로 호출부에서 null로 흘린다.
 */
export async function getStorageQuota(): Promise<DriveResult<DriveStorage>> {
  const token = await getToken();
  if (!token) return REAUTH;

  const result = await driveFetch(`${DRIVE_ABOUT}?fields=storageQuota`, token);
  if (!result.ok) return result;

  const quota =
    (result.data as { storageQuota?: Record<string, string> }).storageQuota ??
    {};

  return {
    ok: true,
    data: {
      // 무제한(Workspace 일부 플랜)이면 limit 자체가 응답에 없다
      limit: quota.limit ? Number(quota.limit) : null,
      usage: Number(quota.usage ?? 0),
      usageInDrive: Number(quota.usageInDrive ?? 0),
      usageInTrash: Number(quota.usageInDriveTrash ?? 0),
    },
  };
}

/** "에임브릿지 인트라넷" 폴더를 찾거나 만든다 (스펙 5장) */
export async function ensureIntranetFolder(): Promise<DriveResult<string>> {
  const token = await getToken();
  if (!token) return REAUTH;

  // 이미 있으면 재사용 — 매번 새로 만들면 폴더가 계속 늘어난다
  const searchParams = new URLSearchParams({
    q:
      `name='${INTRANET_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' ` +
      `and trashed=false and 'root' in parents`,
    fields: "files(id,name)",
    pageSize: "1",
  });

  const found = await driveFetch(`${DRIVE_FILES}?${searchParams}`, token);
  if (!found.ok) return found;

  const existing = (found.data as { files?: { id: string }[] }).files ?? [];
  if (existing.length > 0) return { ok: true, data: existing[0].id };

  const created = await driveFetch(`${DRIVE_FILES}?fields=id`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: INTRANET_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  if (!created.ok) return created;

  return { ok: true, data: String((created.data as { id: string }).id) };
}

/** 파일 업로드 (multipart — 스펙 5장) */
export async function uploadFile(
  folderId: string,
  fileName: string,
  contentType: string,
  bytes: ArrayBuffer,
): Promise<DriveResult<DriveFile>> {
  const token = await getToken();
  if (!token) return REAUTH;

  const boundary = `ab-${Math.abs(hashString(fileName + String(bytes.byteLength)))}`;
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });

  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${contentType || "application/octet-stream"}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);

  const body = new Uint8Array(head.length + bytes.byteLength + tail.length);
  body.set(head, 0);
  body.set(new Uint8Array(bytes), head.length);
  body.set(tail, head.length + bytes.byteLength);

  const result = await driveFetch(
    `${DRIVE_UPLOAD}?uploadType=multipart&fields=${FILE_FIELDS}`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (!result.ok) return result;

  const f = result.data as Record<string, unknown>;
  return {
    ok: true,
    data: {
      ...toDriveFile(f),
      name: String(f.name ?? fileName),
      mimeType: String(f.mimeType ?? contentType),
    },
  };
}

export interface DriveFileMeta {
  webViewLink: string | null;
  mimeType: string | null;
  modifiedTime: string | null;
  size: number | null;
}

/**
 * 라이브러리 문서 메타 조회 (표시이름은 DB 값을 쓰고, 나머지는 Drive에서).
 *
 * 예전에는 webViewLink만 받아왔다. 그래서 목록 화면이 "이 문서가 무슨 형식이고
 * 언제 개정됐는지"를 표시할 근거가 없었다 — 링크뿐이면 카드가 제목 한 줄로 접힌다.
 */
export async function getFileMetas(
  fileIds: string[],
): Promise<Record<string, DriveFileMeta>> {
  if (fileIds.length === 0) return {};
  const token = await getToken();
  if (!token) return {};

  const metas: Record<string, DriveFileMeta> = {};
  // Drive API는 여러 파일을 한 번에 조회하는 배치가 번거로워 개별 조회한다.
  // 라이브러리 문서는 보통 수십 건 규모라 이 정도로 충분하다.
  await Promise.all(
    fileIds.slice(0, 50).map(async (id) => {
      const result = await driveFetch(
        `${DRIVE_FILES}/${id}?fields=id,mimeType,webViewLink,modifiedTime,size`,
        token,
      );
      if (!result.ok) return;
      const f = result.data as {
        webViewLink?: string;
        mimeType?: string;
        modifiedTime?: string;
        size?: string;
      };
      metas[id] = {
        webViewLink: f.webViewLink ?? null,
        mimeType: f.mimeType ?? null,
        modifiedTime: f.modifiedTime ?? null,
        size: f.size ? Number(f.size) : null,
      };
    }),
  );
  return metas;
}

/**
 * Drive 공유링크에서 ID 추출 (스펙 5장)
 *   https://drive.google.com/drive/folders/{ID}
 *   https://drive.google.com/file/d/{ID}/view
 *   https://docs.google.com/document/d/{ID}/edit
 * 순수 ID를 그대로 붙여넣은 경우도 허용한다.
 */
export function extractDriveId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]{10,})/,
    /\/d\/([a-zA-Z0-9_-]{10,})/,
    /[?&]id=([a-zA-Z0-9_-]{10,})/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1];
  }

  // 링크가 아니라 ID만 넣은 경우
  if (/^[a-zA-Z0-9_-]{10,}$/.test(value)) return value;
  return null;
}

/** 폴더 아이콘 판별용 */
export function isFolder(file: DriveFile): boolean {
  return file.mimeType === FOLDER_MIME;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
