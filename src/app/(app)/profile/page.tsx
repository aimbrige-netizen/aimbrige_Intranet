import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmploymentStatusBadge, RoleBadge } from "@/components/ui/Badge";
import { ProfileEditForm } from "@/features/profile/ProfileEditForm";
import { FavoriteList } from "@/features/profile/FavoriteList";
import { SignOutButton } from "@/features/profile/SignOutButton";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getFavorites } from "@/features/dashboard/widget-data";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "내 프로필" };

export default async function ProfilePage() {
  const me = await requireSessionEmployee();
  const favorites = await getFavorites(me.id);

  const basicInfo = [
    { label: "이름", value: me.name },
    { label: "이메일", value: me.email },
    { label: "부서", value: me.department?.name ?? "-" },
    { label: "팀", value: me.team?.name ?? "-" },
    { label: "직급/직책", value: me.position ?? "-" },
    { label: "입사일", value: formatDate(me.hire_date) },
  ];

  return (
    <>
      <PageHeader
        title="내 프로필"
        description="기본정보는 읽기 전용입니다. 변경이 필요하면 시스템 관리자에게 문의하세요."
        action={<SignOutButton />}
      />

      <div className="space-y-5">
        <Card>
          <CardHeader
            title="기본정보"
            description="읽기 전용 — 수정은 관리자만 가능합니다."
            action={
              <div className="flex items-center gap-2">
                <RoleBadge role={me.roleName} />
                <EmploymentStatusBadge status={me.employment_status} />
              </div>
            }
          />
          <CardBody>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {basicInfo.map((item) => (
                <div key={item.label}>
                  <dt className="text-caption">{item.label}</dt>
                  <dd className="mt-0.5 text-body text-ink">{item.value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="내가 수정할 수 있는 항목"
            description="프로필 사진 · 휴대폰번호 · 비상연락처"
          />
          <CardBody>
            <ProfileEditForm
              authUserId={me.auth_user_id}
              name={me.name}
              initial={{
                phone: me.phone ?? "",
                emergency_contact: me.emergency_contact ?? "",
                profile_image_url: me.profile_image_url,
              }}
            />
          </CardBody>
        </Card>

        <Card id="favorites">
          <CardHeader
            title="즐겨찾기"
            description="사이드바 상단에 고정되는 바로가기입니다."
          />
          <CardBody>
            <FavoriteList favorites={favorites} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
