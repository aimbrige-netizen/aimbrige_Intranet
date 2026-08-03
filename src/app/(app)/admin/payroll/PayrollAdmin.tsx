"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { SectionHeader } from "@/components/ui/Card";
import { EmptyState, TableEmptyRow } from "@/components/ui/EmptyState";
import { Field, Input, Select } from "@/components/ui/Field";
import { formatWon } from "@/features/approvals/format";
import {
  deletePayrollSlip,
  savePayrollProfile,
  savePayrollSlip,
} from "@/server/actions/ess";

/**
 * 급여 관리 화면 본문 (13-ess.md /admin/payroll) — system_admin 전용 화면의
 * 클라이언트 절반. 페이지(서버)가 requireSystemAdmin()으로 1차, RLS가 2차로
 * 막은 뒤의 화면이라 여기서는 권한 분기가 없다.
 *
 * 직원 선택은 ?employee= 주소가 상태다 — 서버가 그 직원의 급여상세·명세
 * 목록을 다시 조회해 내려보낸다. 명세 수정은 ?slip= 이 겹으로 실려
 * 초기값(항목 포함)이 폼에 들어온다. 합계 3종은 입력 중에는 화면 계산으로
 * 보여 주고, 저장값은 DB 재계산 트리거가 만든다 — 화면 숫자는 미리보기지
 * 진실이 아니다.
 */

export interface AdminProfileModel {
  payType: "annual" | "monthly";
  annualSalary: number | null;
  monthlySalary: number | null;
  fixedAllowance: number;
  note: string | null;
}

export interface AdminTargetModel {
  employeeId: string;
  name: string;
  position: string | null;
  departmentName: string | null;
  teamName: string | null;
  profile: AdminProfileModel | null;
}

export interface AdminSlipRowModel {
  id: string;
  /** YYYY-MM */
  payMonth: string;
  /** YYYY-MM-DD */
  payDate: string;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
}

export interface AdminSlipItemModel {
  kind: "payment" | "deduction";
  name: string;
  amount: number;
}

/** ?slip= 로 수정에 들어올 때의 폼 초기값 */
export interface AdminSlipInitialModel {
  slipId: string;
  /** YYYY-MM */
  payMonth: string;
  /** YYYY-MM-DD */
  payDate: string;
  memo: string;
  items: AdminSlipItemModel[];
}

/** "1,234,000" → 1234000. 빈 값 null, 숫자 아님 NaN */
function parseAmount(value: string): number | null {
  const digits = value.replaceAll(",", "").trim();
  if (!digits) return null;
  if (!/^\d{1,13}$/.test(digits)) return Number.NaN;
  return Number(digits);
}

function targetLabel(target: AdminTargetModel): string {
  const belong = [target.departmentName, target.teamName, target.position]
    .filter(Boolean)
    .join(" · ");
  const suffix = target.profile ? "" : " — 급여상세 미등록";
  return belong ? `${target.name} (${belong})${suffix}` : `${target.name}${suffix}`;
}

/* ── 급여상세(프로필) 입력 ───────────────────────────────────────── */

