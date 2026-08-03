import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { cn, formatDate } from "@/lib/utils";
import type { SessionEmployee } from "@/types/db";

/**
 * 인사카드 (13-ess.md #hr/my-hr-info).
 *
 * 실측 그대로: 사진 자리 + 라벨-값 필드 그리드(행 270×28 축, 라벨 14/500
 * rgb(51,51,51)≈ink-sub, 값 14/400). 다우 필드 9종(ID·직원구분·사원번호·
 * 직통번호 포함) 중 우리 employees에 있는 것만 세운다 — 없는 필드를
 * 빈 껍데기로 두지 않는다(구현 결정).
 *
 * 탭도 같은 원칙이다. 다우 14칸(신상·포상·어학·가족…) 중 우리 데이터가
 * 있는 4칸만: 기본 / 인사발령(조직 변경 이력) / 프로젝트 / 계약.
 */

export const HR_TABS = [
  "basic",
  "appointments",
  "projects",
  "contracts",
] as const;

export type HrTab = (typeof HR_TABS)[number];

export const HR_TAB_LABELS: Record<HrTab, string> = {
  basic: "기본",
  appointments: "인사발령",
  projects: "프로젝트",
  contracts: "계약",
};

export function parseHrTab(value: string | undefined): HrTab {
  return value === "appointments" ||
    value === "projects" ||
    value === "contracts"
    ? value
    : "basic";
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-7 max-w-[270px] items-center gap-3">
      <dt className="w-[72px] shrink-0 text-body font-medium text-ink-sub">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-body text-ink">{value}</dd>
    </div>
  );
}

/** 사진 자리 + 필드 그리드. 탭과 무관하게 화면 상단에 상주한다 */
export function HrCard({ me }: { me: SessionEmployee }) {
  const fields: { label: string; value: string }[] = [
    { label: "이름", value: me.name },
    {
      label: "부서/팀",
      value:
        [me.department?.name, me.team?.name].filter(Boolean).join(" · ") ||
        "미지정",
    },
    { label: "직위/직책", value: me.position ?? "미지정" },
    { label: "입사일", value: formatDate(me.hire_date) },
    { label: "이메일", value: me.email },
    { label: "휴대전화", value: me.phone ?? "미등록" },
  ];

  return (
    <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <Avatar name={me.name} src={me.profile_image_url} size="xlarge" />
        <dl className="grid flex-1 grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
          {fields.map((field) => (
            <FieldRow key={field.label} label={field.label} value={field.value} />
          ))}
        </dl>
      </div>
    </div>
  );
}

/**
 * 탭 스트립 — 실측: h-40 · 14px · 활성 = border-bottom 2px 검정(ink).
 * 필 세그먼트가 아니라 밑줄 탭이다.
 */
export function HrTabStrip({ active }: { active: HrTab }) {
  return (
    <nav
      aria-label="인사카드 탭"
      className="flex items-stretch gap-5 border-b border-line"
    >
      {HR_TABS.map((tab) => (
        <Link
          key={tab}
          href={tab === "basic" ? "/hr" : `/hr?tab=${tab}`}
          aria-current={active === tab ? "page" : undefined}
          className={cn(
            "-mb-px flex h-10 items-center border-b-2 text-body transition-colors duration-fast ease-standard",
            active === tab
              ? "border-ink font-medium text-ink"
              : "border-transparent text-ink-sub hover:text-ink",
          )}
        >
          {HR_TAB_LABELS[tab]}
        </Link>
      ))}
    </nav>
  );
}
