import type { Metadata } from "next";
import Link from "next/link";
import { FileCheck, FileClock, Hourglass, Inbox, Timer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { Meter, MiniMeter } from "@/components/ui/Progress";
import { PeriodNavigator } from "@/components/ui/PeriodNavigator";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  FilterChip,
  TableToolbar,
  ToolbarSearch,
} from "@/components/ui/TableToolbar";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import { ApprovalStepBar } from "@/features/approvals/ApprovalStepStrip";
import { ApprovalInbox } from "@/features/approvals/ApprovalInbox";
import { requireSessionEmployee } from "@/lib/auth/session";
import {
  bucketByAging,
  getMyApprovalWorkload,
  getMyDocumentStats,
  getMyDocuments,
  getMyPendingApprovals,
} from "@/features/approvals/data";
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_ORDER,
  DOCUMENT_STATUS_TONES,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_META,
  type DocumentStatus,
} from "@/features/approvals/types";
import {
  documentHighlight,
  elapsedDays,
  elapsedLabel,
  stepLabel,
} from "@/features/approvals/format";
import { addMonthsYm, monthLabel, todayYmd } from "@/features/calendar/date";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "전자결재" };

type PeriodView = "month" | "quarter" | "all";

const PERIOD_VIEWS: PeriodView[] = ["month", "quarter", "all"];

