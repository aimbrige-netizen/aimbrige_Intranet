import type { Metadata } from "next";
import Link from "next/link";
import { FileCheck, FileClock, Hourglass, Inbox, Timer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { METER_FILL, Meter, MiniMeter } from "@/components/ui/Progress";
import { PeriodNavigator } from "@/components/ui/PeriodNavigator";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  FilterChip,
  TableToolbar,
  ToolbarSearch,
} from "@/components/ui/TableToolbar";
import { EmptyState, TableEmptyRow } from "@/components/ui/EmptyState";
import { DataTable, Td, Th } from "@/components/ui/Table";
import { ApprovalStepBar } from "@/features/approvals/ApprovalStepStrip";
import { ApprovalInbox } from "@/features/approvals/ApprovalInbox";
import { requireSessionEmployee } from "@/lib/auth/session";
import {
  bucketByAging,
  getMyApprovalWorkload,
  getMyDocumentStats,
  getMyDocuments,
  getMyPendingApprovals,
  type DocumentListRow,
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
  waitLabel,
} from "@/features/approvals/format";
import { todayYmd } from "@/features/calendar/date";
import {
  parsePeriod,
  periodFields,
  periodHref,
  periodRangeArgs,
  PERIOD_UNIT_LABELS,
  type PeriodSearchParams,
  type PeriodUnit,
} from "@/lib/period";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "전자결재" };

