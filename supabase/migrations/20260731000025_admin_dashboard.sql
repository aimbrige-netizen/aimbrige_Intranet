-- =====================================================================
-- 마이그레이션 25 — 스펙 18 관리자 대시보드
--
-- 새 테이블은 없다(스펙 4장). 기존 테이블을 세는 집계 함수만 만든다.
--
-- 전부 security definer다. 전사 집계는 RLS를 우회해야 나오는데
-- (employees는 본인 행만, attendance/leave는 본인+팀원만 보인다),
-- 그러면 함수 자체가 권한 경계가 된다. review_cycle_progress(21)가 세운
-- 규약을 그대로 따른다 — 첫 줄에서 is_system_admin()을 확인하고,
-- 끝에서 revoke all from public + grant execute to authenticated.
-- 하나라도 빠뜨리면 전 직원이 전사 통계를 조회할 수 있다.
--
-- ── 스펙과 다르게 간 부분 (의도적) ──────────────────────────────────
--
-- 1. 오늘의 출근 현황은 3분할이 아니라 4분할이다.
--    스펙은 "출근완료/미출근/휴가중"인데, 반차를 쓴 사람은 출근도 하고
--    휴가도 써서 두 칸에 동시에 들어간다. 합이 재직 인원과 안 맞으면
--    분모가 없는 숫자 세 개일 뿐이라 관리자가 아무것도 판단하지 못한다.
--    종일휴가와 반차·시간연차를 나눠 네 칸으로 만들고, 한 사람이 정확히
--    한 칸에만 들어가도록 우선순위를 고정했다(아래 함수 주석 참고).
--
-- 2. 연차 사용률을 leave_balances에서 내지 않는다.
--    leave_balances.accrued_days는 그 직원이 /attendance를 열어야 채워지는
--    lazy write 캐시다 — 쓰는 곳이 getLeaveSummary() 한 곳뿐이고 스케줄러가
--    없다(src/features/attendance/data.ts). 한 번도 화면을 안 연 직원은
--    발생일수 0으로 잡혀 회사 평균 사용률이 실제보다 높게 나온다.
--    발생일수는 입사일과 기준일만으로 결정되는 값이라, 캐시를 읽는 대신
--    여기서 계산한다(leave_year_of). 산정에 필요한 hire_date가 없는 사람은
--    분자·분모 어디에도 넣지 않고 uncomputed_count로 따로 돌려준다.
--
-- 3. 결재 평균 처리 소요를 approval_documents.updated_at으로 재지 않는다.
--    updated_at은 touch_updated_at 트리거가 모든 UPDATE에 붙어 있어
--    "결재가 끝난 시각"이 아니다. 실제로 complete_approval_document()의
--    시행완료 처리가 updated_at을 다시 밀어서, 완료 문서의 소요는
--    승인까지가 아니라 시행완료까지로 부풀어 있다.
--    approval_steps는 상신 시각(단계 행이 생기는 시각)과 결재 시각
--    (processed_at)을 둘 다 정확히 들고 있으므로 그쪽에서 잰다.
--
-- 4. 온보딩 위젯은 없다. onboarding_checklists 테이블이 아직 없어서
--    (스펙 07 미진행) 대신 recent_hires()로 최근 입사자를 낸다.
--
-- 5. 최근 활동 로그(audit_logs)는 함수를 만들지 않았다 — 아래 6절 참고.
--
-- 기간을 받는 함수는 from/to date를 인자로 받는다. 화면이 src/lib/period.ts로
-- 구간을 계산해 넘긴다. 날짜 경계는 서울 자정 기준으로 맞춘다
-- (마이그레이션 08·16과 같은 규약).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 연차연도 계산 — leave_balances 캐시를 대체한다
--
--    ⚠ src/features/attendance/leave-accrual.ts의 monthsOfService /
--    accrualForLeaveYear / leaveYearWindow를 SQL로 옮긴 것이다.
--    직원 화면(/attendance)이 그 TS 함수로 "이번 연차연도 부여분"을 보여주고
--    있어서, 관리자 집계가 다른 식으로 세면 같은 사람의 사용률이 두 화면에서
--    다르게 나온다. 둘 중 하나를 고칠 때는 반드시 같이 고쳐야 한다.
--
--    집계 쪽에서 계산으로 내는 이유는 위 헤더 2번과 같다. 캐시를 읽으면
--    "아직 로그인 안 한 사람 = 발생 0일"이 되어 평균이 조용히 틀어진다.
--
--    입사일이 없거나 아직 입사 전이면 행을 돌려주지 않는다. 0으로 돌려주면
--    분모에 0이 섞여 "사용률 0%인 사람"으로 평균에 들어가 버린다.
--    호출부는 left join lateral로 붙여 그 인원을 따로 센다.
-- ---------------------------------------------------------------------
create or replace function public.leave_year_of(
  p_hire_date date,
  p_as_of date
)
returns table (
  year_index int,
  period_start date,
  period_end date,
  granted_days numeric
)
language plpgsql
immutable
-- definer가 아니라 지금 당장은 탈취면이 아니지만, 이 파일의 나머지 여섯 함수와
-- 같은 모양으로 둔다. 나중에 여기서 테이블을 읽게 되는 날 빠진 것을 알아채기 어렵다
set search_path = public
as $$
declare
  months int;
  -- make_interval의 인자 이름(years)과 겹치지 않게 다른 이름을 쓴다
  svc_years int;
  anniversary_day int;
