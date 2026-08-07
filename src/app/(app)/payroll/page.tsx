import type { Metadata } from "next";
import {
  PayrollView,
  type PayrollProfileModel,
  type PayrollSlipRowModel,
} from "@/features/ess/PayrollView";
import { getMyPayrollProfile, getPayrollSlips } from "@/features/ess/data";
import { requireSessionEmployee } from "@/lib/auth/session";
import { todayInSeoul } from "@/lib/utils";

export const metadata: Metadata = { title: "급여" };

/**
 * 내 급여 (13-ess.md #payroll/my-pay).
 *
 * 연도 조회는 ?year= 하나로 간다 — 명세가 월 단위라 연 1회 조회 축이면
 * 충분하고, 주소가 곧 상태라 공유·새로고침에 강하다. 조회 범위는
 * getPayrollSlips의 fromMonth/toMonth로 좁힌다.
 *
 * 여기서 넘기는 employeeId는 항상 세션 본인이다. 급여는 최민감 데이터 —
 * 어차피 RLS(본인 + system_admin만)가 행 단위로 거르지만, 애초에 남의
 * id가 이 화면에 들어올 경로를 만들지 않는다.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: { year?: string };
}) {
  const me = await requireSessionEmployee();

  const thisYear = Number(todayInSeoul().slice(0, 4));
  const parsedYear = Number(searchParams.year);
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
      ? parsedYear
      : thisYear;

  const [profile, slipList] = await Promise.all([
    getMyPayrollProfile(me.id),
    getPayrollSlips(me.id, {
      fromMonth: `${year}-01`,
      toMonth: `${year}-12`,
    }),
  ]);

  const profileModel: PayrollProfileModel | null = profile
    ? {
        payType: profile.pay_type,
        annualSalary: profile.annual_salary,
        monthlySalary: profile.monthly_salary,
        fixedAllowance: profile.fixed_allowance,
        note: profile.note,
      }
    : null;

  const rows: PayrollSlipRowModel[] = slipList.items.map((item) => ({
    id: item.id,
    payMonth: item.payMonth.slice(0, 7),
    payDate: item.payDate.slice(0, 10),
    grossTotal: item.grossTotal,
    deductionTotal: item.deductionTotal,
    netTotal: item.netTotal,
  }));

  /* 연도 선택지: 입사 연도부터 올해까지. 주소로 들어온 예외 연도도 살린다 */
  const hireYear = Number((me.hire_date ?? "").slice(0, 4));
  const firstYear =
    Number.isInteger(hireYear) && hireYear >= 2000 && hireYear <= thisYear
      ? hireYear
      : thisYear;
  const years: number[] = [];
  for (let y = thisYear; y >= firstYear; y -= 1) years.push(y);
  if (!years.includes(year)) {
    years.push(year);
    years.sort((a, b) => b - a);
  }

  return (
    <>
      {/* 콘텐츠 제목 20/500 — PageHeader급 밴드 없음(13 ESS는 gw 콘텐츠 문법) */}
      <div className="mb-5">
        <h1 className="text-title-l text-ink">
          내 급여
        </h1>
        <p className="mt-1 text-caption">
          급여상세와 월별 급여명세서입니다. 급여 정보는 본인과 시스템
          관리자만 볼 수 있습니다.
        </p>
      </div>
      <PayrollView
        profile={profileModel}
        rows={rows}
        totals={slipList.totals}
        year={year}
        years={years}
      />
    </>
  );
}
