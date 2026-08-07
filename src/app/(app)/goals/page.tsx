import type { Metadata } from "next";
import { AlarmClock, CalendarClock, Target, Trophy } from "lucide-react";
import { SectionHeader } from "@/components/ui/Card";
import { Callout } from "@/components/ui/Callout";
import { METER_FILL, Meter } from "@/components/ui/Progress";
import { StatCard } from "@/components/ui/StatCard";
import { MemberSelect, type MemberOption } from "@/features/worklog/MemberSelect";
import { getTeamMembers } from "@/features/worklog/data";
import { GoalBoard } from "@/features/goals/GoalBoard";
import { getGoals } from "@/features/goals/data";
import {
  diffDaysYmd,
  GOAL_SOON_DAYS,
  summarizeGoals,
} from "@/features/goals/format";
import { GOAL_STATUS_LABELS } from "@/features/goals/types";
import { todayYmd } from "@/features/calendar/date";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "목표" };

interface GoalsSearchParams {
  /** 팀장이 조회 중인 팀원. 없으면 본인 */
  member?: string;
}

/**
 * 목표 (스펙 09 · 3.3)
 *
 * 기간 스테퍼가 없다 — 목표는 구간이 아니라 상태(진행중·완료·중단)로 산다.
 * 그 자리를 건수 붙은 필터칩과 상태 분포 막대가 대신한다.
 *
 * 스펙 §2 접근권한 표가 "/goals: 전체 임직원(본인·팀 목표)"이고 goals_select
 * RLS도 work_logs_select와 같이 manages_employee()로 팀장 SELECT를 열어둔다.
 * 그래서 대상 전환은 업무일지와 같은 규약을 그대로 쓴다 — my_team_members()
 * RPC + MemberSelect + canEdit 게이팅. 쓰기는 서버 액션이 employee_id=me.id로
 * 막고 있어서, 조회 대상이 바뀌어도 남의 목표는 손댈 수 없다.
 */