/** 기안 문서는 월·분기·전체로 끊어 본다 (lib/period 규약) */
const UNITS = ["month", "quarter", "all"] as const satisfies readonly PeriodUnit[];
const DEFAULT_UNIT = "month";

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
  searchParams: PeriodSearchParams & {
    tab?: string;
    status?: string;
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
  const period = parsePeriod(searchParams, {
    units: UNITS,
    defaultUnit: DEFAULT_UNIT,
    today,
  });
  const view = period.unit;
  const cursor = period.cursor;

  // 직전 기간 — 요약 밴드의 "전 기간 대비" 비교값
  const previous = parsePeriod(
    { period: view, cursor: period.prevCursor ?? cursor },
    { units: UNITS, defaultUnit: DEFAULT_UNIT, today },
  );

  const status = DOCUMENT_STATUS_ORDER.includes(searchParams.status as DocumentStatus)
    ? (searchParams.status as DocumentStatus)
    : undefined;
  const q = searchParams.q?.trim() || undefined;

  const range = periodRangeArgs(period);

  const [stats, list] = await Promise.all([
    getMyDocumentStats(me.id, range, periodRangeArgs(previous)),
    getMyDocuments(me.id, { ...range, status, q }),
  ]);
  const docs = list.rows;

  /** 기간은 lib/period가, 나머지 조건은 extra가 유지한다 */
  const linkFor = (patch: {
    unit?: PeriodUnit;
    cursor?: string | null;
    status?: DocumentStatus | null;
    q?: string | null;
  }) =>
    periodHref(
      "/approvals",
      {
        unit: patch.unit ?? view,
        cursor: patch.cursor === undefined ? cursor : patch.cursor,
      },
      {
        defaultUnit: DEFAULT_UNIT,
        extra: {
          status: patch.status === undefined ? status : patch.status,
          q: patch.q === undefined ? q : patch.q,
        },
      },
    );

  const done = stats.byStatus.approved + stats.byStatus.completed;
  const delta = stats.total - stats.previousTotal;
  /*
   * 증감은 '기간 총 기안 건수'의 변화라 요약 밴드 전체에 걸린다. 예전에는 평균
   * 소요 카드의 delta 칩으로 붙어 있었는데, 그 카드는 이 기간에 결재가 끝난
   * 문서가 없으면 state="empty"가 되고 StatCard는 그때 delta를 그리지 않는다 —
   * 결재 실적이 없다는 이유로 기안 건수 증감까지 사라졌다. 진행 현황 카드
   * 헤더로 옮겨 두면 0건인 달에도 남는다.
   * previousTotal이 0이면 직전 기간 집계가 실패했을 때와 구분되지 않으므로
   * (data.ts) 그때는 아예 말하지 않는다.
   */
  const deltaLabel =
    view === "all" || stats.unavailable || stats.previousTotal === 0
      ? null
      : `${previous.label} 대비 ${delta > 0 ? "+" : ""}${delta}건`;
  /** 0건이면 분모(/0건)도 유형별 0/0 격자도 뜻이 없다 */
  const hasDocs = !stats.unavailable && stats.total > 0;
  const denominator = hasDocs ? stats.total : undefined;

  return (
    <>
      <PageHeader
        title="내가 올린 문서"
        /*
         * 기준을 한 줄로 밝힌다. 관리자 대시보드가 같은 함수로 같은 숫자를 내는데,
         * 여기만 무엇을 재는지 말하지 않으면 두 화면이 다른 것을 센다고 읽힌다.
         * 카드 sub은 한 줄로 잘리므로(StatCard) 규칙은 여기서 한 번만 말한다.
         *
         * 목록만 옛 기준으로 떨어지는 경우가 있다(뷰 조회 실패). 요약 밴드는
         * 따로 성공할 수 있어 그때 아무 경고도 뜨지 않으므로, 선언을 사실에
         * 맞춰 바꾼다 — 표와 요약 밴드가 다른 기준이라는 것을 여기서 말한다.
         */
        description={
          list.basis === "submitted"
            ? "기간은 상신한 시각, 소요는 결재가 끝난 시각으로 셉니다 · 임시저장은 만든 시각"
            : "아래 표만 문서를 만든 시각으로 잘렸습니다 — 요약 밴드(상신한 시각)와 기준이 다릅니다"
        }
        meta={meta}
        toolbar={
          <PeriodNavigator
            label={period.label}
            sublabel={view === "all" ? "모든 기안 문서" : period.sublabel}
            prevHref={
              period.prevCursor ? linkFor({ cursor: period.prevCursor }) : undefined
            }
            nextHref={
              period.nextCursor ? linkFor({ cursor: period.nextCursor }) : undefined
            }
            todayHref={linkFor({ cursor: null })}
            atToday={period.includesToday}
            className="mb-0"
            right={
              <SegmentedControl
                options={UNITS.map((unit) => ({
                  value: unit,
                  label: PERIOD_UNIT_LABELS[unit],
                  // 지난 기간을 보는 중이면 단위를 바꿔도 그 지점에 머문다
                  href: linkFor({
                    unit,
                    cursor: period.includesToday ? null : cursor,
                  }),
                }))}
                value={view}
                ariaLabel="조회 기간 단위"
              />
            }
          />
        }
      />

      {/*
        요약 밴드 — 모든 숫자에 분모를 붙인다.
        집계를 못 불러오면(마이그레이션 26 미적용 등) 카드마다 state="empty"로
        떨어진다. 0건으로 그리면 사용자가 그 0을 사실로 믿는다.
      */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="진행중"
          value={stats.byStatus.pending}
          unit="건"
          denominator={denominator}
          denominatorUnit="건"
          tone="informative"
          icon={Hourglass}
          max={stats.total || 1}
          meterValue={stats.byStatus.pending}
          state={stats.unavailable ? "empty" : "ok"}
          sub={
            stats.unavailable
              ? "집계를 불러오지 못했습니다"
              : stats.pendingNow > 0
                ? /*
                     큰 숫자는 기간 안, 이 줄은 기간과 무관한 '지금' 값이다.
                     모집단이 다르므로 "지금"을 붙여 어느 쪽을 센 건지 밝힌다.
                   */
                  `지금 진행중 ${stats.pendingNow}건 · 최장 ${stats.oldestPendingDays}일 대기`
                : "결재 대기 문서 없음"
          }
        />
        <StatCard
          label="승인·시행완료"
          value={done}
          unit="건"
          denominator={denominator}
          denominatorUnit="건"
          tone="positive"
          icon={FileCheck}
          max={stats.total || 1}
          meterValue={done}
          state={stats.unavailable ? "empty" : "ok"}
          sub={
            stats.unavailable
              ? "집계를 불러오지 못했습니다"
              : `시행완료 ${stats.byStatus.completed}건 포함`
          }
        />
        <StatCard
          label="반려"
          value={stats.byStatus.rejected}
          unit="건"
          denominator={denominator}
          denominatorUnit="건"
          tone={stats.byStatus.rejected > 0 ? "critical" : "neutral"}
          icon={FileClock}
          max={stats.total || 1}
          meterValue={stats.byStatus.rejected}
          state={stats.unavailable ? "empty" : "ok"}
          sub={
            stats.unavailable
              ? "집계를 불러오지 못했습니다"
              : stats.byStatus.rejected > 0
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
          state={
            stats.unavailable || stats.avgDecisionDays === null ? "empty" : "ok"
          }
          sub={
            stats.unavailable
              ? "집계를 불러오지 못했습니다"
              : stats.avgDecisionDays === null
                ? "이 기간에 결재가 끝난 문서가 없습니다"
                : /* 상신부터 마지막 승인·반려까지. 시행완료를 누른 시각이 아니다 */
                  `상신 → 결재까지 · 이 기간 ${stats.decidedCount}건 기준`
          }
        />
      </div>

      {/*
        시각화 — 상태 구성과 유형 분포를 한 화면에서 본다.
        흰 시트 위 카드 해체(10 스윕): md+는 SectionHeader + 내용 직접 배치,
        md 미만은 canvas 위 카드 문법이 그대로라 ab-card 면을 유지한다
        (CalendarBoard와 같은 전환).
      */}
      <section className="mb-5">
        <SectionHeader
          title="결재 진행 현황"
          description={
            stats.unavailable
              ? "집계를 불러오지 못했습니다"
              : [`${period.label} 기안 ${stats.total}건`, deltaLabel]
                  .filter(Boolean)
                  .join(" · ")
          }
        />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          {stats.unavailable ? (
            <EmptyState
              compact
              icon={FileCheck}
              title="집계를 불러오지 못했습니다"
              description="아래 목록은 그대로 볼 수 있습니다. 잠시 후 다시 시도해 주세요."
            />
          ) : /*
               0건이면 미터도 유형별 줄도 전부 0/0이 된다. NaN은 나지 않지만
               화면 절반이 뜻 없는 격자가 되므로 상태 구성 자체를 그리지 않는다.
             */
          stats.total === 0 ? (
            <EmptyState
              compact
              icon={FileCheck}
              title="이 기간에 기안한 문서가 없습니다"
              description="문서를 올리면 상태 구성과 유형 분포가 여기에 쌓입니다."
            />
          ) : (
            <>
              <Meter
                max={stats.total}
                segments={[
                  { value: done, tone: "positive", label: "승인·시행완료" },
                  {
                    value: stats.byStatus.pending,
                    tone: "informative",
                    label: "진행중",
                  },
                  {
                    value: stats.byStatus.rejected,
                    tone: "critical",
                    label: "반려",
                  },
                ]}
                valueLabel={`${done + stats.byStatus.pending + stats.byStatus.rejected} / ${stats.total}건`}
                size="lg"
              />
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                <Legend
                  tone={METER_FILL.positive}
                  label="승인·시행완료"
                  value={done}
                />
                <Legend
                  tone={METER_FILL.informative}
                  label="진행중"
                  value={stats.byStatus.pending}
                />
                <Legend
                  tone={METER_FILL.critical}
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
                      <TypeIcon
                        className="size-3.5 shrink-0 text-muted"
                        aria-hidden
                      />
                      <span className="w-24 shrink-0 truncate text-label text-ink">
                        {DOCUMENT_TYPE_META[type].short}
                      </span>
                      <MiniMeter
                        value={count}
                        max={stats.total}
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
            </>
          )}
        </div>
      </section>

      {/* 검색·상태 필터 — 각 필터가 몇 건인지 누르기 전에 보인다 */}
      <form action="/approvals" method="get">
        {/* 검색을 눌러도 보고 있던 기간·상태가 유지되게 같은 이름으로 실어 보낸다 */}
        {periodFields({ unit: view, cursor }, DEFAULT_UNIT).map((field) => (
          <input
            key={field.name}
            type="hidden"
            name={field.name}
            value={field.value}
          />
        ))}
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
              {/* 집계를 못 불러왔으면 건수를 아예 그리지 않는다 — 0으로 적으면 거짓말이다 */}
              <FilterChip
                href={linkFor({ status: null })}
                active={!status}
                count={stats.unavailable ? undefined : stats.total}
              >
                전체
              </FilterChip>
              {DOCUMENT_STATUS_ORDER.map((value) => (
                <FilterChip
                  key={value}
                  href={linkFor({ status: value })}
                  active={status === value}
                  count={stats.unavailable ? undefined : stats.byStatus[value]}
                >
                  {DOCUMENT_STATUS_LABELS[value]}
                </FilterChip>
              ))}
            </>
          }
          count={`${docs.length}건 표시`}
        />
      </form>

      {/* 표는 시트 위에 그대로 — md 미만만 카드 면 유지 (07 표 문법) */}
      <div className="ab-card md:rounded-none md:border-0">
        <DataTable minWidth={860}>
            <thead>
              <tr>
                <Th className="w-24">문서유형</Th>
                <Th>제목</Th>
                <Th className="w-44">핵심값</Th>
                <Th className="w-40">결재 진행</Th>
                <Th className="w-24">상태</Th>
                <Th className="w-32">기안일</Th>
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
                  /*
                    기안 화면의 빈 상태에서 할 일은 "문서를 올린다" 하나다.
                    가장 흔한 경비청구서를 브랜드색 버튼으로 앞세우고, 출장신청서는
                    그 옆 secondary로 둔다 — 둘 다 채운 버튼이면 어느 쪽이 기본인지
                    알 수 없고, 둘 다 회색이면 갈 곳이 없어 보인다.
                  */
                  cta={{ label: "경비청구서 기안", href: "/approvals/new/expense" }}
                  action={
                    <LinkButton
                      href="/approvals/new/business_trip"
                      size="small"
                      variant="secondary"
                    >
                      출장신청서 기안
                    </LinkButton>
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
                  const timing = docTiming(doc);

                  return (
                    <tr key={doc.id}>
                      <Td nowrap>
                        <span className="flex items-center gap-1.5">
                          <TypeIcon
                            className="size-3.5 shrink-0 text-muted"
                            aria-hidden
                          />
                          {typeMeta.short}
                        </span>
                      </Td>
                      <Td>
                        {/*
                          임시저장은 상세(결재 진행 화면)가 아니라 작성 폼으로
                          보낸다. 결재선도 이력도 없는 문서를 상세로 열면
                          빈 껍데기만 보인다.
                        */}
                        <Link
                          href={
                            doc.status === "draft"
                              ? `/approvals/new/${doc.document_type}?draft=${doc.id}`
                              : `/approvals/${doc.id}`
                          }
                          className="text-ink hover:text-primary hover:underline"
                        >
                          {doc.title}
                        </Link>
                      </Td>
                      <Td numeric>
                        {highlight ? (
                          <>
                            <span className="block text-ink">
                              {highlight.text}
                            </span>
                            {highlight.sub ? (
                              <span className="block truncate text-micro text-muted">
                                {highlight.sub}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </Td>
                      <Td>
                        <ApprovalStepBar steps={docStepStates(doc)} />
                      </Td>
                      <Td>
                        <Badge tone={DOCUMENT_STATUS_TONES[doc.status]}>
                          {DOCUMENT_STATUS_LABELS[doc.status]}
                        </Badge>
                      </Td>
                      <Td numeric nowrap>
                        <span className="block text-ink">
                          {/* 요약 밴드와 같은 기준 시각 — 표만 created_at으로 두면 두 숫자가 갈린다 */}
                          {formatDate(doc.period?.effective_at ?? doc.created_at)}
                        </span>
                        {timing ? (
                          <span className="block text-micro text-muted">
                            {timing}
                          </span>
                        ) : null}
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </DataTable>
      </div>
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
    // 결재선에 올라온 날 — 기안자가 임시저장을 만든 날이 아니다
    arrivedAt: formatDate(row.arrivedAt),
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

      {/* 흰 시트 위 카드 해체(10 스윕) — md+는 섹션 직접 배치, md 미만은 카드 면 유지 */}
      <section className="mb-5">
        <SectionHeader
          title="대기 경과 분포"
          description="오래 묵은 문서가 목록 위로 오도록 오래된 순으로 정렬합니다."
        />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
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
            <Legend
              tone={METER_FILL.positive}
              label="2일 이내"
              value={buckets.fresh}
            />
            <Legend
              tone={METER_FILL.warning}
              label="3~6일"
              value={buckets.aging}
            />
            <Legend
              tone={METER_FILL.critical}
              label="7일 이상"
              value={buckets.late}
            />
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
                ({elapsedLabel(oldest.arrivedAt)} 경과)
              </span>
            </p>
          ) : null}
        </div>
      </section>

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

/**
 * 기안일 아래 한 줄.
 *
 * 예전에는 결재가 끝난 문서에 `소요 = updated_at - created_at`을 찍었다.
 * touch_updated_at 트리거가 모든 UPDATE마다 updated_at을 밀기 때문에 그건
 * '결재까지'가 아니라 '마지막으로 손댈 때까지'였고, 시행완료를 뒤늦게 누른
 * 문서일수록 길어졌다 — 요약 밴드가 고친 바로 그 문제다. 이제 상신·결재 시각
 * (approval_document_periods)으로 잰다.
 *
 * 시각을 못 들고 온 행은 지어내지 않고 줄을 접는다.
 */
function docTiming(doc: DocumentListRow): string | null {
  if (doc.status === "draft") return "상신 전";

  const submitted = doc.period?.submitted_at;
  if (!submitted) return null;
  if (doc.status === "pending") return `${elapsedDays(submitted)}일 경과`;

  const decided = doc.period?.decided_at;
  return decided ? `결재까지 ${waitLabel(submitted, decided)}` : null;
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

