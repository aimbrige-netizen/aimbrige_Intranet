import type { Metadata } from "next";
import Link from "next/link";
import { FileCheck, Hourglass, Inbox, Timer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { METER_FILL, Meter } from "@/components/ui/Progress";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import { DataTable, Td, Th } from "@/components/ui/Table";
import { ApprovalInbox } from "@/features/approvals/ApprovalInbox";
import { requireSessionEmployee } from "@/lib/auth/session";
import {
  bucketByAging,
  getMyApprovalWorkload,
  getMyDocuments,
  getMyPendingApprovals,
  type DocumentListRow,
  type MyDocumentList,
} from "@/features/approvals/data";
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_TONES,
  DOCUMENT_TYPE_META,
  type DocumentType,
} from "@/features/approvals/types";
import {
  documentHighlight,
  elapsedLabel,
  stepLabel,
} from "@/features/approvals/format";
import { todayYmd } from "@/features/calendar/date";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "전자결재" };

/**
 * 결재 홈 (daou-survey/15-approval-home.md 실측 재구축).
 *
 * 다우 결재 홈 구성 그대로 — 콘텐츠 제목 "결재 홈" 20/500 아래 섹션 3개:
 * 결재할 문서 → 기안 진행 문서 → 완료 문서. 섹션 제목 14/600 + 07 표 문법.
 *
 * 종전의 지표 밴드(StatCard 4칸)·"결재 진행 현황" 미터·기간 스테퍼·상태
 * 필터는 다우 결재 홈에 없어서 걷어냈다. 카운트(내 차례·진행중·임시저장)는
 * 패널 "결재하기" 섹션으로 갔다(ApprovalPanelSections — layout이 채운다).
 *
 * 결재 대기함(?tab=inbox)·상세·기안 화면과 데이터 조회는 그대로다 —
 * 표시 계층만 바꿨다(e2e:approval 불변의 근거).
 */
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const me = await requireSessionEmployee();

  const pending = await getMyPendingApprovals(me.id);

  /**
   * 결재함 노출 기준.
   * 스펙 3.1은 "팀장/매니저·시스템 관리자만"이라고 했지만, 최종 승인자는 관리자가
   * 임직원 중 누구든 지정할 수 있다(역할과 무관). 역할로만 가리면 일반직원으로
   * 지정된 최종 승인자가 자기 결재 목록을 아예 못 보게 된다.
   */
  const canSeeInbox = me.isManager || pending.length > 0;

  if (searchParams.tab === "inbox" && canSeeInbox) {
    return <InboxView me={me} pending={pending} today={todayYmd()} />;
  }

  // ── 결재 홈 ────────────────────────────────────────────────────────
  /*
   * 목록 조회 함수(getMyDocuments)는 그대로 두고 호출만 상태별로 나눈다.
   * 전체 최신순 200건을 한 번에 받아 여기서 상태로 쪼개면, 문서가 200건을
   * 넘는 직원은 최근 문서가 한쪽 상태(예: 완료)로 쏠려 다른 섹션이 실제
   * 문서가 있는데도 거짓 빈 상태를 보인다 — 패널 카운트(진행중 n)와도
   * 어긋난다. 상태별 조회면 섹션마다 최근 200건이 온전히 담긴다.
   */
  const [inProgressLists, doneLists] = await Promise.all([
    Promise.all(
      IN_PROGRESS_STATUSES.map((status) => getMyDocuments(me.id, { status })),
    ),
    Promise.all(
      DONE_STATUSES.map((status) => getMyDocuments(me.id, { status })),
    ),
  ]);
  const inProgress = mergeByRecency(inProgressLists);
  const done = mergeByRecency(doneLists);

  return (
    <>
      {/*
        콘텐츠 제목 "결재 홈" 20/500 — PageHeader급 밴드 없음(15 실측).
        줄높이 30px은 06 heading-l 실측(게시글 제목 PostDetailView와 같은 단).
      */}
      <h1 className="mb-5 text-[20px] font-medium leading-[30px] text-ink">
        결재 홈
      </h1>

      {/* 1. 결재할 문서 — 지금 내 차례인 문서, 오래된 순(방치 방지) */}
      <section className="mb-6">
        <SectionHeader title="결재할 문서" />
        <div className="ab-card md:rounded-none md:border-0">
          <DataTable minWidth={800}>
            <thead>
              <tr>
                <Th className="w-28">상신일</Th>
                <Th className="w-36">양식</Th>
                <Th>제목</Th>
                <Th className="w-40">기안자</Th>
                <Th className="w-20">첨부</Th>
                <Th className="w-24">상태</Th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 ? (
                /* 빈 상태 문구는 다우 원문 그대로 — 14px faint 중앙(07 문법) */
                <TableEmptyRow colSpan={6} title="결재할 문서가 없습니다." />
              ) : (
                pending.map((row) => {
                  const requesterSub =
                    [
                      row.document.requester?.department?.name,
                      row.document.requester?.position,
                    ]
                      .filter(Boolean)
                      .join(" · ") || null;
                  return (
                    <tr key={row.document.id}>
                      <Td numeric nowrap>
                        {/* 결재선에 올라온 날 = 상신일 (data.ts arrivedAt) */}
                        {formatDate(row.arrivedAt)}
                      </Td>
                      <Td nowrap>
                        {DOCUMENT_TYPE_META[row.document.document_type].label}
                      </Td>
                      <Td>
                        <Link
                          href={`/approvals/${row.document.id}`}
                          className="text-ink hover:text-primary-ink hover:underline"
                        >
                          {row.document.title}
                        </Link>
                      </Td>
                      <Td>
                        <span className="block truncate text-ink">
                          {row.document.requester?.name ?? "-"}
                        </span>
                        {requesterSub ? (
                          <span className="block truncate text-nano text-muted">
                            {requesterSub}
                          </span>
                        ) : null}
                      </Td>
                      <Td>
                        <AttachCell
                          type={row.document.document_type}
                          formData={row.document.form_data}
                        />
                      </Td>
                      <Td>
                        <Badge tone={DOCUMENT_STATUS_TONES[row.document.status]}>
                          {DOCUMENT_STATUS_LABELS[row.document.status]}
                        </Badge>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </DataTable>
        </div>
      </section>

      {/* 2. 기안 진행 문서 — 내가 올린 문서 중 아직 끝나지 않은 것 */}
      <section className="mb-6">
        <SectionHeader title="기안 진행 문서" />
        <MyDocsTable
          rows={inProgress}
          emptyText="진행 중인 기안 문서가 없습니다."
        />
      </section>

      {/* 3. 완료 문서 — 승인·시행완료·반려 */}
      <section className="mb-6 last:mb-0">
        <SectionHeader title="완료 문서" />
        <MyDocsTable rows={done} emptyText="완료된 문서가 없습니다." />
      </section>
    </>
  );
}

/*
 * 임시저장은 "기안 진행 문서"에 함께 둔다. 다우는 임시 저장 문서함이
 * 따로 있지만 우리에게 그 화면이 없다 — 표에서 빼면 이어서 작성할
 * 길이 사라진다. 상태 컬럼(임시저장 배지)이 진행중과 갈라 준다.
 */
const IN_PROGRESS_STATUSES = ["pending", "draft"] as const;
// 완료 = 결재가 끝난 문서. 반려도 여기다 — 상태 배지가 결과를 말한다.
const DONE_STATUSES = ["approved", "completed", "rejected"] as const;

/**
 * 상태별로 나눠 받은 목록을 한 표로 합친다. 정렬 키는 표의 '상신일' 컬럼이
 * 찍는 값 그대로(effective_at, 없으면 created_at) — 정렬 키와 사용자가
 * 읽는 열이 같아야 한다(data.ts 뷰 정렬과 같은 원칙).
 */
function mergeByRecency(lists: MyDocumentList[]): DocumentListRow[] {
  return lists
    .flatMap((list) => list.rows)
    .sort(
      (a, b) =>
        Date.parse(b.period?.effective_at ?? b.created_at) -
        Date.parse(a.period?.effective_at ?? a.created_at),
    );
}

/**
 * 내가 올린 문서 표 — 15 컬럼 매핑: 상신일 · 양식 · 제목 · 첨부 · 상태.
 * (기안자 컬럼은 결재할 문서 표에만 있다 — 여기는 전부 나다)
 */
function MyDocsTable({
  rows,
  emptyText,
}: {
  rows: DocumentListRow[];
  emptyText: string;
}) {
  return (
    <div className="ab-card md:rounded-none md:border-0">
      <DataTable minWidth={680}>
        <thead>
          <tr>
            <Th className="w-28">상신일</Th>
            <Th className="w-36">양식</Th>
            <Th>제목</Th>
            <Th className="w-20">첨부</Th>
            <Th className="w-24">상태</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <TableEmptyRow colSpan={5} title={emptyText} />
          ) : (
            rows.map((doc) => (
              <tr key={doc.id}>
                <Td numeric nowrap>
                  {doc.status === "draft" ? (
                    // 임시저장은 아직 상신 전 — 날짜를 지어내지 않는다
                    <span className="text-muted">-</span>
                  ) : (
                    /* 요약 집계와 같은 기준 시각 — created_at만 찍으면 두 숫자가 갈린다 */
                    formatDate(doc.period?.effective_at ?? doc.created_at)
                  )}
                </Td>
                <Td nowrap>{DOCUMENT_TYPE_META[doc.document_type].label}</Td>
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
                    className="text-ink hover:text-primary-ink hover:underline"
                  >
                    {doc.title}
                  </Link>
                </Td>
                <Td>
                  <AttachCell type={doc.document_type} formData={doc.form_data} />
                </Td>
                <Td>
                  <Badge tone={DOCUMENT_STATUS_TONES[doc.status]}>
                    {DOCUMENT_STATUS_LABELS[doc.status]}
                  </Badge>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>
    </div>
  );
}

/**
 * 첨부 컬럼(15 매핑).
 *
 * 목록 조회에는 approval_attachments가 실리지 않는다 — 조회를 바꾸지
 * 않는다는 규칙(데이터 경로 불변) 안에서는 form_data가 이미 들고 오는
 * 경비 영수증만 셀 수 있다. 그 외 유형은 모른다고 접는다('-') —
 * 0건이라 지어내는 것보다 낫다. 첨부 테이블까지 세려면 목록 조회에
 * 조인이 필요하다(다음 데이터 사이클 몫).
 */
function receiptCount(
  type: DocumentType,
  formData: Record<string, unknown> | null | undefined,
): number {
  if (type !== "expense") return 0;
  const items =
    (formData?.items as { receiptUrl?: string | null }[] | undefined) ?? [];
  return items.filter(
    (item) => typeof item.receiptUrl === "string" && item.receiptUrl.length > 0,
  ).length;
}

function AttachCell({
  type,
  formData,
}: {
  type: DocumentType;
  formData: Record<string, unknown> | null | undefined;
}) {
  const count = receiptCount(type, formData);
  if (count === 0) return <span className="text-muted">-</span>;
  // 07 표 문법은 아이콘 없는 순수 텍스트 셀 — 양식 컬럼에서 TypeIcon을
  // 걷어낸 것과 같은 이유로 여기도 건수만 찍는다("첨부" 헤더가 맥락).
  return <span className="tabular-nums text-ink">{count}</span>;
}

/** 결재함 — 결재자가 '처리하러' 들어오는 화면 (?tab=inbox, 기존 구성 유지) */
async function InboxView({
  me,
  pending,
  today,
}: {
  me: Awaited<ReturnType<typeof requireSessionEmployee>>;
  pending: Awaited<ReturnType<typeof getMyPendingApprovals>>;
  today: string;
}) {
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
                className="text-ink hover:text-primary-ink hover:underline"
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
