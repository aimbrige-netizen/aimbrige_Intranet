import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, LogIn, ScrollText, Users } from "lucide-react";
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
import { formatDateTime } from "@/lib/utils";
import { addDaysYmd, todayYmd } from "@/features/calendar/date";
import type { AuditLog } from "@/types/db";

export const metadata: Metadata = { title: "감사 로그" };

const PAGE_SIZE = 50;

/** 내보내기는 페이지가 아니라 조건 전체를 담는다. 상한만 걸어 둔다 */
const EXPORT_LIMIT = 500;

/**
 * 기본 조회 구간. 없으면 전 기간이 무한히 누적돼 "최근에 무슨 일이
 * 있었나"를 보려는 화면이 매년 느려지고, 요약 밴드의 분모도 의미를 잃는다.
 */
const DEFAULT_RANGE_DAYS = 30;

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
};

/** 그룹별 기본 톤 — 권한 변경만 경고 축에 둔다 */
const GROUP_TONES: Record<string, StatTone> = {
  auth: "neutral",
  access: "warning",
  hr: "informative",
  org: "neutral",
};

/** 정렬 가능한 컬럼. 행위자·대상은 임베드/조인이라 서버 정렬이 안 된다 */
const AUDIT_SORT_KEYS = ["created_at", "action"] as const;
type AuditSortKey = (typeof AUDIT_SORT_KEYS)[number];

/**
 * 목록 파라미터 규약: sort / dir / page / from / to + 이 화면 고유의
 * group / action / target. 임직원 목록과 같은 이름을 쓴다.
 */
interface SearchParams {
  group?: string;
  action?: string;
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
  // URL에 없으면 최근 30일. 화면에는 항상 확정된 구간이 보인다
  const rangeTo = searchParams.to || today;
  const rangeFrom =
    searchParams.from || addDaysYmd(rangeTo, -(DEFAULT_RANGE_DAYS - 1));
  const isDefaultRange = !searchParams.from && !searchParams.to;

  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const groupActions = actionsOfGroup(searchParams.group);

  const sortKey: AuditSortKey = parseSortKey(searchParams.sort, AUDIT_SORT_KEYS);
  // 감사 로그의 기본은 최신순이다. dir이 없으면 시각만 내림차순으로 시작한다
  const sortDir: SortDir = searchParams.dir
    ? parseSortDir(searchParams.dir)
    : sortKey === "created_at"
      ? "desc"
      : "asc";
  const ascending = sortDir === "asc";

  /** 기간·대상 조건은 목록·그룹 카운트·내보내기가 똑같이 쓴다 */
  const withPeriod = <T extends { gte: unknown; lte: unknown; eq: unknown }>(
    query: T,
  ): T => {
    let next = query as unknown as {
      gte: (c: string, v: string) => typeof next;
      lte: (c: string, v: string) => typeof next;
      eq: (c: string, v: string) => typeof next;
    };
    next = next.gte("created_at", `${rangeFrom}T00:00:00+09:00`);
    next = next.lte("created_at", `${rangeTo}T23:59:59+09:00`);
    if (searchParams.target) next = next.eq("target_id", searchParams.target);
    return next as unknown as T;
  };

  /** 액션 조건 — 정밀 액션이 있으면 그것만, 없으면 그룹 전체 */
  const withAction = <T extends { eq: unknown; in: unknown }>(query: T): T => {
    const next = query as unknown as {
      eq: (c: string, v: string) => T;
      in: (c: string, v: string[]) => T;
    };
    if (searchParams.action) return next.eq("action", searchParams.action);
    if (groupActions) return next.in("action", groupActions);
    return query;
  };

  /** 액션 정렬은 동률이 많다 — 같은 액션 안에서는 최신순으로 고정한다 */
  const ordered = <T extends { order: unknown }>(query: T): T => {
    let next = query as unknown as {
      order: (c: string, o: { ascending: boolean }) => typeof next;
    };
    next = next.order(sortKey, { ascending });
    if (sortKey !== "created_at") {
      next = next.order("created_at", { ascending: false });
    }
    return next as unknown as T;
  };

  const LOG_SELECT = `id, action, target_id, detail, created_at, actor_id,
         actor:employees(id, name, email)`;

