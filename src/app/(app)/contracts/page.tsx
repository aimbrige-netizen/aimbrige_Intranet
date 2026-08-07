import type { Metadata } from "next";
import {
  ContractList,
  type ContractRowModel,
} from "@/features/ess/ContractList";
import { getMyContracts } from "@/features/ess/data";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "계약" };

/**
 * 내 계약서 (13-ess.md #econtract).
 *
 * 목록·열람만 동작한다 — 전자서명(모두싸인) 연동은 대기. 파일 경로는
 * 뷰모델에 싣지 않고(hasFile만), 열람 시점에 서버 액션이 서명 URL을 발급한다.
 */
export default async function ContractsPage() {
  const me = await requireSessionEmployee();

  const contracts = await getMyContracts(me.id);

  const rows: ContractRowModel[] = contracts.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    signedAt: row.signedAt ? row.signedAt.slice(0, 10) : null,
    hasFile: row.hasFile,
  }));

  return (
    <>
      {/* 콘텐츠 제목 20/500 — PageHeader급 밴드 없음(13 ESS는 gw 콘텐츠 문법) */}
      <div className="mb-5">
        <h1 className="text-title-l text-ink">
          내 계약서
        </h1>
        <p className="mt-1 text-caption">
          내 근로계약서를 확인하고 파일을 열람합니다.
        </p>
        <p className="mt-1.5 text-label text-muted">{rows.length}건</p>
      </div>
      <ContractList rows={rows} />
    </>
  );
}
