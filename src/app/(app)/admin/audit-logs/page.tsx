import type { Metadata } from "next";
import Link from "next/link";
import { GitBranch, KeyRound, LogIn, ScrollText, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { PeriodNavigator } from "@/components/ui/PeriodNavigator";
import { StatCard, type StatTone } from "@/components/ui/StatCard";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { AuditExportButton } from "@/features/audit/AuditExportButton";
import { AuditFilters } from "@/features/audit/AuditFilters";
import {
  actionsOfGroup,
  AUDIT_ACTION_LABELS,
  AUDIT_GROUPS,
} from "@/features/audit/constants";
import {
  AUDIT_PAGE_SIZE,
  getAuditActionCounts,
  listAuditLogs,
} from "@/features/audit/data";
import { requireSystemAdmin } from "@/lib/auth/session";
import {
  ariaSortOf,
  parseSortDir,
  parseSortKey,
  SortHeaderLink,
  toggledDir,
  type SortDir,
} from "@/lib/sort";
import { createServerSupabase } from "@/lib/supabase/server";
import { parsePeriod, type PeriodUnit } from "@/lib/period";
import { formatDateTime } from "@/lib/utils";
import { addDaysYmd, todayYmd } from "@/features/calendar/date";
import type { AuditLog } from "@/types/db";

export const metadata: Metadata = { title: "감사 로그" };

/** 내보내기는 페이지가 아니라 조건 전체를 담는다. 상한만 걸어 둔다 */
const EXPORT_LIMIT = 500;

/**
 * 기본 조회 구간. 없으면 전 기간이 무한히 누적돼 "최근에 무슨 일이
 * 있었나"를 보려는 화면이 매년 느려지고, 요약 밴드의 분모도 의미를 잃는다.
 */
const DEFAULT_RANGE_DAYS = 30;

/**
 * 이 화면이 지원하는 기간 단위 (lib/period 규약).
 * 기본은 custom — 감사 조회는 "최근 30일"·"올해" 같은 일수 프리셋으로 오고,
 * 그건 달력 경계가 아니라 임의 구간이라 from/to로만 정확히 적힌다.
 * 그래도 주간·월간·분기·연간을 함께 받는 이유는, 근태·결재에서 보던 구간을
 * 그대로 들고 넘어오는 링크(?period=month&cursor=)를 버리지 않기 위해서다.
 */
const AUDIT_UNITS = [
  "custom",
  "week",
  "month",
  "quarter",
  "year",
] as const satisfies readonly PeriodUnit[];

const ACTION_TONES: Record<
  string,
  "neutral" | "primary" | "success" | "warn" | "danger"
> = {
  login: "neutral",
  login_denied: "danger",
  employee_created: "success",
  employee_updated: "primary",
  employment_status_changed: "warn",
  role_changed: "warn",
  profile_updated: "neutral",
};

/** 감사 로그에 노출할 필드 라벨 */
const FIELD_LABELS: Record<string, string> = {
  name: "이름",
  email: "이메일",
  department_id: "부서",
  team_id: "팀",
  position: "직급",
  hire_date: "입사일",
  role_id: "역할",
  role: "역할",
  employment_status: "재직상태",
  phone: "휴대폰",
  emergency_contact: "비상연락처",
  profile_image_url: "프로필 사진",
  reason: "사유",
};

const STATUS_LABELS: Record<string, string> = {
  active: "재직중",
  leave: "휴직",
  terminated: "퇴사",
  not_registered: "미등록 계정",
};

const GROUP_ICONS: Record<string, LucideIcon> = {
  auth: LogIn,
  access: KeyRound,
  hr: Users,
  org: ScrollText,
  approval: GitBranch,
};

/** 그룹별 기본 톤 — 권한 변경만 경고 축에 둔다 */
const GROUP_TONES: Record<string, StatTone> = {
  auth: "neutral",
  access: "warning",
  hr: "informative",
  org: "neutral",
  approval: "neutral",
};

/** 정렬 가능한 컬럼. 행위자·대상은 임베드/조인이라 서버 정렬이 안 된다 */
const AUDIT_SORT_KEYS = ["created_at", "action"] as const;
type AuditSortKey = (typeof AUDIT_SORT_KEYS)[number];

/**
 * 목록 파라미터 규약: q / sort / dir / page + 기간(period·cursor·from·to,
 * lib/period) + 이 화면 고유의 group / action / target.
 * 임직원 목록과 같은 이름을 쓴다.
 */
interface SearchParams {
  q?: string;
  group?: string;
  action?: string;
  period?: string;
  cursor?: string;
  from?: string;
  to?: string;
  page?: string;
  target?: string;
  sort?: string;
  dir?: string;
}

/** 'yyyy-MM-dd' 두 개 사이의 일수 (양끝 포함) */
function spanDays(from: string, to: string): number {
  const diff =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86_400_000;
  return Math.max(1, Math.round(diff) + 1);
}

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const today = todayYmd();
  /*
   * 기간은 ?period=custom&from=&to= 로 읽는다 (lib/period 규약).
   * URL에 아무것도 없으면 최근 30일을 파서에 넣어 확정한다 — 화면에는 언제나
   * 실제 조회 중인 구간이 보여야 하고, 뒤집힌 구간도 파서가 바로잡는다.
   */
  const period = parsePeriod(
    {
      ...searchParams,
      to: searchParams.to || today,
      from:
        searchParams.from ||
        addDaysYmd(searchParams.to || today, -(DEFAULT_RANGE_DAYS - 1)),
    },
    { units: AUDIT_UNITS, defaultUnit: "custom", today },
  );
  const rangeFrom = period.from;
  const rangeTo = period.to;
  const isDefaultRange =
    !searchParams.period &&
    !searchParams.cursor &&
    !searchParams.from &&
    !searchParams.to;

  const q = (searchParams.q ?? "").trim();
  const searching = q.length > 0;

  /**
   * 이름 검색은 행위자를 조인해야 해서 list_audit_logs RPC로만 된다.
   * 그 함수는 액션을 하나까지만 받고 정렬이 최신순으로 고정돼 있어
   * 그룹(액션 여러 개)·대상·정렬을 함께 걸 수 없다. 그래서 검색 중에는
   * 그 셋을 아예 떨어뜨린다 — 걸리지도 않은 필터가 켜진 것처럼 보이는
   * 쪽이 더 나쁘다. 액션 하나는 검색과 함께 걸린다.
   */
  const group = searching ? "" : (searchParams.group ?? "");
  const target = searching ? "" : (searchParams.target ?? "");
  const action = searchParams.action ?? "";
  const groupActions = actionsOfGroup(group);

  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);
  const offset = (page - 1) * AUDIT_PAGE_SIZE;

  const sortKey: AuditSortKey = parseSortKey(searchParams.sort, AUDIT_SORT_KEYS);
  // 감사 로그의 기본은 최신순이다. dir이 없으면 시각만 내림차순으로 시작한다
  const sortDir: SortDir = searchParams.dir
    ? parseSortDir(searchParams.dir)
    : sortKey === "created_at"
      ? "desc"
      : "asc";
  const ascending = sortDir === "asc";

  const filters = {
    from: rangeFrom,
    to: rangeTo,
    q,
    action,
    actions: groupActions as string[] | null,
    target,
    // 검색 경로는 최신순 고정이라 정렬 헤더도 함께 접는다
    sortKey: searching ? ("created_at" as const) : sortKey,
    ascending: searching ? false : ascending,
  };

  /** 기간(+대상) 안의 건수 — 액션별 건수를 못 받았을 때의 대비 경로 */
  const countInPeriod = async (actions?: string[]) => {
    let query = supabase
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", `${rangeFrom}T00:00:00+09:00`)
      .lt("created_at", `${addDaysYmd(rangeTo, 1)}T00:00:00+09:00`);
    if (target) query = query.eq("target_id", target);
    if (actions) query = query.in("action", actions);
    const { count } = await query;
    return count ?? 0;
  };

  const [list, exportList, actionCounts] = await Promise.all([
    listAuditLogs({ ...filters, limit: AUDIT_PAGE_SIZE, offset }),
    listAuditLogs({ ...filters, limit: EXPORT_LIMIT, offset: 0 }),
    getAuditActionCounts(rangeFrom, rangeTo),
  ]);

  /*
   * 요약 밴드는 액션별 건수를 합쳐 만든다 — 그룹마다 count 쿼리를 던지던
   * 여섯 번의 왕복이 한 번으로 준다. 대상으로 좁혀 볼 때는 그 함수가
   * 대상을 받지 않으므로 직접 센다(밴드의 분모가 표와 어긋나면 안 된다).
   */
  const sumOf = (keys: readonly string[]) =>
    keys.reduce((sum, key) => sum + (actionCounts?.[key] ?? 0), 0);

  let rangeTotal: number;
  let deniedCount: number;
  let groupCounts: number[];

  if (actionCounts && !target) {
    rangeTotal = sumOf(Object.keys(actionCounts));
    deniedCount = actionCounts["login_denied"] ?? 0;
    groupCounts = AUDIT_GROUPS.map((item) => sumOf(item.actions));
  } else {
    const [total, denied, counts] = await Promise.all([
      countInPeriod(),
      countInPeriod(["login_denied"]),
      Promise.all(AUDIT_GROUPS.map((item) => countInPeriod(item.actions))),
    ]);
    rangeTotal = total;
    deniedCount = denied;
    groupCounts = counts;
  }

  const logs = list.rows;
  const exportLogs = exportList.rows;
  const total = list.total;

  // 대상(target_id)이 임직원인 경우 이름을 함께 보여준다 (내보내기도 같은 이름을 쓴다)
  const targetIds = Array.from(
    new Set(
      [...logs, ...exportLogs]
        .map((log) => log.targetId)
        .filter((id): id is string => !!id),
    ),
  );
  const targetNames = new Map<string, string>();
  if (targetIds.length > 0) {
    const { data: targets } = await supabase
      .from("employees")
      .select("id, name")
      .in("id", targetIds);
    (targets ?? []).forEach((row) => targetNames.set(row.id, row.name));
  }

  const presets = [
    { label: "최근 7일", from: addDaysYmd(today, -6) },
    { label: "최근 30일", from: addDaysYmd(today, -29) },
    { label: "최근 90일", from: addDaysYmd(today, -89) },
    // 감사 요청은 대개 연 단위로 온다. 전 기간 대신 올해로 상한을 준다
    { label: "올해", from: `${today.slice(0, 4)}-01-01` },
  ];

  /**
   * 링크는 현재 조건을 그대로 이어받는다. 페이지만 버린다.
   * 검색 중이라 지금은 걸리지 않은 그룹·대상도 URL에는 들고 간다 —
   * 검색을 풀면 보고 있던 필터로 돌아오게 하기 위해서다.
   */
  const hrefWith = (patch: Partial<Record<keyof SearchParams, string>>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q: q || undefined,
      group: searchParams.group,
      action: action || undefined,
      target: searchParams.target,
      period: searchParams.period,
      cursor: searchParams.cursor,
      from: searchParams.from,
      to: searchParams.to,
      sort: searching ? undefined : searchParams.sort,
      dir: searching ? undefined : searchParams.dir,
      ...patch,
    };
    Object.entries(merged).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const search = params.toString();
    return search ? `/admin/audit-logs?${search}` : "/admin/audit-logs";
  };

  /*
   * 스테퍼. 임의 구간(custom)은 지금 보고 있는 길이만큼 통째로 옮기고,
   * 달력 단위로 들어온 링크는 파서가 준 이전/다음 기준점으로 옮긴다.
   */
  const windowDays = spanDays(rangeFrom, rangeTo);
  const stepHref = (direction: -1 | 1) => {
    if (period.unit === "custom") {
      const days = windowDays * direction;
      return hrefWith({
        period: "custom",
        cursor: undefined,
        from: addDaysYmd(rangeFrom, days),
        to: addDaysYmd(rangeTo, days),
      });
    }
    const next = direction < 0 ? period.prevCursor : period.nextCursor;
    return hrefWith({
      period: period.unit,
      cursor: next ?? undefined,
      from: undefined,
      to: undefined,
    });
  };

  // 그룹·대상·정렬은 검색과 함께 걸리지 않는다 — 누르면 검색어를 놓는다
  const groupHref = (key: string) =>
    hrefWith({
      group: group === key ? undefined : key,
      // 그룹을 바꾸면 이전 그룹의 정밀 액션은 의미가 없다
      action: undefined,
      q: undefined,
    });

  const sortHref = (key: AuditSortKey) =>
    hrefWith({
      sort: key,
      dir: toggledDir(
        sortKey === key,
        sortDir,
        key === "created_at" ? "desc" : "asc",
      ),
    });

  const sortableHeader = (key: AuditSortKey, label: string) => {
    const current = sortKey === key;
    return {
      "aria-sort": ariaSortOf(current, sortDir),
      children: (
        <SortHeaderLink
          href={sortHref(key)}
          label={label}
          active={current}
          dir={sortDir}
        />
      ),
    };
  };

  const timeHeader = searching ? null : sortableHeader("created_at", "시각");
  const actionHeader = searching ? null : sortableHeader("action", "액션");

  const exportRows = exportLogs.map((log) => ({
    at: formatDateTime(log.createdAt),
    actor: log.actorName ?? "시스템",
    actorEmail: log.actorEmail ?? "",
    action: AUDIT_ACTION_LABELS[log.action] ?? log.action,
    target: log.targetId ? (targetNames.get(log.targetId) ?? log.targetId) : "",
    detail: detailText(log.detail),
  }));

  return (
    <>
      <PageHeader
        title="감사 로그"
        meta={
          <>
            <span>조회 기간 {rangeTotal.toLocaleString("ko-KR")}건</span>
            <span>·</span>
            <span>
              {searching
                ? `'${q}' 검색 ${total.toLocaleString("ko-KR")}건`
                : sortKey === "created_at"
                  ? sortDir === "desc"
                    ? "최신순"
                    : "오래된순"
                  : `액션 ${sortDir === "asc" ? "가나다순" : "역순"}`}
            </span>
            <span>·</span>
            <span>
              {rangeFrom} ~ {rangeTo}
              {isDefaultRange ? ` (기본 ${DEFAULT_RANGE_DAYS}일)` : ""}
            </span>
          </>
        }
      />

      <PeriodNavigator
        label={period.label}
        sublabel={`${windowDays}일 구간 · ${rangeTotal.toLocaleString("ko-KR")}건`}
        prevHref={stepHref(-1)}
        nextHref={stepHref(1)}
        nextDisabled={rangeTo >= today}
        todayHref={hrefWith({
          period: undefined,
          cursor: undefined,
          from: undefined,
          to: undefined,
        })}
        atToday={isDefaultRange}
      />

      {/* 요약 밴드가 곧 그룹 필터다 — 선택된 카드는 브랜드 틴트로 표시된다 */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {AUDIT_GROUPS.map((item, index) => {
          const value = groupCounts[index];
          const active = group === item.key;
          const denied = item.key === "auth" ? deniedCount : 0;

          return (
            <StatCard
              key={item.key}
              label={item.label}
              value={value}
              unit="건"
              denominator={rangeTotal}
              denominatorUnit="건"
              tone={
                active ? "brand" : denied > 0 ? "warning" : GROUP_TONES[item.key]
              }
              icon={GROUP_ICONS[item.key]}
              emphasis={active}
              max={rangeTotal || 1}
              meterValue={value}
              href={groupHref(item.key)}
              sub={
                active
                  ? "다시 누르면 전체"
                  : denied > 0
                    ? `차단 ${denied}건 포함`
                    : item.description
              }
            />
          );
        })}
      </div>

      <Card>
        <CardHeader
          title="변경 이력"
          description="로그인 이력과 계정·권한 변경을 원본 그대로 보관합니다"
          density="compact"
          action={
            <span className="text-label tabular-nums text-muted">
              {total.toLocaleString("ko-KR")}건
            </span>
          }
        />
        <CardBody density="compact" className="!pb-0">
          <AuditFilters
            presets={presets}
            from={rangeFrom}
            to={rangeTo}
            today={today}
            q={q}
            actionCounts={target ? null : actionCounts}
            targetLabel={target ? (targetNames.get(target) ?? null) : null}
            actions={
              <AuditExportButton
                rows={exportRows}
                filename={`감사로그_${rangeFrom}_${rangeTo}`}
                capped={exportRows.length < total}
              />
            }
          />
        </CardBody>
        <CardBody density="compact" className="!p-0">
          <div className="overflow-x-auto">
            <table className="ab-table ab-table--compact min-w-[860px]">
              <thead>
                <tr>
                  <th className="w-40" aria-sort={timeHeader?.["aria-sort"]}>
                    {timeHeader ? timeHeader.children : "시각"}
                  </th>
                  <th className="w-36">행위자</th>
                  <th className="w-28" aria-sort={actionHeader?.["aria-sort"]}>
                    {actionHeader ? actionHeader.children : "액션"}
                  </th>
                  <th className="w-32">대상</th>
                  <th>상세 (변경 전 → 후)</th>
                </tr>
              </thead>
              <tbody>
                {list.errorMessage ? (
                  /* 빈 표는 "기록이 없다"로 읽힌다 — 실패는 실패라고 말한다 */
                  <TableEmptyRow
                    colSpan={5}
                    icon={ScrollText}
                    title="로그를 불러오지 못했습니다"
                    description={`${list.errorMessage} · 잠시 후 다시 시도하거나 조건을 좁혀 보세요.`}
                    action={
                      <Link
                        href="/admin/audit-logs"
                        className="text-label text-primary hover:underline"
                      >
                        최근 {DEFAULT_RANGE_DAYS}일 전체 보기
                      </Link>
                    }
                  />
                ) : logs.length === 0 ? (
                  <TableEmptyRow
                    colSpan={5}
                    icon={ScrollText}
                    title={
                      searching
                        ? `'${q}' 검색 결과가 없습니다`
                        : "조건에 맞는 기록이 없습니다"
                    }
                    description={
                      searching
                        ? `${rangeFrom} ~ ${rangeTo} 구간에서 이름·이메일·액션으로 찾습니다. 기간을 넓히거나 낱말을 줄여 보세요.`
                        : `${rangeFrom} ~ ${rangeTo} 구간에는 해당하는 기록이 없습니다. 기간을 넓히거나 그룹을 풀어 보세요.`
                    }
                    action={
                      <Link
                        href="/admin/audit-logs"
                        className="text-label text-primary hover:underline"
                      >
                        최근 {DEFAULT_RANGE_DAYS}일 전체 보기
                      </Link>
                    }
                  />
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="group">
                      <td className="whitespace-nowrap tabular-nums text-muted">
                        {formatDateTime(log.createdAt)}
                      </td>
                      <td>
                        {log.actorName ? (
                          <span title={log.actorEmail ?? undefined}>
                            {log.actorName}
                          </span>
                        ) : (
                          <span className="text-muted">시스템</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={ACTION_TONES[log.action] ?? "neutral"}>
                          {AUDIT_ACTION_LABELS[log.action] ?? log.action}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap">
                        {log.targetId && targetNames.has(log.targetId) ? (
                          <>
                            <Link
                              href={`/admin/employees/${log.targetId}`}
                              className="text-primary hover:underline"
                            >
                              {targetNames.get(log.targetId)}
                            </Link>
                            {/* 대상 기준 좁히기 — 행 위에 올렸을 때만 꺼낸다 */}
                            {target !== log.targetId ? (
                              <Link
                                href={hrefWith({
                                  target: log.targetId,
                                  q: undefined,
                                })}
                                title="이 대상의 기록만 보기"
                                className="ml-1.5 text-nano text-muted opacity-0 transition-opacity duration-fast ease-standard hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
                              >
                                이 대상만
                              </Link>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td className="text-muted">
                        <DetailCell detail={log.detail} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            pageSize={AUDIT_PAGE_SIZE}
            total={total}
            basePath="/admin/audit-logs"
            params={{
              q: q || undefined,
              group: searchParams.group,
              action: action || undefined,
              period: searchParams.period,
              cursor: searchParams.cursor,
              from: searchParams.from,
              to: searchParams.to,
              target: searchParams.target,
              sort: searching ? undefined : searchParams.sort,
              dir: searching ? undefined : searchParams.dir,
            }}
          />
        </CardBody>
      </Card>
    </>
  );
}

/** before/after 키를 한 번만 정리한다 — 표 셀과 CSV가 같은 규칙을 쓴다 */
function detailEntries(detail: AuditLog["detail"]) {
  const before = (detail?.before ?? {}) as Record<string, unknown>;
  const after = (detail?.after ?? {}) as Record<string, unknown>;
  const keys = Array.from(
    new Set([...Object.keys(before), ...Object.keys(after)]),
  ).filter((key) => key !== "role_id" || !("role" in after));
  const rest = Object.entries(detail ?? {}).filter(
    ([key]) => key !== "before" && key !== "after",
  );
  return { before, after, keys, rest };
}

function DetailCell({ detail }: { detail: AuditLog["detail"] }) {
  if (!detail) return <span>-</span>;
  const { before, after, keys, rest } = detailEntries(detail);

  if (keys.length === 0) {
    // login 등 before/after가 없는 로그는 남은 필드를 그대로 보여준다
    if (rest.length === 0) return <span>-</span>;
    return (
      <span className="text-label">
        {rest
          .map(([key, value]) => `${FIELD_LABELS[key] ?? key}: ${display(value)}`)
          .join(" · ")}
      </span>
    );
  }

  return (
    <ul className="space-y-0.5 text-label">
      {keys.map((key) => (
        <li key={key}>
          <span className="text-ink">{FIELD_LABELS[key] ?? key}</span>{" "}
          {key in before ? (
            <>
              <span className="line-through">{display(before[key])}</span>
              <span className="mx-1">→</span>
            </>
          ) : null}
          <span className="font-bold text-ink">{display(after[key])}</span>
        </li>
      ))}
    </ul>
  );
}

/** CSV용 한 줄 요약 */
function detailText(detail: AuditLog["detail"]): string {
  if (!detail) return "";
  const { before, after, keys, rest } = detailEntries(detail);

  if (keys.length === 0) {
    return rest
      .map(([key, value]) => `${FIELD_LABELS[key] ?? key}: ${display(value)}`)
      .join(" · ");
  }

  return keys
    .map((key) => {
      const label = FIELD_LABELS[key] ?? key;
      const arrow = key in before ? `${display(before[key])} → ` : "";
      return `${label}: ${arrow}${display(after[key])}`;
    })
    .join(" · ");
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(없음)";
  const text = String(value);
  return STATUS_LABELS[text] ?? text;
}
