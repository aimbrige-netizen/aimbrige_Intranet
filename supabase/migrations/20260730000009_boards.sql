-- =====================================================================
-- 스펙 05 — 게시판 & 공지사항
-- 근거: aimbridge_intranet_spec_05_board_notices.md 4장·5장
-- =====================================================================

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  board_type text not null check (board_type in ('notice','discussion')),
  -- null이면 전사, 값이 있으면 해당 부서 전용(공지 타입에서만 사용)
  department_id uuid references public.departments(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  -- 자유게시판을 특정 부서 전용으로 두는 개념은 스펙에 없다
  constraint boards_department_only_notice
    check (department_id is null or board_type = 'notice')
);

create index if not exists boards_type_idx on public.boards (board_type, sort_order);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  title text not null,
  content text not null,
  category text,
  is_pinned boolean not null default false,
  author_id uuid not null references public.employees(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posts_board_idx
  on public.posts (board_id, is_pinned desc, created_at desc);
create index if not exists posts_author_idx on public.posts (author_id);
create index if not exists posts_category_idx on public.posts (category);

drop trigger if exists posts_touch_updated_at on public.posts;
create trigger posts_touch_updated_at
  before update on public.posts
  for each row execute function public.touch_updated_at();

create table if not exists public.post_reads (
  post_id uuid not null references public.posts(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (post_id, employee_id)
);

create index if not exists post_reads_employee_idx
  on public.post_reads (employee_id);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.employees(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comments_post_idx
  on public.comments (post_id, created_at);

drop trigger if exists comments_touch_updated_at on public.comments;
create trigger comments_touch_updated_at
  before update on public.comments
  for each row execute function public.touch_updated_at();

create table if not exists public.reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  emoji text not null check (emoji in ('👍','❤️','😂','🎉')),
  created_at timestamptz not null default now(),
  primary key (post_id, employee_id, emoji)
);

create table if not exists public.post_attachments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  file_url text not null,
  file_name text,
  file_size int,
  uploaded_at timestamptz not null default now()
);

create index if not exists post_attachments_post_idx
  on public.post_attachments (post_id);

-- ---------------------------------------------------------------------
-- 권한 판정 헬퍼
-- ---------------------------------------------------------------------

/**
 * 이 게시판에 글을 쓸 수 있는지 (스펙 3.2 권한표)
 *   notice     → 팀장/매니저 이상 (시스템 관리자 포함)
 *   discussion → 전체 임직원
 * RLS 정책에서 boards를 읽어야 하는데 정책 안에서 조인하면 얽히므로 definer로 뺀다.
 */
create or replace function public.can_post_to_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
        when b.board_type = 'discussion' then true
        else exists (
          select 1
          from public.employees e
          join public.roles r on r.id = e.role_id
          where e.auth_user_id = auth.uid()
            and e.employment_status = 'active'
            and r.name in ('manager','system_admin')
        )
      end
      from public.boards b
      where b.id = p_board_id
    ),
    false
  )
$$;

revoke all on function public.can_post_to_board(uuid) from public;
grant execute on function public.can_post_to_board(uuid) to authenticated;

/** 게시글 작성자 본인인지 */
create or replace function public.is_post_author(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.author_id = public.current_employee_id()
      from public.posts p
      where p.id = p_post_id
    ),
    false
  )
$$;

revoke all on function public.is_post_author(uuid) from public;
grant execute on function public.is_post_author(uuid) to authenticated;

/**
 * 읽음 현황 (스펙 3.3)
 * 작성자·관리자만 열람 가능. 대상자는 전사공지면 전 재직자,
 * 부서공지면 해당 부서 소속으로 본다.
 */
