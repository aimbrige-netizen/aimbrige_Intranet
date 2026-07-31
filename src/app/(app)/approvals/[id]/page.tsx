import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Paperclip } from "lucide-react";
import { AttachmentPanel } from "@/features/approvals/AttachmentPanel";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { Avatar } from "@/components/ui/Avatar";
import { Meter } from "@/components/ui/Progress";
import { ApprovalActions } from "@/features/approvals/ApprovalActions";
import { ApprovalStepBar } from "@/features/approvals/ApprovalStepStrip";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getApprovalDocument } from "@/features/approvals/data";
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_TONES,
  DOCUMENT_TYPE_META,
  type ApprovalDocumentWithRelations,
  type DocumentType,
  type ExpenseItem,
} from "@/features/approvals/types";
import {
  elapsedLabel,
  formatWon,
  stepLabel,
  waitLabel,
} from "@/features/approvals/format";
import { formatDate, formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "결재 문서" };

/** form_data를 유형별 라벨과 함께 읽기전용으로 표시 (스펙 3.4) */
const FIELD_LABELS: Record<string, string> = {
  title: "제목",
  content: "내용",
  destination: "출장지",
  startDate: "시작일",
  endDate: "종료일",
  purpose: "출장목적",
  estimatedCost: "예상경비",
  reason: "사유",
  itemName: "품목",
  quantity: "수량",
  total: "총액",
};

const MONEY_FIELDS = new Set(["estimatedCost", "total"]);

/**
 * 양식마다 항목 순서를 고정한다.
 * JSON 키 순서에 맡기면 같은 유형인데 문서마다 항목 차례가 달라진다.
 */
const FIELD_ORDER: Record<DocumentType, string[]> = {
  special_request: ["content"],
  business_trip: ["destination", "purpose", "estimatedCost"],
  expense: ["total", "reason"],
  purchase_request: ["itemName", "quantity", "estimatedCost", "reason"],
  remote_work: ["reason"],
};

