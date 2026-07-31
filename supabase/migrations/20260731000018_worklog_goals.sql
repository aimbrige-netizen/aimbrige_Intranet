-- =====================================================================
-- 마이그레이션 18 — 스펙 09 업무기록 & 목표설정
--
--   work_logs  업무일지 (본인 + 팀장은 팀원 조회)
--   todos      개인 할일 (완전 개인용 — 남에게 절대 보이지 않는다)
--   goals      목표 (본인 + 팀장은 팀원 조회)
--
-- work_logs.project_id는 컬럼만 열어 두고 FK는 스펙 10(마이그레이션 19)에서
-- projects 테이블이 생긴 뒤에 건다. 스펙 09 문서의 지시 그대로다.
--
-- 권한 헬퍼는 새로 만들지 않는다 — current_employee_id()/is_system_admin()
-- (마이그레이션 01)과 manages_employee()(마이그레이션 06)를 그대로 쓴다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 업무일지
-- ---------------------------------------------------------------------
create table if not exists public.work_logs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  log_date date not null,
  content text not null,
  -- 스펙 10에서 projects(id) FK로 승격한다
  project_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_logs_content_not_blank check (btrim(content) <> '')
);

comment on column public.work_logs.project_id is
  '프로젝트 태깅. 마이그레이션 19에서 projects(id) FK 제약을 건다.';

-- 목록은 항상 "누구의 · 어느 기간"으로 조회된다
create index if not exists work_logs_employee_date_idx
  on public.work_logs (employee_id, log_date desc);
create index if not exists work_logs_project_idx
  on public.work_logs (project_id) where project_id is not null;

alter table public.work_logs enable row level security;

drop policy if exists work_logs_select on public.work_logs;
create policy work_logs_select on public.work_logs
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.manages_employee(employee_id)
    or public.is_system_admin()
  );

/*
 * 쓰기는 본인만. 팀장도 팀원 일지를 고칠 수 없다 —
 * 업무일지는 본인 기록이고, 남이 고칠 수 있으면 기록으로서 의미가 없다.
 */
drop policy if exists work_logs_insert on public.work_logs;
create policy work_logs_insert on public.work_logs
  for insert to authenticated
  with check (employee_id = public.current_employee_id());

drop policy if exists work_logs_update on public.work_logs;
create policy work_logs_update on public.work_logs
  for update to authenticated
  using (employee_id = public.current_employee_id())
  with check (employee_id = public.current_employee_id());

drop policy if exists work_logs_delete on public.work_logs;
create policy work_logs_delete on public.work_logs
  for delete to authenticated
  using (employee_id = public.current_employee_id());

-- ---------------------------------------------------------------------
-- 2. 개인 할일
--    완전 개인 데이터다. 관리자에게도 열지 않는다 — 스펙 09 · 4장 RLS 원칙.
-- ---------------------------------------------------------------------
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  content text not null,
  is_completed boolean not null default false,
  completed_at timestamptz,
  due_date date,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint todos_content_not_blank check (btrim(content) <> ''),
  -- 완료 표시와 완료 시각이 어긋나면 "언제 끝냈나"를 알 수 없다
  constraint todos_completed_consistent
    check ((is_completed and completed_at is not null)
        or (not is_completed and completed_at is null))
);

create index if not exists todos_employee_order_idx
  on public.todos (employee_id, is_completed, sort_order, created_at);

alter table public.todos enable row level security;

drop policy if exists todos_all on public.todos;
create policy todos_all on public.todos
  for all to authenticated
  using (employee_id = public.current_employee_id())
  with check (employee_id = public.current_employee_id());

-- ---------------------------------------------------------------------
-- 3. 목표
-- ---------------------------------------------------------------------
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  title text not null,
  description text,
  target_date date,
  status text not null default 'active'
    check (status in ('active', 'completed', 'dropped')),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_title_not_blank check (btrim(title) <> ''),
  constraint goals_closed_consistent
    check ((status = 'active' and closed_at is null)
        or (status <> 'active' and closed_at is not null))
);

create index if not exists goals_employee_status_idx
  on public.goals (employee_id, status, target_date);

alter table public.goals enable row level security;

drop policy if exists goals_select on public.goals;
create policy goals_select on public.goals
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.manages_employee(employee_id)
    or public.is_system_admin()
  );

drop policy if exists goals_insert on public.goals;
create policy goals_insert on public.goals
  for insert to authenticated
  with check (employee_id = public.current_employee_id());

drop policy if exists goals_update on public.goals;
create policy goals_update on public.goals
  for update to authenticated
  using (employee_id = public.current_employee_id())
  with check (employee_id = public.current_employee_id());

drop policy if exists goals_delete on public.goals;
create policy goals_delete on public.goals
  for delete to authenticated
  using (employee_id = public.current_employee_id());

-- ---------------------------------------------------------------------
-- 4. updated_at 자동 갱신
--    touch_updated_at()은 마이그레이션 01에 이미 있다.
-- ---------------------------------------------------------------------
drop trigger if exists work_logs_touch_updated_at on public.work_logs;
create trigger work_logs_touch_updated_at
  before update on public.work_logs
  for each row execute function public.touch_updated_at();

drop trigger if exists goals_touch_updated_at on public.goals;
create trigger goals_touch_updated_at
  before update on public.goals
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 5. 팀원 목록 — 팀장의 워크로그 조회 드롭다운용
--
--    employees는 RLS가 select using(true)로 열려 있지만, "내가 관리하는
--    사람이 누구인가"를 화면에서 매번 팀·부서 조인으로 재현하면 규칙이
--    manages_employee()와 갈린다. 판정 기준을 한 곳에 둔다.
-- ---------------------------------------------------------------------
--
-- position은 PostgreSQL 예약어(문자열 함수 position(a in b))라
-- returns table의 컬럼 정의에서 따옴표 없이 쓰면 구문 오류가 난다.
-- 큰따옴표로 감싸면 반환 키 이름은 그대로 position으로 나간다.
--
create or replace function public.my_team_members()
returns table (id uuid, name text, "position" text, team_name text)
language sql
security definer
stable
set search_path = public
as $$
  select e.id, e.name, e.position, t.name as team_name
  from public.employees e
  left join public.teams t on t.id = e.team_id
  where e.employment_status = 'active'
    and e.id <> public.current_employee_id()
    and (public.manages_employee(e.id) or public.is_system_admin())
  order by t.name nulls last, e.name;
$$;

revoke all on function public.my_team_members() from public;
grant execute on function public.my_team_members() to authenticated;
