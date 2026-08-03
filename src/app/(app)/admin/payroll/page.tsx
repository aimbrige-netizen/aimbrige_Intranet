import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  getPayrollSlipDetail,
  getPayrollSlips,
  getPayrollTargets,
} from "@/features/ess/data";
import { requireSystemAdmin } from "@/lib/auth/session";
import { todayInSeoul } from "@/lib/utils";
import {
  PayrollAdmin,
  type AdminSlipInitialModel,
  type AdminSlipRowModel,
  type AdminTargetModel,
} from "./PayrollAdmin";

export const metadata: Metadata = { title: "급여 관리" };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 급여 관리 (13-ess.md /admin/payroll) — 시스템 관리자 전용.
 *
 * 이 프로젝트 최민감 화면이다. requireSystemAdmin()이 1차 방어선이고,
 * payroll_* RLS(본인 + system_admin만 — manager도 불가)가 2차다. 관리자가
 * 아니면 여기 도달 전에 리다이렉트되고, 설령 조회가 돌아도 RLS가 남의
 * 행을 돌려주지 않는다.
 *
 * 화면 상태는 전부 주소다 — ?employee= 로 대상 직원, ?slip= 으로 수정할
 * 명세. 서버가 그때그때 다시 조회해 폼 초기값까지 내려보낸다.
 */
export default async function AdminPayrollPage({
  searchParams,
}: {
  searchParams: { employee?: string; slip?: string };
}) {
  await requireSystemAdmin();

  const targets = await getPayrollTargets();

  const targetModels: AdminTargetModel[] = targets.map((target) => ({
    employeeId: target.employeeId,
    name: target.name,
    position: target.position,
    departmentName: target.departmentName,
    teamName: target.teamName,
    profile: target.profile
      ? {
          payType: target.profile.pay_type,
          annualSalary: target.profile.annual_salary,
          monthlySalary: target.profile.monthly_salary,
          fixedAllowance: target.profile.fixed_allowance,
          note: target.profile.note,
        }
      : null,
  }));

  const employeeParam = searchParams.employee ?? "";
  const selected = UUID_PATTERN.test(employeeParam)
    ? (targetModels.find((target) => target.employeeId === employeeParam) ?? null)
    : null;

  /* 선택한 직원의 명세 전부 — 월 단위 데이터라 연도 필터 없이도 작다 */
  const slips: AdminSlipRowModel[] = selected
    ? (await getPayrollSlips(selected.employeeId)).items.map((item) => ({
        id: item.id,
        payMonth: item.payMonth.slice(0, 7),
        payDate: item.payDate.slice(0, 10),
        grossTotal: item.grossTotal,
        deductionTotal: item.deductionTotal,
        netTotal: item.netTotal,
      }))
    : [];

  /* ?slip= 수정 모드 — 다른 직원의 명세 id가 실려 오면 조용히 무시한다 */
  let initialSlip: AdminSlipInitialModel | null = null;
  const slipParam = searchParams.slip ?? "";
  if (selected && UUID_PATTERN.test(slipParam)) {
    const detail = await getPayrollSlipDetail(slipParam);
    if (detail && detail.employeeId === selected.employeeId) {
      initialSlip = {
        slipId: detail.id,
        payMonth: detail.payMonth.slice(0, 7),
        payDate: detail.payDate.slice(0, 10),
        memo: detail.memo ?? "",
        items: detail.items.map((item) => ({
          kind: item.kind,
          name: item.name,
          amount: item.amount,
        })),
      };
    }
  }

  return (
    <>
      <PageHeader
        title="급여 관리"
        description="직원별 급여상세와 월 명세를 등록합니다. 급여 정보는 대상 본인과 시스템 관리자만 볼 수 있습니다."
        meta={<span>대상 {targetModels.length}명</span>}
      />
      <PayrollAdmin
        targets={targetModels}
        selected={selected}
        slips={slips}
        initialSlip={initialSlip}
        defaultMonth={todayInSeoul().slice(0, 7)}
      />
    </>
  );
}
