-- =====================================================================
-- 스펙 03 — 출퇴근관리 (연차·반차)
-- 근거: aimbridge_intranet_spec_03_attendance_leave.md 4장
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 승인 권한 판정 헬퍼
--    팀장/부서장 여부를 employees·teams·departments를 함께 읽어 판단해야 하는데
--    RLS 정책 안에서 그렇게 하면 employees 정책과 얽히므로 definer 함수로 뺀다.
-- ---------------------------------------------------------------------
create or replace function public.manages_employee(target_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (
    select 1
    from public.employees target_e
    join public.employees me on me.auth_user_id = auth.uid()
    left join public.teams t on t.id = target_e.team_id
    left join public.departments d on d.id = target_e.department_id
    where target_e.id = target_employee_id
      and me.employment_status = 'active'
      and (t.manager_id = me.id or d.manager_id = me.id)
  ), false)
$$;

revoke all on function public.manages_employee(uuid) from public;
grant execute on function public.manages_employee(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. 출퇴근 기록
-- ---------------------------------------------------------------------
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  check_in_at timestamptz,
  check_out_at timestamptz,
  check_in_ip text,
  check_in_location text,
  -- 사내 IP·GPS는 참고 신호일 뿐 차단하지 않는다(스펙 3.1). 경고 표시용으로만 저장.
  location_warning text,
  work_status text not null default 'normal_office'
    check (work_status in ('normal_office','field_work','remote','training')),
  status text not null default 'normal'
    check (status in ('normal','late','early_leave','absent')),
  manual_adjustment_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date),
  constraint attendance_time_order
    check (check_out_at is null or check_in_at is null or check_out_at >= check_in_at)
);

create index if not exists attendance_employee_date_idx
  on public.attendance_records (employee_id, work_date desc);
create index if not exists attendance_date_idx
  on public.attendance_records (work_date desc);

drop trigger if exists attendance_touch_updated_at on public.attendance_records;
create trigger attendance_touch_updated_at
  before update on public.attendance_records
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. 근태 수정요청
-- ---------------------------------------------------------------------
create table if not exists public.attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  target_date date not null,
  requested_check_in timestamptz,
  requested_check_out timestamptz,
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  approver_id uuid references public.employees(id) on delete set null,
  rejection_reason text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists correction_employee_idx
  on public.attendance_correction_requests (employee_id, created_at desc);
create index if not exists correction_status_idx
  on public.attendance_correction_requests (status, created_at desc);

-- ---------------------------------------------------------------------
-- 4. 연차·반차·법정휴가 신청
-- ---------------------------------------------------------------------
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type text not null
    check (leave_type in ('full_day','half_day_am','half_day_pm','hourly')),
  leave_category text not null default 'annual'
    check (leave_category in ('annual','industrial_accident','family_care','maternity','menstrual','congratulation_condolence')),
  start_date date not null,
  end_date date not null,
  start_time time,
  hours numeric,
  days numeric not null default 0,
  reason text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled')),
  approver_id uuid references public.employees(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  constraint leave_date_order check (end_date >= start_date),
  -- 반차·시간단위는 하루만 가능 (스펙 3.3)
  constraint leave_single_day_types
    check (leave_type = 'full_day' or start_date = end_date)
);

create index if not exists leave_employee_idx
  on public.leave_requests (employee_id, start_date desc);
create index if not exists leave_status_idx
  on public.leave_requests (status, created_at desc);
create index if not exists leave_range_idx
  on public.leave_requests (start_date, end_date) where status = 'approved';

-- ---------------------------------------------------------------------
-- 5. 초과근무 신청
-- ---------------------------------------------------------------------
create table if not exists public.overtime_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  start_time time not null,
  end_time time not null,
  reason text not null,
  compensate_as_leave boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  approver_id uuid references public.employees(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  constraint overtime_time_order check (end_time > start_time)
);

create index if not exists overtime_employee_idx
  on public.overtime_requests (employee_id, work_date desc);
create index if not exists overtime_status_idx
  on public.overtime_requests (status, created_at desc);