function ProfileForm({ target }: { target: AdminTargetModel }) {
  const router = useRouter();
  const profile = target.profile;

  const [payType, setPayType] = useState<"annual" | "monthly">(
    profile?.payType ?? "annual",
  );
  const [annualSalary, setAnnualSalary] = useState(
    profile?.annualSalary != null ? String(profile.annualSalary) : "",
  );
  const [monthlySalary, setMonthlySalary] = useState(
    profile?.monthlySalary != null ? String(profile.monthlySalary) : "",
  );
  const [fixedAllowance, setFixedAllowance] = useState(
    profile ? String(profile.fixedAllowance) : "0",
  );
  const [note, setNote] = useState(profile?.note ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setSuccess(null);

      const local: Record<string, string> = {};
      const annual = parseAmount(annualSalary);
      const monthly = parseAmount(monthlySalary);
      const fixed = parseAmount(fixedAllowance);
      if (Number.isNaN(annual)) local.annualSalary = "숫자만 입력하세요.";
      if (Number.isNaN(monthly)) local.monthlySalary = "숫자만 입력하세요.";
      if (Number.isNaN(fixed)) local.fixedAllowance = "숫자만 입력하세요.";
      if (Object.keys(local).length > 0) {
        setErrors(local);
        setMessage(null);
        return;
      }

      const result = await savePayrollProfile({
        employeeId: target.employeeId,
        payType,
        annualSalary: annual,
        monthlySalary: monthly,
        fixedAllowance: fixed ?? 0,
        note: note.trim() || undefined,
      });

      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message ?? null);
        return;
      }
      setErrors({});
      setMessage(null);
      setSuccess("급여상세를 저장했습니다.");
      router.refresh();
    });

  return (
    <section>
      <SectionHeader
        title="급여상세"
        description={`${target.name}의 급여유형과 계약 금액 — /payroll 상단 "급여상세" 섹션에 그대로 보입니다.`}
      />
      <div className="ab-card space-y-3 p-4">
        {message ? (
          <Callout tone="warn" title="저장하지 못했습니다">
            {message}
          </Callout>
        ) : null}
        {success ? (
          <p className="text-label text-success-ink">{success}</p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="급여유형" required htmlFor="pp-pay-type">
            <Select
              id="pp-pay-type"
              value={payType}
              onChange={(e) =>
                setPayType(e.target.value === "monthly" ? "monthly" : "annual")
              }
            >
              <option value="annual">연봉제</option>
              <option value="monthly">월급제</option>
            </Select>
          </Field>

          <Field
            label="연봉 (원)"
            required={payType === "annual"}
            htmlFor="pp-annual"
            error={errors.annualSalary}
          >
            <Input
              id="pp-annual"
              inputMode="numeric"
              value={annualSalary}
              onChange={(e) => setAnnualSalary(e.target.value)}
              placeholder="예) 48000000"
              invalid={Boolean(errors.annualSalary)}
              className="text-right tabular-nums"
            />
          </Field>

          <Field
            label="월급 (원)"
            required={payType === "monthly"}
            htmlFor="pp-monthly"
            error={errors.monthlySalary}
          >
            <Input
              id="pp-monthly"
              inputMode="numeric"
              value={monthlySalary}
              onChange={(e) => setMonthlySalary(e.target.value)}
              placeholder="예) 4000000"
              invalid={Boolean(errors.monthlySalary)}
              className="text-right tabular-nums"
            />
          </Field>

          <Field
            label="고정수당 (원)"
            htmlFor="pp-fixed"
            error={errors.fixedAllowance}
          >
            <Input
              id="pp-fixed"
              inputMode="numeric"
              value={fixedAllowance}
              onChange={(e) => setFixedAllowance(e.target.value)}
              invalid={Boolean(errors.fixedAllowance)}
              className="text-right tabular-nums"
            />
          </Field>
        </div>

        <Field label="비고" htmlFor="pp-note" error={errors.note}>
          <Input
            id="pp-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예) 2026-01 연봉 조정 반영"
          />
        </Field>

        <div className="flex justify-end">
          <Button disabled={pending} onClick={submit}>
            급여상세 저장
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ── 월 명세 등록/수정 — 지급/공제 동적 행 + 합계 미리보기 ───────── */

interface ItemDraft {
  key: number;
  kind: "payment" | "deduction";
  name: string;
  amount: string;
}

let draftKey = 0;
function nextKey(): number {
  draftKey += 1;
  return draftKey;
}

function draftsOf(initial: AdminSlipInitialModel | null): ItemDraft[] {
  if (initial && initial.items.length > 0) {
    return initial.items.map((item) => ({
      key: nextKey(),
      kind: item.kind,
      name: item.name,
      amount: String(item.amount),
    }));
  }
  return [{ key: nextKey(), kind: "payment", name: "기본급", amount: "" }];
}

function SlipForm({
  target,
  initial,
  defaultMonth,
}: {
  target: AdminTargetModel;
  initial: AdminSlipInitialModel | null;
  defaultMonth: string;
}) {
  const router = useRouter();

  const [payMonth, setPayMonth] = useState(initial?.payMonth ?? defaultMonth);
  const [payDate, setPayDate] = useState(initial?.payDate ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [items, setItems] = useState<ItemDraft[]>(() => draftsOf(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [itemError, setItemError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /* 합계 미리보기 — 저장값은 DB 재계산 트리거가 만든다 */
  const totals = useMemo(() => {
    let gross = 0;
    let deduction = 0;
    for (const item of items) {
      const amount = parseAmount(item.amount);
      if (amount == null || Number.isNaN(amount)) continue;
      if (item.kind === "payment") gross += amount;
      else deduction += amount;
    }
    return { gross, deduction, net: gross - deduction };
  }, [items]);

  const patchItem = (key: number, patch: Partial<ItemDraft>) =>
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );

  const addItem = (kind: "payment" | "deduction") =>
    setItems((prev) => [
      ...prev,
      { key: nextKey(), kind, name: "", amount: "" },
    ]);

  const removeItem = (key: number) =>
    setItems((prev) => prev.filter((item) => item.key !== key));

  const submit = () =>
    startTransition(async () => {
      setSuccess(null);

      const local: Record<string, string> = {};
      if (!/^\d{4}-\d{2}$/.test(payMonth)) {
        local.payMonth = "급여월을 선택하세요.";
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) {
        local.payDate = "지급일을 선택하세요.";
      }

      const payload: { kind: "payment" | "deduction"; name: string; amount: number; sort: number }[] =
        [];
      let badRow: number | null = null;
      items.forEach((item, index) => {
        const name = item.name.trim();
        const amount = parseAmount(item.amount);
        if (!name || amount == null || Number.isNaN(amount)) {
          if (badRow == null) badRow = index + 1;
          return;
        }
        payload.push({ kind: item.kind, name, amount, sort: index + 1 });
      });

      if (badRow != null) {
        setItemError(`${badRow}번째 항목의 이름과 금액을 확인하세요.`);
      } else if (payload.length === 0) {
        setItemError("지급·공제 항목을 1건 이상 입력하세요.");
      } else {
        setItemError(null);
      }

      if (Object.keys(local).length > 0 || badRow != null || payload.length === 0) {
        setErrors(local);
        setMessage(null);
        return;
      }

      const result = await savePayrollSlip({
        employeeId: target.employeeId,
        payMonth,
        payDate,
        memo: memo.trim() || undefined,
        items: payload,
      });

      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setItemError(result.fieldErrors?.items ?? null);
        setMessage(result.message ?? null);
        return;
      }

      setErrors({});
      setItemError(null);
      setMessage(null);

      if (initial) {
        // 수정 저장 — 주소의 ?slip= 을 걷어 새 등록 모드로 돌아간다
        router.push(`/admin/payroll?employee=${target.employeeId}`);
      } else {
        setSuccess("명세를 저장했습니다. 같은 급여월을 다시 저장하면 항목이 통째로 교체됩니다.");
      }
      router.refresh();
    });

  return (
    <section>
      <SectionHeader
        title={initial ? `명세 수정 — ${initial.payMonth}` : "월 명세 등록"}
        description="같은 직원·같은 급여월은 덮어쓰기(항목 전체 교체)입니다. 합계는 항목에서 자동 계산됩니다."
        action={
          initial ? (
            <Link
              href={`/admin/payroll?employee=${target.employeeId}`}
              className="text-label text-muted hover:text-ink hover:underline"
            >
              새 등록으로 전환
            </Link>
          ) : null
        }
      />

      <div className="ab-card space-y-4 p-4">
        {message ? (
          <Callout tone="warn" title="저장하지 못했습니다">
            {message}
          </Callout>
        ) : null}
        {success ? (
          <p className="text-label text-success-ink">{success}</p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="급여월" required htmlFor="slip-month" error={errors.payMonth}>
            <Input
              id="slip-month"
              type="month"
              value={payMonth}
              onChange={(e) => setPayMonth(e.target.value)}
              invalid={Boolean(errors.payMonth)}
            />
          </Field>
          <Field label="지급일" required htmlFor="slip-date" error={errors.payDate}>
            <Input
              id="slip-date"
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              invalid={Boolean(errors.payDate)}
            />
          </Field>
          <Field label="메모" htmlFor="slip-memo" error={errors.memo}>
            <Input
              id="slip-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="명세 상세에 함께 보입니다"
            />
          </Field>
        </div>

        <div>
          <p className="mb-1.5 text-label font-bold text-ink">지급·공제 항목</p>
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.key}
                className="grid grid-cols-[96px_minmax(0,1fr)_140px_32px] items-center gap-2"
              >
                <Select
                  aria-label="항목 종류"
                  value={item.kind}
                  onChange={(e) =>
                    patchItem(item.key, {
                      kind: e.target.value === "deduction" ? "deduction" : "payment",
                    })
                  }
                  className="py-1.5"
                >
                  <option value="payment">지급</option>
                  <option value="deduction">공제</option>
                </Select>
                <Input
                  aria-label="항목명"
                  value={item.name}
                  onChange={(e) => patchItem(item.key, { name: e.target.value })}
                  placeholder={item.kind === "payment" ? "예) 기본급" : "예) 국민연금"}
                  className="py-1.5"
                />
                <Input
                  aria-label="금액(원)"
                  inputMode="numeric"
                  value={item.amount}
                  onChange={(e) => patchItem(item.key, { amount: e.target.value })}
                  placeholder="0"
                  className="py-1.5 text-right tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => removeItem(item.key)}
                  disabled={items.length === 1}
                  aria-label="항목 삭제"
                  className="rounded-sm p-1.5 text-muted transition-colors hover:bg-danger-light hover:text-danger disabled:opacity-40"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          {itemError ? (
            <p className="mt-1.5 text-label text-danger">{itemError}</p>
          ) : null}

          <div className="mt-2 flex gap-2">
            <Button size="small" variant="secondary" onClick={() => addItem("payment")}>
              <Plus className="size-3.5" aria-hidden />
              지급 항목
            </Button>
            <Button size="small" variant="secondary" onClick={() => addItem("deduction")}>
              <Plus className="size-3.5" aria-hidden />
              공제 항목
            </Button>
          </div>
        </div>

        {/* 합계 자동 표시 (작업 결정) — 명세서 표와 같은 3종 축 */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-subtle px-4 py-3">
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-body-sm">
            <div className="flex gap-2">
              <dt className="font-medium text-ink-sub">지급합계</dt>
              <dd className="tabular-nums text-ink">{formatWon(totals.gross)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-ink-sub">공제합계</dt>
              <dd className="tabular-nums text-ink">{formatWon(totals.deduction)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-ink-sub">공제 후 지급액</dt>
              <dd className="font-semibold tabular-nums text-ink">
                {formatWon(totals.net)}
              </dd>
            </div>
          </dl>
          <Button disabled={pending} onClick={submit}>
            {initial ? "명세 수정 저장" : "명세 등록"}
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ── 등록된 명세 목록 ────────────────────────────────────────────── */

function SlipTable({
  target,
  rows,
  editingId,
}: {
  target: AdminTargetModel;
  rows: AdminSlipRowModel[];
  editingId: string | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = (row: AdminSlipRowModel) => {
    if (
      !window.confirm(
        `${row.payMonth} 명세를 삭제할까요? 지급·공제 항목도 함께 삭제됩니다.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deletePayrollSlip(row.id);
      if (!result.ok) {
        setMessage(result.message ?? "명세를 삭제하지 못했습니다.");
        return;
      }
      setMessage(null);
      if (editingId === row.id) {
        router.push(`/admin/payroll?employee=${target.employeeId}`);
      }
      router.refresh();
    });
  };

  return (
    <section>
      <SectionHeader
        title="등록된 명세"
        description={`${target.name} · ${rows.length}건`}
      />
      {message ? (
        <Callout tone="warn" title="처리하지 못했습니다" className="mb-2.5">
          {message}
        </Callout>
      ) : null}
      <div className="ab-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="ab-table min-w-[720px]">
            <thead>
              <tr>
                <th>급여월</th>
                <th>지급일</th>
                <th className="text-right">지급합계</th>
                <th className="text-right">공제합계</th>
                <th className="text-right">공제 후 지급액</th>
                <th className="text-right">관리</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <TableEmptyRow
                  colSpan={6}
                  title="등록된 명세가 없습니다"
                  description="위 폼에서 급여월·지급일·항목을 입력해 등록합니다."
                />
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    className={editingId === row.id ? "bg-subtle" : undefined}
                  >
                    <td className="whitespace-nowrap">
                      <Link
                        href={`/payroll/${row.id}`}
                        className="text-body-sm font-medium tabular-nums text-ink hover:underline"
                      >
                        {row.payMonth}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap text-label tabular-nums text-muted">
                      {row.payDate}
                    </td>
                    <td className="whitespace-nowrap text-right text-body-sm tabular-nums text-ink">
                      {formatWon(row.grossTotal)}
                    </td>
                    <td className="whitespace-nowrap text-right text-body-sm tabular-nums text-muted">
                      {formatWon(row.deductionTotal)}
                    </td>
                    <td className="whitespace-nowrap text-right text-body-sm font-medium tabular-nums text-ink">
                      {formatWon(row.netTotal)}
                    </td>
                    <td className="text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <Link
                          href={`/admin/payroll?employee=${target.employeeId}&slip=${row.id}`}
                          className="text-label text-ink-sub hover:text-ink hover:underline"
                        >
                          수정
                        </Link>
                        <Button
                          size="small"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => remove(row)}
                        >
                          삭제
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ── 화면 본문 ───────────────────────────────────────────────────── */

export function PayrollAdmin({
  targets,
  selected,
  slips,
  initialSlip,
  defaultMonth,
}: {
  targets: AdminTargetModel[];
  selected: AdminTargetModel | null;
  slips: AdminSlipRowModel[];
  initialSlip: AdminSlipInitialModel | null;
  /** 서버가 계산한 이번 달(YYYY-MM) — 초기값 하이드레이션 어긋남 방지 */
  defaultMonth: string;
}) {
  const router = useRouter();

  return (
    <div className="space-y-5">
      <section>
        <SectionHeader
          title="직원 선택"
          description="급여상세와 월별 명세를 등록할 직원을 고릅니다. 퇴사자는 목록에 없습니다."
        />
        <div className="ab-card p-4">
          <Select
            aria-label="직원 선택"
            value={selected?.employeeId ?? ""}
            onChange={(e) =>
              router.push(
                e.target.value
                  ? `/admin/payroll?employee=${e.target.value}`
                  : "/admin/payroll",
              )
            }
            className="max-w-md"
          >
            <option value="">직원을 선택하세요</option>
            {targets.map((target) => (
              <option key={target.employeeId} value={target.employeeId}>
                {targetLabel(target)}
              </option>
            ))}
          </Select>
        </div>
      </section>

      {selected ? (
        <>
          {/* key — 직원이 바뀌면 폼 상태를 통째로 다시 시작한다 */}
          <ProfileForm key={`profile-${selected.employeeId}`} target={selected} />
          <SlipForm
            key={`slip-${selected.employeeId}-${initialSlip?.slipId ?? "new"}`}
            target={selected}
            initial={initialSlip}
            defaultMonth={defaultMonth}
          />
          <SlipTable
            target={selected}
            rows={slips}
            editingId={initialSlip?.slipId ?? null}
          />
        </>
      ) : (
        <div className="ab-card p-4">
          <EmptyState
            icon={UserRound}
            title="직원을 선택하세요"
            description="선택한 직원의 급여상세 입력과 월 명세 등록 폼이 여기에 열립니다."
            compact
          />
        </div>
      )}
    </div>
  );
}