export default async function GoalsPage({
  searchParams,
}: {
  searchParams: GoalsSearchParams;
}) {
  const me = await requireSessionEmployee();
  const today = todayYmd();

  // 조회 대상 판정은 my_team_members()에 맡긴다 (마이그레이션 18)
  const members = await getTeamMembers();
  const target = members.find((m) => m.id === searchParams.member) ?? null;
  const targetId = target?.id ?? me.id;
  const canEdit = targetId === me.id;

  const { rows, error } = await getGoals(targetId);
  const summary = summarizeGoals(rows, today);

  const memberOptions: MemberOption[] = [
    { value: "", label: "내 목표", href: "/goals" },
    ...members.map((member) => ({
      value: member.id,
      label: [member.name, member.position, member.team_name]
        .filter(Boolean)
        .join(" · "),
      href: `/goals?member=${encodeURIComponent(member.id)}`,
    })),
  ];

  const memberSelect =
    members.length > 0 ? (
      <MemberSelect options={memberOptions} value={target?.id ?? ""} />
    ) : undefined;

  if (error) {
    return (
      <>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-title-l text-ink">
            목표
          </h1>
          {memberSelect}
        </div>
        <Callout tone="danger" title="목표를 불러오지 못했습니다">
          {error}
        </Callout>
      </>
    );
  }

  const ratePercent = Math.round(summary.rate * 100);

  return (
    <>
      {/*
        콘텐츠 제목 "목표" 20/500 — PageHeader급 밴드 없음(확립 문법, 결재 홈
        축). 줄높이 30px은 06 heading-l 실측. 종전 메타(소속·오늘 날짜·건수)는
        걷어낸다 — 건수는 아래 요약 밴드·분포 섹션이 분모까지 들고 말하고,
        조회 대상은 우측 MemberSelect 값과 팀원 조회 Callout이 말한다.
      */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title-l text-ink">
          목표
        </h1>
        {memberSelect}
      </div>

      {target ? (
        <Callout
          tone="info"
          title={`${target.name}님의 목표를 보고 있습니다`}
          className="mb-5"
        >
          팀원의 목표는 조회만 할 수 있습니다. 내 목표로 돌아가려면 위 목록에서
          &lsquo;내 목표&rsquo;를 고르세요.
        </Callout>
      ) : null}

      {/*
        요약 밴드 — 숫자마다 분모가 붙는다.
        색 절제(할일 화면과 같은 판단 축): 색을 갖는 값은 기한 지남(warn)과
        완료(민트 지표 규율) 둘뿐이다 — 진행중은 하고 있는 일이지 성패 판정이
        아니라서 중립이다.
      */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="진행중"
          value={summary.active}
          unit="건"
          denominator={summary.total}
          denominatorUnit="건"
          tone="neutral"
          icon={Target}
          max={summary.total || 1}
          meterValue={summary.active}
          sub={`목표일 없음 ${summary.noTarget}건`}
        />
        <StatCard
          label={`목표일 임박 (${GOAL_SOON_DAYS}일 내)`}
          value={summary.dueSoon}
          unit="건"
          denominator={summary.active}
          denominatorUnit="건"
          tone="neutral"
          icon={CalendarClock}
          max={summary.active || 1}
          meterValue={summary.dueSoon}
          sub={
            summary.nextTarget
              ? `가장 가까운 목표일 ${summary.nextTarget.slice(5)} (D-${diffDaysYmd(today, summary.nextTarget)})`
              : "예정된 목표일 없음"
          }
        />
        {/* 이 화면에서 경고색을 올리는 값은 여기 하나다 — 진행중은 위반이 아니다 */}
        <StatCard
          label="목표일 지남"
          value={summary.overdue}
          unit="건"
          denominator={summary.active}
          denominatorUnit="건"
          tone={summary.overdue > 0 ? "warning" : "neutral"}
          icon={AlarmClock}
          max={summary.active || 1}
          meterValue={summary.overdue}
          sub={
            summary.overdue > 0
              ? "목표일을 다시 잡거나 중단으로 정리하세요"
              : "지난 목표일 없음"
          }
        />
        {/*
          라벨과 큰 숫자는 같은 개념을 가리켜야 한다 — 굵게 찍히는 값이
          완료 '건수'이므로 라벨도 '완료'다. 달성률(%)은 분모 있는 보조 문구로
          내린다(전체 대비 비율은 어차피 옆 미터가 같이 그린다).
        */}
        <StatCard
          label="완료"
          value={summary.completed}
          unit="건"
          denominator={summary.total}
          denominatorUnit="건"
          tone="positive"
          icon={Trophy}
          max={summary.total || 1}
          meterValue={summary.completed}
          sub={`달성률 ${ratePercent}% · 중단 ${summary.dropped}건`}
        />
      </div>

      {/* 카드 목록만으로는 셋의 비중이 보이지 않는다 */}
      {/*
        08 흰 시트: md+에서 .ab-card는 흰 면 위 이중 테두리 —
        섹션 제목 + 직접 배치로 해체하고 md 미만만 카드 유지(10-modules2).
      */}
      {summary.total > 0 ? (
        <section className="mb-5">
          <SectionHeader
            title="상태 분포"
            description={`전체 ${summary.total}건`}
          />
          <div className="ab-card px-4 py-3 md:rounded-none md:border-0 md:p-0">
            <Meter
              max={summary.total}
              segments={[
                {
                  value: summary.active,
                  tone: "informative",
                  label: GOAL_STATUS_LABELS.active,
                },
                {
                  value: summary.completed,
                  tone: "positive",
                  label: GOAL_STATUS_LABELS.completed,
                },
                {
                  value: summary.dropped,
                  tone: "neutral",
                  label: GOAL_STATUS_LABELS.dropped,
                },
              ]}
              valueLabel={`달성 ${ratePercent}%`}
            />
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
              <Legend
                swatch={METER_FILL.informative}
                label={GOAL_STATUS_LABELS.active}
                count={summary.active}
              />
              <Legend
                swatch={METER_FILL.positive}
                label={GOAL_STATUS_LABELS.completed}
                count={summary.completed}
              />
              <Legend
                swatch={METER_FILL.neutral}
                label={GOAL_STATUS_LABELS.dropped}
                count={summary.dropped}
              />
            </div>
          </div>
        </section>
      ) : null}

      <GoalBoard
        /* 대상이 바뀌면 열려 있던 필터·수정 모달도 함께 초기화돼야 한다 */
        key={targetId}
        goals={rows}
        today={today}
        canEdit={canEdit}
        ownerLabel={target ? `${target.name}님이` : "아직"}
      />
    </>
  );
}

function Legend({
  swatch,
  label,
  count,
}: {
  swatch: string;
  label: string;
  count: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-label text-muted">
      <span className={`size-2 rounded-sm ${swatch}`} aria-hidden />
      {label}
      <span className="tabular-nums text-ink">{count}</span>
    </span>
  );
}