  const [
    { data, count, error },
    { count: totalInRange },
    { count: deniedCount },
    groupCounts,
    exportResult,
  ] = await Promise.all([
    ordered(
      withAction(
        withPeriod(
          supabase.from("audit_logs").select(LOG_SELECT, { count: "exact" }),
        ),
      ),
    ).range(offset, offset + PAGE_SIZE - 1),
    withPeriod(
      supabase.from("audit_logs").select("id", { count: "exact", head: true }),
    ),
    withPeriod(
      supabase.from("audit_logs").select("id", { count: "exact", head: true }),
    ).eq("action", "login_denied"),
    Promise.all(
      AUDIT_GROUPS.map(async (group) => {
        const { count: value } = await withPeriod(
          supabase
            .from("audit_logs")
            .select("id", { count: "exact", head: true }),
        ).in("action", group.actions);
        return value ?? 0;
      }),
    ),
    ordered(
      withAction(withPeriod(supabase.from("audit_logs").select(LOG_SELECT))),
    ).range(0, EXPORT_LIMIT - 1),
  ]);

  type LogRow = AuditLog & {
    actor: { id: string; name: string; email: string } | null;
  };

  const logs = (data ?? []) as unknown as LogRow[];
  const exportLogs = (exportResult.data ?? []) as unknown as LogRow[];

  // 대상(target_id)이 임직원인 경우 이름을 함께 보여준다 (내보내기도 같은 이름을 쓴다)
  const targetIds = Array.from(
    new Set(
      [...logs, ...exportLogs]
        .map((log) => log.target_id)
        .filter((id): id is string => !!id),
    ),
  );
  const targetNames = new Map<string, string>();
  if (targetIds.length > 0) {
    const { data: targets } = await supabase
      .from("employees")
      .select("id, name")
      .in("id", targetIds);
    (targets ?? []).forEach((target) => targetNames.set(target.id, target.name));
  }

  const presets = [
    { label: "최근 7일", from: addDaysYmd(today, -6) },
    { label: "최근 30일", from: addDaysYmd(today, -29) },
    { label: "최근 90일", from: addDaysYmd(today, -89) },
    // 감사 요청은 대개 연 단위로 온다. 전 기간 대신 올해로 상한을 준다
    { label: "올해", from: `${today.slice(0, 4)}-01-01` },
  ];

  const rangeTotal = totalInRange ?? 0;

