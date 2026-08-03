import "server-only";

import {
  getMyCertificateRequests as getMyCertificateRequestItems,
  getMyContracts as getMyContractItems,
} from "@/features/ess/data";
import type { ContractStatus } from "@/types/db";
import type { CertRequestRow } from "@/features/ess/CertRequests";

/**
 * 인사(ESS) 조회 어댑터 — 13-ess.md 인사 절.
 *
 * 실제 조회는 담당 A의 features/ess/data.ts가 한다(마이그레이션 30의
 * 컬럼명 cert_type·reject_reason·requested_at·file_path 기준). 이 파일은
 * 그 뷰모델을 인사 화면(CertRequests·인사카드 계약 탭)의 행 모양으로만
 * 바꾼다 — 봉합 전의 자체 select(kind·rejection_reason·created_at·file_url)는
 * 존재하지 않는 컬럼이라 매 호출 42703으로 죽었다.
 *
 * 실패 규약도 A를 따른다(소프트 실패 — mail/data.ts와 같은 리듬):
 * 조회가 실패하면 console.error만 남기고 빈 배열이 온다.
 */

/** 내 증명서 신청 목록 (/hr?tab=certificates) */
export async function getMyCertificateRequests(
  employeeId: string,
): Promise<CertRequestRow[]> {
  const items = await getMyCertificateRequestItems(employeeId);
  return items.map((item) => ({
    id: item.id,
    kind: item.certType,
    purpose: item.purpose,
    status: item.status,
    rejection_reason: item.rejectReason,
    created_at: item.requestedAt,
    processed_at: item.processedAt,
  }));
}

/* ── 계약 탭 (담당 A 조회 위임) ──────────────────────────────────── */

export interface MyContractItem {
  id: string;
  title: string;
  status: ContractStatus;
  /** 체결일. 작성중이면 null */
  signed_at: string | null;
  /** 파일 유무만 탭에서 쓴다 — 열람은 계약 모듈(/contracts)이 담당 */
  hasFile: boolean;
}

/** 내 계약 (인사카드 '계약' 탭 — 13-ess.md "계약↔A의 조회") */
export async function getMyContracts(
  employeeId: string,
): Promise<MyContractItem[]> {
  const items = await getMyContractItems(employeeId);
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    signed_at: item.signedAt,
    hasFile: item.hasFile,
  }));
}

/** 카드 필드 그리드·기본 탭이 쓰는 라벨 — 상태값과 함께 여기 모아둔다 */
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "작성중",
  signed: "서명완료",
  expired: "만료",
};

export type { ContractStatus };
