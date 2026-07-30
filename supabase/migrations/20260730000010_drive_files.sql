-- =====================================================================
-- 스펙 06 — 개인 파일함 (Google Drive 연동)
-- 근거: aimbridge_intranet_spec_06_files_drive.md 4장
--
-- 이 세 테이블은 파일을 저장하지 않는다. "어떤 Drive 폴더/파일을 어디에
-- 연결할지"만 저장하는 매핑 테이블이고, 실제 목록·내용은 매번 Drive API로 읽는다.
-- =====================================================================

create table if not exists public.employee_drive_folders (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  drive_folder_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.drive_folder_links (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('team','department')),
  scope_id uuid not null,
  drive_folder_id text not null,
  label text,
  created_at timestamptz not null default now(),
  unique (scope_type, scope_id)
);

create index if not exists drive_folder_links_scope_idx
  on public.drive_folder_links (scope_type, scope_id);

create table if not exists public.library_documents (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null,
  display_name text not null,
  category text,
  description text,
  added_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists library_documents_category_idx
  on public.library_documents (category, display_name);

-- ---------------------------------------------------------------------
-- 개인 폴더 매핑 등록
--   RLS로 INSERT를 열지 않고(스펙 4장 "INSERT는 서버 로직만") 함수로만 받는다.
-- ---------------------------------------------------------------------
create or replace function public.set_my_drive_folder(p_folder_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.current_employee_id();
begin
  if me is null then
    raise exception '권한이 없습니다.';
  end if;
  if p_folder_id is null or btrim(p_folder_id) = '' then
    raise exception '폴더 ID가 비어 있습니다.';
  end if;

  insert into public.employee_drive_folders (employee_id, drive_folder_id)
  values (me, btrim(p_folder_id))
  on conflict (employee_id) do update
    set drive_folder_id = excluded.drive_folder_id;
end $$;

revoke all on function public.set_my_drive_folder(text) from public;
grant execute on function public.set_my_drive_folder(text) to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.employee_drive_folders enable row level security;
alter table public.drive_folder_links     enable row level security;
alter table public.library_documents      enable row level security;

-- 개인 폴더 매핑: 본인 것만 조회. 쓰기는 위 함수로만.
drop policy if exists employee_drive_folders_select on public.employee_drive_folders;
create policy employee_drive_folders_select on public.employee_drive_folders
  for select to authenticated
  using (employee_id = public.current_employee_id() or public.is_system_admin());

-- 팀 폴더 매핑: 자기 팀 폴더를 찾아야 하므로 전체 조회 허용, 변경은 관리자만
drop policy if exists drive_folder_links_select on public.drive_folder_links;
create policy drive_folder_links_select on public.drive_folder_links
  for select to authenticated using (true);

drop policy if exists drive_folder_links_write on public.drive_folder_links;
create policy drive_folder_links_write on public.drive_folder_links
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

drop policy if exists library_documents_select on public.library_documents;
create policy library_documents_select on public.library_documents
  for select to authenticated using (true);

drop policy if exists library_documents_write on public.library_documents;
create policy library_documents_write on public.library_documents
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());