export default async function ApprovalDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const me = await requireSessionEmployee();
  const doc = await getApprovalDocument(params.id);
  if (!doc) notFound();

  const typeMeta = DOCUMENT_TYPE_META[doc.document_type];
  const totalSteps = doc.steps.length || 1;
  const currentStep = doc.steps.find((s) => s.step_order === doc.current_step);
  const doneSteps = doc.steps.filter((s) => s.status === "approved").length;

  // 지금 내 차례일 때만 승인/반려 노출
  const canProcess =
    doc.status === "pending" &&
    !!currentStep &&
    currentStep.approver_id === me.id &&
    currentStep.status === "pending";

  const canComplete = doc.status === "approved" && me.isSystemAdmin;
  const canAttach = doc.requester_id === me.id && doc.status === "pending";

  const isRequester = doc.requester_id === me.id;
  /*
   * 회수는 아직 아무도 승인하지 않았을 때만. 한 단계라도 승인된 뒤에 허용하면
   * 그 승인 기록이 조용히 사라진다(DB도 같은 조건으로 막는다).
   */
  const canWithdraw =
    isRequester &&
    doc.status === "pending" &&
    doc.steps.every((s) => s.status !== "approved");
  const canResubmit = isRequester && doc.status === "rejected";

  const rejectedStep = doc.steps.find((s) => s.status === "rejected");
  const fields = buildFields(doc);
  const expenseItems = (doc.form_data?.items as ExpenseItem[] | undefined) ?? [];
  const comments = doc.steps.filter((s) => s.comment?.trim());

  const affiliation =
    [doc.requester?.department?.name, doc.requester?.team?.name]
      .filter(Boolean)
      .join(" · ") || "소속 미지정";

  const timeline = buildTimeline(doc, totalSteps);

  const stripSteps = doc.steps.map((step) => ({
    label: stepLabel(step.step_order, totalSteps),
    name: step.approver?.name ?? null,
    state:
      step.status === "approved"
        ? ("done" as const)
        : step.status === "rejected"
          ? ("rejected" as const)
          : doc.status === "pending" && step.step_order === doc.current_step
            ? ("current" as const)
            : ("todo" as const),
  }));

  return (
    <>
      {/*
        상단 고정 액션 바.
        결재자는 이 화면에 '처리하러' 들어온다. 예전엔 승인/반려가 본문
        세 번째 카드 안에 있어서 문서 내용과 첨부를 지나 스크롤해야 닿았다.
      */}
      <div className="sticky top-topbar z-10 -mx-4 mb-5 border-b border-line bg-canvas px-4 py-3 md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Badge tone={DOCUMENT_STATUS_TONES[doc.status]}>
            {DOCUMENT_STATUS_LABELS[doc.status]}
          </Badge>

          <div className="min-w-0 flex-1">
            <p className="truncate text-body-sm font-bold text-ink">
              {doc.title}
            </p>
            <p className="truncate text-nano text-muted">
              {typeMeta.label} · 기안 {doc.requester?.name ?? "-"} ·{" "}
              {elapsedLabel(doc.created_at)} 경과
            </p>
          </div>

          <ApprovalStepBar
            steps={stripSteps}
            className="hidden shrink-0 md:block"
          />

          {canProcess || canComplete ? (
            <div className="flex shrink-0 items-center gap-2">
              {canProcess ? (
                <span className="hidden text-label text-info-ink lg:inline">
                  내 차례 · {stepLabel(doc.current_step, totalSteps)}
                </span>
              ) : null}
              <ApprovalActions
                documentId={doc.id}
                documentType={doc.document_type}
                canProcess={canProcess}
                canComplete={canComplete}
                canWithdraw={canWithdraw}
                canResubmit={canResubmit}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* 문서 캔버스 — 종이 양식처럼 중앙 제목 + 메타표 + 본문 */}
        <article className="ab-card mx-auto w-full max-w-[860px]">
          <header className="border-b border-line px-6 py-7 text-center">
            <p className="text-label text-muted">{typeMeta.label}</p>
            <h1 className="mt-1.5 text-h1 leading-snug text-ink">{doc.title}</h1>
          </header>

          {rejectedStep ? (
            <div className="border-b border-line px-6 py-4">
              <Callout
                tone="danger"
                title={`${stepLabel(rejectedStep.step_order, totalSteps)}에서 반려되었습니다`}
              >
                {rejectedStep.comment ?? "반려 사유가 기록되지 않았습니다."}
              </Callout>
            </div>
          ) : null}

          <SectionLabel>문서 정보</SectionLabel>
          <div className="ab-form-grid !rounded-none !border-0">
            <div className="ab-form-label">기안자</div>
            <div className="ab-form-field">
              <span className="flex items-center gap-2">
                <Avatar name={doc.requester?.name ?? "?"} size="small" />
                <span className="text-ink">{doc.requester?.name ?? "-"}</span>
              </span>
            </div>

            <div className="ab-form-label">소속</div>
            <div className="ab-form-field">{affiliation}</div>

            <div className="ab-form-label">직위</div>
            <div className="ab-form-field">{doc.requester?.position ?? "-"}</div>

            <div className="ab-form-label">기안일</div>
            <div className="ab-form-field tabular-nums">
              {formatDateTime(doc.created_at)}
            </div>
          </div>

          <SectionLabel>신청 내용</SectionLabel>
          <div className="ab-form-grid !rounded-none !border-0">
            {fields.map((field) => (
              <div key={field.label} className="contents">
                <div className="ab-form-label">{field.label}</div>
                <div
                  className={cn(
                    "ab-form-field whitespace-pre-wrap",
                    field.numeric && "tabular-nums",
                  )}
                >
                  {field.value}
                </div>
              </div>
            ))}
          </div>

          {/* 경비청구서는 항목별 표로 (스펙 3.4) */}
          {expenseItems.length > 0 ? (
            <>
              <SectionLabel>청구 항목</SectionLabel>
              <table className="ab-table ab-table--compact">
                <thead>
                  <tr>
                    <th className="!px-6">항목명</th>
                    <th className="w-40 !px-6 text-right">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {expenseItems.map((item, index) => (
                    <tr key={index}>
                      <td className="!px-6">{item.name}</td>
                      <td className="!px-6 text-right tabular-nums">
                        {formatWon(Number(item.amount) || 0)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="!px-6 font-bold text-ink">
                      합계 <span className="text-muted">({expenseItems.length}건)</span>
                    </td>
                    <td className="!px-6 text-right font-bold tabular-nums text-ink">
                      {formatWon(
                        expenseItems.reduce(
                          (sum, item) => sum + (Number(item.amount) || 0),
                          0,
                        ),
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </>
          ) : null}

          <SectionLabel>결재 의견</SectionLabel>
          <div className="px-6 pb-6">
            {comments.length === 0 ? (
              <p className="text-caption">
                아직 기록된 결재 의견이 없습니다. 반려 시에는 사유가 여기에
                남습니다.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {comments.map((step) => (
                  <li
                    key={step.id}
                    className={cn(
                      "rounded-card border px-4 py-3",
                      step.status === "rejected"
                        ? "border-danger/30 bg-danger-light"
                        : "border-line bg-subtle",
                    )}
                  >
                    <p className="flex flex-wrap items-center gap-x-2 text-label text-muted">
                      <span className="font-bold text-ink">
                        {step.approver?.name ?? "담당자 미지정"}
                      </span>
                      {step.approver?.position ? (
                        <span>{step.approver.position}</span>
                      ) : null}
                      <span>·</span>
                      <span>{stepLabel(step.step_order, totalSteps)}</span>
                      <span>·</span>
                      <span className="tabular-nums">
                        {formatDateTime(step.processed_at)}
                      </span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-body text-ink">
                      {step.comment}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>

        {/* 결재 진행 패널 — 게이지·결재선·첨부를 한 카드에 모은다 */}
        <aside className="space-y-5 xl:sticky xl:top-32 xl:self-start">
          <Card>
            <CardHeader
              title="결재 진행"
              description={
                doc.status === "pending"
                  ? `${totalSteps}단계 중 ${doc.current_step}단계 진행중`
                  : rejectedStep
                    ? `${stepLabel(rejectedStep.step_order, totalSteps)}에서 중단`
                    : `${totalSteps}단계 결재 완료`
              }
              density="compact"
            />
            <CardBody density="compact">
              <Meter
                value={doneSteps}
                max={totalSteps}
                tone={
                  doc.status === "rejected"
                    ? "critical"
                    : doneSteps === totalSteps
                      ? "positive"
                      : "informative"
                }
                valueLabel={`${Math.round((doneSteps / totalSteps) * 100)}%`}
                label="승인 완료"
              />

              <ol className="mt-4">
                {timeline.map(({ key, ...item }, index) => (
                  <TimelineItem
                    key={key}
                    {...item}
                    last={index === timeline.length - 1}
                  />
                ))}
              </ol>

              <dl className="mt-4 space-y-1.5 border-t border-line pt-3">
                <MetaRow
                  label={doc.status === "pending" ? "기안 후 경과" : "총 소요"}
                  value={
                    doc.status === "pending"
                      ? elapsedLabel(doc.created_at)
                      : waitLabel(doc.created_at, doc.updated_at)
                  }
                />
                <MetaRow label="최종 변경" value={formatDate(doc.updated_at)} />
                <MetaRow label="첨부" value={`${doc.attachments.length}건`} />
              </dl>
            </CardBody>
          </Card>

          {/*
            첨부는 문서 캔버스가 아니라 이 패널에 둔다.
            좌측에 두면 첨부 0건이면서 기안자가 아닐 때 카드가 통째로 사라져
            좌우 컬럼 높이가 무너졌다.
          */}
          <Card>
            <CardHeader
              title="첨부파일"
              description={`${doc.attachments.length}건`}
              density="compact"
              action={
                <Paperclip className="size-4 text-muted" aria-hidden />
              }
            />
            <CardBody density="compact">
              <AttachmentPanel
                documentId={doc.id}
                authUserId={me.auth_user_id}
                attachments={doc.attachments}
                canUpload={canAttach}
              />
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-b border-line bg-subtle px-6 py-2 text-label font-bold text-muted">
      {children}
    </p>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-label text-muted">{label}</dt>
      <dd className="text-label tabular-nums text-ink">{value}</dd>
    </div>
  );
}

const DOT = {
  done: "bg-success",
  current: "bg-info",
  rejected: "bg-danger",
  todo: "bg-line-strong",
} as const;

interface TimelineNode {
  key: string;
  title: string;
  name?: string;
  position?: string | null;
  at: string | null;
  wait?: string | null;
  tone: keyof typeof DOT;
}

/**
 * 기안 → 각 결재 단계 → 시행완료를 한 줄기로 잇는다.
 * 단계 사이 대기시간을 캡션으로 달아 "어디서 멈춰 있었는지"가 보이게 한다.
 */
function buildTimeline(
  doc: ApprovalDocumentWithRelations,
  totalSteps: number,
): TimelineNode[] {
  const nodes: TimelineNode[] = [
    {
      key: "draft",
      title: "기안",
      name: doc.requester?.name ?? "-",
      position: doc.requester?.position ?? null,
      at: doc.created_at,
      tone: "done",
    },
  ];

  doc.steps.forEach((step, index) => {
    const previousAt =
      index === 0
        ? doc.created_at
        : (doc.steps[index - 1].processed_at ?? doc.created_at);
    const isCurrent =
      doc.status === "pending" && step.step_order === doc.current_step;

    nodes.push({
      key: step.id,
      title: stepLabel(step.step_order, totalSteps),
      name: step.approver?.name ?? "담당자 미지정",
      position: step.approver?.position ?? null,
      at: step.processed_at,
      wait: step.processed_at
        ? `${waitLabel(previousAt, step.processed_at)} 만에 처리`
        : isCurrent
          ? `${elapsedLabel(previousAt)} 대기중`
          : null,
      tone:
        step.status === "approved"
          ? "done"
          : step.status === "rejected"
            ? "rejected"
            : isCurrent
              ? "current"
              : "todo",
    });
  });

  if (doc.status === "completed") {
    nodes.push({
      key: "completed",
      title: "시행완료",
      at: doc.updated_at,
      tone: "done",
    });
  }

  return nodes;
}

/**
 * 결재선 한 칸.
 * 예전에는 점만 있고 점과 점을 잇는 선이 없어서 타임라인이 아니라
 * 그냥 불릿 목록으로 읽혔다.
 */
function TimelineItem({
  name,
  position,
  title,
  at,
  wait,
  tone,
  last,
}: {
  name?: string;
  position?: string | null;
  title: string;
  at: string | null;
  wait?: string | null;
  tone: keyof typeof DOT;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last ? (
        <span
          className="absolute bottom-0 left-[6px] top-4 w-px bg-line"
          aria-hidden
        />
      ) : null}
      <span
        className={cn("mt-1 size-3 shrink-0 rounded-full", DOT[tone])}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center justify-between gap-2 text-label">
          <span className="font-bold text-ink">{title}</span>
          {at ? (
            <span className="shrink-0 tabular-nums text-muted">
              {formatDateTime(at)}
            </span>
          ) : null}
        </p>
        {name ? (
          <p className="mt-1 flex items-center gap-1.5 text-label text-muted">
            <Avatar name={name} size="small" />
            <span className="truncate">
              {name}
              {position ? ` ${position}` : ""}
            </span>
          </p>
        ) : null}
        {wait ? <p className="mt-0.5 text-nano text-muted">{wait}</p> : null}
      </div>
    </li>
  );
}

interface FieldRow {
  label: string;
  value: string;
  numeric?: boolean;
}

/**
 * form_data → 표시용 행.
 * 시작일·종료일은 한 줄("기간")로 합친다. 두 줄로 나오면 며칠짜리인지
 * 읽는 사람이 매번 뺄셈을 해야 한다.
 */
function buildFields(doc: ApprovalDocumentWithRelations): FieldRow[] {
  const data = doc.form_data ?? {};
  const rows: FieldRow[] = [];

  const start = data.startDate;
  const end = data.endDate;
  if (typeof start === "string" && typeof end === "string") {
    const days =
      Math.round(
        (new Date(`${end}T00:00:00Z`).getTime() -
          new Date(`${start}T00:00:00Z`).getTime()) /
          86_400_000,
      ) + 1;
    rows.push({
      label: DOCUMENT_TYPE_META[doc.document_type].hasDateRange ? "기간" : "일자",
      value: start === end ? start : `${start} ~ ${end} (${days}일)`,
      numeric: true,
    });
  }

  const order = FIELD_ORDER[doc.document_type] ?? [];
  const known = new Set([...order, "startDate", "endDate", "items", "title"]);
  const keys = [
    ...order.filter((key) => key in data),
    ...Object.keys(data).filter((key) => !known.has(key)),
  ];

  for (const key of keys) {
    const value = data[key];
    if (value === null || value === undefined || value === "") {
      rows.push({ label: FIELD_LABELS[key] ?? key, value: "-" });
      continue;
    }
    if (MONEY_FIELDS.has(key)) {
      rows.push({
        label: FIELD_LABELS[key] ?? key,
        value: formatWon(Number(value)),
        numeric: true,
      });
      continue;
    }
    if (key === "quantity") {
      rows.push({ label: "수량", value: `${value}개`, numeric: true });
      continue;
    }
    rows.push({ label: FIELD_LABELS[key] ?? key, value: String(value) });
  }

  return rows;
}
