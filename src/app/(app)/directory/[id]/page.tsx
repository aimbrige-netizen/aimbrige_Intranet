import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Mail, Phone } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { EmploymentStatusBadge } from "@/components/ui/Badge";
import {
  getDirectoryEmployee,
  getEmployeeTimeline,
} from "@/features/directory/data";
import { requireSessionEmployee } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "임직원 프로필" };

const ACTION_LABELS: Record<string, string> = {
  employee_created: "입사·계정 등록",
  employee_transferred: "조직 이동",
  employee_promoted: "승진",
  employment_status_changed: "재직상태 변경",
  role_changed: "역할 변경",
};

export default async function DirectoryEmployeePage({
  params,
}: {
  params: { id: string };
}) {
  const me = await requireSessionEmployee();

  // 본인 프로필은 편집 가능한 /profile 로 안내 (스펙 3.2)
  if (params.id === me.id) redirect("/profile");

  const employee = await getDirectoryEmployee(params.id);
  if (!employee) notFound();

  const timeline = await getEmployeeTimeline(params.id);

  const info = [
    { label: "부서", value: employee.department?.name ?? "-" },
    { label: "팀", value: employee.team?.name ?? "-" },
    { label: "직급/직책", value: employee.position ?? "-" },
    { label: "입사일", value: formatDate(employee.hire_date) },
  ];

  return (
    <>
      <Link
        href="/directory"
        className="mb-3 inline-flex items-center gap-1 text-label text-primary hover:underline"
      >
        <ChevronLeft className="size-3.5" />
        조직도·디렉토리
      </Link>

      <PageHeader
        title={employee.name}
        description={
          [employee.department?.name, employee.team?.name, employee.position]
            .filter(Boolean)
            .join(" · ") || "소속 미지정"
        }
        action={<EmploymentStatusBadge status={employee.employment_status} />}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_1fr]">
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-6 text-center">
            <Avatar
              name={employee.name}
              src={employee.profile_image_url}
              size="xlarge"
            />
            <div>
              <p className="text-h2 text-ink">{employee.name}</p>
              <p className="mt-0.5 text-caption">{employee.position ?? "-"}</p>
            </div>

            <div className="w-full space-y-2 border-t border-line pt-3 text-left">
              <a
                href={`mailto:${employee.email}`}
                className="flex items-center gap-2 rounded-card px-2 py-1.5 text-body text-ink transition-colors hover:bg-canvas"
              >
                <Mail className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="truncate">{employee.email}</span>
              </a>
              {employee.phone ? (
                <a
                  href={`tel:${employee.phone}`}
                  className="flex items-center gap-2 rounded-card px-2 py-1.5 text-body text-ink transition-colors hover:bg-canvas"
                >
                  <Phone className="size-4 shrink-0 text-muted" aria-hidden />
                  {employee.phone}
                </a>
              ) : (
                <p className="flex items-center gap-2 px-2 py-1.5 text-body text-muted">
                  <Phone className="size-4 shrink-0" aria-hidden />
                  전화번호 미등록
                </p>
              )}
            </div>
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="기본정보" />
            <CardBody>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                {info.map((item) => (
                  <div key={item.label}>
                    <dt className="text-caption">{item.label}</dt>
                    <dd className="mt-0.5 text-body text-ink">{item.value}</dd>
                  </div>
                ))}
                <div className="sm:col-span-2">
                  <dt className="text-caption">담당업무</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-body text-ink">
                    {employee.responsibilities || "-"}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          {/* audit_logs는 관리자만 읽을 수 있어 일반 사용자에겐 결과가 비어 섹션이 숨겨진다 */}
          {timeline.length > 0 ? (
            <Card>
              <CardHeader
                title="조직 변경 이력"
                description="팀 이동·승진 등 조직 관련 변경 내역입니다."
              />
              <CardBody>
                <ol className="space-y-3">
                  {timeline.map((log) => (
                    <li key={log.id} className="flex gap-3">
                      <span
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                        aria-hidden
                      />
                      <div>
                        <p className="text-body text-ink">
                          {ACTION_LABELS[log.action] ?? log.action}
                        </p>
                        <p className="text-caption">
                          {formatDateTime(log.created_at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
