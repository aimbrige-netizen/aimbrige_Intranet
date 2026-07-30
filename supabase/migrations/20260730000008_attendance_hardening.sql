-- =====================================================================
-- 스펙 03 보안·정합성 보강
--
-- 코드 리뷰에서 확인된 결함을 수정한다. 핵심은 두 가지다.
--
-- (1) 승인 정책이 잔여 차감 함수를 우회할 수 있었다 [치명적]
--     migration 06의 leave_update / overtime_update / correction_update 정책은
--     매니저에게 컬럼 제약 없는 UPDATE를 허용했다. 브라우저에 anon 키로 붙는
--     Supabase 클라이언트가 실제로 존재하므로, UI를 거치지 않고
--       update leave_requests set status='approved' where id=...
--     를 직접 호출할 수 있었다. 그러면 approve_leave_request()가 하는
--     자가승인 차단·잔여 부족 검사·used_days 가산이 전부 건너뛰어져
--     연차를 무한히 승인해도 잔여가 줄지 않는다.
--     초과근무는 보상휴가 가산이, 근태수정은 실제 기록 반영이 누락된다.
--     → UPDATE 정책을 전부 제거하고 반려도 definer 함수로만 처리한다.
--       (마이그레이션 07의 결재 문서에서 이미 쓰던 원칙을 여기에도 적용)
--
-- (2) 본인 근태 기록을 자유롭게 고쳐 쓸 수 있었다 [치명적]
--     attendance_insert / attendance_update_self 정책에 컬럼·날짜 제약이 없어
--     지각(status='late')을 나중에 'normal'로 바꾸거나, 지난 날짜를 임의로
--     만들거나, 관리자 전용인 manual_adjustment_reason을 쓸 수 있었다.
--     → 트리거로 불변식을 강제한다. 상태는 항상 시각에서 재계산한다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 근태 상태 계산을 SQL 쪽에 한 번만 정의
--    체크인/체크아웃 경로, 수정요청 승인, 관리자 수동조정이 모두 같은 규칙을 쓴다.
--    기준은 스펙 7장: 09:10 이후 체크인=지각, 18:00 이전 퇴근=조퇴.
-- ---------------------------------------------------------------------
create or replace function public.compute_attendance_status(
  p_check_in timestamptz,
  p_check_out timestamptz
)
returns text
language plpgsql
immutable
as $$
declare
  in_local time;
  out_local time;
begin
  if p_check_in is null then
    -- 출근 기록이 없으면 판정하지 않는다(결근 판정은 화면에서 근무일 기준으로 계산)
    return 'normal';
  end if;

  in_local := (p_check_in at time zone 'Asia/Seoul')::time;
  if in_local > time '09:10' then
    return 'late';
  end if;

  if p_check_out is not null then
    out_local := (p_check_out at time zone 'Asia/Seoul')::time;
    if out_local < time '18:00' then
      return 'early_leave';
    end if;
  end if;

  return 'normal';
end $$;

-- ---------------------------------------------------------------------
-- 1. 근태 기록 자체 수정 가드
-- ---------------------------------------------------------------------
create or replace function public.attendance_guard_self()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role / DB 관리자 / SECURITY DEFINER 함수 경유 호출은 통과.
  -- (approve_correction_request, 관리자 수동조정이 이 경로를 쓴다)
  if current_user in ('postgres','supabase_admin','service_role')
     or auth.uid() is null
     or public.is_system_admin() then
    return new;
  end if;

  if new.employee_id is distinct from public.current_employee_id() then
    raise exception '본인 근태만 기록할 수 있습니다.';
  end if;

  -- 지난 날짜를 직접 만들거나 고치는 것은 막는다. 정정은 수정요청 경로로.
  if new.work_date <> (now() at time zone 'Asia/Seoul')::date then
    raise exception '오늘 날짜의 근태만 직접 기록할 수 있습니다. 지난 기록은 근태 수정요청을 이용하세요.';
  end if;

  -- 관리자·승인 경로 전용 필드는 사용자가 쓸 수 없다
  if tg_op = 'UPDATE' then
    new.manual_adjustment_reason := old.manual_adjustment_reason;
    -- 한 번 기록된 출근 시각은 사용자가 바꿀 수 없다(퇴근 기록만 추가 가능)
    if old.check_in_at is not null
       and new.check_in_at is distinct from old.check_in_at then
      raise exception '기록된 출근 시각은 직접 변경할 수 없습니다. 근태 수정요청을 이용하세요.';
    end if;
  else
    new.manual_adjustment_reason := null;
  end if;

  -- 상태는 클라이언트 값을 신뢰하지 않고 항상 시각에서 재계산한다
  new.status := public.compute_attendance_status(new.check_in_at, new.check_out_at);

  return new;
