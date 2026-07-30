-- =====================================================================
-- 스펙 01 — 계정/인증 & 홈대시보드
-- 근거: aimbridge_intranet_spec_01_auth_dashboard.md 4장
--
-- 실행 방법 (둘 중 하나)
--   A. Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 Run
--   B. supabase CLI: supabase db push
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 조직 구조
-- ---------------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.departments(id) on delete set null,
  manager_id uuid, -- employees.id — 아래에서 FK 추가
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  department_id uuid references public.departments(id) on delete set null,
  manager_id uuid, -- employees.id — 아래에서 FK 추가
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. 역할 (MVP는 3종 고정, 커스텀 역할 생성은 Phase 2)
-- ---------------------------------------------------------------------
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
    check (name in ('system_admin','manager','employee')),
  label text not null,
  is_system_role boolean not null default true
);

insert into public.roles (name, label) values
  ('system_admin', '시스템 관리자'),
  ('manager',      '팀장/매니저'),
  ('employee',     '일반직원')
on conflict (name) do update set label = excluded.label;

-- ---------------------------------------------------------------------
-- 3. 임직원 마스터
-- ---------------------------------------------------------------------
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text not null unique,
  name text not null,
  department_id uuid references public.departments(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  position text,
  role_id uuid not null references public.roles(id),
  employment_status text not null default 'active'
    check (employment_status in ('active','leave','terminated')),
  hire_date date,
  phone text,
  emergency_contact text,
  profile_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 이메일 대소문자 구분 없이 중복 차단
create unique index if not exists employees_email_lower_idx
  on public.employees (lower(email));
create index if not exists employees_department_idx on public.employees (department_id);
create index if not exists employees_team_idx on public.employees (team_id);
create index if not exists employees_role_idx on public.employees (role_id);
create index if not exists employees_status_idx on public.employees (employment_status);

-- 조직 테이블의 manager FK를 이제 연결
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'departments_manager_id_fkey'
  ) then
    alter table public.departments
      add constraint departments_manager_id_fkey
      foreign key (manager_id) references public.employees(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'teams_manager_id_fkey'
  ) then
    alter table public.teams
      add constraint teams_manager_id_fkey
      foreign key (manager_id) references public.employees(id) on delete set null;
  end if;
end $$;

-- updated_at 자동 갱신
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists employees_touch_updated_at on public.employees;
create trigger employees_touch_updated_at
  before update on public.employees
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. 감사 로그
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.employees(id) on delete set null,
  action text not null,
  target_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id);

-- ---------------------------------------------------------------------
-- 5. 대시보드 위젯 설정 / 즐겨찾기
-- ---------------------------------------------------------------------
create table if not exists public.dashboard_widgets (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  widget_key text not null
    check (widget_key in ('approval_pending','attendance_today','notices','calendar_upcoming','favorites')),
  is_visible boolean not null default true,
  sort_order int not null default 0,
  unique (employee_id, widget_key)
);

create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  label text not null,
  target_path text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (employee_id, target_path)
);

create index if not exists favorites_employee_idx
  on public.favorites (employee_id, sort_order);

-- ---------------------------------------------------------------------
-- 6. 권한 판정 헬퍼
--    employees 정책 안에서 employees를 다시 읽으면 무한 재귀가 나므로
--    security definer 함수로 RLS를 우회해 조회한다.
-- ---------------------------------------------------------------------
create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.employees
  where auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees e
    join public.roles r on r.id = e.role_id
    where e.auth_user_id = auth.uid()
      and e.employment_status = 'active'
      and r.name = 'system_admin'
  )
$$;

revoke all on function public.current_employee_id() from public;
revoke all on function public.is_system_admin() from public;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.is_system_admin() to authenticated;

-- ---------------------------------------------------------------------
-- 7. 본인 수정 가능 필드 제한
--    RLS는 컬럼 단위 제어가 안 되므로 트리거로 막는다.
--    (스펙 3.7 — 본인은 프로필사진·휴대폰·비상연락처만 수정 가능)
-- ---------------------------------------------------------------------
create or replace function public.employees_guard_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 서버(service_role) 경유 쓰기와 DB 관리자는 그대로 통과.
  -- 관리자 화면의 변경은 Server Action에서 권한 확인 후 service_role로 수행한다.
  if current_user in ('postgres','supabase_admin','service_role')
     or auth.uid() is null
     or public.is_system_admin() then
    return new;
  end if;

  if new.email             is distinct from old.email
     or new.name           is distinct from old.name
     or new.department_id   is distinct from old.department_id
     or new.team_id         is distinct from old.team_id
     or new.position        is distinct from old.position
     or new.role_id         is distinct from old.role_id
     or new.employment_status is distinct from old.employment_status
     or new.hire_date       is distinct from old.hire_date
     or new.auth_user_id    is distinct from old.auth_user_id then
    raise exception '본인이 직접 수정할 수 없는 항목입니다. 시스템 관리자에게 문의하세요.';
  end if;

  return new;
end $$;

drop trigger if exists employees_guard_self_update on public.employees;
create trigger employees_guard_self_update
  before update on public.employees
  for each row execute function public.employees_guard_self_update();

-- ---------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------
alter table public.departments       enable row level security;
alter table public.teams             enable row level security;
alter table public.roles             enable row level security;
alter table public.employees         enable row level security;
alter table public.audit_logs        enable row level security;
alter table public.dashboard_widgets enable row level security;
alter table public.favorites         enable row level security;

-- departments / teams / roles: 전 임직원 조회, 수정은 시스템 관리자
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  for select to authenticated using (true);
drop policy if exists departments_write on public.departments;
create policy departments_write on public.departments
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams
  for select to authenticated using (true);
drop policy if exists teams_write on public.teams;
create policy teams_write on public.teams
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated using (true);
drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

-- employees: 본인 행 + 시스템 관리자는 전체
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_system_admin());

drop policy if exists employees_update_self on public.employees;
create policy employees_update_self on public.employees
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

drop policy if exists employees_admin_write on public.employees;
create policy employees_admin_write on public.employees
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

-- audit_logs: 시스템 관리자만 조회. INSERT 정책은 만들지 않는다(서버 전용).
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated using (public.is_system_admin());

-- dashboard_widgets / favorites: 본인 소유 행만
drop policy if exists dashboard_widgets_own on public.dashboard_widgets;
create policy dashboard_widgets_own on public.dashboard_widgets
  for all to authenticated
  using (employee_id = public.current_employee_id())
  with check (employee_id = public.current_employee_id());

drop policy if exists favorites_own on public.favorites;
create policy favorites_own on public.favorites
  for all to authenticated
  using (employee_id = public.current_employee_id())
  with check (employee_id = public.current_employee_id());
