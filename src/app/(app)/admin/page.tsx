import type { Metadata } from "next";
import Link from "next/link";
import {
  Boxes,
  Building2,
  CalendarOff,
  ClipboardList,
  GitBranch,
  ScrollText,
  Settings,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, SectionHeader } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Callout } from "@/components/ui/Callout";
import { LinkButton } from "@/components/ui/Button";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "시스템 개요" };

/**
 * 관리자 진입점.
 *
 * 관리 기능 9개가 전역 레일에 평면으로 나열돼 있던 명분이 "진입점이 없어서"였다.
 * 각 기능은 이제 해당 모듈 패널의 '관리' 섹션으로 들어갔고, 여기는
 * 전사 설정 상태를 한눈에 보고 미완료 항목으로 이동하는 자리다.
 */
export default async function AdminOverviewPage() {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const [
    { count: employeeCount },
    { count: activeCount },
    { count: unlinkedCount },
    { data: lines },
    { count: departmentCount },
    { count: auditCount },
  ] = await Promise.all([
    supabase.from("employees").select("id", { count: "exact", head: true }),
    supabase
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("employment_status", "active"),
    // 아직 Google 계정과 연결되지 않은 임직원 — 로그인이 불가능한 상태
    supabase
      .from("employees")
      .select("id", { count: "exact", head: true })
      .is("auth_user_id", null),
    supabase.from("approval_line_configs").select("document_type, step2_approver_id"),
    supabase.from("departments").select("id", { count: "exact", head: true }),
    // 최근 7일 감사 로그 — "확인"이라는 맨텍스트 대신 실제 변경량을 보여준다
    supabase
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .gte(
        "created_at",
        new Date(Date.now() - 7 * 86_400_000).toISOString(),
      ),
  ]);

  const unsetLines = (lines ?? []).filter((l) => !l.step2_approver_id).length;
  const totalLines = (lines ?? []).length;

  return (
    <>
      <PageHeader
        title="시스템 개요"
        description="전사 설정 상태와 조치가 필요한 항목"
      />

      {unsetLines > 0 ? (
        <Callout
          tone="warn"
          title={`결재라인 ${unsetLines}건에 최종 결재자가 지정되지 않았습니다`}
          action={
            <LinkButton
              href="/admin/approval-lines"
              size="small"
              variant="secondary"
            >
              지정하기
            </LinkButton>
          }
          className="mb-5"
        >
          최종 결재자가 없는 문서 유형은 아무도 기안할 수 없습니다.
        </Callout>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="재직 인원"
          value={activeCount ?? 0}
          unit="명"
          denominator={employeeCount ?? 0}
          denominatorUnit="명"
          tone="brand"
          icon={Building2}
          emphasis
          sub={`부서 ${departmentCount ?? 0}개`}
        />
        <StatCard
          label="계정 연결"
          value={(employeeCount ?? 0) - (unlinkedCount ?? 0)}
          unit="명"
          denominator={employeeCount ?? 0}
          denominatorUnit="명"
          tone={unlinkedCount ? "warning" : "positive"}
          icon={Shield}
          href="/admin/employees"
          max={employeeCount || 1}
          meterValue={(employeeCount ?? 0) - (unlinkedCount ?? 0)}
          sub={
            unlinkedCount
              ? `미연결 ${unlinkedCount}명 — 로그인 불가`
              : "전원 로그인 가능"
          }
        />
        <StatCard
          label="결재라인 설정"
          value={totalLines - unsetLines}
          denominator={totalLines}
          unit="건"
          tone={unsetLines ? "warning" : "positive"}
          icon={GitBranch}
          max={totalLines || 1}
          meterValue={totalLines - unsetLines}
          href="/admin/approval-lines"
        />
        <StatCard
          label="최근 7일 변경"
          value={auditCount ?? 0}
          unit="건"
          tone="informative"
          icon={ScrollText}
          href="/admin/audit-logs"
          sub="권한·인사정보 변경 이력"
        />
      </div>

      <SectionHeader
        title="관리 화면"
        description="각 기능은 해당 모듈 패널의 '관리' 섹션에서도 열 수 있습니다"
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {AREAS.map((area) => (
          <AdminLink key={area.href} {...area} />
        ))}
      </div>
    </>
  );
}

const AREAS: { href: string; label: string; note: string; icon: LucideIcon }[] =
  [
    {
      href: "/admin/employees",
      label: "임직원 관리",
      note: "계정 생성·인사정보·재직상태",
      icon: Building2,
    },
    {
      href: "/admin/roles",
      label: "권한 관리",
      note: "역할 부여와 권한 범위",
      icon: Shield,
    },
    {
      href: "/admin/attendance",
      label: "전사 근태 관리",
      note: "근태 조회·보정·주52시간 모니터링",
      icon: ClipboardList,
    },
    {
      href: "/admin/approval-lines",
      label: "결재라인 설정",
      note: "문서 유형별 결재 단계",
      icon: GitBranch,
    },
    {
      href: "/admin/holidays",
      label: "휴일 관리",
      note: "공휴일·회사 지정 휴무일",
      icon: CalendarOff,
    },
    {
      href: "/admin/resources",
      label: "리소스 관리",
      note: "회의실·장비 예약 대상",
      icon: Boxes,
    },
    {
      href: "/admin/boards",
      label: "게시판 관리",
      note: "게시판 생성·쓰기 권한",
      icon: Settings,
    },
    {
      href: "/admin/files",
      label: "파일함 관리",
      note: "사내 규정 문서 등록",
      icon: Settings,
    },
    {
      href: "/admin/audit-logs",
      label: "감사 로그",
      note: "누가 무엇을 바꿨는지",
      icon: ScrollText,
    },
  ];

function AdminLink({
  href,
  label,
  note,
  icon: Icon,
}: {
  href: string;
  label: string;
  note: string;
  icon: LucideIcon;
}) {
  return (
    <Link href={href} className="block">
      <Card className="h-full transition-colors duration-fast ease-standard hover:border-line-strong">
        <CardBody density="compact" className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-subtle text-muted">
            <Icon className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-body-sm font-bold text-ink">
              {label}
            </span>
            <span className="block truncate text-caption">{note}</span>
          </span>
        </CardBody>
      </Card>
    </Link>
  );
}
