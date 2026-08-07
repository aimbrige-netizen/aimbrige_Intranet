"use client";

import Link from "next/link";
import { ChevronLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatWon } from "@/features/approvals/format";

/**
 * 급여명세 상세 (13-ess.md — 명세 행 클릭 시).
 *
 * 사원명·부서·급여월·지급일 + 지급/공제 항목 2열 나열 + 합계 3종.
 * 인쇄는 window.print 하나로 간다 — 명세 영역 밖(셸·헤더)을 감추는
 * print CSS를 이 컴포넌트가 직접 들고 다닌다(globals 수정 없이 컴포넌트
 * 스코프, 작업 결정). visibility 트릭이라 셸 마크업이 바뀌어도 깨지지 않는다.
 *
 * 관리자도 이 화면을 그대로 쓴다(/admin/payroll 목록의 "보기") — 급여
 * 데이터 접근은 RLS(본인 + system_admin)가 이미 판정한 뒤다.
 */

export interface PaySlipItemModel {
  id: string;
  name: string;
  amount: number;
}

export interface PaySlipDetailModel {
  id: string;
  employeeName: string;
  departmentName: string | null;
  position: string | null;
  /** "2026년 7월" */
  monthLabel: string;
  /** YYYY-MM-DD */
  payDate: string;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  memo: string | null;
  payments: PaySlipItemModel[];
  deductions: PaySlipItemModel[];
}

/*
 * 인쇄 시 명세 카드만 남긴다. display:none 대신 visibility를 쓰는 이유 —
 * 조상까지 전부 숨겨야 하는데 display:none은 자손을 되살릴 방법이 없다.
 * 숨긴 셸이 차지하던 자리를 지우려고 명세 영역을 좌상단으로 끌어올린다.
 */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  .payslip-print-area, .payslip-print-area * { visibility: visible; }
  .payslip-print-area {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    margin: 0;
    border: 0;
    border-radius: 0;
  }
}
`;

/** 지급 또는 공제 한 열 — 항목 나열 + 열 합계 */
function ItemColumn({
  title,
  items,
  total,
}: {
  title: string;
  items: PaySlipItemModel[];
  total: number;
}) {
  return (
    <div>
      <h3 className="border-b border-ink-sub pb-1.5 text-body font-semibold text-ink-sub">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="py-2.5 text-label text-faint">항목 없음</p>
      ) : (
        <dl>
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 py-1.5"
            >
              <dt className="min-w-0 truncate text-body-sm text-ink">
                {item.name}
              </dt>
              <dd className="shrink-0 text-body-sm tabular-nums text-ink">
                {formatWon(item.amount)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-line pt-1.5">
        <span className="text-body-sm font-bold text-ink-sub">{title} 합계</span>
        <span className="text-body-sm font-bold tabular-nums text-ink">
          {formatWon(total)}
        </span>
      </div>
    </div>
  );
}

export function PaySlipDetail({ slip }: { slip: PaySlipDetailModel }) {
  const belong = [slip.departmentName, slip.position]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <style>{PRINT_CSS}</style>

      {/* 콘텐츠 제목 20/500 — PageHeader급 밴드 없음(13 ESS는 gw 콘텐츠 문법) */}
      <div className="mb-5">
        <Link
          href="/payroll"
          className="mb-2 inline-flex items-center gap-1 text-label text-muted transition-colors duration-fast ease-standard hover:text-ink"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          급여명세서 목록으로
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-title-l text-ink">
              급여명세서
            </h1>
            <p className="mt-1 text-caption">
              {slip.monthLabel} 명세입니다. 급여 정보는 본인과 시스템
              관리자만 볼 수 있습니다.
            </p>
          </div>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden />
            인쇄
          </Button>
        </div>
      </div>

      <div className="payslip-print-area ab-card p-5">
        {/* 인쇄물에는 셸 헤더가 없으므로 제목을 명세 안에서 한 번 더 세운다 */}
        <header className="border-b border-ink-sub pb-3">
          <h2 className="text-body font-semibold text-ink">
            급여명세서 — {slip.monthLabel}
          </h2>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-body-sm">
            <div className="flex gap-2">
              <dt className="font-medium text-ink-sub">사원명</dt>
              <dd className="text-ink">
                {slip.employeeName}
                {belong ? (
                  <span className="ml-1.5 text-nano text-muted">{belong}</span>
                ) : null}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-ink-sub">지급일</dt>
              <dd className="tabular-nums text-ink">{slip.payDate}</dd>
            </div>
          </dl>
        </header>

        {/* 지급/공제 2열 나열 (13-ess.md 상세) */}
        <div className="mt-4 grid grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-2">
          <ItemColumn
            title="지급항목"
            items={slip.payments}
            total={slip.grossTotal}
          />
          <ItemColumn
            title="공제항목"
            items={slip.deductions}
            total={slip.deductionTotal}
          />
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-card bg-subtle px-4 py-3">
          <span className="text-body font-semibold text-ink-sub">
            공제 후 지급액
          </span>
          <span className="text-body font-semibold tabular-nums text-ink">
            {formatWon(slip.netTotal)}
          </span>
        </div>

        {slip.memo ? <p className="mt-3 text-caption">{slip.memo}</p> : null}
      </div>
    </>
  );
}