begin
  if p_hire_date is null or p_hire_date > p_as_of then
    return;
  end if;

  months := (extract(year from p_as_of)::int - extract(year from p_hire_date)::int) * 12
          + (extract(month from p_as_of)::int - extract(month from p_hire_date)::int);

  -- 말일 입사 보정: 1/31 입사자의 2월 기념일은 2/28(29)로 본다.
  -- 이 보정이 없으면 말일 입사자만 한 달씩 늦게 발생한다.
  anniversary_day := least(
    extract(day from p_hire_date)::int,
    extract(day from (
      date_trunc('month', p_as_of::timestamp) + interval '1 month' - interval '1 day'
    ))::int
  );
  if extract(day from p_as_of)::int < anniversary_day then
    months := months - 1;
  end if;
  months := greatest(0, months);

  svc_years := months / 12;

  year_index := svc_years;
  -- date + interval '1 year'는 Postgres가 말일을 알아서 당긴다(2/29 → 2/28)
  period_start := (p_hire_date + make_interval(svc_years))::date;
  -- 종료일은 다음 기념일 전날(포함 구간)
  period_end := (p_hire_date + make_interval(svc_years + 1) - interval '1 day')::date;

  if svc_years < 1 then
    -- 1년 미만은 월 개근마다 1일, 최대 11일 (근로기준법 제60조②)
    granted_days := least(months, 11);
  else
    -- 1년 이상 15일 + 3년차부터 2년마다 1일 가산, 25일 상한
    granted_days := least(15 + ((svc_years - 1) / 2), 25);
  end if;

  return next;
end;
$$;

revoke all on function public.leave_year_of(date, date) from public;
grant execute on function public.leave_year_of(date, date) to authenticated;

comment on function public.leave_year_of(date, date) is
  'src/features/attendance/leave-accrual.ts의 SQL 이식본. 한쪽만 고치면 관리자와 직원이 다른 숫자를 본다.';

