-- =====================================================================
-- 마이그레이션 19 — 스펙 10 프로젝트 관리
--
--   projects            프로젝트
--   project_milestones  마일스톤
--   project_files       산출물 첨부
--   + work_logs.project_id FK 확정 (스펙 09에서 컬럼만 열어뒀던 것)
--   + list_calendar_milestones() — 캘린더 병합 (연차·출장과 같은 패턴)
--
-- 진행률은 컬럼으로 저장하지 않는다. 완료 마일스톤 수 / 전체 수로 그때그때
-- 센다 — 저장하면 마일스톤을 지웠을 때 갱신을 놓치는 경로가 생긴다.
-- (스펙 03의 연차 cron 사건과 같은 이유)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 프로젝트
-- ---------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  team_id uuid references public.teams(id) on delete set null,
  owner_id uuid references public.employees(id) on delete set null,
  status text not null default 'planning'
    check (status in ('planning', 'in_progress', 'completed', 'on_hold', 'cancelled')),
  start_date date,
  end_date date,
  description text,
  result_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_name_not_blank check (btrim(name) <> ''),
  constraint projects_date_order
    check (end_date is null or start_date is null or end_date >= start_date)
);

create index if not exists projects_status_idx on public.projects (status, end_date);
create index if not exists projects_team_idx on public.projects (team_id);
create index if not exists projects_owner_idx on public.projects (owner_id);

alter table public.projects enable row level security;

/**
 * 이 프로젝트를 고칠 수 있는가 — 담당자 또는 시스템 관리자.
 * SECURITY DEFINER로 두는 이유: milestones·files 정책이 projects를 직접
 * 조회하면 그쪽 RLS가 다시 평가돼 정책이 서로를 참조하게 된다.
 */
create or replace function public.can_edit_project(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (p.owner_id = public.current_employee_id() or public.is_system_admin())
  ), false);
$$;

revoke all on function public.can_edit_project(uuid) from public;
grant execute on function public.can_edit_project(uuid) to authenticated;

/** 팀장/매니저 이상인가 — 프로젝트 등록 권한 */
create or replace function public.is_manager_or_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(exists (
    select 1
    from public.employees e
    join public.roles r on r.id = e.role_id
    where e.auth_user_id = auth.uid()
      and e.employment_status = 'active'
      and r.name in ('manager', 'system_admin')
  ), false);
$$;

revoke all on function public.is_manager_or_admin() from public;
grant execute on function public.is_manager_or_admin() to authenticated;

-- 전체 조회. 프로젝트별 비공개는 스펙 10 · 6장에서 명시적으로 미룬 항목이다
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated using (true);

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check (public.is_manager_or_admin());

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using (
    owner_id = public.current_employee_id() or public.is_system_admin()
  )
  with check (
    owner_id = public.current_employee_id() or public.is_system_admin()
  );

-- 삭제는 관리자만. 담당자가 지우면 그 프로젝트를 참조한 업무일지의
-- project_id가 조용히 null이 된다(아래 FK는 on delete set null)
drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete to authenticated
  using (public.is_system_admin());

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 2. 마일스톤
-- ---------------------------------------------------------------------
create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  due_date date,
  is_completed boolean not null default false,
  completed_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint milestones_title_not_blank check (btrim(title) <> ''),
  constraint milestones_completed_consistent
    check ((is_completed and completed_at is not null)
        or (not is_completed and completed_at is null))
);

create index if not exists project_milestones_project_idx
  on public.project_milestones (project_id, sort_order, due_date);
-- 캘린더 병합이 기간으로 훑는다
create index if not exists project_milestones_due_idx
  on public.project_milestones (due_date) where due_date is not null;

alter table public.project_milestones enable row level security;

drop policy if exists project_milestones_select on public.project_milestones;
create policy project_milestones_select on public.project_milestones
  for select to authenticated using (true);

drop policy if exists project_milestones_write on public.project_milestones;
create policy project_milestones_write on public.project_milestones
  for all to authenticated
  using (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

-- ---------------------------------------------------------------------
-- 3. 산출물 파일
-- ---------------------------------------------------------------------
create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- 공개 URL이 아니라 스토리지 경로다. 다운로드는 서명 URL로만 한다
  file_url text not null,
  file_name text,
  file_size bigint,
  uploaded_by uuid references public.employees(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create index if not exists project_files_project_idx
  on public.project_files (project_id, uploaded_at desc);

alter table public.project_files enable row level security;

drop policy if exists project_files_select on public.project_files;
create policy project_files_select on public.project_files
  for select to authenticated using (true);

drop policy if exists project_files_write on public.project_files;
create policy project_files_write on public.project_files
  for all to authenticated
  using (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

-- 산출물 버킷. 경로 규칙은 결재·게시판 첨부와 같다:
--   project-files/<업로더 auth uid>/<프로젝트 id>/<파일명>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-files',
  'project-files',
  false,
  20971520,
  array[
    'image/png','image/jpeg','image/webp','image/gif','application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv','application/zip'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "project files owner insert" on storage.objects;
create policy "project files owner insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "project files delete" on storage.objects;
create policy "project files delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-files'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_system_admin()
    )
  );

-- 프로젝트는 전 임직원이 조회하므로 산출물도 로그인 사용자면 볼 수 있다
drop policy if exists "project files select" on storage.objects;
create policy "project files select" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-files');

-- ---------------------------------------------------------------------
-- 4. work_logs.project_id FK 확정 (스펙 09에서 열어둔 컬럼)
--
--    on delete set null: 프로젝트가 사라져도 업무일지 자체는 남아야 한다.
--    기록은 프로젝트에 종속된 게 아니라 그 사람이 그 날 한 일이다.
-- ---------------------------------------------------------------------
-- 존재하지 않는 프로젝트를 가리키는 값이 있으면 FK가 실패한다. 먼저 정리한다
update public.work_logs w
set project_id = null
where w.project_id is not null
  and not exists (select 1 from public.projects p where p.id = w.project_id);

alter table public.work_logs
  drop constraint if exists fk_work_logs_project;

alter table public.work_logs
  add constraint fk_work_logs_project
  foreign key (project_id) references public.projects(id) on delete set null;

-- ---------------------------------------------------------------------
-- 5. 캘린더 병합 — 마일스톤
--
--    연차(list_calendar_leaves)·출장(list_calendar_approvals)과 같은 패턴.
--    캘린더 data.ts가 이 세 RPC를 합쳐서 하나의 항목 배열을 만든다.
-- ---------------------------------------------------------------------
create or replace function public.list_calendar_milestones(
  p_from date,
  p_to date
)
returns table (
  id uuid,
  project_id uuid,
  project_name text,
  title text,
  due_date date,
  is_completed boolean,
  is_mine boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.current_employee_id();
begin
  if me is null then
    return;
  end if;

  return query
  select
    m.id,
    m.project_id,
    p.name as project_name,
    m.title,
    m.due_date,
    m.is_completed,
    (p.owner_id = me) as is_mine
  from public.project_milestones m
  join public.projects p on p.id = m.project_id
  where m.due_date is not null
    and m.due_date >= p_from
    and m.due_date <= p_to
    -- 취소된 프로젝트의 마일스톤은 캘린더를 채울 이유가 없다
    and p.status <> 'cancelled'
  order by m.due_date, p.name;
end;
$$;

revoke all on function public.list_calendar_milestones(date, date) from public;
grant execute on function public.list_calendar_milestones(date, date) to authenticated;
