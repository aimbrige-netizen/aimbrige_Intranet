import type { Metadata } from "next";
import Link from "next/link";
import { FileSignature, FolderKanban, History } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionHeader } from "@/components/ui/Card";
import {
  Badge,
  EmploymentStatusBadge,
  RoleBadge,
} from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/EmptyState";
import { HrCard, HrTabStrip, parseHrTab, type HrTab } from "@/features/ess/HrCard";
import { CertRequests } from "@/features/ess/CertRequests";
import {
  CONTRACT_STATUS_LABELS,
  getMyCertificateRequests,
  getMyContracts,
  type ContractStatus,
} from "./data";
import { getEmployeeTimeline } from "@/features/directory/data";
import { tenureLabel, tenureMonths } from "@/features/directory/org";
import { getProjects } from "@/features/projects/data";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  type ProjectListRow,
} from "@/features/projects/types";
import { progressLabel, progressOf } from "@/features/projects/format";
import { requireSessionEmployee } from "@/lib/auth/session";
import { formatDate, formatDateTime, todayInSeoul } from "@/lib/utils";
import type { OrgHistoryRow } from "@/features/directory/data";

export const metadata: Metadata = { title: "인사" };

/**
 * 인사 (13-ess.md #hr/my-hr-info).
 *
 * ?tab= 이 화면을 가른다 — 패널 항목 '내 인사정보'(/hr)는 인사카드 + 탭 4칸,
 * '증명서 발급 신청'(/hr?tab=certificates)은 신청 폼 + 내 신청 목록이다.
 * 인사카드 탭(appointments/projects/contracts)도 같은 파라미터를 쓴다 —
 * /directory?tab=people과 같은 규약이라 nav의 활성 판정(isChildActive)이
 * 그대로 동작한다.
 */

/** directory 상세와 같은 라벨 축 — list_org_history가 주는 action 그대로 */
const ACTION_LABELS: Record<string, string> = {
  employee_created: "입사·계정 등록",
  employee_transferred: "조직 이동",
  employee_promoted: "승진",
  employment_status_changed: "재직상태 변경",
  role_changed: "역할 변경",
};

const CONTRACT_STATUS_TONES: Record<
  ContractStatus,
  "neutral" | "success"
> = {
  draft: "neutral",
  signed: "success",
  expired: "neutral",
};

export default async function HrPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const me = await requireSessionEmployee();

  /* 증명서 발급 신청 — 인사카드와 별개 화면 (패널 항목이 직접 링크한다) */
  if (searchParams.tab === "certificates") {
    /* 조회는 소프트 실패다(A의 규약) — 실패하면 빈 목록으로 선다 */
    const rows = await getMyCertificateRequests(me.id);
    return (
      <>
        <PageHeader
          title="증명서 발급 신청"
          description="재직·경력증명서 발급을 신청하고 처리 상태를 확인합니다."
        />
        <CertRequests rows={rows} />
      </>
    );
  }

  const tab = parseHrTab(searchParams.tab);

  return (
    <>
      <PageHeader
        title="내 인사정보"
        description="인사카드는 읽기 전용입니다. 변경이 필요하면 시스템 관리자에게 문의하세요."
      />

      <div className="space-y-5">
        <HrCard me={me} />
        <HrTabStrip active={tab} />
        <TabBody tab={tab} me={me} />
      </div>
    </>
  );
}

/** 탭 본문 — 필요한 조회만 그 탭에서 한다 */
async function TabBody({
  tab,
  me,
}: {
  tab: HrTab;
  me: Awaited<ReturnType<typeof requireSessionEmployee>>;
}) {
  if (tab === "appointments") return <AppointmentsTab employeeId={me.id} />;
  if (tab === "projects") {
    return <ProjectsTab employeeId={me.id} teamId={me.team_id} />;
  }
  if (tab === "contracts") return <ContractsTab employeeId={me.id} />;
  return <BasicTab me={me} />;
}

/* ── 기본: 직원정보 + 소속이력 요약 ─────────────────────────────── */

async function BasicTab({
  me,
}: {
  me: Awaited<ReturnType<typeof requireSessionEmployee>>;
}) {
  const timeline = await getEmployeeTimeline(me.id);
  const tenure = tenureLabel(tenureMonths(me.hire_date, todayInSeoul()));
  const recent = timeline.slice(0, 3);

  const info: { label: string; value: React.ReactNode }[] = [
    {
      label: "재직상태",
      value: <EmploymentStatusBadge status={me.employment_status} />,
    },
    { label: "입사일", value: formatDate(me.hire_date) },
    { label: "근속", value: tenure },
    { label: "역할", value: <RoleBadge role={me.roleName} /> },
    { label: "부서", value: me.department?.name ?? "미지정" },
    { label: "팀", value: me.team?.name ?? "미지정" },
  ];

  return (
    <div className="space-y-5">
      <section>
        <SectionHeader title="직원정보" />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
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
        </div>
      </section>

      <section>
        <SectionHeader
          title="소속이력 요약"
          description="최근 3건 — 전체 이력은 인사발령 탭에서 봅니다."
        />
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          {recent.length === 0 ? (
            <p className="text-label text-muted">
              기록된 조직 변경이 없습니다.
            </p>
          ) : (
            <Timeline rows={recent} />
          )}
        </div>
      </section>
    </div>
  );
}

