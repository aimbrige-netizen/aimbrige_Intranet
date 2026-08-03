import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { getAllContracts, getPayrollTargets } from "@/features/ess/data";
import { requireSystemAdmin } from "@/lib/auth/session";
import {
  ContractAdmin,
  type AdminContractRowModel,
  type ContractEmployeeModel,
} from "./ContractAdmin";

export const metadata: Metadata = { title: "계약 관리" };

/**
 * 계약 관리 (13-ess.md /admin/contracts) — 시스템 관리자 전용.
 *
 * 등록(직원·제목·상태·파일 업로드) + 전사 목록·열람. 전자서명(모두싸인)
 * 연동 전까지는 서면 체결한 계약을 사후 등록하는 흐름이다.
 *
 * 직원 선택지는 급여 관리와 같은 축(getPayrollTargets — 퇴사자 제외 전
 * 직원)을 재사용한다. 계약도 재직·휴직자에게만 새로 등록한다.
 */
export default async function AdminContractsPage() {
  await requireSystemAdmin();

  const [targets, contracts] = await Promise.all([
    getPayrollTargets(),
    getAllContracts(),
  ]);

  const employees: ContractEmployeeModel[] = targets.map((target) => ({
    employeeId: target.employeeId,
    name: target.name,
    position: target.position,
    departmentName: target.departmentName,
  }));

  const rows: AdminContractRowModel[] = contracts.map((row) => ({
    id: row.id,
    /* 퇴사자 정리로 FK가 비어도 이름 자리를 비워두지 않는다 */
    employeeName: row.employeeName ?? "(퇴사자)",
    title: row.title,
    status: row.status,
    signedAt: row.signedAt ? row.signedAt.slice(0, 10) : null,
    hasFile: row.hasFile,
    createdAt: row.createdAt.slice(0, 10),
  }));

  return (
    <>
      <PageHeader
        title="계약 관리"
        description="임직원 근로계약을 등록하고 파일을 관리합니다. 파일은 대상 본인과 시스템 관리자만 열람합니다."
        meta={<span>전체 {rows.length}건</span>}
      />
      <ContractAdmin employees={employees} rows={rows} />
    </>
  );
}
