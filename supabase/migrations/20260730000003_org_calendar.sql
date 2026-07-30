-- =====================================================================
-- 스펙 02 — 조직도 & 디렉토리, 캘린더
-- 근거: aimbridge_intranet_spec_02_org_calendar.md 4장
--
-- 실행 방법
--   Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 Run
-- =====================================================================

-- 예약 시간대 겹침을 DB 레벨에서 막기 위해 필요 (EXCLUDE + tstzrange)
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- 1. 임직원 확장 — 담당업무 (스펙 3.2)
-- ---------------------------------------------------------------------
alter table public.employees
  add column if not exists responsibilities text;

-- ---------------------------------------------------------------------
-- 1-2. employees 조회 범위 확대 (스펙 02 · 3.1 조직도/디렉토리)
--
-- 스펙 01은 employees SELECT를 "본인 + 시스템 관리자"로 잠갔지만, 조직도·디렉토리와
-- 캘린더의 작성자 표시는 동료 정보를 읽어야 동작한다. 그래서 전 임직원 조회를 허용한다.
--
-- 단, 스펙 02가 디렉토리에 노출한다고 명시한 항목은 이름·직급·소속·이메일·전화번호까지다.
-- 비상연락처(emergency_contact)는 노출 대상이 아니므로 RLS(행 단위)로는 막을 수 없어
-- 컬럼 단위 권한으로 authenticated 롤에서 빼둔다. 본인·관리자는 아래 함수로만 읽는다.
-- ---------------------------------------------------------------------
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated using (true);

revoke select on public.employees from authenticated;
grant select (
  id, auth_user_id, email, name, department_id, team_id, position, role_id,
  employment_status, hire_date, phone, profile_image_url, responsibilities,
  created_at, updated_at
) on public.employees to authenticated;

-- 본인이 수정 가능한 항목만 UPDATE 권한을 준다(트리거와 이중 방어).
-- 관리자 변경은 Server Action에서 service_role로 수행하므로 영향 없다.
revoke update on public.employees from authenticated;
grant update (phone, emergency_contact, profile_image_url)
  on public.employees to authenticated;

-- 비상연락처는 본인 또는 시스템 관리자만 조회
create or replace function public.get_emergency_contact(target_employee_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result text;
begin
  if not (
    target_employee_id = public.current_employee_id()
    or public.is_system_admin()
  ) then
    raise exception '비상연락처를 조회할 권한이 없습니다.';
  end if;

  select emergency_contact into result
  from public.employees
  where id = target_employee_id;

  return result;
end $$;

revoke all on function public.get_emergency_contact(uuid) from public;
grant execute on function public.get_emergency_contact(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. 외부 연락처
-- ---------------------------------------------------------------------
create table if not exists public.external_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  role text,
  phone text,
  email text,
  memo text,
  category text check (category in ('vendor','client','partner')),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists external_contacts_name_idx on public.external_contacts (name);
create index if not exists external_contacts_category_idx on public.external_contacts (category);

drop trigger if exists external_contacts_touch_updated_at on public.external_contacts;
create trigger external_contacts_touch_updated_at
  before update on public.external_contacts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. 캘린더 일정
-- ---------------------------------------------------------------------
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  visibility text not null default 'personal'
    check (visibility in ('personal','team','company')),
  owner_id uuid not null references public.employees(id) on delete cascade,
  -- 팀 뷰 필터를 매번 employees 조인 없이 처리하려고 작성 시점의 팀을 박아둔다.
  -- 작성자가 팀을 옮겨도 그 일정은 원래 팀 일정으로 남는 게 자연스럽다.
  team_id uuid references public.teams(id) on delete set null,
  google_calendar_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_time_order check (end_at > start_at),
  -- team 일정인데 team_id가 비면 RLS상 아무에게도 안 보이는 고아 일정이 된다
  constraint calendar_events_team_requires_team
    check (visibility <> 'team' or team_id is not null)
);

create index if not exists calendar_events_start_idx on public.calendar_events (start_at);
create index if not exists calendar_events_owner_idx on public.calendar_events (owner_id);
create index if not exists calendar_events_visibility_idx on public.calendar_events (visibility);
create index if not exists calendar_events_team_idx on public.calendar_events (team_id);

drop trigger if exists calendar_events_touch_updated_at on public.calendar_events;
create trigger calendar_events_touch_updated_at
  before update on public.calendar_events
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. 예약 가능 리소스
-- ---------------------------------------------------------------------
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('meeting_room','vehicle','equipment')),
  capacity int,
  location text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resources_active_idx on public.resources (is_active, type);

drop trigger if exists resources_touch_updated_at on public.resources;
create trigger resources_touch_updated_at
  before update on public.resources
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 5. 리소스 예약
-- ---------------------------------------------------------------------
create table if not exists public.resource_bookings (
  id uuid primary key default gen_random_uuid(),
  -- 스펙 3.7이 "삭제 대신 비활성화(과거 예약 이력 보존)"를 요구하므로
  -- 리소스가 지워질 때 예약까지 사라지면 안 된다. restrict로 삭제 자체를 막는다.
  resource_id uuid not null references public.resources(id) on delete restrict,
  booked_by uuid not null references public.employees(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  purpose text,
  created_at timestamptz not null default now(),
  constraint resource_bookings_time_order check (end_at > start_at)
);

create index if not exists resource_bookings_resource_time_idx
  on public.resource_bookings (resource_id, start_at, end_at);
create index if not exists resource_bookings_booked_by_idx
  on public.resource_bookings (booked_by);

-- 같은 리소스의 시간대 중복 예약을 DB가 직접 막는다 (스펙 3.6).
-- 애플리케이션 단 검사만으로는 동시 요청에서 뚫린다.
-- 경계가 맞닿는 예약(09:00~10:00 과 10:00~11:00)은 허용해야 하므로 '[)' 범위를 쓴다.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'resource_bookings_no_overlap'
  ) then
    alter table public.resource_bookings
      add constraint resource_bookings_no_overlap
      exclude using gist (
        resource_id with =,
        tstzrange(start_at, end_at, '[)') with &&
      );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5-2. 조직 변경 이력 조회 (스펙 02 · 3.2)
