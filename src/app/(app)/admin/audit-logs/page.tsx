import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { AuditFilters } from "@/features/audit/AuditFilters";
import { AUDIT_ACTION_OPTIONS } from "@/features/audit/constants";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import type { AuditLog } from "@/types/db";

export const metadata: Metadata = { title: "감사 로그" };

const PAGE_SIZE = 50;

const ACTION_LABELS = Object.fromEntries(
  AUDIT_ACTION_OPTIONS.map((option) => [option.value, option.label]),
) as Record<string, string>;

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

interface SearchParams {
  action?: string;
  from?: string;
  to?: string;
  page?: string;
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

  let query = supabase
    .from("audit_logs")
    .select(
      `id, action, target_id, detail, created_at, actor_id,
       actor:employees(id, name, email)`,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (searchParams.action) query = query.eq("action", searchParams.action);
  if (searchParams.from) query = query.gte("created_at", `${searchParams.from}T00:00:00+09:00`);
  if (searchParams.to) query = query.lte("created_at", `${searchParams.to}T23:59:59+09:00`);

  const { data, count, error } = await query;

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

  return (
    <>
      <PageHeader
        title="감사 로그"
        description="로그인 이력, 계정·권한 변경 이력을 최신순으로 보여줍니다."
      />

      <AuditFilters />

      <Card className="overflow-hidden">
        {error ? (
          <EmptyState title="로그를 불러오지 못했습니다" description={error.message} />
        ) : logs.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="기록된 로그가 없습니다"
            description="로그인·계정 변경이 발생하면 여기에 쌓입니다."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="ab-table min-w-[860px]">
              <thead>
                <tr>
                  <th className="w-40">시각</th>
                  <th className="w-40">행위자</th>
                  <th className="w-32">액션</th>
                  <th className="w-40">대상</th>
                  <th>상세 (변경 전 → 후)</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap text-muted">
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
                        {ACTION_LABELS[log.action] ?? log.action}
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
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={count ?? 0}
          basePath="/admin/audit-logs"
          params={{
            action: searchParams.action,
            from: searchParams.from,
            to: searchParams.to,
          }}
        />
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
