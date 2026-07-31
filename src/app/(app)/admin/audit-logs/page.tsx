import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, LogIn, ScrollText, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatCard, type StatTone } from "@/components/ui/StatCard";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { AuditFilters } from "@/features/audit/AuditFilters";
import {
  actionsOfGroup,
  AUDIT_ACTION_LABELS,
  AUDIT_GROUPS,
} from "@/features/audit/constants";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import { addDaysYmd, todayYmd } from "@/features/calendar/date";
import type { AuditLog } from "@/types/db";

export const metadata: Metadata = { title: "감사 로그" };

const PAGE_SIZE = 50;

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

interface SearchParams {
  group?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: string;
  target?: string;
}

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const groupActions = actionsOfGroup(searchParams.group);

  /** 기간·대상 조건은 목록과 그룹 카운트가 똑같이 쓴다 */
  const withPeriod = <T extends { gte: unknown; lte: unknown; eq: unknown }>(
    query: T,
  ): T => {
    let next = query as unknown as {
      gte: (c: string, v: string) => typeof next;
      lte: (c: string, v: string) => typeof next;
      eq: (c: string, v: string) => typeof next;
    };
    if (searchParams.from) {
      next = next.gte("created_at", `${searchParams.from}T00:00:00+09:00`);
    }
    if (searchParams.to) {
      next = next.lte("created_at", `${searchParams.to}T23:59:59+09:00`);
    }
    if (searchParams.target) next = next.eq("target_id", searchParams.target);
    return next as unknown as T;
  };

  let query = withPeriod(
    supabase
      .from("audit_logs")
      .select(
        `id, action, target_id, detail, created_at, actor_id,
         actor:employees(id, name, email)`,
        { count: "exact" },
      ),
  )
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (searchParams.action) query = query.eq("action", searchParams.action);
  else if (groupActions) query = query.in("action", groupActions);

  const [
    { data, count, error },
    { count: totalInRange },
    { count: deniedCount },
    groupCounts,
  ] = await Promise.all([
    query,
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
  ]);

  const logs = (data ?? []) as unknown as (AuditLog & {
    actor: { id: string; name: string; email: string } | null;
  })[];

  // 대상(target_id)이 임직원인 경우 이름을 함께 보여준다
  const targetIds = Array.from(
    new Set(logs.map((log) => log.target_id).filter((id): id is string => !!id)),
  );
  const targetNames = new Map<string, string>();
  if (targetIds.length > 0) {
    const { data: targets } = await supabase
      .from("employees")
      .select("id, name")
      .in("id", targetIds);
    (targets ?? []).forEach((target) => targetNames.set(target.id, target.name));
  }

  const today = todayYmd();
  const presets = [
    { label: "최근 7일", from: addDaysYmd(today, -6) },
    { label: "최근 30일", from: addDaysYmd(today, -29) },
  ];

  const rangeTotal = totalInRange ?? 0;
  const baseParams = new URLSearchParams();
  if (searchParams.from) baseParams.set("from", searchParams.from);
  if (searchParams.to) baseParams.set("to", searchParams.to);
  if (searchParams.target) baseParams.set("target", searchParams.target);

  const hrefFor = (key: string) => {
    const params = new URLSearchParams(baseParams);
    if (searchParams.group !== key) params.set("group", key);
    const search = params.toString();
    return search ? `/admin/audit-logs?${search}` : "/admin/audit-logs";
  };

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
            <span>최신순</span>
            {searchParams.from || searchParams.to ? (
              <>
                <span>·</span>
                <span>
                  {searchParams.from ?? "처음"} ~ {searchParams.to ?? "오늘"}
                </span>
              </>
            ) : null}
          </>
        }
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
              href={hrefFor(group.key)}
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
          <AuditFilters presets={presets} />
        </CardBody>
        <CardBody density="compact" className="!p-0">
          <div className="overflow-x-auto">
            <table className="ab-table ab-table--compact min-w-[860px]">
              <thead>
                <tr>
                  <th className="w-40">시각</th>
                  <th className="w-36">행위자</th>
                  <th className="w-28">액션</th>
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
                    description="로그인·계정 변경이 발생하면 여기에 쌓입니다. 기간이나 그룹을 넓혀 보세요."
                    action={
                      <Link
                        href="/admin/audit-logs"
                        className="text-label text-primary hover:underline"
                      >
                        필터 초기화
                      </Link>
                    }
                  />
                ) : (
                  logs.map((log) => (
                    <tr key={log.id}>
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
                      <td>
                        {log.target_id && targetNames.has(log.target_id) ? (
                          <Link
                            href={`/admin/employees/${log.target_id}`}
                            className="text-primary hover:underline"
                          >
                            {targetNames.get(log.target_id)}
                          </Link>
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
            }}
          />
        </CardBody>
      </Card>
    </>
  );
}

function DetailCell({ detail }: { detail: AuditLog["detail"] }) {
  if (!detail) return <span>-</span>;

  const before = (detail.before ?? {}) as Record<string, unknown>;
  const after = (detail.after ?? {}) as Record<string, unknown>;
  const keys = Array.from(
    new Set([...Object.keys(before), ...Object.keys(after)]),
  ).filter((key) => key !== "role_id" || !("role" in after));

  if (keys.length === 0) {
    // login 등 before/after가 없는 로그는 남은 필드를 그대로 보여준다
    const rest = Object.entries(detail).filter(
      ([key]) => key !== "before" && key !== "after",
    );
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

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(없음)";
  const text = String(value);
  return STATUS_LABELS[text] ?? text;
}