--
-- 스펙은 임직원 프로필 상세(전 직원 조회 가능)에 팀 이동·승진 이력을 보여달라고 한다.
-- 그런데 audit_logs는 스펙 01에서 시스템 관리자 전용이고, 여기엔 로그인 거부·역할 변경
-- 같은 민감 기록이 함께 쌓인다. RLS를 넓히면 그것까지 새므로 그대로 두고,
-- 조직 관련 action만 화이트리스트로 뽑아 주는 함수를 따로 연다. detail은 반환하지 않는다.
-- ---------------------------------------------------------------------
create index if not exists audit_logs_target_idx on public.audit_logs (target_id);

create or replace function public.list_org_history(target_employee_id uuid)
returns table (id uuid, action text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.action, l.created_at
  from public.audit_logs l
  where l.target_id = target_employee_id
    and l.action in (
      'employee_created',
      'employee_transferred',
      'employee_promoted'
    )
  order by l.created_at desc
  limit 30
$$;

revoke all on function public.list_org_history(uuid) from public;
grant execute on function public.list_org_history(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------
alter table public.external_contacts  enable row level security;
alter table public.calendar_events    enable row level security;
alter table public.resources          enable row level security;
alter table public.resource_bookings  enable row level security;

-- external_contacts: 전체 조회·등록, 수정/삭제는 등록자 본인 또는 시스템 관리자
drop policy if exists external_contacts_select on public.external_contacts;
create policy external_contacts_select on public.external_contacts
  for select to authenticated using (true);

drop policy if exists external_contacts_insert on public.external_contacts;
create policy external_contacts_insert on public.external_contacts
  for insert to authenticated
  with check (created_by = public.current_employee_id());

drop policy if exists external_contacts_update on public.external_contacts;
create policy external_contacts_update on public.external_contacts
  for update to authenticated
  using (created_by = public.current_employee_id() or public.is_system_admin())
  with check (created_by = public.current_employee_id() or public.is_system_admin());

drop policy if exists external_contacts_delete on public.external_contacts;
create policy external_contacts_delete on public.external_contacts
  for delete to authenticated
  using (created_by = public.current_employee_id() or public.is_system_admin());

-- 같은 팀인지 판정 (calendar_events 정책에서 employees를 직접 읽으면
-- employees RLS와 얽히므로 security definer 함수로 뺀다)
create or replace function public.is_my_team(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_team_id is not null
     and exists (
       select 1 from public.employees e
       where e.auth_user_id = auth.uid()
         and e.team_id = target_team_id
     )
$$;

revoke all on function public.is_my_team(uuid) from public;
grant execute on function public.is_my_team(uuid) to authenticated;

-- calendar_events
drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
  for select to authenticated
  using (
    owner_id = public.current_employee_id()
    or visibility = 'company'
    or (visibility = 'team' and public.is_my_team(team_id))
    or public.is_system_admin()
  );

drop policy if exists calendar_events_insert on public.calendar_events;
create policy calendar_events_insert on public.calendar_events
  for insert to authenticated
  with check (owner_id = public.current_employee_id());

drop policy if exists calendar_events_update on public.calendar_events;
create policy calendar_events_update on public.calendar_events
  for update to authenticated
  using (owner_id = public.current_employee_id() or public.is_system_admin())
  with check (owner_id = public.current_employee_id() or public.is_system_admin());

drop policy if exists calendar_events_delete on public.calendar_events;
create policy calendar_events_delete on public.calendar_events
  for delete to authenticated
  using (owner_id = public.current_employee_id() or public.is_system_admin());

-- resources: 전체 조회, 변경은 시스템 관리자만
drop policy if exists resources_select on public.resources;
create policy resources_select on public.resources
  for select to authenticated using (true);

drop policy if exists resources_write on public.resources;
create policy resources_write on public.resources
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

-- resource_bookings: 중복 확인이 필요해 전체 조회 허용
drop policy if exists resource_bookings_select on public.resource_bookings;
create policy resource_bookings_select on public.resource_bookings
  for select to authenticated using (true);

drop policy if exists resource_bookings_insert on public.resource_bookings;
create policy resource_bookings_insert on public.resource_bookings
  for insert to authenticated
  with check (booked_by = public.current_employee_id());

drop policy if exists resource_bookings_update on public.resource_bookings;
create policy resource_bookings_update on public.resource_bookings
  for update to authenticated
  using (booked_by = public.current_employee_id() or public.is_system_admin())
  with check (booked_by = public.current_employee_id() or public.is_system_admin());

drop policy if exists resource_bookings_delete on public.resource_bookings;
create policy resource_bookings_delete on public.resource_bookings
  for delete to authenticated
  using (booked_by = public.current_employee_id() or public.is_system_admin());