-- ---------------------------------------------------------------------
-- 1. 인원 현황 (위젯 A)
--
--    /admin이 지금 employees·departments·audit_logs에 head count 질의를
--    여섯 번 따로 던져 만들던 숫자다. 한 번에 세서 내려준다 —
--    "재직 인원"의 정의(employment_status='active')가 화면마다 갈리지
--    않게 하는 것이 진짜 목적이다.
-- ---------------------------------------------------------------------
create or replace function public.headcount_summary()
returns table (
  total_count int,
  active_count int,
  on_leave_count int,
  terminated_count int,
  -- 아직 Google 계정과 연결되지 않은 재직·휴직 인원 — 로그인이 불가능한 상태.
  -- 퇴사자는 세지 않는다. auth_user_id는 첫 로그인 때 채워지므로 로그인 없이
  -- 퇴사 처리된 사람과 시스템 도입 전 퇴사자가 영구히 미연결로 남고,
  -- 그러면 조치할 대상이 0명인데도 화면에 상시 경고가 켜진다
  unlinked_count int,
  department_count int,
  team_count int
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    raise exception '전사 인원 현황은 시스템 관리자만 조회할 수 있습니다';
  end if;

  return query
  select
    count(*)::int,
    count(*) filter (where e.employment_status = 'active')::int,
    count(*) filter (where e.employment_status = 'leave')::int,
    count(*) filter (where e.employment_status = 'terminated')::int,
    count(*) filter (
      where e.auth_user_id is null and e.employment_status <> 'terminated'
    )::int,
    (select count(*) from public.departments)::int,
    (select count(*) from public.teams)::int
  from public.employees e;
end;
$$;

revoke all on function public.headcount_summary() from public;
grant execute on function public.headcount_summary() to authenticated;

/**
 * 부서별 인원 분포.
 *
 * 부서 미지정 인원도 한 행으로 돌려준다(department_id is null).
 * 빼 버리면 막대 합이 재직 인원과 안 맞고, 정작 조치가 필요한 사람들이
 * 화면에서 사라진다.
 */
create or replace function public.headcount_by_department()
returns table (
  department_id uuid,
  department_name text,
  active_count int,
  on_leave_count int,
  terminated_count int
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    raise exception '부서별 인원 분포는 시스템 관리자만 조회할 수 있습니다';
  end if;

  return query
  select
    d.id,
    d.name,
    count(*) filter (where e.employment_status = 'active')::int,
    count(*) filter (where e.employment_status = 'leave')::int,
    count(*) filter (where e.employment_status = 'terminated')::int
  from public.employees e
  left join public.departments d on d.id = e.department_id
  group by d.id, d.name
  -- 막대가 긴 순서로 그려지도록 정렬해서 내려준다
  order by count(*) filter (where e.employment_status = 'active') desc,
           d.name nulls last;
end;
$$;

revoke all on function public.headcount_by_department() from public;
grant execute on function public.headcount_by_department() to authenticated;

-- ---------------------------------------------------------------------
-- 2. 오늘의 출근 현황 — 4분할 (위젯 B)
--
--    한 사람이 정확히 한 칸에만 들어가고, 네 칸의 합이 재직 인원과
--    같아야 한다. 그래서 우선순위를 고정한다:
--
--      종일휴가 > 반차·시간연차 > 출근완료 > 미출근
--
--    반차를 쓴 사람은 출근도 했지만 '반차'로 센다. 출근완료에 넣으면
--    "오늘 온전히 일하는 인원"이라는 뜻이 흐려지고, 종일휴가와 같은 칸에
--    넣으면 자리에 없는 사람으로 읽힌다. 반차 칸이 따로 있어야 하는 이유가
--    그것이다.
--
--    leave_type으로 가른다 — full_day / half_day_am / half_day_pm / hourly
--    (마이그레이션 06). 반차·시간연차는 CHECK 제약으로 하루짜리만 가능해
--    start_date = end_date 이지만, 판정은 종일휴가와 같은 구간 비교로 둔다.
--
--    p_date는 화면이 서울 기준 오늘(todayYmd())을 넘긴다. 기본값도 서울
--    자정 기준이다 — DB 세션 타임존이 UTC면 한국 시각 오전 9시가 아직
--    '어제'로 잡힌다.
--
--    ⚠ 비근무일(주말·공휴일)에는 '미출근'이 조치 대상이 아니다. 그날은
--    거의 전원이 출근 기록 없이 미출근 칸으로 떨어지는데, 화면이 그 칸을
--    경고로 그리면 1년의 30%가 전사 무단결근으로 읽힌다. 칸을 없애면 네 칸의
--    합이 재직 인원과 어긋나므로, 대신 그날이 근무일인지를 같이 돌려주고
--    화면이 톤과 문구를 바꾸게 한다. 판정 기준은 결근 판정과 같은 규약이다
--    (getAttendanceWithAbsences — 토·일 + holidays.is_non_working).
-- ---------------------------------------------------------------------
create or replace function public.today_attendance_summary(
  p_date date default (now() at time zone 'Asia/Seoul')::date
)
returns table (
  active_total int,
  checked_in_count int,
  partial_leave_count int,
  full_day_leave_count int,
  absent_count int,
  /** 그날이 근무일이 아니면 true — 미출근 칸을 조치 대상으로 읽으면 안 된다 */
  non_working boolean,
  /** 비근무일의 이유(공휴일 이름 또는 '주말'). 근무일이면 null */
  non_working_label text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  -- isodow는 월=1 … 토=6, 일=7
  weekend boolean := extract(isodow from p_date) >= 6;
  holiday_name text;
begin
  if not public.is_system_admin() then
    raise exception '전사 출근 현황은 시스템 관리자만 조회할 수 있습니다';
  end if;

  -- is_non_working=false인 휴일(기념일 등)은 근무일이므로 여기서 걸러진다
  select h.name into holiday_name
  from public.holidays h
  where h.date = p_date and h.is_non_working;

  return query
  with bucketed as (
    select
      case
        when exists (
          select 1 from public.leave_requests l
          where l.employee_id = e.id
            and l.status = 'approved'
            and l.leave_type = 'full_day'
            and l.start_date <= p_date and l.end_date >= p_date
        ) then 'full_leave'
        when exists (
          select 1 from public.leave_requests l
          where l.employee_id = e.id
            and l.status = 'approved'
            and l.leave_type <> 'full_day'
            and l.start_date <= p_date and l.end_date >= p_date
        ) then 'partial_leave'
        -- 행이 있어도 check_in_at이 비어 있을 수 있다(퇴근만 보정된 경우)
        when exists (
          select 1 from public.attendance_records a
          where a.employee_id = e.id
            and a.work_date = p_date
            and a.check_in_at is not null
        ) then 'checked_in'
        else 'absent'
      end as bucket
    from public.employees e
    where e.employment_status = 'active'
      -- 입사 예정자를 미출근으로 찍으면 안 된다. 아직 오지 않은 사람이라
      -- 분모에도 들어가면 안 된다(recent_hires도 같은 이유로 뺀다).
      -- 입사일이 비어 있는 재직자는 판단할 근거가 없으므로 그대로 센다.
      and (e.hire_date is null or e.hire_date <= p_date)
  )
  select
    count(*)::int,
    count(*) filter (where bucket = 'checked_in')::int,
    count(*) filter (where bucket = 'partial_leave')::int,
    count(*) filter (where bucket = 'full_leave')::int,
    count(*) filter (where bucket = 'absent')::int,
    (weekend or holiday_name is not null),
    -- 공휴일이 주말과 겹치면 공휴일 이름을 쓴다 — 더 구체적인 쪽이 낫다
    coalesce(holiday_name, case when weekend then '주말' end)
  from bucketed;
end;
$$;

revoke all on function public.today_attendance_summary(date) from public;
grant execute on function public.today_attendance_summary(date) to authenticated;

-- ---------------------------------------------------------------------
-- 3. 연차 사용률 — 연차연도 기준, 팀별 (위젯 C)
--
--    스펙은 "이번 달 연차 사용률"이지만 월 단위 사용률은 분모가 없다
--    (연차는 월에 발생하지 않는다). 직원 화면 /attendance가 보여주는 것과
--    같은 기준 — 이번 연차연도(입사기념일 ~ 다음 기념일 전날)의 부여분 대비
--    그 구간의 승인된 연차 사용분 — 으로 낸다. 두 화면이 다른 숫자를
--    보여주면 문의가 들어왔을 때 어느 쪽이 맞는지 아무도 모른다.
--
--    사용분 필터는 getLeaveSummary()와 정확히 같다:
--    status='approved' + leave_category='annual' + start_date가 연차연도 안.
--    (법정휴가는 연차 잔여에서 차감되지 않으므로 사용률에도 들어가면 안 된다)
--
--    비율은 여기서 나누지 않고 부여합·사용합을 그대로 돌려준다. 화면이
--    가중평균(사용합/부여합)을 쓸지 1인 평균을 쓸지 고를 수 있어야 하고,
--    무엇보다 uncomputed_count와 함께 보여야 분모를 신뢰할 수 있다.
-- ---------------------------------------------------------------------
create or replace function public.annual_leave_usage_by_team(
  p_as_of date default (now() at time zone 'Asia/Seoul')::date
)
returns table (
  team_id uuid,
  team_name text,
  department_name text,
  /** 그 팀의 재직 인원 */
  member_count int,
  /** 그중 연차연도를 산정할 수 있었던 인원 = 부여합·사용합의 실제 분모 */
  computed_count int,
  /** 입사일이 없거나 아직 입사 전이라 산정에서 뺀 인원 */
  uncomputed_count int,
  granted_days numeric,
  used_days numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    raise exception '전사 연차 사용률은 시스템 관리자만 조회할 수 있습니다';
  end if;

  return query
  select
    t.id,
    t.name,
    d.name,
    count(*)::int,
    count(ly.granted_days)::int,
    (count(*) - count(ly.granted_days))::int,
    coalesce(sum(ly.granted_days), 0)::numeric,
    coalesce(sum(u.used), 0)::numeric
  from public.employees e
  left join public.teams t on t.id = e.team_id
  -- 부서는 팀에서만 끌어온다. coalesce(t.department_id, e.department_id)로
  -- 직원마다 부서를 다시 정하면 부서명이 그룹 키에 섞여 한 팀이 여러 행으로
  -- 쪼개진다(팀 미지정 인원은 부서 수만큼, department_id가 null인 팀은
  -- 소속 직원의 부서 수만큼). 쪼개진 행은 팀의 일부만으로 사용률을 그리고,
  -- 화면의 팀 목록 key(team_id)도 중복된다.
  left join public.departments d on d.id = t.department_id
  -- 발생일수는 캐시(leave_balances)가 아니라 입사일에서 계산한다 — 헤더 2번
  left join lateral public.leave_year_of(e.hire_date, p_as_of) ly on true
  left join lateral (
    select coalesce(sum(l.days), 0) as used
    from public.leave_requests l
    where l.employee_id = e.id
      and l.status = 'approved'
      and l.leave_category = 'annual'
      and l.start_date between ly.period_start and ly.period_end
  ) u on true
  where e.employment_status = 'active'
  group by t.id, t.name, d.name
  order by t.name nulls last;
end;
$$;

revoke all on function public.annual_leave_usage_by_team(date) from public;
grant execute on function public.annual_leave_usage_by_team(date) to authenticated;

-- ---------------------------------------------------------------------
-- 4. 결재 처리 현황 (위젯 D)
--
--    시각의 출처를 전부 approval_steps로 잡는다.
--
--      상신 시각 = min(step.created_at)
--        단계 행은 상신하는 순간 만들어진다(submit_approval_document /
--        submit_approval_draft). 임시저장은 단계가 없으므로 자연히 빠지고,
--        회수 후 재상신은 단계를 다시 만들므로 재상신 시각으로 잡힌다.
--        approval_documents.created_at은 임시저장을 만든 시각이라 상신
--        시각이 아니다.
--
--      결재 시각 = max(step.processed_at)
--        반려는 그 자리에서 끝나고, 승인은 마지막 단계가 끝이므로
--        마지막 처리 시각이 곧 결재 종료 시각이다.
--        updated_at을 쓰면 안 되는 이유는 헤더 3번 참고.
--
--    상신 건수는 기간 내 '상신'된 문서, 승인·반려 건수는 기간 내 '결재된'
--    문서다. 둘의 분모가 다르다 — 지난달 상신이 이번 달 승인되는 건이
--    정상이라 억지로 맞추면 오히려 거짓말이 된다.
--
--    pending_count / oldest_pending_days는 기간과 무관한 '지금' 값이다.
--    기간 안에서 몇 건 처리했는지만으로는 밀려 있는지 알 수 없다.
-- ---------------------------------------------------------------------
create or replace function public.approval_activity(
  p_from date,
  p_to date
)
returns table (
  submitted_count int,
  approved_count int,
  rejected_count int,
  decided_count int,
  /** 상신 → 결재 완료 평균 소요일 (소수 첫째 자리). 결재된 건이 없으면 null */
  avg_decision_days numeric,
  pending_count int,
  oldest_pending_days int
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  -- 서울 자정 경계. [from 00:00, to+1일 00:00) — 종료일 당일을 포함한다
  from_ts timestamptz := (p_from::timestamp at time zone 'Asia/Seoul');
  to_ts   timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Seoul');
begin
  if not public.is_system_admin() then
    raise exception '전사 결재 현황은 시스템 관리자만 조회할 수 있습니다';
  end if;

  return query
  -- 답에 영향을 줄 수 있는 문서만 먼저 좁힌다. 이 CTE 없이 전체 이력을
  -- group by 하면 /admin을 열 때마다 한 달치를 묻는 질의가 누적 문서 수에
  -- 비례해 무거워진다(관리자 진입 화면이라 매 로드마다 돈다).
  --   · 상신 시각(min created_at)이 기간 안이면 기간 안에 만들어진 단계가 있다
  --   · 결재 시각(max processed_at)이 기간 안이면 기간 안에 처리된 단계가 있다
  --   · pending은 기간과 무관한 '지금' 값이라 전부 필요하다
  with candidate as (
    select s.document_id as id
    from public.approval_steps s
    where (s.created_at >= from_ts and s.created_at < to_ts)
       or (s.processed_at >= from_ts and s.processed_at < to_ts)
    union
    select d.id
    from public.approval_documents d
    where d.status = 'pending'
  ),
  doc as (
    select
      d.id,
      d.status,
      min(s.created_at) as submitted_at,
      max(s.processed_at) filter (
        where s.status in ('approved', 'rejected')
      ) as decided_at
    from candidate c
    join public.approval_documents d on d.id = c.id
    -- inner join — 단계가 없는 임시저장은 아직 상신된 문서가 아니다.
    -- 후보를 좁혔어도 min/max는 그 문서의 단계 전체에서 잰다
    join public.approval_steps s on s.document_id = d.id
    group by d.id, d.status
  ),
  decided as (
    select
      doc.status,
      doc.submitted_at,
      doc.decided_at,
      extract(epoch from (doc.decided_at - doc.submitted_at)) / 86400.0 as days
    from doc
    where doc.decided_at >= from_ts
      and doc.decided_at < to_ts
      and doc.status in ('approved', 'completed', 'rejected')
  )
  select
    (select count(*) from doc
      where doc.submitted_at >= from_ts and doc.submitted_at < to_ts)::int,
    -- completed(시행완료)는 승인을 거친 문서다. 빼면 승인 건수가 시간이
    -- 지날수록 줄어드는 숫자가 된다
    (select count(*) from decided
      where decided.status in ('approved', 'completed'))::int,
    (select count(*) from decided where decided.status = 'rejected')::int,
    (select count(*) from decided)::int,
    (select round(avg(decided.days)::numeric, 1) from decided
      where decided.days >= 0)::numeric,
    (select count(*) from doc where doc.status = 'pending')::int,
    (select coalesce(
       max(floor(extract(epoch from (now() - doc.submitted_at)) / 86400))::int, 0)
     from doc where doc.status = 'pending')::int;
end;
$$;

revoke all on function public.approval_activity(date, date) from public;
grant execute on function public.approval_activity(date, date) to authenticated;

-- 결재 시각으로 훑는 질의가 새로 생겼다. 처리된 단계만 부분 인덱스로 잡는다
create index if not exists approval_steps_processed_at_idx
  on public.approval_steps (processed_at desc)
  where processed_at is not null;

-- 상신 시각(단계 생성 시각)으로도 구간을 좁힌다 — candidate CTE의 앞줄
create index if not exists approval_steps_created_at_idx
  on public.approval_steps (created_at desc);

-- ---------------------------------------------------------------------
-- 5. 최근 입사자 (위젯 E)
--
--    스펙의 온보딩 위젯 자리다. onboarding_checklists 테이블이 아직 없어
--    (스펙 07 미진행) 진행률을 낼 수 없다. employees.hire_date만으로
--    성립하는 지표로 바꿨다 — 최근 입사자 명단은 그 자체로 쓸모가 있다
--    (계정 연결·장비 지급·인사정보 누락을 여기서 잡는다).
--
--    입사 예정자(hire_date가 미래)는 넣지 않는다. "최근 입사자"라는 이름과
--    맞지 않고, 아직 오지 않은 사람이 명단 맨 위에 서면 목록이 거짓말을 한다.
-- ---------------------------------------------------------------------
create or replace function public.recent_hires(p_days int default 90)
returns table (
  employee_id uuid,
  employee_name text,
  "position" text,
  department_name text,
  team_name text,
  hired_on date,
  days_since int,
  /** 계정 미연결 = 아직 로그인할 수 없는 상태. 신규 입사자에게 가장 흔한 결손 */
  is_unlinked boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  window_days int := greatest(1, coalesce(p_days, 90));
begin
  if not public.is_system_admin() then
    raise exception '최근 입사자 목록은 시스템 관리자만 조회할 수 있습니다';
  end if;

  return query
  select
    e.id,
    e.name,
    e.position,
    d.name,
    t.name,
    e.hire_date,
    (today - e.hire_date)::int,
    (e.auth_user_id is null)
  from public.employees e
  left join public.departments d on d.id = e.department_id
  left join public.teams t on t.id = e.team_id
  where e.employment_status = 'active'
    and e.hire_date is not null
    and e.hire_date <= today
    and e.hire_date > today - window_days
  order by e.hire_date desc, e.name;
end;
$$;

revoke all on function public.recent_hires(int) from public;
grant execute on function public.recent_hires(int) to authenticated;

-- 최근 입사자 조회가 hire_date를 탄다. 재직자만 보므로 부분 인덱스로 충분하다
create index if not exists employees_hire_date_idx
  on public.employees (hire_date desc)
  where employment_status = 'active';

-- ---------------------------------------------------------------------
-- 6. 최근 활동 로그 (위젯 F) — 함수를 만들지 않는다
--
--    audit_logs의 SELECT 정책이 이미 is_system_admin()이다(마이그레이션 01).
--    관리자 세션에서는 평범한 select가 그대로 최근 10건을 돌려주므로,
--    definer 함수를 하나 더 만들면 같은 권한 검사를 두 벌 관리하게 된다.
--    /admin/audit-logs의 filterAuditLogs()가 쓰는 경로가 그것이고,
--    audit_logs_created_at_idx(15)가 정렬을 받쳐 준다.
--
--    화면에서 actor를 임베드할 때는 FK를 명시할 것:
--      actor:employees!actor_id(id, name)
--    audit_logs → employees FK는 지금 actor_id 하나뿐이라 생략해도 붙지만,
--    target_id에 FK가 생기는 순간 조용히 모호해진다.
--
--    ⚠ 라벨 누락: DB가 실제로 쓰는 action 값 중 'approval.submit'(13·14)과
--    'approval.withdraw'(13)가 src/types/db.ts의 AuditAction 유니온과
--    src/features/audit/constants.ts의 AUDIT_ACTION_LABELS에 없다.
--    지금도 /admin/audit-logs에 원문 키가 그대로 찍히고 있다.
--    이 마이그레이션에서 고칠 수 있는 문제가 아니라 여기 남겨 둔다.
-- ---------------------------------------------------------------------

comment on function public.today_attendance_summary(date) is
  '오늘 출근 현황 4분할. 네 칸의 합은 항상 active_total과 같다(한 사람은 한 칸에만). 비근무일이면 non_working=true — 그날의 미출근은 조치 대상이 아니다.';
comment on function public.annual_leave_usage_by_team(date) is
  '팀별 연차 사용률. leave_balances 캐시를 읽지 않고 입사일에서 계산한다.';
comment on function public.approval_activity(date, date) is
  '결재 처리 현황. 상신·결재 시각은 approval_steps에서 잰다(updated_at은 시행완료로 오염된다).';
