/**
 * 감사 로그 내보내기의 한 줄과 결과 모양.
 *
 * 클라이언트 버튼과 서버 액션이 함께 읽으므로 어느 쪽에도 두지 않는다
 * (버튼은 "use client", 액션은 "use server"라 서로를 import할 수 없다).
 */
export interface AuditExportRow {
  at: string;
  actor: string;
  actorEmail: string;
  action: string;
  target: string;
  detail: string;
}

/**
 * 빈 배열과 실패를 구분한다.
 * 감사 화면에서 빈 CSV는 "그 기간에 아무 일도 없었다"로 읽힌다 — 조회가
 * 실패한 것을 그렇게 말하면 안 된다(features/audit/data.ts의 errorMessage와 같은 태도).
 */
export type AuditExportResult =
  | { ok: true; rows: AuditExportRow[] }
  | { ok: false; message: string };
