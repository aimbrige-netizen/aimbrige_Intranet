import type { Metadata } from "next";
import { CalendarCheck, FileText, FolderKanban, NotebookPen } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Callout } from "@/components/ui/Callout";
import { StatCard } from "@/components/ui/StatCard";
import { PeriodNavigator } from "@/components/ui/PeriodNavigator";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { MemberSelect, type MemberOption } from "@/features/worklog/MemberSelect";
import { WorklogView } from "@/features/worklog/WorklogView";
import {
  countWorkLogs,
  getHolidayNames,
  getProjectNames,
  getProjectOptions,
  getRecordStreak,
  getTeamMembers,
  getWorkLogs,
} from "@/features/worklog/data";
import type { WorklogStripDay } from "@/features/worklog/types";
import { requireSessionEmployee } from "@/lib/auth/session";
import { addDaysYmd, todayYmd, weekdayOf } from "@/features/calendar/date";
import {
  parsePeriod,
  periodHref,
  PERIOD_UNIT_LABELS,
  type PeriodSearchParams,
  type PeriodUnit,
} from "@/lib/period";

export const metadata: Metadata = { title: "업무일지" };

/** 이 화면이 지원하는 기간 단위 (= 토글 순서) */
const UNITS = ["week", "month"] as const satisfies readonly PeriodUnit[];
/** 업무일지는 주 단위로 쓴다 — 한 주를 채웠는지가 이 화면의 질문이다 */
const DEFAULT_UNIT = "week";

interface WorklogSearchParams extends PeriodSearchParams {
  /** 팀장이 조회 중인 팀원. 없으면 본인 */
  member?: string;
}

/**
 * 업무일지 (스펙 09 · 3.1)
 *
 * 구성은 근태 화면과 같다: 기간 스테퍼 → 분모 있는 요약 밴드 →
 * 7일 칩 스트립 → 인라인 입력 → 조밀 표.
 *
 * "캘린더뷰"는 별도 격자를 만들지 않고 근태와 같은 DayStrip을 쓴다.
 * 월간에는 스트립을 그리지 않는다 — 30칸짜리 칩 격자는 한 줄짜리 기록을
 * 읽을 수 없는 크기로 접고, 그 자리를 표가 이미 더 잘 하고 있다.
 */