  /** 링크는 현재 조건을 그대로 이어받는다. 페이지만 버린다 */
  const hrefWith = (patch: Partial<Record<keyof SearchParams, string>>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      group: searchParams.group,
      action: searchParams.action,
      target: searchParams.target,
      from: searchParams.from,
      to: searchParams.to,
      sort: searchParams.sort,
      dir: searchParams.dir,
      ...patch,
    };
    Object.entries(merged).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const search = params.toString();
    return search ? `/admin/audit-logs?${search}` : "/admin/audit-logs";
  };

  // 스테퍼는 지금 보고 있는 구간의 길이만큼 통째로 옮긴다
  const windowDays = spanDays(rangeFrom, rangeTo);
  const shiftHref = (days: number) =>
    hrefWith({
      from: addDaysYmd(rangeFrom, days),
      to: addDaysYmd(rangeTo, days),
    });

  const groupHref = (key: string) =>
    hrefWith({
      group: searchParams.group === key ? undefined : key,
      // 그룹을 바꾸면 이전 그룹의 정밀 액션은 의미가 없다
      action: undefined,
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

  const timeHeader = sortableHeader("created_at", "시각");
  const actionHeader = sortableHeader("action", "액션");

  const exportRows = exportLogs.map((log) => ({
    at: formatDateTime(log.created_at),
    actor: log.actor?.name ?? "시스템",
    actorEmail: log.actor?.email ?? "",
    action: AUDIT_ACTION_LABELS[log.action] ?? log.action,
    target: log.target_id ? (targetNames.get(log.target_id) ?? log.target_id) : "",
    detail: detailText(log.detail),
  }));

  return (
    <>
      <PageHeader
        title="감사 로그"
        meta={
          <>
            <span>
              조회 기간 {rangeTotal.toLocaleString("ko-KR")}건
            </span>
            <span>·</span>
            <span>
              {sortKey === "created_at"
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
        label={`${rangeFrom} ~ ${rangeTo}`}
        sublabel={`${windowDays}일 구간 · ${rangeTotal.toLocaleString("ko-KR")}건`}
        prevHref={shiftHref(-windowDays)}
        nextHref={shiftHref(windowDays)}
        nextDisabled={rangeTo >= today}
        todayHref={hrefWith({ from: undefined, to: undefined })}
        atToday={isDefaultRange}
      />

      {/* 요약 밴드가 곧 그룹 필터다 — 선택된 카드는 브랜드 틴트로 표시된다 */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {AUDIT_GROUPS.map((group, index) => {
          const value = groupCounts[index];
          const active = searchParams.group === group.key;
          const denied = group.key === "auth" ? (deniedCount ?? 0) : 0;

          return (
            <StatCard
              key={group.key}
              label={group.label}
              value={value}
              unit="건"
              denominator={rangeTotal}
              denominatorUnit="건"
              tone={
                active
                  ? "brand"
                  : denied > 0
                    ? "warning"
                    : GROUP_TONES[group.key]
              }
              icon={GROUP_ICONS[group.key]}
              emphasis={active}
              max={rangeTotal || 1}
              meterValue={value}
              href={groupHref(group.key)}
              sub={
                active
                  ? "다시 누르면 전체"
                  : denied > 0
                    ? `차단 ${denied}건 포함`
                    : group.description
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
              {(count ?? 0).toLocaleString("ko-KR")}건
            </span>
          }
        />
        <CardBody density="compact" className="!pb-0">
          <AuditFilters
            presets={presets}
            from={rangeFrom}
            to={rangeTo}
            today={today}
            targetLabel={
              searchParams.target
                ? (targetNames.get(searchParams.target) ?? null)
                : null
            }
            actions={
              <AuditExportButton
                rows={exportRows}
                filename={`감사로그_${rangeFrom}_${rangeTo}`}
                capped={(count ?? 0) > EXPORT_LIMIT}
              />
            }
          />
        </CardBody>
        <CardBody density="compact" className="!p-0">
          <div className="overflow-x-auto">
            <table className="ab-table ab-table--compact min-w-[860px]">
              <thead>
                <tr>
                  <th className="w-40" aria-sort={timeHeader["aria-sort"]}>
                    {timeHeader.children}
                  </th>
                  <th className="w-36">행위자</th>
                  <th className="w-28" aria-sort={actionHeader["aria-sort"]}>
                    {actionHeader.children}
                  </th>
                  <th className="w-32">대상</th>
                  <th>상세 (변경 전 → 후)</th>
                </tr>
              </thead>
              <tbody>
                {error ? (
                  <TableEmptyRow
                    colSpan={5}
                    icon={ScrollText}
                    title="로그를 불러오지 못했습니다"
                    description={error.message}
                  />
                ) : logs.length === 0 ? (
                  <TableEmptyRow
                    colSpan={5}
                    icon={ScrollText}
                    title="조건에 맞는 기록이 없습니다"
                    description={`${rangeFrom} ~ ${rangeTo} 구간에는 해당하는 기록이 없습니다. 기간을 넓히거나 그룹을 풀어 보세요.`}
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
                        {formatDateTime(log.created_at)}
                      </td>
                      <td>
                        {log.actor ? (
                          <span title={log.actor.email}>{log.actor.name}</span>
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
                        {log.target_id && targetNames.has(log.target_id) ? (
                          <>
                            <Link
                              href={`/admin/employees/${log.target_id}`}
                              className="text-primary hover:underline"
                            >
                              {targetNames.get(log.target_id)}
                            </Link>
                            {/* 대상 기준 좁히기 — 행 위에 올렸을 때만 꺼낸다 */}
                            {searchParams.target !== log.target_id ? (
                              <Link
                                href={hrefWith({ target: log.target_id })}
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
            pageSize={PAGE_SIZE}
            total={count ?? 0}
            basePath="/admin/audit-logs"
            params={{
              group: searchParams.group,
              action: searchParams.action,
              from: searchParams.from,
              to: searchParams.to,
              target: searchParams.target,
              sort: searchParams.sort,
              dir: searchParams.dir,
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
