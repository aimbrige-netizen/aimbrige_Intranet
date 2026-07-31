import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Building2, History, Mail, Phone, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import {
  Badge,
  EmploymentStatusBadge,
  RoleBadge,
} from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  getDirectoryProfile,
  getEmployeeTimeline,
} from "@/features/directory/data";
import {
  tenureLabel,
  tenureMonths,
  type DirectoryEmployee,
} from "@/features/directory/org";
import { requireSessionEmployee } from "@/lib/auth/session";
import { formatDate, formatDateTime, todayInSeoul } from "@/lib/utils";

export const metadata: Metadata = { title: "임직원 프로필" };

const ACTION_LABELS: Record<string, string> = {
  employee_created: "입사·계정 등록",
  employee_transferred: "조직 이동",
  employee_promoted: "승진",
  employment_status_changed: "재직상태 변경",
  role_changed: "역할 변경",
};

/**
 * 동료 프로필 상세 (스펙 02 · 3.2)
 *
 * 예전에는 부서/팀/직급/입사일 네 항목과 담당업무 한 줄이 전부라 xl 화면에서
 * 카드 대부분이 빈 여백이었다. 리포팅 라인(departments.manager_id,
 * teams.manager_id)은 스키마에 있는데 한 번도 읽히지 않았고 근속도 없었다.
 */