-- ---------------------------------------------------------------------
-- 6. 연차 잔여
--    잔여 = accrued_days - used_days + adjustment_days
-- ---------------------------------------------------------------------
create table if not exists public.leave_balances (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  accrued_days numeric not null default 0,
  used_days numeric not null default 0,
  adjustment_days numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.leave_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  days numeric not null,
  reason text not null,
  adjusted_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists leave_adjustments_employee_idx
  on public.leave_adjustments (employee_id, created_at desc);

-- ---------------------------------------------------------------------
-- 7. 보상휴가 가산율
-- ---------------------------------------------------------------------
create table if not exists public.compensatory_leave_settings (
  id uuid primary key default gen_random_uuid(),
  group_scope text unique,   -- null이면 전사 기본값
  rate numeric not null default 1.5 check (rate > 0),
  updated_at timestamptz not null default now()
);

-- 전사 기본값 1행 보장 (group_scope IS NULL은 unique로 중복을 못 막으므로 조건부 삽입)
insert into public.compensatory_leave_settings (group_scope, rate)
select null, 1.5
where not exists (
  select 1 from public.compensatory_leave_settings where group_scope is null
);

-- ---------------------------------------------------------------------
-- 8. 잔여 연차 갱신 함수
--    leave_balances는 사용자가 직접 쓰지 못하게 막고(RLS), 이 함수들로만 바꾼다.
-- ---------------------------------------------------------------------

/** 발생일수를 계산된 값으로 덮어쓴다. 여러 번 호출해도 결과가 같다. */
create or replace function public.set_accrued_days(
  target_employee_id uuid,
  new_accrued numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_system_admin() or auth.uid() is null) then
    raise exception '연차 발생일수를 변경할 권한이 없습니다.';
  end if;

  insert into public.leave_balances (employee_id, accrued_days, updated_at)
  values (target_employee_id, new_accrued, now())
  on conflict (employee_id) do update
    set accrued_days = excluded.accrued_days,
        updated_at = now();
end $$;

/**
 * 휴가 신청 승인 — 상태 변경과 잔여 차감을 한 트랜잭션에서 처리한다 (스펙 5장).
 * 승인 권한(팀장/부서장/관리자)과 잔여 부족을 함께 검사한다.
 */
create or replace function public.approve_leave_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  approver uuid := public.current_employee_id();
  remaining numeric;
begin
  if approver is null then
    raise exception '승인 권한이 없습니다.';
  end if;

  select * into req from public.leave_requests where id = request_id for update;
  if req is null then
    raise exception '신청을 찾을 수 없습니다.';
  end if;
  if req.status <> 'pending' then
    raise exception '이미 처리된 신청입니다.';
  end if;
  if not (public.manages_employee(req.employee_id) or public.is_system_admin()) then
    raise exception '이 신청을 승인할 권한이 없습니다.';
  end if;
  -- 본인 신청을 본인이 승인하는 것을 막는다(관리자도 예외 없음)
  if req.employee_id = approver then
    raise exception '본인 신청은 스스로 승인할 수 없습니다.';
  end if;

  -- 연차 카테고리만 잔여에서 차감한다 (법정휴가는 별도 기록)
  if req.leave_category = 'annual' then
    insert into public.leave_balances (employee_id) values (req.employee_id)
    on conflict (employee_id) do nothing;

    select accrued_days - used_days + adjustment_days into remaining
    from public.leave_balances where employee_id = req.employee_id for update;

    if remaining < req.days then
      raise exception '잔여 연차가 부족합니다. (잔여 %일, 신청 %일)', remaining, req.days;
    end if;

    update public.leave_balances
    set used_days = used_days + req.days, updated_at = now()
    where employee_id = req.employee_id;
  end if;

  update public.leave_requests
  set status = 'approved', approver_id = approver, approved_at = now()
  where id = request_id;
end $$;

/** 승인된 휴가를 취소하면 차감분을 되돌린다 */
create or replace function public.cancel_leave_request(request_id uuid)
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
    raise exception '권한이 없습니다.';
  end if;

  select * into req from public.leave_requests where id = request_id for update;
  if req is null then
    raise exception '신청을 찾을 수 없습니다.';
  end if;
  if not (req.employee_id = actor or public.manages_employee(req.employee_id)
          or public.is_system_admin()) then
    raise exception '이 신청을 취소할 권한이 없습니다.';
  end if;
  if req.status not in ('pending','approved') then
    raise exception '취소할 수 없는 상태입니다.';
  end if;

  if req.status = 'approved' and req.leave_category = 'annual' then
    update public.leave_balances
    set used_days = greatest(used_days - req.days, 0), updated_at = now()
    where employee_id = req.employee_id;
  end if;

  update public.leave_requests set status = 'cancelled' where id = request_id;
end $$;

/** 연차 수동 조정 — 이력과 잔여를 함께 반영 (스펙 3.7) */
create or replace function public.adjust_leave_balance(
  target_employee_id uuid,
  delta_days numeric,
  adjust_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := public.current_employee_id();
begin
  if not public.is_system_admin() then
    raise exception '연차를 조정할 권한이 없습니다.';
  end if;
  if adjust_reason is null or btrim(adjust_reason) = '' then
    raise exception '조정 사유는 필수입니다.';
  end if;

  insert into public.leave_adjustments (employee_id, days, reason, adjusted_by)
  values (target_employee_id, delta_days, adjust_reason, actor);

  insert into public.leave_balances (employee_id, adjustment_days)
  values (target_employee_id, delta_days)
  on conflict (employee_id) do update
    set adjustment_days = public.leave_balances.adjustment_days + delta_days,
        updated_at = now();
end $$;

/**
 * 초과근무 승인 — 보상휴가 전환 시 가산율을 적용해 연차에 더한다 (스펙 3.4 / 5장).
 * 8시간을 1일로 환산한다.
 */
create or replace function public.approve_overtime_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  approver uuid := public.current_employee_id();
  rate numeric;
  hours numeric;
  granted numeric;
begin
  if approver is null then
    raise exception '승인 권한이 없습니다.';
  end if;

  select * into req from public.overtime_requests where id = request_id for update;
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

  if req.compensate_as_leave then
    select s.rate into rate
    from public.compensatory_leave_settings s
    where s.group_scope is null
    limit 1;
    rate := coalesce(rate, 1.5);

    hours := extract(epoch from (req.end_time - req.start_time)) / 3600.0;
    -- 8시간 = 1일 환산, 0.5일 단위로 반올림
    granted := round((hours * rate / 8.0) * 2) / 2.0;

    if granted > 0 then
      insert into public.leave_adjustments (employee_id, days, reason, adjusted_by)
      values (req.employee_id, granted,
              format('보상휴가 전환 (%s, %s시간 × %s배)', req.work_date, round(hours,1), rate),
              approver);

      insert into public.leave_balances (employee_id, adjustment_days)
      values (req.employee_id, granted)
      on conflict (employee_id) do update
        set adjustment_days = public.leave_balances.adjustment_days + granted,
            updated_at = now();
    end if;
  end if;

  update public.overtime_requests
  set status = 'approved', approver_id = approver, approved_at = now()
  where id = request_id;
end $$;

/** 근태 수정요청 승인 — 승인 시 실제 출퇴근 기록에 반영 (스펙 3.5) */
create or replace function public.approve_correction_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  approver uuid := public.current_employee_id();
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

  insert into public.attendance_records (
    employee_id, work_date, check_in_at, check_out_at, manual_adjustment_reason
  )
  values (
    req.employee_id, req.target_date, req.requested_check_in,
    req.requested_check_out, format('수정요청 승인: %s', req.reason)
  )
  on conflict (employee_id, work_date) do update
    set check_in_at = coalesce(excluded.check_in_at, public.attendance_records.check_in_at),
        check_out_at = coalesce(excluded.check_out_at, public.attendance_records.check_out_at),
        manual_adjustment_reason = excluded.manual_adjustment_reason,
        updated_at = now();

  update public.attendance_correction_requests
  set status = 'approved', approver_id = approver, processed_at = now()
  where id = request_id;
end $$;

revoke all on function public.set_accrued_days(uuid, numeric) from public;
revoke all on function public.approve_leave_request(uuid) from public;
revoke all on function public.cancel_leave_request(uuid) from public;
revoke all on function public.adjust_leave_balance(uuid, numeric, text) from public;
revoke all on function public.approve_overtime_request(uuid) from public;
revoke all on function public.approve_correction_request(uuid) from public;

grant execute on function public.approve_leave_request(uuid) to authenticated;
grant execute on function public.cancel_leave_request(uuid) to authenticated;
grant execute on function public.adjust_leave_balance(uuid, numeric, text) to authenticated;
grant execute on function public.approve_overtime_request(uuid) to authenticated;
grant execute on function public.approve_correction_request(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------
alter table public.attendance_records              enable row level security;
alter table public.attendance_correction_requests  enable row level security;
alter table public.leave_requests                  enable row level security;
alter table public.overtime_requests               enable row level security;
alter table public.leave_balances                  enable row level security;
alter table public.leave_adjustments               enable row level security;
alter table public.compensatory_leave_settings     enable row level security;

-- 출퇴근: 본인 조회·기록, 팀장은 팀원 조회, 관리자는 전체
drop policy if exists attendance_select on public.attendance_records;
create policy attendance_select on public.attendance_records
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.manages_employee(employee_id)
    or public.is_system_admin()
  );

drop policy if exists attendance_insert on public.attendance_records;
create policy attendance_insert on public.attendance_records
  for insert to authenticated
  with check (employee_id = public.current_employee_id());

drop policy if exists attendance_update_self on public.attendance_records;
create policy attendance_update_self on public.attendance_records
  for update to authenticated
  using (employee_id = public.current_employee_id())
  with check (employee_id = public.current_employee_id());

drop policy if exists attendance_admin on public.attendance_records;
create policy attendance_admin on public.attendance_records
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

-- 신청류 공통 패턴: 본인 + 승인자 + 관리자
drop policy if exists correction_select on public.attendance_correction_requests;
create policy correction_select on public.attendance_correction_requests
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.manages_employee(employee_id)
    or public.is_system_admin()
  );

drop policy if exists correction_insert on public.attendance_correction_requests;
create policy correction_insert on public.attendance_correction_requests
  for insert to authenticated
  with check (employee_id = public.current_employee_id());

drop policy if exists correction_update on public.attendance_correction_requests;
create policy correction_update on public.attendance_correction_requests
  for update to authenticated
  using (public.manages_employee(employee_id) or public.is_system_admin())
  with check (public.manages_employee(employee_id) or public.is_system_admin());

drop policy if exists leave_select on public.leave_requests;
create policy leave_select on public.leave_requests
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.manages_employee(employee_id)
    or public.is_system_admin()
  );