export default async function WorklogPage({
  searchParams,
}: {
  searchParams: WorklogSearchParams;
}) {
  const me = await requireSessionEmployee();
  const today = todayYmd();

  // 기간은 ?period=week|month & ?cursor= 로 읽는다 (lib/period 규약)
  const period = parsePeriod(searchParams, {
    units: UNITS,
    defaultUnit: DEFAULT_UNIT,
    today,
  });
  const view = period.unit;

  // 조회 대상 판정은 my_team_members()에 맡긴다 (마이그레이션 18)
  const members = await getTeamMembers();
  const target = members.find((m) => m.id === searchParams.member) ?? null;
  const targetId = target?.id ?? me.id;
  const canEdit = targetId === me.id;

  // 지난 기간 비교값 — 같은 규약으로 한 칸 뒤 구간을 다시 계산한다
  const previous = period.prevCursor
    ? parsePeriod(
        { period: view, cursor: period.prevCursor },
        { units: UNITS, defaultUnit: DEFAULT_UNIT, today },
      )
    : null;

  const [{ logs, error }, holidays, streak, previousCount, projects] =
    await Promise.all([
      getWorkLogs(targetId, period.from, period.to),
      getHolidayNames(period.from, period.to),
      getRecordStreak(targetId, today),
      previous
        ? countWorkLogs(targetId, previous.from, previous.to)
        : Promise.resolve(0),
      getProjectOptions(),
    ]);

  // 드롭다운에 없는(취소·삭제된) 프로젝트도 표에서는 이름을 잃지 않게 한다
  const knownNames: Record<string, string> = {};
  projects.forEach((project) => {
    knownNames[project.id] = project.name;
  });
  const missingIds = Array.from(
    new Set(
      logs
        .map((log) => log.project_id)
        .filter((id): id is string => !!id && !knownNames[id]),
    ),
  );
  const projectNames = {
    ...knownNames,
    ...(await getProjectNames(missingIds)),
  };

  // ── 집계 ────────────────────────────────────────────────────────
  const days: string[] = [];
  for (
    let cursor = period.from, guard = 0;
    guard < 400 && cursor <= period.to;
    guard += 1
  ) {
    days.push(cursor);
    cursor = addDaysYmd(cursor, 1);
  }

  const isNonWorking = (ymd: string) => {
    const weekday = weekdayOf(ymd);
    return weekday === 0 || weekday === 6 || !!holidays[ymd];
  };

  // 아직 오지 않은 날은 "미기록"이 아니다
  const observedTo = period.to < today ? period.to : today;
  const workingDays = days.filter((d) => d <= observedTo && !isNonWorking(d));

  const recordedDates = new Set(logs.map((log) => log.log_date));
  const recordedWorkingDays = workingDays.filter((d) =>
    recordedDates.has(d),
  ).length;
  const missingDays = workingDays.length - recordedWorkingDays;

  const taggedCount = logs.filter((log) => log.project_id).length;
  const taggedProjectCount = new Set(
    logs.map((log) => log.project_id).filter(Boolean),
  ).size;

  const perDay =
    recordedDates.size > 0
      ? Math.round((logs.length / recordedDates.size) * 10) / 10
      : 0;

  /*
   * 조회가 실패했을 때는 0이 아니라 "—"로 둔다. 둘은 다른 사실이다.
   * 보조 문구도 같이 감춘다 — 값이 "—"인데 "지난 기간 0건"이 남아 있으면
   * 실패를 0으로 읽게 만든다.
   */
  const statState = error ? ("empty" as const) : ("ok" as const);
  const statSub = (text: string) => (error ? undefined : text);

  // ── 링크 ────────────────────────────────────────────────────────
  const memberParam = target?.id ?? null;
  const linkTo = (unit: PeriodUnit, cursor: string | null) =>
    periodHref(
      "/worklog",
      { unit, cursor },
      { defaultUnit: DEFAULT_UNIT, extra: { member: memberParam } },
    );

  const memberOptions: MemberOption[] = [
    {
      value: "",
      label: "내 업무일지",
      href: periodHref(
        "/worklog",
        { unit: view, cursor: period.includesToday ? null : period.cursor },
        { defaultUnit: DEFAULT_UNIT },
      ),
    },
    ...members.map((member) => ({
      value: member.id,
      label: [member.name, member.position, member.team_name]
        .filter(Boolean)
        .join(" · "),
      href: periodHref(
        "/worklog",
        { unit: view, cursor: period.includesToday ? null : period.cursor },
        { defaultUnit: DEFAULT_UNIT, extra: { member: member.id } },
      ),
    })),
  ];

  // ── 스트립 ──────────────────────────────────────────────────────
  const strip: WorklogStripDay[] | null =
    view === "week"
      ? days.map((date) => ({
          date,
          holiday: holidays[date] ?? null,
          muted: isNonWorking(date) || date > today,
          selectable: canEdit && date <= today,
        }))
      : null;

  const defaultDate = period.includesToday
    ? today
    : period.to < today
      ? period.to
      : today;

  const ownerLabel = target ? `${target.name}님이` : "아직";

  return (
    <>
      <PageHeader
        title="업무일지"
        meta={
          <>
            <span>
              {target
                ? [target.name, target.position].filter(Boolean).join(" ")
                : me.name}
            </span>
            <span>·</span>
            <span>
              {/* 팀원 것을 볼 때 내 소속으로 되돌아가면 누구의 기록인지 흐려진다 */}
              {target
                ? (target.team_name ?? "팀 미지정")
                : (me.team?.name ?? me.department?.name ?? "부서 미지정")}
            </span>
            <span>·</span>
            <span>{period.label}</span>
          </>
        }
        actions={
          members.length > 0 ? (
            <MemberSelect options={memberOptions} value={target?.id ?? ""} />
          ) : undefined
        }
        toolbar={
          <PeriodNavigator
            label={period.label}
            sublabel={period.sublabel}
            prevHref={linkTo(view, period.prevCursor)}
            nextHref={linkTo(view, period.nextCursor)}
            todayHref={linkTo(view, null)}
            atToday={period.includesToday}
            className="mb-0"
            right={
              <SegmentedControl
                options={UNITS.map((unit) => ({
                  value: unit,
                  label: PERIOD_UNIT_LABELS[unit],
                  // 지난 기간을 보는 중이면 단위를 바꿔도 그 지점에 머문다
                  href: linkTo(
                    unit,
                    period.includesToday ? null : period.cursor,
                  ),
                }))}
                value={view}
                ariaLabel="기간 단위"
              />
            }
          />
        }
      />

      {error ? (
        <Callout
          tone="warn"
          title="업무일지를 불러오지 못했습니다"
          className="mb-5"
        >
          {error}
        </Callout>
      ) : null}

      {target ? (
        <Callout
          tone="info"
          title={`${target.name}님의 업무일지를 보고 있습니다`}
          className="mb-5"
        >
          팀원의 기록은 조회만 할 수 있습니다. 내 기록으로 돌아가려면 위
          목록에서 &lsquo;내 업무일지&rsquo;를 고르세요.
        </Callout>
      ) : null}

      {/*
        요약 밴드 — 숫자마다 분모나 비교값을 붙인다.
        색 절제(17 준용): 색을 갖는 값은 이 화면의 질문인 "기록한 날"(brand)
        하나다 — 기록 건수·연속 기록·태깅은 성패 판정이 아니라 중립이다.
      */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="기록한 날"
          value={recordedWorkingDays}
          unit="일"
          denominator={workingDays.length}
          denominatorUnit="일"
          tone="brand"
          icon={NotebookPen}
          max={workingDays.length || 1}
          meterValue={recordedWorkingDays}
          state={statState}
          sub={statSub(
            workingDays.length === 0
              ? "이 기간에는 근무일이 없습니다"
              : missingDays > 0
                ? `아직 ${missingDays}일 남았습니다`
                : "근무일을 모두 기록했습니다",
          )}
        />
        <StatCard
          label="이번 기간 기록"
          value={logs.length}
          unit="건"
          tone="neutral"
          icon={FileText}
          state={statState}
          /*
            증감 델타 배지는 두지 않는다 — 지난 기간보다 덜 쓴 주에 danger
            틴트가 붙는데, 개인 기록의 주간 증감은 성패 판정이 아니다(할일
            화면과 같은 판단). 비교값은 sub의 지난 기간 건수로 충분하다.
          */
          sub={statSub(
            `지난 기간 ${previousCount}건 · 기록한 날 하루 평균 ${perDay}건`,
          )}
        />
        <StatCard
          label="연속 기록"
          value={streak.current}
          unit="일"
          denominator={streak.longest}
          denominatorUnit="일"
          tone="neutral"
          icon={CalendarCheck}
          max={streak.longest || 1}
          meterValue={streak.current}
          state={statState}
          sub={statSub(
            streak.lastDate
              ? `최근 12주 최장 ${streak.longest}일 · 마지막 기록 ${streak.lastDate.slice(5)}`
              : "최근 12주에 남긴 기록이 없습니다",
          )}
        />
        <StatCard
          label="프로젝트 태깅"
          value={taggedCount}
          unit="건"
          denominator={logs.length}
          denominatorUnit="건"
          tone="neutral"
          icon={FolderKanban}
          max={logs.length || 1}
          meterValue={taggedCount}
          state={statState}
          sub={statSub(
            projects.length === 0
              ? "고를 수 있는 프로젝트가 아직 없습니다"
              : `${taggedProjectCount}개 프로젝트 · 선택 가능 ${projects.length}개`,
          )}
        />
      </div>

      <WorklogView
        /*
         * 기간·대상이 바뀌면 입력창의 날짜와 편집 중이던 행도 함께 초기화돼야
         * 한다. 지난 주를 보다가 이번 주로 옮겼는데 입력 날짜가 지난 주에
         * 남아 있으면, 저장 버튼이 조용히 엉뚱한 날에 기록을 남긴다.
         */
        key={`${targetId}-${view}-${period.cursor}`}
        logs={logs}
        projects={projects}
        projectNames={projectNames}
        strip={strip}
        canEdit={canEdit}
        today={today}
        defaultDate={defaultDate}
        periodLabel={period.label}
        ownerLabel={ownerLabel}
      />
    </>
  );
}
