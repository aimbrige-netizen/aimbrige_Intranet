"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SectionHeader } from "@/components/ui/Card";
import { EmptyState, TableEmptyRow } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Field";
import { formatWon } from "@/features/approvals/format";

/**
 * 내 급여 (13-ess.md #payroll/my-pay).
 *
 * 상단 "급여상세"(급여유형·연봉·월급·고정수당 — 인사카드와 같은 라벨-값
 * 그리드 축) + "급여명세서"(연도 조회 + 표 + 하단 합계 행). 표 문법은
 * 07-modules.md 그대로 — th 아래 굵은 선 하나, 행 구분선 없음, 금액은
 * tabular-nums 우측 정렬.
 *
 * 데이터는 페이지가 어댑트해서 넘긴다(뷰모델 규약 — MailRead와 같은 구조).
 * 급여는 최민감 데이터라 이 컴포넌트는 항상 "본인 것"만 받는다 — 남의
 * employeeId로 조회해도 RLS가 빈 결과를 돌려주므로 여기 방어 분기는 없다.
 */

export const PAY_TYPE_LABELS: Record<"annual" | "monthly", string> = {
  annual: "연봉제",
  monthly: "월급제",
};

export interface PayrollProfileModel {
  payType: "annual" | "monthly";
  annualSalary: number | null;
  monthlySalary: number | null;
  fixedAllowance: number;
  note: string | null;
}

export interface PayrollSlipRowModel {
  id: string;
  /** YYYY-MM (표시 그대로) */
  payMonth: string;
  /** YYYY-MM-DD */
  payDate: string;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
}

/** 하단 합계 행 (13-ess.md 급여명세서 표) */
export interface PayrollTotalsModel {
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  count: number;
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-7 max-w-[270px] items-center gap-3">
      <dt className="w-[72px] shrink-0 text-body font-medium text-ink-sub">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-body tabular-nums text-ink">
        {value}
      </dd>
    </div>
  );
}

/** 급여상세 섹션 본문 — 없으면 빈 상태 문구(스펙 문구 그대로) */
function ProfileSection({ profile }: { profile: PayrollProfileModel | null }) {
  if (!profile) {
    return (
      <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
        <EmptyState
          icon={Wallet}
          title="급여 정보가 아직 등록되지 않았습니다"
          description="시스템 관리자가 급여상세를 등록하면 여기에 표시됩니다."
          compact
        />
      </div>
    );
  }

  const fields: { label: string; value: string }[] = [
    { label: "급여유형", value: PAY_TYPE_LABELS[profile.payType] },
    {
      label: "연봉",
      value: profile.annualSalary != null ? formatWon(profile.annualSalary) : "-",
    },
    {
      label: "월급",
      value:
        profile.monthlySalary != null ? formatWon(profile.monthlySalary) : "-",
    },
    { label: "고정수당", value: formatWon(profile.fixedAllowance) },
  ];

  return (
    <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
      <dl className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-4">
        {fields.map((field) => (
          <ProfileRow key={field.label} label={field.label} value={field.value} />
        ))}
      </dl>
      {profile.note ? (
        <p className="mt-2 text-caption">{profile.note}</p>
      ) : null}
    </div>
  );
}

const AMOUNT_TD = "whitespace-nowrap text-right text-body-sm tabular-nums";

/*
 * 인쇄(13-ess.md "급(상)여명세서" 섹션: 기간 조회 + 인쇄 + 표)는 명세서
 * 섹션만 남긴다 — PaySlipDetail과 같은 visibility 트릭(컴포넌트 스코프
 * print CSS, globals 수정 없음). 연도 Select·인쇄 버튼 같은 조작부는
 * 종이에서 무의미하므로 함께 감춘다.
 */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  .payroll-print-area, .payroll-print-area * { visibility: visible; }
  .payroll-print-area .payroll-print-hide,
  .payroll-print-area .payroll-print-hide * { visibility: hidden; }
  .payroll-print-area {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    margin: 0;
  }
}
`;

export function PayrollView({
  profile,
  rows,
  totals,
  year,
  years,
}: {
  profile: PayrollProfileModel | null;
  rows: PayrollSlipRowModel[];
  totals: PayrollTotalsModel;
  year: number;
  years: number[];
}) {
  const router = useRouter();

  return (
    <div className="space-y-5">
      <section>
        <SectionHeader
          title="급여상세"
          description="급여유형과 계약 금액입니다. 변경은 시스템 관리자만 할 수 있습니다."
        />
        <ProfileSection profile={profile} />
      </section>

      <section className="payroll-print-area">
        <style>{PRINT_CSS}</style>
        <SectionHeader
          title="급여명세서"
          description={`${year}년 · ${totals.count}건`}
          action={
            <div className="payroll-print-hide flex items-center gap-2">
              <Select
                aria-label="조회 연도"
                value={String(year)}
                onChange={(e) => router.push(`/payroll?year=${e.target.value}`)}
                className="h-9 w-28 py-1.5"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </Select>
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer className="size-4" aria-hidden />
                인쇄
              </Button>
            </div>
          }
        />

        <div className="ab-card overflow-hidden md:rounded-none md:border-0">
          <div className="overflow-x-auto">
            <table className="ab-table min-w-[640px]">
              <thead>
                <tr>
                  <th>급여월</th>
                  <th>지급일</th>
                  <th className="text-right">지급합계</th>
                  <th className="text-right">공제합계</th>
                  <th className="text-right">공제 후 지급액</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <TableEmptyRow
                    colSpan={5}
                    icon={Wallet}
                    title={`${year}년에 등록된 급여명세서가 없습니다`}
                    description="명세가 등록되면 급여월별로 여기에 쌓입니다."
                  />
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => router.push(`/payroll/${row.id}`)}
                      className="cursor-pointer"
                    >
                      <td className="whitespace-nowrap">
                        {/* 행 전체가 클릭 대상이지만, 키보드 접근은 이 링크가 맡는다 */}
                        <Link
                          href={`/payroll/${row.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-body-sm font-medium tabular-nums text-ink hover:underline"
                        >
                          {row.payMonth}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap text-label tabular-nums text-muted">
                        {row.payDate}
                      </td>
                      <td className={`${AMOUNT_TD} text-ink`}>
                        {formatWon(row.grossTotal)}
                      </td>
                      <td className={`${AMOUNT_TD} text-muted`}>
                        {formatWon(row.deductionTotal)}
                      </td>
                      <td className={`${AMOUNT_TD} font-medium text-ink`}>
                        {formatWon(row.netTotal)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {rows.length > 0 ? (
                <tfoot>
                  {/* 하단 합계 행 — 머리처럼 굵은 선으로 몸과 가른다 */}
                  <tr className="border-t border-ink-sub">
                    <td
                      colSpan={2}
                      className="px-4 py-2 text-body-sm font-bold text-ink-sub"
                    >
                      합계 ({totals.count}건)
                    </td>
                    <td className={`px-4 py-2 font-bold text-ink ${AMOUNT_TD}`}>
                      {formatWon(totals.grossTotal)}
                    </td>
                    <td className={`px-4 py-2 font-bold text-ink-sub ${AMOUNT_TD}`}>
                      {formatWon(totals.deductionTotal)}
                    </td>
                    <td className={`px-4 py-2 font-bold text-ink ${AMOUNT_TD}`}>
                      {formatWon(totals.netTotal)}
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