/* ── 인사발령: 조직 변경 이력 (directory 상세의 조회 재사용) ─────── */

async function AppointmentsTab({ employeeId }: { employeeId: string }) {
  const timeline = await getEmployeeTimeline(employeeId);

  return (
    <section>
      <SectionHeader
        title="인사발령"
        description="조직 이동·승진·재직상태 변경이 시간순으로 쌓입니다."
      />
      <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
        {timeline.length === 0 ? (
          <EmptyState
            icon={History}
            title="기록된 인사발령이 없습니다"
            description="조직 이동·승진이 발생하면 여기에 시간순으로 쌓입니다."
            compact
          />
        ) : (
          <Timeline rows={timeline} />
        )}
      </div>
    </section>
  );
}

function Timeline({ rows }: { rows: OrgHistoryRow[] }) {
  return (
    <ol className="space-y-3">
      {rows.map((log) => (
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
  );
}

/* ── 프로젝트: 내 프로젝트 목록 (기존 조회 재사용) ──────────────── */

async function ProjectsTab({
  employeeId,
  teamId,
}: {
  employeeId: string;
  teamId: string | null;
}) {
  const { rows, error } = await getProjects();
  const mine = rows.filter(
    (row) =>
      row.owner_id === employeeId || (teamId && row.team_id === teamId),
  );

  return (
    <section>
      <SectionHeader
        title="프로젝트"
        description="내가 담당하거나 우리 팀이 담당하는 프로젝트입니다."
      />
      {error ? (
        <Callout tone="danger" title="프로젝트를 불러오지 못했습니다">
          {error}
        </Callout>
      ) : mine.length === 0 ? (
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <EmptyState
            icon={FolderKanban}
            title="참여 중인 프로젝트가 없습니다"
            description="담당자나 담당팀으로 지정되면 여기에 표시됩니다."
            cta={{ label: "프로젝트 목록 보기", href: "/projects" }}
            compact
          />
        </div>
      ) : (
        <div className="ab-card overflow-hidden md:rounded-none md:border-0">
          <div className="overflow-x-auto">
            <table className="ab-table min-w-[640px]">
              <thead>
                <tr>
                  <th>프로젝트명</th>
                  <th>담당팀</th>
                  <th>상태</th>
                  <th>기간</th>
                  <th>진행</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((row) => (
                  <ProjectRow key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function ProjectRow({ row }: { row: ProjectListRow }) {
  const progress = progressOf(row.milestones ?? []);
  const period =
    row.start_date || row.end_date
      ? `${row.start_date ?? "?"} ~ ${row.end_date ?? "?"}`
      : "-";

  return (
    <tr>
      <td className="max-w-[280px]">
        <Link
          href={`/projects/${row.id}`}
          className="block truncate text-body-sm text-ink hover:underline"
        >
          {row.name}
        </Link>
      </td>
      <td className="whitespace-nowrap text-label text-muted">
        {row.team?.name ?? "-"}
      </td>
      <td>
        <Badge tone={PROJECT_STATUS_TONES[row.status]}>
          {PROJECT_STATUS_LABELS[row.status]}
        </Badge>
      </td>
      <td className="whitespace-nowrap text-label tabular-nums text-muted">
        {period}
      </td>
      <td className="whitespace-nowrap text-label tabular-nums text-muted">
        {progressLabel(progress)}
      </td>
    </tr>
  );
}

/* ── 계약: 내 계약 (담당 A의 조회 — 어댑터 경유) ────────────────── */

async function ContractsTab({ employeeId }: { employeeId: string }) {
  /* 조회는 소프트 실패다(A의 규약) — 실패하면 빈 목록으로 선다 */
  const rows = await getMyContracts(employeeId);

  return (
    <section>
      <SectionHeader
        title="계약"
        description="내 근로계약 목록입니다. 열람은 계약 모듈에서 합니다."
      />
      {rows.length === 0 ? (
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <EmptyState
            icon={FileSignature}
            title="등록된 계약이 없습니다"
            description="계약이 등록되면 계약서명·상태·체결일이 여기에 표시됩니다."
            compact
          />
        </div>
      ) : (
        <div className="ab-card overflow-hidden md:rounded-none md:border-0">
          <div className="overflow-x-auto">
            <table className="ab-table min-w-[560px]">
              <thead>
                <tr>
                  <th>계약서명</th>
                  <th>상태</th>
                  <th>체결일</th>
                  <th>파일</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="max-w-[320px] truncate text-body-sm text-ink">
                      {row.title}
                    </td>
                    <td>
                      <Badge tone={CONTRACT_STATUS_TONES[row.status]}>
                        {CONTRACT_STATUS_LABELS[row.status]}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap text-label tabular-nums text-muted">
                      {row.signed_at ? row.signed_at.slice(0, 10) : "-"}
                    </td>
                    <td className="whitespace-nowrap text-label">
                      {row.hasFile ? (
                        <Link
                          href="/contracts"
                          className="text-primary-ink hover:underline"
                        >
                          계약 모듈에서 열람
                        </Link>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