create or replace function public.post_read_status(p_post_id uuid)
returns table (
  employee_id uuid,
  employee_name text,
  department_name text,
  read_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  post_row record;
  board_row record;
begin
  select * into post_row from public.posts where id = p_post_id;
  if post_row is null then
    raise exception '게시글을 찾을 수 없습니다.';
  end if;

  if not (public.is_post_author(p_post_id) or public.is_system_admin()) then
    raise exception '읽음 현황은 작성자와 시스템 관리자만 볼 수 있습니다.';
  end if;

  select * into board_row from public.boards where id = post_row.board_id;

  return query
    select e.id, e.name, d.name, r.read_at
    from public.employees e
    left join public.departments d on d.id = e.department_id
    left join public.post_reads r
      on r.post_id = p_post_id and r.employee_id = e.id
    where e.employment_status = 'active'
      and (
        board_row.department_id is null
        or e.department_id = board_row.department_id
      )
    order by (r.read_at is null) desc, e.name;
end $$;

revoke all on function public.post_read_status(uuid) from public;
grant execute on function public.post_read_status(uuid) to authenticated;

/**
 * 게시판별 읽음 집계 — 목록에서 "읽음 N/M" 배지에 쓴다.
 * post_reads의 RLS를 본인 것으로 좁혀도 집계는 필요하므로 함수로 제공한다.
 */
create or replace function public.board_post_read_counts(p_board_id uuid)
returns table (post_id uuid, read_count bigint, target_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  board_row record;
  targets bigint;
begin
  if public.current_employee_id() is null then
    raise exception '조회 권한이 없습니다.';
  end if;

  select * into board_row from public.boards where id = p_board_id;
  if board_row is null then
    return;
  end if;

  select count(*) into targets
  from public.employees e
  where e.employment_status = 'active'
    and (board_row.department_id is null
         or e.department_id = board_row.department_id);

  return query
    select p.id, count(r.employee_id), targets
    from public.posts p
    left join public.post_reads r on r.post_id = p.id
    where p.board_id = p_board_id
    group by p.id;
end $$;

revoke all on function public.board_post_read_counts(uuid) from public;
grant execute on function public.board_post_read_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.boards           enable row level security;
alter table public.posts            enable row level security;
alter table public.post_reads       enable row level security;
alter table public.comments         enable row level security;
alter table public.reactions        enable row level security;
alter table public.post_attachments enable row level security;

drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards
  for select to authenticated using (true);

drop policy if exists boards_write on public.boards;
create policy boards_write on public.boards
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts
  for select to authenticated using (true);

-- 공지 게시판은 팀장 이상만 쓸 수 있다 (스펙 3.2)
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts
  for insert to authenticated
  with check (
    author_id = public.current_employee_id()
    and public.can_post_to_board(board_id)
  );

drop policy if exists posts_update on public.posts;
create policy posts_update on public.posts
  for update to authenticated
  using (author_id = public.current_employee_id() or public.is_system_admin())
  with check (author_id = public.current_employee_id() or public.is_system_admin());

drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts
  for delete to authenticated
  using (author_id = public.current_employee_id() or public.is_system_admin());

-- 읽음 기록: 본인 명의로만 기록. 조회는 본인 것 + 작성자·관리자는 전체
drop policy if exists post_reads_select on public.post_reads;
create policy post_reads_select on public.post_reads
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.is_post_author(post_id)
    or public.is_system_admin()
  );

drop policy if exists post_reads_insert on public.post_reads;
create policy post_reads_insert on public.post_reads
  for insert to authenticated
  with check (employee_id = public.current_employee_id());

drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments
  for select to authenticated using (true);

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
  for insert to authenticated
  with check (author_id = public.current_employee_id());

drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments
  for update to authenticated
  using (author_id = public.current_employee_id())
  with check (author_id = public.current_employee_id());

drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments
  for delete to authenticated
  using (author_id = public.current_employee_id() or public.is_system_admin());

drop policy if exists reactions_select on public.reactions;
create policy reactions_select on public.reactions
  for select to authenticated using (true);

drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions
  for insert to authenticated
  with check (employee_id = public.current_employee_id());

drop policy if exists reactions_delete on public.reactions;
create policy reactions_delete on public.reactions
  for delete to authenticated
  using (employee_id = public.current_employee_id());

drop policy if exists post_attachments_select on public.post_attachments;
create policy post_attachments_select on public.post_attachments
  for select to authenticated using (true);

drop policy if exists post_attachments_insert on public.post_attachments;
create policy post_attachments_insert on public.post_attachments
  for insert to authenticated
  with check (public.is_post_author(post_id));

drop policy if exists post_attachments_delete on public.post_attachments;
create policy post_attachments_delete on public.post_attachments
  for delete to authenticated
  using (public.is_post_author(post_id) or public.is_system_admin());

-- ---------------------------------------------------------------------
-- 초기 시딩 (스펙 5장)
-- ---------------------------------------------------------------------
insert into public.boards (name, board_type, department_id, sort_order)
select '전사공지', 'notice', null, 0
where not exists (
  select 1 from public.boards where name = '전사공지' and board_type = 'notice'
);

insert into public.boards (name, board_type, department_id, sort_order)
select '자유게시판', 'discussion', null, 1
where not exists (
  select 1 from public.boards where name = '자유게시판' and board_type = 'discussion'
);

-- ---------------------------------------------------------------------
-- 첨부파일 저장소
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-attachments',
  'post-attachments',
  false,
  10485760,
  array['image/png','image/jpeg','image/webp','image/gif','application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "post attach owner insert" on storage.objects;
create policy "post attach owner insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'post-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "post attach owner delete" on storage.objects;
create policy "post attach owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'post-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 게시글은 전 임직원이 보므로 첨부도 로그인 사용자면 조회 가능
drop policy if exists "post attach select" on storage.objects;
create policy "post attach select" on storage.objects
  for select to authenticated
  using (bucket_id = 'post-attachments');