export default async function DirectoryEmployeePage({
  params,
}: {
  params: { id: string };
}) {
  const me = await requireSessionEmployee();

  // 본인 프로필은 편집 가능한 /profile 로 안내 (스펙 3.2)
  if (params.id === me.id) redirect("/profile");

  const profile = await getDirectoryProfile(params.id);
  if (!profile) notFound();

  const { employee, departmentManager, teamManager, teammates } = profile;
  const timeline = await getEmployeeTimeline(params.id);

  const today = todayInSeoul();
  const tenure = tenureLabel(tenureMonths(employee.hire_date, today));

  const path = [
    "에임브릿지",
    employee.department?.name,
    employee.team?.name,
  ].filter((value): value is string => !!value);

  const info: { label: string; value: React.ReactNode }[] = [
    { label: "부서", value: employee.department?.name ?? "미지정" },
    { label: "팀", value: employee.team?.name ?? "미지정" },
    { label: "직급/직책", value: employee.position ?? "미지정" },
    { label: "입사일", value: formatDate(employee.hire_date) },
    { label: "근속", value: tenure },
    {
      label: "재직상태",
      value: <EmploymentStatusBadge status={employee.employment_status} />,
    },
    { label: "역할", value: <RoleBadge role={employee.role?.name} /> },
    {
      label: "이메일",
      value: (
        <a href={`mailto:${employee.email}`} className="hover:underline">
          {employee.email}
        </a>
      ),
    },
    { label: "전화번호", value: employee.phone ?? "미등록" },
  ];

  return (
    <>
      <PageHeader
        backHref="/directory"
        backLabel="조직도"
        title={employee.name}
        meta={
          <>
            <span>{path.join(" › ")}</span>
            {employee.position ? (
              <>
                <span>·</span>
                <span>{employee.position}</span>
              </>
            ) : null}
            <span>·</span>
            <span>근속 {tenure}</span>
          </>
        }
        action={<EmploymentStatusBadge status={employee.employment_status} />}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
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
                  {employee.position ?? "직급 미지정"}
                </p>
              </div>

              <div className="w-full space-y-2 border-t border-line pt-3 text-left">
                <a
                  href={`mailto:${employee.email}`}
                  className="flex items-center gap-2 rounded-card px-2 py-1.5 text-body-sm text-ink transition-colors duration-fast ease-standard hover:bg-subtle"
                >
                  <Mail className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="truncate">{employee.email}</span>
                </a>
                {employee.phone ? (
                  <a
                    href={`tel:${employee.phone}`}
                    className="flex items-center gap-2 rounded-card px-2 py-1.5 text-body-sm text-ink transition-colors duration-fast ease-standard hover:bg-subtle"
                  >
                    <Phone className="size-4 shrink-0 text-muted" aria-hidden />
                    {employee.phone}
                  </a>
                ) : (
                  <p className="flex items-center gap-2 px-2 py-1.5 text-body-sm text-muted">
                    <Phone className="size-4 shrink-0" aria-hidden />
                    전화번호 미등록
                  </p>
                )}
              </div>

              <dl className="w-full space-y-1.5 border-t border-line pt-3 text-left">
                <SideRow label="입사일" value={formatDate(employee.hire_date)} />
                <SideRow label="근속" value={tenure} />
                <SideRow
                  label="같은 부서"
                  value={`${profile.departmentSize}명`}
                />
                <SideRow
                  label="같은 팀"
                  value={
                    employee.team ? `${teammates.length + 1}명` : "팀 미배정"
                  }
                />
              </dl>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="기본정보" density="compact" />
            <CardBody density="compact">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
                {info.map((item) => (
                  <div key={item.label}>
                    <dt className="text-nano text-muted">{item.label}</dt>
                    <dd className="mt-0.5 truncate text-body-sm text-ink">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 border-t border-line pt-3">
                <p className="text-nano text-muted">담당업무</p>
                <p className="mt-0.5 whitespace-pre-wrap text-body-sm text-ink">
                  {employee.responsibilities || "등록된 담당업무가 없습니다."}
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="리포팅 라인"
              description={path.join(" › ")}
              density="compact"
            />
            <CardBody density="compact">
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {path.map((step, i) => (
                  <span key={step} className="flex items-center gap-1.5">
                    {i > 0 ? (
                      <span className="text-nano text-muted">›</span>
                    ) : null}
                    <Badge tone={i === path.length - 1 ? "primary" : "neutral"}>
                      {step}
                    </Badge>
                  </span>
                ))}
              </div>

              {departmentManager || teamManager ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {teamManager ? (
                    <ManagerCard
                      person={teamManager}
                      role="팀장"
                      scope={employee.team?.name ?? "팀"}
                    />
                  ) : null}
                  {departmentManager &&
                  departmentManager.id !== teamManager?.id ? (
                    <ManagerCard
                      person={departmentManager}
                      role="부서장"
                      scope={employee.department?.name ?? "부서"}
                    />
                  ) : null}
                </div>
              ) : (
                <EmptyState
                  icon={Building2}
                  title="지정된 책임자가 없습니다"
                  description="부서·팀의 담당 매니저가 지정되면 여기에 리포팅 라인이 표시됩니다."
                  compact
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="같은 팀 동료"
              description={
                employee.team
                  ? `${employee.team.name} · ${teammates.length}명 / 같은 부서 ${profile.departmentSize}명`
                  : "팀 미배정"
              }
              density="compact"
            />
            <CardBody density="compact">
              {teammates.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title={
                    employee.team
                      ? "이 팀에 다른 인원이 없습니다"
                      : "배정된 팀이 없습니다"
                  }
                  description="같은 팀에 인원이 배치되면 여기에서 프로필로 바로 이동할 수 있습니다."
                  compact
                />
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {teammates.map((mate) => (
                    <li key={mate.id}>
                      <Link
                        href={
                          mate.id === me.id ? "/profile" : `/directory/${mate.id}`
                        }
                        className="flex items-center gap-2 rounded-card border border-line px-2.5 py-2 transition-colors duration-fast ease-standard hover:border-line-strong"
                      >
                        <Avatar
                          name={mate.name}
                          src={mate.profile_image_url}
                          size="small"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-body-sm text-ink">
                            {mate.name}
                          </span>
                          <span className="block truncate text-nano text-muted">
                            {mate.position ?? "직급 미지정"}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="조직 변경 이력"
              description="팀 이동·승진 등 조직 관련 변경 내역입니다."
              density="compact"
            />
            <CardBody density="compact">
              {timeline.length === 0 ? (
                <EmptyState
                  icon={History}
                  title="기록된 조직 변경이 없습니다"
                  description="팀 이동·승진·재직상태 변경이 발생하면 여기에 시간순으로 쌓입니다."
                  compact
                />
              ) : (
                <ol className="space-y-3">
                  {timeline.map((log) => (
                    <li key={log.id} className="flex gap-3">
                      <span
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-line-strong"
                        aria-hidden
                      />
                      <div>
                        <p className="text-body-sm text-ink">
                          {ACTION_LABELS[log.action] ?? log.action}
                        </p>
                        <p className="text-nano tabular-nums text-muted">
                          {formatDateTime(log.created_at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function SideRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-nano text-muted">{label}</dt>
      <dd className="text-label tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function ManagerCard({
  person,
  role,
  scope,
}: {
  person: DirectoryEmployee;
  role: string;
  scope: string;
}) {
  return (
    <Link
      href={`/directory/${person.id}`}
      className="flex items-start gap-2.5 rounded-card border border-line p-3 transition-colors duration-fast ease-standard hover:border-line-strong"
    >
      <Avatar name={person.name} src={person.profile_image_url} size="large" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-body-sm font-bold text-ink">
            {person.name}
          </span>
          <Badge tone="info">{role}</Badge>
        </span>
        <span className="mt-0.5 block truncate text-nano text-muted">
          {scope} · {person.position ?? "직급 미지정"}
        </span>
        <span className="mt-1 block truncate text-nano text-muted">
          {person.email}
        </span>
      </span>
    </Link>
  );
}
