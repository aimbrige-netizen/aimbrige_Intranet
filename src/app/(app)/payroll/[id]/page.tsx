import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  PaySlipDetail,
  type PaySlipDetailModel,
} from "@/features/ess/PaySlipDetail";
import { getPayrollSlipDetail } from "@/features/ess/data";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "급여명세서" };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "2026-07-01" → "2026년 7월" */
function monthLabelOf(payMonth: string): string {
  const year = payMonth.slice(0, 4);
  const month = Number(payMonth.slice(5, 7));
  return `${year}년 ${month}월`;
}

/**
 * 급여명세 상세 (13-ess.md — 명세 행 클릭).
 *
 * 남의 명세 id를 들고 와도 RLS(본인 + system_admin만)가 행을 돌려주지
 * 않으므로 "없음"과 "권한 없음"은 같은 화면이다 — 존재 여부 자체가
 * 급여 정보라 둘을 구분해서 말해 주지 않는다.
 */
export default async function PaySlipPage({
  params,
}: {
  params: { id: string };
}) {
  await requireSessionEmployee();

  const detail = UUID_PATTERN.test(params.id)
    ? await getPayrollSlipDetail(params.id)
    : null;

  if (!detail) {
    return (
      <>
        <PageHeader
          title="급여명세서"
          backHref="/payroll"
          backLabel="급여명세서 목록으로"
        />
        <div className="ab-card p-4">
          <EmptyState
            icon={Wallet}
            title="명세를 찾을 수 없습니다"
            description="삭제됐거나 열람 권한이 없는 명세입니다."
            cta={{ label: "급여명세서 목록으로", href: "/payroll" }}
          />
        </div>
      </>
    );
  }

  const model: PaySlipDetailModel = {
    id: detail.id,
    employeeName: detail.employeeName ?? "(퇴사자)",
    departmentName: detail.departmentName,
    position: detail.position,
    monthLabel: monthLabelOf(detail.payMonth),
    payDate: detail.payDate.slice(0, 10),
    grossTotal: detail.grossTotal,
    deductionTotal: detail.deductionTotal,
    netTotal: detail.netTotal,
    memo: detail.memo,
    payments: detail.items
      .filter((item) => item.kind === "payment")
      .map((item) => ({ id: item.id, name: item.name, amount: item.amount })),
    deductions: detail.items
      .filter((item) => item.kind === "deduction")
      .map((item) => ({ id: item.id, name: item.name, amount: item.amount })),
  };

  return <PaySlipDetail slip={model} />;
}