drop policy if exists leave_insert on public.leave_requests;
create policy leave_insert on public.leave_requests
  for insert to authenticated
  with check (employee_id = public.current_employee_id() and status = 'pending');

-- 반려는 정책으로, 승인·취소는 잔여 차감이 얽혀 있어 함수로만 처리한다
drop policy if exists leave_update on public.leave_requests;
create policy leave_update on public.leave_requests
  for update to authenticated
  using (public.manages_employee(employee_id) or public.is_system_admin())
  with check (public.manages_employee(employee_id) or public.is_system_admin());

drop policy if exists overtime_select on public.overtime_requests;
create policy overtime_select on public.overtime_requests
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.manages_employee(employee_id)
    or public.is_system_admin()
  );

drop policy if exists overtime_insert on public.overtime_requests;
create policy overtime_insert on public.overtime_requests
  for insert to authenticated
  with check (employee_id = public.current_employee_id() and status = 'pending');

drop policy if exists overtime_update on public.overtime_requests;
create policy overtime_update on public.overtime_requests
  for update to authenticated
  using (public.manages_employee(employee_id) or public.is_system_admin())
  with check (public.manages_employee(employee_id) or public.is_system_admin());

-- 잔여 연차: 조회만. 쓰기는 위 definer 함수로만 (스펙 4장 RLS 원칙)
drop policy if exists leave_balances_select on public.leave_balances;
create policy leave_balances_select on public.leave_balances
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.manages_employee(employee_id)
    or public.is_system_admin()
  );

-- 조정 이력: 본인은 자기 것 조회 가능(왜 늘었는지 알아야 한다), 등록은 함수로만
drop policy if exists leave_adjustments_select on public.leave_adjustments;
create policy leave_adjustments_select on public.leave_adjustments
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.is_system_admin()
  );

drop policy if exists comp_settings_select on public.compensatory_leave_settings;
create policy comp_settings_select on public.compensatory_leave_settings
  for select to authenticated using (true);

drop policy if exists comp_settings_write on public.compensatory_leave_settings;
create policy comp_settings_write on public.compensatory_leave_settings
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());
