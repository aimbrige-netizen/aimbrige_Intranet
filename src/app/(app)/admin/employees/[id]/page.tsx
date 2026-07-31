import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { EmploymentStatusBadge, RoleBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmployeeEditForm } from "@/features/employees/EmployeeEditForm";
import { tenureLabel, tenureMonths } from "@/features/directory/org";
import { getEmergencyContact, requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatDate, formatDateTime, todayInSeoul } from "@/lib/utils";
import type { AuditLog, EmployeeWithRelations } from "@/types/db";

export const metadata: Metadata = { title: "임직원 상세" };

const ACTION_LABELS: Record<string, string> = {
  login: "로그인",
  login_denied: "로그인 차단",
  employee_created: "계정 등록",
  employee_updated: "정보 수정",
  employment_status_changed: "재직상태 변경",
  role_changed: "역할 변경",
  profile_updated: "프로필 수정",
};

export default async function EmployeeDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const { data: employee } = await supabase
    .from("employees")
    .select(
      `id, auth_user_id, email, name, department_id, team_id, position, role_id,
       employment_status, hire_date, phone, responsibilities, profile_image_url,
       created_at, updated_at,
       role:roles(id, name, label),
       department:departments!department_id(id, name),
       team:teams!team_id(id, name)`,
    )
    .eq("id", params.id)
    .maybeSingle<EmployeeWithRelations>();

  if (!employee) notFound();

  const [{ data: departments }, { data: teams }, { data: logs }, emergency] =
    await Promise.all([
      supabase.from("departments").select("id, name").order("name"),
      supabase.from("teams").select("id, name, department_id").order("name"),
      supabase
        .from("audit_logs")
        .select("id, action, detail, created_at, actor_id, target_id")
        .eq("target_id", params.id)
        .order("created_at", { ascending: false })
        .limit(10),
      getEmergencyContact(params.id),
    ]);

  const isSystemAdminTarget = employee.role?.name === "system_admin";
  const today = todayInSeoul();
  const tenure = tenureLabel(tenureMonths(employee.hire_date, today));

  return (
    <>
      <PageHeader
        backHref="/admin/employees"
        backLabel="임직원 목록"
        title={employee.name}
        description={employee.email}
        meta={
          <>
            <span>
              {[employee.department?.name, employee.team?.name]
                .filter(Boolean)
                .join(" › ") || "소속 미지정"}
            </span>
            <span>·</span>
            <span>{employee.position ?? "직급 미지정"}</span>
            <span>·</span>
            <span>근속 {tenure}</span>
          </>
        }
        action={
          <div className="flex items-center gap-2">
            <RoleBadge role={employee.role?.name} />
            <EmploymentStatusBadge status={employee.employment_status} />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="기본정보"
              description="이 화면의 변경은 모두 감사 로그에 기록됩니다."
            />
            <CardBody>
              <EmployeeEditForm
                employeeId={employee.id}
                lockRole={isSystemAdminTarget}
                departments={departments ?? []}
                teams={teams ?? []}
                initialValues={{
                  name: employee.name,
                  email: employee.email,
                  department_id: employee.department_id ?? "",
                  team_id: employee.team_id ?? "",
                  position: employee.position ?? "",
                  hire_date: employee.hire_date ?? "",
                  role:
                    employee.role?.name === "manager" ? "manager" : "employee",
                  employment_status: employee.employment_status,
                }}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="본인 관리 항목"
              description="아래 항목은 본인만 /profile 화면에서 수정할 수 있습니다."
            />
            <CardBody>
              <dl className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {[
                  { label: "휴대폰번호", value: employee.phone },
                  { label: "비상연락처", value: emergency },
                  {
                    label: "최초 로그인 연결",
                    value: employee.auth_user_id ? "연결됨" : "미연결",
                  },
                ].map((item) => (
                  <div key={item.label}>
                    <dt className="text-caption">{item.label}</dt>
                    <dd className="mt-0.5 text-body text-ink">
                      {item.value || "-"}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardBody className="flex flex-col items-center gap-3 py-6 text-center">
              <Avatar
                name={employee.name}
                src={employee.profile_image_url}
                size="xlarge"
              />
              <div>
                <p className="text-h2 text-ink">{employee.name}</p>
                <p className="mt-0.5 text-caption">
                  {[
                    employee.department?.name,
                    employee.team?.name,
                    employee.position,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "소속 미지정"}
                </p>
              </div>
              <dl className="w-full space-y-2 border-t border-line pt-3 text-left">
                <Row label="입사일" value={formatDate(employee.hire_date)} />
                <Row label="근속" value={tenure} />
                <Row label="등록일" value={formatDate(employee.created_at)} />
                <Row
                  label="최근 수정"
                  value={formatDateTime(employee.updated_at)}
                />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="최근 변경 이력"
              description="이 계정에 대한 감사 로그 최근 10건입니다."
            />
            <CardBody>
              {!logs || logs.length === 0 ? (
                <EmptyState
                  icon={History}
                  title="기록된 변경 이력이 없습니다"
                  description="역할·재직상태·기본정보를 수정하면 여기에 시간순으로 쌓입니다."
                  compact
                />
              ) : (
                <ul className="space-y-3">
                  {(logs as AuditLog[]).map((log) => (
                    <li key={log.id} className="text-body">
                      <p className="text-ink">
                        {ACTION_LABELS[log.action] ?? log.action}
                      </p>
                      <p className="text-caption">
                        {formatDateTime(log.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-caption">{label}</dt>
      <dd className="text-body text-ink">{value}</dd>
    </div>
  );
}