/**
 * 전자결재 목록.
 *
 * 예전 구성은 "제목 → 탭 2개 → 상태필터 → 표" 네 줄이 전부였다.
 * 탭(내 문서/결재함)은 모듈 패널이 이미 하는 일이라 본문에서 걷어내고
 * searchParams만 읽는다. 그 자리를 기간 스테퍼·요약 밴드·진행 분포가 채운다.
 */
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: {
    tab?: string;
    status?: string;
    view?: string;
    cursor?: string;
    q?: string;
  };
}) {
  const me = await requireSessionEmployee();
  const today = todayYmd();

  const pending = await getMyPendingApprovals(me.id);

  /**
   * 결재함 노출 기준.
   * 스펙 3.1은 "팀장/매니저·시스템 관리자만"이라고 했지만, 최종 승인자는 관리자가
   * 임직원 중 누구든 지정할 수 있다(역할과 무관). 역할로만 가리면 일반직원으로
   * 지정된 최종 승인자가 자기 결재 목록을 아예 못 보게 된다.
   */
  const canSeeInbox = me.isManager || pending.length > 0;
  const tab = searchParams.tab === "inbox" && canSeeInbox ? "inbox" : "mine";

  const meta = (
    <>
      <span>{me.department?.name ?? "부서 미지정"}</span>
      {me.position ? (
        <>
          <span>·</span>
          <span>{me.position}</span>
        </>
      ) : null}
    </>
  );

  if (tab === "inbox") {
    return <InboxView me={me} meta={meta} pending={pending} today={today} />;
  }

  // ── 내가 올린 문서 ────────────────────────────────────────────────
  const view: PeriodView = PERIOD_VIEWS.includes(searchParams.view as PeriodView)
    ? (searchParams.view as PeriodView)
    : "month";
  const cursor = (searchParams.cursor ?? today.slice(0, 7)).slice(0, 7);
  const period = resolvePeriod(view, cursor);
  const previous = resolvePeriod(view, addMonthsYm(cursor, view === "quarter" ? -3 : -1));

  const status = DOCUMENT_STATUS_ORDER.includes(searchParams.status as DocumentStatus)
    ? (searchParams.status as DocumentStatus)
    : undefined;
  const q = searchParams.q?.trim() || undefined;

  const [stats, docs] = await Promise.all([
    getMyDocumentStats(me.id, period.range, previous.range),
    getMyDocuments(me.id, { ...period.range, status, q }),
  ]);

  const linkFor = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { view, cursor, status, q, ...patch };
    if (merged.view && merged.view !== "month") params.set("view", merged.view);
    if (merged.cursor && merged.view !== "all") params.set("cursor", merged.cursor);
    if (merged.status) params.set("status", merged.status);
    if (merged.q) params.set("q", merged.q);
    const query = params.toString();
    return query ? `/approvals?${query}` : "/approvals";
  };

  const done = stats.byStatus.approved + stats.byStatus.completed;
  const delta = stats.total - stats.previousTotal;

  return (
    <>
      <PageHeader
        title="내가 올린 문서"
        meta={meta}
        toolbar={
          <PeriodNavigator
            label={period.label}
            sublabel={period.sublabel}
            prevHref={view === "all" ? undefined : linkFor({ cursor: period.prev })}
            nextHref={view === "all" ? undefined : linkFor({ cursor: period.next })}
            todayHref={linkFor({ cursor: today.slice(0, 7) })}
            atToday={view === "all" || period.includesToday}
            className="mb-0"
            right={
              <SegmentedControl
                options={[
                  { value: "month", label: "월간", href: linkFor({ view: "month" }) },
                  {
                    value: "quarter",
                    label: "분기",
                    href: linkFor({ view: "quarter" }),
                  },
                  { value: "all", label: "전체", href: linkFor({ view: "all" }) },
                ]}
                value={view}
                ariaLabel="조회 기간 단위"
              />
            }
          />
        }
      />

      {/* 요약 밴드 — 모든 숫자에 분모를 붙인다 */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="진행중"
          value={stats.byStatus.pending}
          unit="건"
          denominator={stats.total}
          denominatorUnit="건"
          tone="informative"
          icon={Hourglass}
          max={stats.total || 1}
          meterValue={stats.byStatus.pending}
          sub={
            stats.byStatus.pending > 0
              ? `가장 오래된 문서 ${stats.oldestPendingDays}일 경과`
              : "결재 대기 문서 없음"
          }
        />
        <StatCard
          label="승인·시행완료"
          value={done}
          unit="건"
          denominator={stats.total}
          denominatorUnit="건"
          tone="positive"
          icon={FileCheck}
          max={stats.total || 1}
          meterValue={done}
          sub={`시행완료 ${stats.byStatus.completed}건 포함`}
        />
        <StatCard
          label="반려"
          value={stats.byStatus.rejected}
          unit="건"
          denominator={stats.total}
          denominatorUnit="건"
          tone={stats.byStatus.rejected > 0 ? "critical" : "neutral"}
          icon={FileClock}
          max={stats.total || 1}
          meterValue={stats.byStatus.rejected}
          sub={
            stats.byStatus.rejected > 0
              ? "사유를 확인하고 다시 기안할 수 있습니다"
              : "반려된 문서 없음"
          }
        />
        <StatCard
          label="평균 결재 소요"
          value={stats.avgDecisionDays === null ? "—" : stats.avgDecisionDays}
          unit={stats.avgDecisionDays === null ? undefined : "일"}
          tone="neutral"
          icon={Timer}
          state={stats.avgDecisionDays === null ? "empty" : "ok"}
          sub={
            stats.avgDecisionDays === null
              ? "결재가 끝난 문서가 생기면 계산됩니다"
              : `결재 완료 ${stats.decidedCount}건 기준`
          }
          delta={
            view === "all" || stats.previousTotal === 0
              ? undefined
              : {
                  label: `${delta > 0 ? "+" : ""}${delta}건`,
                  direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
                }
          }
        />
      </div>

      {/* 시각화 — 상태 구성과 유형 분포를 한 화면에서 본다 */}
      <Card className="mb-5">
        <CardHeader
          title="결재 진행 현황"
          description={`${period.label} 기안 ${stats.total}건`}
          density="compact"
        />
        <CardBody density="compact">
          <Meter
            max={stats.total || 1}
            segments={[
              { value: done, tone: "positive", label: "승인·시행완료" },
              { value: stats.byStatus.pending, tone: "informative", label: "진행중" },
              { value: stats.byStatus.rejected, tone: "critical", label: "반려" },
            ]}
            valueLabel={`${done + stats.byStatus.pending + stats.byStatus.rejected} / ${stats.total}건`}
            size="lg"
          />
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            <Legend tone="bg-success" label="승인·시행완료" value={done} />
            <Legend
              tone="bg-info"
              label="진행중"
              value={stats.byStatus.pending}
            />
            <Legend
              tone="bg-danger"
              label="반려"
              value={stats.byStatus.rejected}
            />
          </div>

          <div className="mt-4 grid gap-x-6 gap-y-2 border-t border-line pt-3 md:grid-cols-2">
            {DOCUMENT_TYPES.map((type) => {
              const TypeIcon = DOCUMENT_TYPE_META[type].icon;
              const count = stats.byType[type];
              return (
                <div key={type} className="flex items-center gap-2">
                  <TypeIcon className="size-3.5 shrink-0 text-muted" aria-hidden />
                  <span className="w-24 shrink-0 truncate text-label text-ink">
                    {DOCUMENT_TYPE_META[type].short}
                  </span>
                  <MiniMeter
                    value={count}
                    max={stats.total || 1}
                    tone={count > 0 ? "informative" : "neutral"}
                    className="flex-1"
                    aria-label={`${DOCUMENT_TYPE_META[type].label} ${count}건`}
                  />
                  <span className="w-12 shrink-0 text-right text-label tabular-nums text-muted">
                    {count}/{stats.total}
                  </span>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* 검색·상태 필터 — 각 필터가 몇 건인지 누르기 전에 보인다 */}
      <form action="/approvals" method="get">
        {view !== "month" ? <input type="hidden" name="view" value={view} /> : null}
        {view !== "all" ? <input type="hidden" name="cursor" value={cursor} /> : null}
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <TableToolbar
          search={
            <ToolbarSearch
              name="q"
              defaultValue={q}
              placeholder="문서 제목 검색"
            />
          }
          filters={
            <>
              <FilterChip
                href={linkFor({ status: undefined })}
                active={!status}
                count={stats.total}
              >
                전체
              </FilterChip>
              {DOCUMENT_STATUS_ORDER.map((value) => (
                <FilterChip
                  key={value}
                  href={linkFor({ status: value })}
                  active={status === value}
                  count={stats.byStatus[value]}
                >
                  {DOCUMENT_STATUS_LABELS[value]}
                </FilterChip>
              ))}
            </>
          }
          count={`${docs.length}건 표시`}
        />
      </form>

      <Card>
        <CardBody className="!p-0">
          <div className="overflow-x-auto">
            <table className="ab-table ab-table--compact min-w-[860px]">
              <thead>
                <tr>
                  <th className="w-24">문서유형</th>
                  <th>제목</th>
                  <th className="w-44">핵심값</th>
                  <th className="w-40">결재 진행</th>
                  <th className="w-24">상태</th>
                  <th className="w-32">기안일</th>
                </tr>
              </thead>
              <tbody>
                {docs.length === 0 ? (
                  <TableEmptyRow
                    colSpan={6}
                    icon={FileCheck}
                    title={
                      q || status
                        ? "조건에 맞는 문서가 없습니다"
                        : "이 기간에 기안한 문서가 없습니다"
                    }
                    description="문서를 올리면 유형·핵심값·결재 진행이 이 표에 쌓입니다."
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        <LinkButton
                          href="/approvals/new/expense"
                          size="small"
                          variant="secondary"
                        >
                          경비청구서 기안
                        </LinkButton>
                        <LinkButton
                          href="/approvals/new/business_trip"
                          size="small"
                          variant="secondary"
                        >
                          출장신청서 기안
                        </LinkButton>
                      </div>
                    }
                  />
                ) : (
                  docs.map((doc) => {
                    const typeMeta = DOCUMENT_TYPE_META[doc.document_type];
                    const highlight = documentHighlight(
                      doc.document_type,
                      doc.form_data,
                    );
                    const TypeIcon = typeMeta.icon;
                    const days = elapsedDays(doc.created_at);

                    return (
                      <tr key={doc.id}>
                        <td className="whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            <TypeIcon
                              className="size-3.5 shrink-0 text-muted"
                              aria-hidden
                            />
                            {typeMeta.short}
                          </span>
                        </td>
                        <td>
                          <Link
                            href={`/approvals/${doc.id}`}
                            className="text-ink hover:text-primary hover:underline"
                          >
                            {doc.title}
                          </Link>
                        </td>
                        <td className="tabular-nums">
                          {highlight ? (
                            <>
                              <span className="block text-body-sm text-ink">
                                {highlight.text}
                              </span>
                              {highlight.sub ? (
                                <span className="block truncate text-nano text-muted">
                                  {highlight.sub}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          <ApprovalStepBar steps={docStepStates(doc)} />
                        </td>
                        <td>
                          <Badge tone={DOCUMENT_STATUS_TONES[doc.status]}>
                            {DOCUMENT_STATUS_LABELS[doc.status]}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap tabular-nums">
                          <span className="block text-ink">
                            {formatDate(doc.created_at)}
                          </span>
                          <span className="block text-nano text-muted">
                            {doc.status === "pending"
                              ? `${days}일 경과`
                              : `소요 ${elapsedLabel(doc.created_at, new Date(doc.updated_at).getTime())}`}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

/** 결재함 — 결재자가 '처리하러' 들어오는 화면 */
async function InboxView({
  me,
  meta,
  pending,
  today,
}: {
  me: Awaited<ReturnType<typeof requireSessionEmployee>>;
  meta: React.ReactNode;
  pending: Awaited<ReturnType<typeof getMyPendingApprovals>>;
  today: string;
}) {
  const monthStart = `${today.slice(0, 7)}-01`;
  const workload = await getMyApprovalWorkload(me.id, {
    from: monthStart,
    to: today,
  });

  const buckets = bucketByAging(pending);
  const total = pending.length;
  const oldest = pending[0];

  const rows = pending.map((row) => ({
    id: row.document.id,
    title: row.document.title,
    typeShort: DOCUMENT_TYPE_META[row.document.document_type].short,
    requesterName: row.document.requester?.name ?? "-",
    requesterSub:
      [row.document.requester?.department?.name, row.document.requester?.position]
        .filter(Boolean)
        .join(" · ") || null,
    highlight: documentHighlight(row.document.document_type, row.document.form_data),
    waitingDays: row.waitingDays,
    createdAt: formatDate(row.document.created_at),
    steps: Array.from({ length: row.totalSteps }, (_, i) => {
      const order = i + 1;
      return {
        label: stepLabel(order, row.totalSteps),
        state:
          order < row.stepOrder
            ? ("done" as const)
            : order === row.stepOrder
              ? ("current" as const)
              : ("todo" as const),
        name: order === row.stepOrder ? "내 차례" : null,
      };
    }),
  }));

  return (
    <>
      <PageHeader title="결재 대기함" meta={meta} />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="내 차례"
          value={total}
          unit="건"
          denominator={total + workload.processed}
          denominatorUnit="건"
          tone="informative"
          icon={Inbox}
          max={total + workload.processed || 1}
          meterValue={total}
          sub={
            oldest
              ? `가장 오래 기다린 문서 ${oldest.waitingDays}일`
              : "지금 처리할 문서가 없습니다"
          }
        />
        <StatCard
          label="3일 이상 대기"
          value={buckets.aging + buckets.late}
          unit="건"
          denominator={total}
          denominatorUnit="건"
          tone={buckets.late > 0 ? "critical" : buckets.aging > 0 ? "warning" : "neutral"}
          icon={Hourglass}
          max={total || 1}
          meterValue={buckets.aging + buckets.late}
          sub={`7일 이상 ${buckets.late}건`}
        />
        <StatCard
          label="이번 달 처리"
          value={workload.processed}
          unit="건"
          tone="positive"
          icon={FileCheck}
          sub={`승인 ${workload.approved}건 · 반려 ${workload.rejected}건`}
        />
        <StatCard
          label="평균 응답"
          value={workload.avgResponseDays === null ? "—" : workload.avgResponseDays}
          unit={workload.avgResponseDays === null ? undefined : "일"}
          tone="neutral"
          icon={Timer}
          state={workload.avgResponseDays === null ? "empty" : "ok"}
          sub={
            workload.avgResponseDays === null
              ? "이번 달 처리 이력이 쌓이면 계산됩니다"
              : `이번 달 처리 ${workload.processed}건 기준`
          }
        />
      </div>

      <Card className="mb-5">
        <CardHeader
          title="대기 경과 분포"
          description="오래 묵은 문서가 목록 위로 오도록 오래된 순으로 정렬합니다."
          density="compact"
        />
        <CardBody density="compact">
          <Meter
            max={total || 1}
            segments={[
              { value: buckets.fresh, tone: "positive", label: "2일 이내" },
              { value: buckets.aging, tone: "warning", label: "3~6일" },
              { value: buckets.late, tone: "critical", label: "7일 이상" },
            ]}
            valueLabel={`${total}건 대기`}
            size="lg"
          />
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            <Legend tone="bg-success" label="2일 이내" value={buckets.fresh} />
            <Legend tone="bg-warn" label="3~6일" value={buckets.aging} />
            <Legend tone="bg-danger" label="7일 이상" value={buckets.late} />
          </div>
          {oldest ? (
            <p className="mt-3 border-t border-line pt-3 text-label text-muted">
              가장 오래 기다린 문서 ·{" "}
              <Link
                href={`/approvals/${oldest.document.id}`}
                className="text-ink hover:text-primary hover:underline"
              >
                {oldest.document.title}
              </Link>{" "}
              <span className="tabular-nums">
                ({elapsedLabel(oldest.document.created_at)} 경과)
              </span>
            </p>
          ) : null}
        </CardBody>
      </Card>

      <ApprovalInbox rows={rows} />
    </>
  );
}

function Legend({
  tone,
  label,
  value,
}: {
  tone: string;
  label: string;
  value: number;
}) {
  return (
    <span className="flex items-center gap-1.5 text-label text-muted">
      <span className={`size-2 rounded-pill ${tone}`} aria-hidden />
      {label}
      <span className="tabular-nums text-ink">{value}건</span>
    </span>
  );
}

/** 목록 행의 단계 상태 — 결재선이 1단계인 문서(기안자가 팀장)도 그대로 그린다 */
function docStepStates(doc: {
  status: DocumentStatus;
  current_step: number;
  steps: { step_order: number }[];
}): { label: string; state: "done" | "current" | "todo" | "rejected" }[] {
  const total = Math.max(doc.steps?.length ?? 0, doc.current_step, 1);

  return Array.from({ length: total }, (_, i) => {
    const order = i + 1;
    const label = stepLabel(order, total);

    if (doc.status === "approved" || doc.status === "completed") {
      return { label, state: "done" as const };
    }
    if (doc.status === "rejected") {
      return {
        label,
        state:
          order < doc.current_step
            ? ("done" as const)
            : order === doc.current_step
              ? ("rejected" as const)
              : ("todo" as const),
      };
    }
    return {
      label,
      state:
        order < doc.current_step
          ? ("done" as const)
          : order === doc.current_step
            ? ("current" as const)
            : ("todo" as const),
    };
  });
}

/** 기간 계산 — 월간/분기/전체 */
function resolvePeriod(view: PeriodView, cursor: string) {
  const today = todayYmd();

  if (view === "all") {
    return {
      label: "전체 기간",
      sublabel: "모든 기안 문서",
      range: {} as { from?: string; to?: string },
      prev: cursor,
      next: cursor,
      includesToday: true,
    };
  }

  if (view === "quarter") {
    const [year, month] = cursor.split("-").map(Number);
    const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
    const start = `${year}-${String(startMonth).padStart(2, "0")}`;
    const from = `${start}-01`;
    const to = lastDayOf(addMonthsYm(start, 2));
    return {
      label: `${year}년 ${Math.floor((startMonth - 1) / 3) + 1}분기`,
      sublabel: `${from} ~ ${to}`,
      range: { from, to },
      prev: addMonthsYm(start, -3),
      next: addMonthsYm(start, 3),
      includesToday: today >= from && today <= to,
    };
  }

  const from = `${cursor}-01`;
  const to = lastDayOf(cursor);
  return {
    label: monthLabel(cursor),
    sublabel: `${from} ~ ${to}`,
    range: { from, to },
    prev: addMonthsYm(cursor, -1),
    next: addMonthsYm(cursor, 1),
    includesToday: today >= from && today <= to,
  };
}

function lastDayOf(ym: string) {
  const [year, month] = ym.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
}