end $$;

drop trigger if exists attendance_guard_self on public.attendance_records;
create trigger attendance_guard_self
  before insert or update on public.attendance_records
  for each row execute function public.attendance_guard_self();

-- ---------------------------------------------------------------------
-- 2. 반려 처리를 definer 함수로 (UPDATE 정책 제거에 대응)
-- ---------------------------------------------------------------------
create or replace function public.reject_leave_request(
  request_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  actor uuid := public.current_employee_id();
begin
  if actor is null then
    raise exception '승인 권한이 없습니다.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '반려 사유는 필수입니다.';
  end if;

  select * into req from public.leave_requests where id = request_id for update;
  if req is null then
    raise exception '신청을 찾을 수 없습니다.';
  end if;
  if req.status <> 'pending' then
    raise exception '이미 처리된 신청입니다.';
  end if;
  if not (public.manages_employee(req.employee_id) or public.is_system_admin()) then
    raise exception '이 신청을 처리할 권한이 없습니다.';
  end if;
  if req.employee_id = actor then
    raise exception '본인 신청은 스스로 처리할 수 없습니다.';
  end if;

  update public.leave_requests
  set status = 'rejected', approver_id = actor,
      rejection_reason = btrim(p_reason), approved_at = null
  where id = request_id;
end $$;

create or replace function public.reject_overtime_request(
  request_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  actor uuid := public.current_employee_id();
begin
  if actor is null then
    raise exception '승인 권한이 없습니다.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '반려 사유는 필수입니다.';
  end if;

  select * into req from public.overtime_requests where id = request_id for update;
  if req is null then
    raise exception '신청을 찾을 수 없습니다.';
  end if;
  if req.status <> 'pending' then
    raise exception '이미 처리된 신청입니다.';
  end if;
  if not (public.manages_employee(req.employee_id) or public.is_system_admin()) then
    raise exception '이 신청을 처리할 권한이 없습니다.';
  end if;
  if req.employee_id = actor then
    raise exception '본인 신청은 스스로 처리할 수 없습니다.';
  end if;

  update public.overtime_requests
  set status = 'rejected', approver_id = actor,
      rejection_reason = btrim(p_reason), approved_at = null
  where id = request_id;
end $$;

create or replace function public.reject_correction_request(
  request_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  actor uuid := public.current_employee_id();
begin
  if actor is null then
    raise exception '승인 권한이 없습니다.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '반려 사유는 필수입니다.';
  end if;

  select * into req from public.attendance_correction_requests
  where id = request_id for update;
  if req is null then
    raise exception '신청을 찾을 수 없습니다.';
  end if;
  if req.status <> 'pending' then
    raise exception '이미 처리된 신청입니다.';
  end if;
  if not (public.manages_employee(req.employee_id) or public.is_system_admin()) then
    raise exception '이 신청을 처리할 권한이 없습니다.';
  end if;
  if req.employee_id = actor then
    raise exception '본인 신청은 스스로 처리할 수 없습니다.';
  end if;

  update public.attendance_correction_requests
  set status = 'rejected', approver_id = actor,
      rejection_reason = btrim(p_reason), processed_at = now()
  where id = request_id;
end $$;

revoke all on function public.reject_leave_request(uuid, text) from public;
revoke all on function public.reject_overtime_request(uuid, text) from public;
revoke all on function public.reject_correction_request(uuid, text) from public;
grant execute on function public.reject_leave_request(uuid, text) to authenticated;
grant execute on function public.reject_overtime_request(uuid, text) to authenticated;
grant execute on function public.reject_correction_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. 우회 가능했던 UPDATE 정책 제거
--    승인·반려·취소는 모두 definer 함수만 통하게 한다.
-- ---------------------------------------------------------------------
drop policy if exists leave_update on public.leave_requests;
drop policy if exists overtime_update on public.overtime_requests;
drop policy if exists correction_update on public.attendance_correction_requests;

-- 근태 기록의 본인 UPDATE는 퇴근 기록을 위해 남기되, 위 트리거가 불변식을 지킨다.
-- (정책은 "본인 행"까지만 판정하고, 무엇을 어떻게 바꿀 수 있는지는 트리거가 정한다)

-- ---------------------------------------------------------------------
-- 4. 수정요청 INSERT에 status 고정 (다른 신청 테이블과 동일하게)
--    없으면 status='approved'로 미리 승인된 것처럼 위조 삽입이 가능하다.
-- ---------------------------------------------------------------------
drop policy if exists correction_insert on public.attendance_correction_requests;
create policy correction_insert on public.attendance_correction_requests
  for insert to authenticated
  with check (
    employee_id = public.current_employee_id()
    and status = 'pending'
    and approver_id is null
    and processed_at is null
  );

-- 휴가·초과근무 INSERT도 승인 관련 필드를 비워야 한다
drop policy if exists leave_insert on public.leave_requests;
create policy leave_insert on public.leave_requests
  for insert to authenticated
  with check (
    employee_id = public.current_employee_id()
    and status = 'pending'
    and approver_id is null
    and approved_at is null
  );

drop policy if exists overtime_insert on public.overtime_requests;
create policy overtime_insert on public.overtime_requests
  for insert to authenticated
  with check (
    employee_id = public.current_employee_id()
    and status = 'pending'
    and approver_id is null
    and approved_at is null
  );

-- ---------------------------------------------------------------------
-- 5. days 값 정합성을 DB에서 강제
--    days는 클라이언트 계산값이라, hourly 7시간을 days=0.01로 신청해
--    승인 시 0.01일만 차감시키는 조작이 가능했다.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leave_days_consistent'
  ) then
    alter table public.leave_requests
      add constraint leave_days_consistent check (
        case leave_type
          when 'half_day_am' then days = 0.5
          when 'half_day_pm' then days = 0.5
          -- 8시간 = 1일 환산, 소수점 2자리 반올림 허용
          when 'hourly' then hours is not null and hours > 0
                            and abs(days - round(hours / 8.0, 2)) < 0.011
          else days > 0
        end
      );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. 캘린더용 휴가 조회 (스펙 03 · 6장 / 스펙 02 · 3.4 연차 겹침 확인)
--
--    leave_requests의 RLS는 "본인 + 관리자 + 팀장"이라, 일반 직원이
--    팀·전사 캘린더를 봐도 동료 연차가 하나도 안 보였다. 그런데 스펙은
--    "같은 팀 내 여러 명이 동시에 휴가인 날짜를 시각적으로 표시"를 요구한다.
--
--    RLS를 넓히면 leave_category까지 노출되는데 생리휴가·공상휴가는 민감정보다.
--    그래서 정책은 그대로 두고, 표시에 필요한 최소 정보만 돌려주는 함수를 연다.
--    (본인 것만 상세 종류를 알려주고, 남의 것은 '휴가'로 뭉갠다)
-- ---------------------------------------------------------------------
create or replace function public.list_calendar_leaves(
  p_from date,
  p_to date
)
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  start_date date,
  end_date date,
  label text,
  is_mine boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := public.current_employee_id();
begin
  if me is null then
    raise exception '조회 권한이 없습니다.';
  end if;

  return query
    select
      l.id,
      l.employee_id,
      e.name,
      l.start_date,
      l.end_date,
      case
        when l.employee_id = me then
          case l.leave_type
            when 'half_day_am' then '오전반차'
            when 'half_day_pm' then '오후반차'
            when 'hourly' then '시간연차'
            else case when l.leave_category = 'annual' then '연차' else '휴가' end
          end
        -- 타인의 휴가는 종류를 노출하지 않는다(민감정보 보호)
        else '휴가'
      end,
      l.employee_id = me
    from public.leave_requests l
    join public.employees e on e.id = l.employee_id
    where l.status = 'approved'
      and l.start_date <= p_to
      and l.end_date >= p_from;
end $$;

revoke all on function public.list_calendar_leaves(date, date) from public;
grant execute on function public.list_calendar_leaves(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 7. 수정요청 승인·관리자 조정 시 상태 재계산
--    기존 함수는 시각만 바꿔서, 10:30으로 정정해도 '정상'으로 남았다.
-- ---------------------------------------------------------------------
create or replace function public.approve_correction_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  approver uuid := public.current_employee_id();
  final_in timestamptz;
  final_out timestamptz;
begin
  if approver is null then
    raise exception '승인 권한이 없습니다.';
  end if;

  select * into req from public.attendance_correction_requests
  where id = request_id for update;
  if req is null then
    raise exception '신청을 찾을 수 없습니다.';
  end if;
  if req.status <> 'pending' then
    raise exception '이미 처리된 신청입니다.';
  end if;
  if not (public.manages_employee(req.employee_id) or public.is_system_admin()) then
    raise exception '이 신청을 승인할 권한이 없습니다.';
  end if;
  if req.employee_id = approver then
    raise exception '본인 신청은 스스로 승인할 수 없습니다.';
  end if;

  -- 정정하지 않은 항목은 기존 값을 유지한다
  select coalesce(req.requested_check_in, a.check_in_at),
         coalesce(req.requested_check_out, a.check_out_at)
  into final_in, final_out
  from (select null::timestamptz as check_in_at, null::timestamptz as check_out_at) dummy
  left join public.attendance_records a
    on a.employee_id = req.employee_id and a.work_date = req.target_date;

  insert into public.attendance_records (
    employee_id, work_date, check_in_at, check_out_at,
    status, manual_adjustment_reason
  )
  values (
    req.employee_id, req.target_date, final_in, final_out,
    public.compute_attendance_status(final_in, final_out),
    format('수정요청 승인: %s', req.reason)
  )
  on conflict (employee_id, work_date) do update
    set check_in_at = coalesce(excluded.check_in_at, public.attendance_records.check_in_at),
        check_out_at = coalesce(excluded.check_out_at, public.attendance_records.check_out_at),
        status = public.compute_attendance_status(
          coalesce(excluded.check_in_at, public.attendance_records.check_in_at),
          coalesce(excluded.check_out_at, public.attendance_records.check_out_at)
        ),
        manual_adjustment_reason = excluded.manual_adjustment_reason,
        updated_at = now();

  update public.attendance_correction_requests
  set status = 'approved', approver_id = approver, processed_at = now()
  where id = request_id;
end $$;

/** 관리자 수동조정 — 상태 재계산까지 함께 (스펙 3.7) */
create or replace function public.admin_set_attendance(
  p_employee_id uuid,
  p_work_date date,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    raise exception '근태를 수정할 권한이 없습니다.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '수정 사유는 필수입니다.';
  end if;

  insert into public.attendance_records (
    employee_id, work_date, check_in_at, check_out_at,
    status, manual_adjustment_reason
  )
  values (
    p_employee_id, p_work_date, p_check_in, p_check_out,
    public.compute_attendance_status(p_check_in, p_check_out),
    btrim(p_reason)
  )
  on conflict (employee_id, work_date) do update
    set check_in_at = excluded.check_in_at,
        check_out_at = excluded.check_out_at,
        status = excluded.status,
        manual_adjustment_reason = excluded.manual_adjustment_reason,
        updated_at = now();
end $$;

revoke all on function public.admin_set_attendance(uuid, date, timestamptz, timestamptz, text) from public;
grant execute on function public.admin_set_attendance(uuid, date, timestamptz, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. 스펙 4장 RLS 원칙에 맞춰 조회 범위 축소
--    보상휴가 가산율은 관리자만, 잔여 연차는 본인+관리자만.
-- ---------------------------------------------------------------------
drop policy if exists comp_settings_select on public.compensatory_leave_settings;
create policy comp_settings_select on public.compensatory_leave_settings
  for select to authenticated using (public.is_system_admin());

drop policy if exists leave_balances_select on public.leave_balances;
create policy leave_balances_select on public.leave_balances
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.is_system_admin()
  );

-- ---------------------------------------------------------------------
-- 9. 팀장이 팀원 주간 근무시간을 볼 수 있게 (스펙 3.2 "본인과 팀장 모두에게 노출")
--    attendance_records SELECT 정책이 이미 manages_employee를 허용하므로
--    별도 정책은 필요 없다. 화면에서 쓸 집계 함수만 제공한다.
-- ---------------------------------------------------------------------
create or replace function public.team_weekly_hours(p_week_start date)
returns table (
  employee_id uuid,
  employee_name text,
  hours numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := public.current_employee_id();
begin
  if me is null then
    raise exception '조회 권한이 없습니다.';
  end if;

  return query
    select
      e.id,
      e.name,
      round(coalesce(sum(
        extract(epoch from (a.check_out_at - a.check_in_at)) / 3600.0
      ), 0)::numeric, 1)
      + round(coalesce((
          select sum(extract(epoch from (o.end_time - o.start_time)) / 3600.0)
          from public.overtime_requests o
          where o.employee_id = e.id
            and o.status = 'approved'
            and o.work_date between p_week_start and p_week_start + 6
        ), 0)::numeric, 1)
    from public.employees e
    left join public.attendance_records a
      on a.employee_id = e.id
      and a.work_date between p_week_start and p_week_start + 6
      and a.check_in_at is not null
      and a.check_out_at is not null
    where e.employment_status = 'active'
      and (public.manages_employee(e.id) or public.is_system_admin())
    group by e.id, e.name
    order by 3 desc;
end $$;

revoke all on function public.team_weekly_hours(date) from public;
grant execute on function public.team_weekly_hours(date) to authenticated;
