"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { FormRow, Input, Textarea } from "@/components/ui/Field";
import { submitApprovalDocument } from "@/server/actions/approvals";
import { todayYmd } from "@/features/calendar/date";
import { DOCUMENT_TYPE_META, type DocumentType } from "./types";
import type { ExpenseItem } from "./types";

interface LinePreview {
  step1: { name: string; position: string | null } | null;
  step2: { name: string; position: string | null } | null;
  blocked: boolean;
}

/**
 * 유형별 기안 작성 폼 (스펙 04 · 3.3)
 * 항목이 많은 신청서라 디자인시스템 원칙대로 라벨-옆-인풋 표 형태를 쓴다.
 */
export function ApprovalForm({
  documentType,
  line,
}: {
  documentType: DocumentType;
  line: LinePreview;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 공통 필드
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [reason, setReason] = useState("");
  const [startDate, setStartDate] = useState(todayYmd());
  const [endDate, setEndDate] = useState(todayYmd());
  // 출장
  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  // 비품
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("1");
  // 경비
  const [items, setItems] = useState<ExpenseItem[]>([{ name: "", amount: 0 }]);

  const total = useMemo(
    () => items.reduce((s, i) => s + (Number(i.amount) || 0), 0),
    [items],
  );

  /**
   * 경비 항목 오류를 하나의 문구로 모은다.
   * 서버는 items.1.amount 처럼 인덱스가 붙은 키로 오류를 주는데, 특정 인덱스만
   * 확인하면 두 번째 이후 항목의 오류가 화면에 전혀 안 나타난다(제출이 조용히 실패).
   */
  const itemsError = useMemo(() => {
    const direct = errors.items;
    if (direct) return direct;

    const perItem = Object.entries(errors)
      .filter(([key]) => key.startsWith("items."))
      .map(([key, message]) => {
        const index = Number(key.split(".")[1]);
        return Number.isFinite(index) ? `${index + 1}번 항목: ${message}` : message;
      });

    return perItem.length > 0 ? perItem.join(" / ") : undefined;
  }, [errors]);

  const buildPayload = (): Record<string, unknown> => {
    switch (documentType) {
      case "special_request":
        return { title, content };
      case "business_trip":
        return {
          destination,
          startDate,
          endDate,
          purpose,
          estimatedCost: estimatedCost === "" ? null : Number(estimatedCost),
        };
      case "expense":
        return {
          items: items.map((i) => ({
            name: i.name,
            amount: Number(i.amount) || 0,
          })),
          reason: reason || null,
        };
      case "purchase_request":
        return {
          itemName,
          quantity: Number(quantity),
          estimatedCost: estimatedCost === "" ? null : Number(estimatedCost),
          reason,
        };
      case "remote_work":
        return { startDate, endDate, reason };
    }
  };

  const submit = () => {
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await submitApprovalDocument(documentType, buildPayload());
      if (result.ok) {
        router.push(`/approvals/${result.documentId}`);
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message ?? null);
    });
  };

  const meta = DOCUMENT_TYPE_META[documentType];

  return (
    <div className="space-y-5">
      {line.blocked ? (
        <div className="flex gap-2.5 rounded-card border border-danger/30 bg-danger/10 px-4 py-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <div className="text-body text-ink">
            <p className="font-medium text-danger">최종 승인자 미지정</p>
            <p className="mt-0.5 text-label">
              이 문서유형의 최종 승인자가 지정되지 않아 기안할 수 없습니다. 시스템
              관리자가 결재라인 설정에서 지정해야 합니다.
            </p>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader title={meta.label} description={meta.description} />
        <CardBody>
          <div className="ab-form-grid">
            {documentType === "special_request" ? (
              <>
                <FormRow label="제목" required htmlFor="f-title" error={errors.title}>
                  <Input
                    id="f-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={pending}
                    invalid={!!errors.title}
                    placeholder="특별처리 요청 제목"
                  />
                </FormRow>
                <FormRow label="내용" required htmlFor="f-content" error={errors.content}>
                  <Textarea
                    id="f-content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    disabled={pending}
                    invalid={!!errors.content}
                    className="min-h-32"
                  />
                </FormRow>
              </>
            ) : null}

            {documentType === "business_trip" ? (
              <>
                <FormRow label="출장지" required htmlFor="f-dest" error={errors.destination}>
                  <Input
                    id="f-dest"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    disabled={pending}
                    invalid={!!errors.destination}
                  />
                </FormRow>
                <FormRow
                  label="출장기간"
                  required
                  error={errors.startDate ?? errors.endDate}
                >
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      aria-label="시작일"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      disabled={pending}
                      className="md:max-w-44"
                    />
                    <span className="text-muted">~</span>
                    <Input
                      type="date"
                      aria-label="종료일"
                      value={endDate}
                      min={startDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      disabled={pending}
                      invalid={!!errors.endDate}
                      className="md:max-w-44"
                    />
                  </div>
                </FormRow>
                <FormRow label="출장목적" required htmlFor="f-purpose" error={errors.purpose}>
                  <Textarea
                    id="f-purpose"
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    disabled={pending}
                    invalid={!!errors.purpose}
                  />
                </FormRow>
                <FormRow label="예상경비" htmlFor="f-cost">
                  <Input
                    id="f-cost"
                    type="number"
                    min={0}
                    value={estimatedCost}
                    onChange={(e) => setEstimatedCost(e.target.value)}
                    disabled={pending}
                    placeholder="원"
                    className="md:max-w-52"
                  />
                </FormRow>
              </>
            ) : null}

            {documentType === "expense" ? (
              <>
                <FormRow
                  label="청구 항목"
                  required
                  // 항목별 오류 키는 items.1.amount 처럼 인덱스가 붙는다.
                  // 0번만 보면 두 번째 이후 항목 오류가 화면에 안 나와서 전부 모은다.
                  error={itemsError}
                >
                  <div className="space-y-2">
                    {items.map((item, index) => (
                      <div key={index} className="flex gap-2">
                        <Input
                          aria-label={`항목명 ${index + 1}`}
                          value={item.name}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((it, i) =>
                                i === index ? { ...it, name: e.target.value } : it,
                              ),
                            )
                          }
                          disabled={pending}
                          placeholder="항목명"
                        />
                        <Input
                          aria-label={`금액 ${index + 1}`}
                          type="number"
                          min={0}
                          value={item.amount || ""}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((it, i) =>
                                i === index
                                  ? { ...it, amount: Number(e.target.value) || 0 }
                                  : it,
                              ),
                            )
                          }
                          disabled={pending}
                          placeholder="금액"
                          className="max-w-40"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setItems((prev) =>
                              prev.length === 1
                                ? prev
                                : prev.filter((_, i) => i !== index),
                            )
                          }
                          disabled={pending || items.length === 1}
                          aria-label={`항목 ${index + 1} 삭제`}
                          className="shrink-0 rounded-md p-2 text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setItems((prev) => [...prev, { name: "", amount: 0 }])
                      }
                      disabled={pending}
                    >
                      <Plus className="size-3.5" />
                      항목 추가
                    </Button>
                  </div>
                </FormRow>
                <FormRow label="총액">
                  <p className="text-h2 tabular-nums text-primary">
                    {total.toLocaleString("ko-KR")}원
                    <span className="ml-2 text-label font-normal text-muted">
                      {items.length}건
                    </span>
                  </p>
                </FormRow>
                <FormRow label="사유" htmlFor="f-reason">
                  <Textarea
                    id="f-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    disabled={pending}
                  />
                </FormRow>
              </>
            ) : null}

            {documentType === "purchase_request" ? (
              <>
                <FormRow label="품목" required htmlFor="f-item" error={errors.itemName}>
                  <Input
                    id="f-item"
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    disabled={pending}
                    invalid={!!errors.itemName}
                  />
                </FormRow>
                <FormRow label="수량" required htmlFor="f-qty" error={errors.quantity}>
                  <Input
                    id="f-qty"
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    disabled={pending}
                    invalid={!!errors.quantity}
                    className="md:max-w-32"
                  />
                </FormRow>
                <FormRow label="예상금액" htmlFor="f-amount">
                  <Input
                    id="f-amount"
                    type="number"
                    min={0}
                    value={estimatedCost}
                    onChange={(e) => setEstimatedCost(e.target.value)}
                    disabled={pending}
                    placeholder="원"
                    className="md:max-w-52"
                  />
                </FormRow>
                <FormRow label="사유" required htmlFor="f-reason2" error={errors.reason}>
                  <Textarea
                    id="f-reason2"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    disabled={pending}
                    invalid={!!errors.reason}
                  />
                </FormRow>
              </>
            ) : null}

            {documentType === "remote_work" ? (
              <>
                <FormRow label="기간" required error={errors.startDate ?? errors.endDate}>
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      aria-label="시작일"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      disabled={pending}
                      className="md:max-w-44"
                    />
                    <span className="text-muted">~</span>
                    <Input
                      type="date"
                      aria-label="종료일"
                      value={endDate}
                      min={startDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      disabled={pending}
                      invalid={!!errors.endDate}
                      className="md:max-w-44"
                    />
                  </div>
                </FormRow>
                <FormRow label="사유" required htmlFor="f-reason3" error={errors.reason}>
                  <Textarea
                    id="f-reason3"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    disabled={pending}
                    invalid={!!errors.reason}
                  />
                </FormRow>
              </>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {/* 결재라인 미리보기 (스펙 3.3 공통) */}
      <Card>
        <CardHeader title="결재라인" description="제출 시 아래 순서로 진행됩니다." />
        <CardBody>
          <ol className="flex flex-wrap items-center gap-2 text-body">
            <li className="rounded-lg bg-canvas px-3 py-2">
              <span className="text-caption">기안</span>
              <span className="ml-2 text-ink">본인</span>
            </li>
            {line.step1 ? (
              <>
                <li className="text-muted">→</li>
                <li className="rounded-lg bg-canvas px-3 py-2">
                  <span className="text-caption">1차 검토</span>
                  <span className="ml-2 text-ink">
                    {line.step1.name}
                    {line.step1.position ? ` ${line.step1.position}` : ""}
                  </span>
                </li>
              </>
            ) : null}
            <li className="text-muted">→</li>
            <li className="rounded-lg bg-primary-light px-3 py-2">
              <span className="text-caption">최종 승인</span>
              <span className="ml-2 font-medium text-primary">
                {line.step2
                  ? `${line.step2.name}${line.step2.position ? ` ${line.step2.position}` : ""}`
                  : "미지정"}
              </span>
            </li>
          </ol>
          {!line.step1 ? (
            <p className="mt-3 text-caption">
              소속 팀의 팀장이 지정되지 않았거나 본인이 팀장이라 1차 검토를 건너뛰고
              최종 승인자에게 바로 전달됩니다.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {message ? (
          <p className="mr-auto text-label text-danger">{message}</p>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => router.push("/approvals/new")}
          disabled={pending}
        >
          유형 다시 선택
        </Button>
        <Button onClick={submit} disabled={pending || line.blocked}>
          {pending ? "제출 중…" : "제출"}
        </Button>
      </div>
    </div>
  );
}
