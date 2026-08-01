-- =====================================================================
-- 마이그레이션 24 — 스펙 16 커뮤니티(동호회)
--
-- 동호회는 새 도메인이 아니라 "가입이 필요한 게시판"이다(스펙 16 · 1장).
-- 그래서 새 테이블은 멤버십 하나뿐이고, 나머지는 전부 스펙 05의
-- boards/posts/comments/reactions를 넓히는 작업이다.
--
-- 이 마이그레이션이 실제로 막는 사고는 셋이다.
--
--  1) can_post_to_board()에 community 분기를 넣지 않으면 권한이 정확히 뒤집힌다.
--     현재 함수는 'discussion이면 true, 아니면 팀장 이상'이라서 community는
--     else로 떨어진다 → 가입한 일반 직원은 자기 동호회에 글을 못 쓰고,
--     가입하지도 않은 팀장·관리자는 아무 동호회에나 쓴다.
--
--  2) posts_update의 WITH CHECK가 board_id를 보지 않는다. 자유게시판에 글을
--     쓴 뒤 board_id만 남의 동호회(또는 공지 게시판)로 바꿔치기하면
--     posts_insert의 can_post_to_board() 검사를 통째로 우회할 수 있다.
--     지금까지는 notice/discussion 둘뿐이라 피해가 "자유글이 공지에 끼어든다"
--     정도였는데, 동호회가 생기면 비가입자 글쓰기 경로가 된다.
--     comments_update도 author_id만 보므로 post_id에 같은 구멍이 있다.
--
--  3) 부적절한 동호회를 내리는 경로가 없다. deleteBoard()는 글이 1건이라도
--     있으면 거부하고(cascade 사고 방지), 그 원칙은 옳다. 그래서 삭제가 아니라
--     보관(archived_at)으로 내린다 — 글은 남고 목록에서만 사라진다.
--
-- 개설 권한은 전 임직원이다(스펙 3.1). 승인제 없이 자유 가입(스펙 6장).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. boards 확장
-- ---------------------------------------------------------------------

-- 원본(마이그레이션 09)의 인라인 CHECK는 자동으로 boards_board_type_check로
-- 이름이 붙는다. 이름으로 지운 뒤 값을 하나 늘려 다시 건다.
alter table public.boards
  drop constraint if exists boards_board_type_check;

alter table public.boards
  add constraint boards_board_type_check
  check (board_type in ('notice','discussion','community'));

alter table public.boards
  add column if not exists description text;

-- 개설자. 동호회는 관리자가 아니라 임직원이 만들기 때문에 "누가 만들었나"가
-- 화면에도 필요하고, 아래 자동 가입 트리거의 입력이기도 하다.
alter table public.boards
  add column if not exists created_by uuid references public.employees(id) on delete set null;

/*
 * 보관 시각. boolean이 아니라 timestamptz인 이유는 "언제 내렸는지"가 남아야
 * 하기 때문이다 — 부적절한 동호회를 내린 기록은 사후에 되짚을 일이 생긴다.
 * null이면 운영 중.
 */
alter table public.boards
  add column if not exists archived_at timestamptz;

comment on column public.boards.archived_at is
  '동호회 보관 시각. null이면 운영 중. 글을 지우지 않고 목록에서만 감춘다(스펙 16 · 3.3).';

/*
 * 보관은 동호회 전용이다. 공지·자유게시판에 archived_at을 찍어도 게시판 모듈은
 * 그 컬럼을 읽지 않으므로 아무 일도 일어나지 않는다 — 조용히 무시되는 상태를
 * 데이터로 남길 수 있게 두면 나중에 "왜 안 숨겨지지"로 돌아온다.
 */
alter table public.boards
  drop constraint if exists boards_archive_only_community;

alter table public.boards
  add constraint boards_archive_only_community
  check (archived_at is null or board_type = 'community');

-- 이름 없는 게시판은 목록에서 클릭할 수 없는 빈 줄이 된다.
-- 개설 경로가 관리자 화면 하나에서 전 임직원으로 넓어지므로 DB에서도 막는다.
alter table public.boards
  drop constraint if exists boards_name_not_blank;

alter table public.boards
  add constraint boards_name_not_blank check (btrim(name) <> '');

/*
 * 이름 길이·소개 길이는 create_community()가 검사하지만, 아래 boards_insert
 * 정책이 전 임직원에게 community INSERT를 열어 두는 이상 PostgREST로 boards에
 * 직접 꽂는 경로에는 그 검증이 하나도 적용되지 않는다. 카드 레이아웃을
 * 무너뜨리는 값(60자 넘는 이름·수만 자 소개)은 DB에서 막는다.
 *
 * community에만 건다 — 공지·자유게시판은 관리자만 만들고 이미 운영 중인
 * 이름이 있어서, 전 타입에 걸면 기존 행이 제약에 걸릴 수 있다.
 */
alter table public.boards
  drop constraint if exists boards_community_text_limits;

alter table public.boards
  add constraint boards_community_text_limits
  check (
    board_type <> 'community'
    or (
      char_length(btrim(name)) <= 60
      and char_length(coalesce(description, '')) <= 500
    )
  );

-- 동호회 목록은 "운영 중인 것만 이름순"이 기본 질의다
create index if not exists boards_community_idx
  on public.boards (archived_at, name)
  where board_type = 'community';

/*
 * 운영 중인 동호회끼리는 이름이 유일하다. create_community()가 같은 규칙을
 * 검사하지만 그건 RPC 경로에만 적용되고, 목록 카드에서 이름이 유일한
 * 식별자라 '러닝크루'가 둘이면 어느 쪽에 가입했는지 화면상 구분이 불가능하다.
 * 보관된 것은 목록에 없으므로 이름을 다시 쓸 수 있다(부분 인덱스의 where).
 */
create unique index if not exists boards_community_name_uniq
  on public.boards (lower(btrim(name)))
  where board_type = 'community' and archived_at is null;

-- ---------------------------------------------------------------------
-- 2. community_members (스펙 16 · 4장)
-- ---------------------------------------------------------------------
create table if not exists public.community_members (
  board_id uuid not null references public.boards(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (board_id, employee_id)
);

-- "내가 가입한 동호회"를 목록 화면이 매번 묻는다
create index if not exists community_members_employee_idx
  on public.community_members (employee_id);

alter table public.community_members enable row level security;

-- ---------------------------------------------------------------------
-- 3. 권한 판정 헬퍼
--
-- 정책 안에서 boards를 조인하면 관계가 얽히므로 definer로 뺀다
-- (마이그레이션 09의 can_post_to_board()와 같은 이유).
-- ---------------------------------------------------------------------

/** 지금 가입할 수 있는 동호회인지 — community 타입이면서 보관되지 않았을 것 */
create or replace function public.is_open_community(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select b.board_type = 'community' and b.archived_at is null
      from public.boards b
      where b.id = p_board_id
    ),
    false
  )
$$;

revoke all on function public.is_open_community(uuid) from public;
grant execute on function public.is_open_community(uuid) to authenticated;

/**
 * 내가 이 동호회 멤버인지 (스펙 16 · 3.2)
 * current_employee_id()가 null이면 exists가 false라 자연히 막힌다.
 */
create or replace function public.is_community_member(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.community_members m
    where m.board_id = p_board_id
      and m.employee_id = public.current_employee_id()
  )
$$;

revoke all on function public.is_community_member(uuid) from public;
grant execute on function public.is_community_member(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. can_post_to_board()에 community 분기 (스펙 16 · 4장 RLS 원칙)
--
-- 원본은 'discussion이면 true, 아니면 팀장 이상'이었다. community를 넣지 않으면
-- else로 떨어져 권한이 정확히 뒤집힌다(파일 머리 주석 1번).
--
-- 관리자 우회를 일부러 넣지 않았다. 동호회는 "가입한 사람들의 공간"이라
-- 시스템 관리자도 가입해야 쓸 수 있다. 관리자에게 필요한 건 남의 동호회에
-- 글을 쓰는 권한이 아니라 부적절한 동호회를 내리는 권한이고, 그건
-- archive_community()가 맡는다.
-- ---------------------------------------------------------------------
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
        -- 보관된 동호회에는 멤버도 관리자도 쓸 수 없다
        when b.board_type = 'community' then
          b.archived_at is null and public.is_community_member(b.id)
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

/**
 * 이 글에 댓글·반응을 남길 수 있는지.
 *
 * can_post_to_board()를 그대로 쓸 수는 없다 — 공지 게시판은 글쓰기가 팀장
 * 이상이지만 댓글은 전 임직원이 달 수 있고(스펙 05 · 3.3), 여기에
 * can_post_to_board()를 붙이면 오늘 되던 공지 댓글이 내일 안 된다.
 * 그래서 community에서만 갈라지고 나머지는 기존대로 true다.
 */
create or replace function public.can_comment_on_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
        when b.board_type = 'community' then
          b.archived_at is null and public.is_community_member(b.id)
        else true
      end
      from public.posts p
      join public.boards b on b.id = p.board_id
      where p.id = p_post_id
    ),
    false
  )
$$;

revoke all on function public.can_comment_on_post(uuid) from public;
grant execute on function public.can_comment_on_post(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. boards RLS — community만 열고 나머지는 그대로 잠근다
--
-- 원본의 boards_write는 for all + is_system_admin() 하나였다. 그대로 두면
-- 일반 직원이 동호회를 만들 수 없고, 통째로 열면 일반 직원이 '전사공지'
-- 게시판을 만들 수 있게 된다. 그래서 INSERT만, 그것도 community 타입에만 연다.
-- ---------------------------------------------------------------------
drop policy if exists boards_write on public.boards;

drop policy if exists boards_insert on public.boards;
create policy boards_insert on public.boards
  for insert to authenticated
  with check (
    public.is_system_admin()
    or (
      board_type = 'community'
      -- 부서 전용 동호회 개념은 스펙에 없다(boards_department_only_notice와 같은 규칙)
      and department_id is null
      -- 만들자마자 보관된 상태로 넣는 경로를 남기지 않는다
      and archived_at is null
      -- 개설자를 남의 이름으로 적을 수 없다. 자동 가입 트리거의 입력이기도 하다
      and created_by = public.current_employee_id()
    )
  );

/*
 * 수정·삭제는 시스템 관리자만이다. 스펙 16에는 동호회 정보를 고치는 화면이
 * 없고(3.1 개설 / 3.2 상세 / 3.3 관리), 개설자에게 UPDATE를 열면 board_type과
 * archived_at까지 함께 열려 컬럼 가드 트리거가 한 벌 더 필요해진다.
 * 보관·해제는 아래 함수가 맡는다.
 */
drop policy if exists boards_update on public.boards;
create policy boards_update on public.boards
  for update to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

drop policy if exists boards_delete on public.boards;
create policy boards_delete on public.boards
  for delete to authenticated
  using (public.is_system_admin());

-- ---------------------------------------------------------------------
-- 6. community_members RLS (스펙 16 · 4장)
-- ---------------------------------------------------------------------

-- 멤버 수·명단은 공개다 — 목록 카드의 "가입 인원수"와 상세 상단 멤버 목록
drop policy if exists community_members_select on public.community_members;
create policy community_members_select on public.community_members
  for select to authenticated using (true);

-- 남을 대신 가입시킬 수 없고, 보관된 동호회에는 가입할 수 없다
drop policy if exists community_members_insert on public.community_members;
create policy community_members_insert on public.community_members
  for insert to authenticated
  with check (
    employee_id = public.current_employee_id()
    and public.is_open_community(board_id)
  );

/*
 * 탈퇴는 보관된 동호회에서도 가능해야 한다. 보관을 가입 조건과 같은 잣대로
 * 막으면 이미 가입한 사람이 영영 나가지 못하고 "내 동호회" 목록에 남는다.
 * 관리자 삭제는 부적절한 가입(예: 사칭)을 정리하기 위한 것이다.
 */
drop policy if exists community_members_delete on public.community_members;
create policy community_members_delete on public.community_members
  for delete to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.is_system_admin()
  );

-- ---------------------------------------------------------------------
-- 7. 개설자 자동 가입 — 멤버 0명짜리 유령 동호회를 원천 차단
--
-- 정상 경로는 create_community()지만 boards_insert 정책이 열려 있는 이상
-- PostgREST로 boards에 직접 꽂는 경로도 존재한다. 그쪽으로 들어오면
-- 개설자조차 멤버가 아닌 동호회가 생기고, can_post_to_board() 기준으로
-- "아무도 글을 못 쓰는 동호회"가 된다.
--
-- AFTER INSERT라 upsert의 첫 INSERT도 같이 잡힌다.
-- ---------------------------------------------------------------------

/*
 * 자동 가입의 입력은 created_by다. 그래서 created_by가 비어 있으면 가입도
 * 일어나지 않는다. 로그인 사용자의 INSERT는 아래 트리거가 current_employee_id()로
 * 채워 주므로 그 상태가 남을 수 있는 자리는 둘뿐이다 —
 * (a) service_role 시딩·관리 스크립트(아래 우회 분기), (b) 개설자가 퇴사해
 * FK가 created_by를 null로 되돌린 뒤. 시딩 스크립트는 created_by를 직접 넣어야
 * 개설자 자동 가입까지 함께 일어난다.
 *
 * CHECK 제약으로 막지 않은 이유가 있다. created_by는 on delete set null이라
 * 개설자의 employees 행이 지워질 때 FK가 null로 되돌리는데, CHECK가 걸려 있으면
 * 그 UPDATE가 실패해 퇴사자 삭제 자체가 막힌다. INSERT 시점에만 채운다.
 */
create or replace function public.community_require_creator()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- 시딩·관리 스크립트(service_role)는 개설자를 명시적으로 지정해 넣는다.
  -- 아래 posts_guard_board_id()와 같은 규약이다 — 여기만 어기면 시딩 경로가
  -- '동호회는 개설자를 지정해야 합니다'로 조용히 막힌다.
  if current_user in ('postgres','supabase_admin','service_role')
     or auth.uid() is null then
    return new;
  end if;

  if new.board_type = 'community' and new.created_by is null then
    new.created_by := public.current_employee_id();
    if new.created_by is null then
      raise exception '동호회는 개설자를 지정해야 합니다';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists boards_community_require_creator on public.boards;
create trigger boards_community_require_creator
  before insert on public.boards
  for each row execute function public.community_require_creator();

create or replace function public.community_autojoin_creator()
returns trigger
language plpgsql
-- SECURITY INVOKER(기본값)를 명시한다. definer로 두면 community_members의
-- RLS를 우회해 남의 이름으로 가입시키는 경로가 트리거를 통해 열린다.
security invoker
set search_path = public
as $$
begin
  if new.board_type = 'community' and new.created_by is not null then
    insert into public.community_members (board_id, employee_id)
    values (new.id, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists boards_community_autojoin on public.boards;
create trigger boards_community_autojoin
  after insert on public.boards
  for each row execute function public.community_autojoin_creator();

-- ---------------------------------------------------------------------
-- 8. create_community() — 개설과 자동 가입을 한 트랜잭션으로 (스펙 16 · 5장)
-- ---------------------------------------------------------------------
create or replace function public.create_community(
  p_name text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_employee_id();
  v_id uuid;
begin
  if v_me is null then
    raise exception '로그인이 필요합니다';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception '동호회 이름을 입력하세요';
  end if;
  if char_length(btrim(p_name)) > 60 then
    raise exception '동호회 이름은 60자 이내로 입력하세요';
  end if;

  /*
   * 같은 이름의 동호회를 막는다. 카드 목록에서 이름이 유일한 식별자라
   * "러닝크루"가 둘이면 어느 쪽에 가입했는지 화면상 구분이 불가능하다.
   * 보관된 것은 목록에 없으므로 이름을 다시 쓸 수 있다.
   */
  if exists (
    select 1 from public.boards
    where board_type = 'community'
      and archived_at is null
      and lower(btrim(name)) = lower(btrim(p_name))
  ) then
    raise exception '같은 이름의 동호회가 이미 있습니다';
  end if;

  insert into public.boards (
    name, board_type, department_id, description, created_by, sort_order
  )
  values (
    btrim(p_name),
    'community',
    null,
    nullif(btrim(coalesce(p_description, '')), ''),
    v_me,
    -- 나중에 만든 동호회가 뒤로 가도록. 공지·자유게시판의 순번과는 별개 축이다
    coalesce(
      (select max(sort_order) + 1 from public.boards where board_type = 'community'),
      0
    )
  )
  returning id into v_id;

  /*
   * 개설자 가입은 boards_community_autojoin 트리거가 같은 트랜잭션에서 넣는다.
   * 여기서 한 번 더 확인하는 이유는, 트리거가 언젠가 사라지거나 조건이 어긋나면
   * 그 사고가 "멤버 0명이라 아무도 글을 못 쓰는 동호회"라는 조용한 형태로
   * 나타나기 때문이다 — 개설 직후에는 아무도 눈치채지 못한다.
   */
  if not exists (
    select 1 from public.community_members
    where board_id = v_id and employee_id = v_me
  ) then
    insert into public.community_members (board_id, employee_id) values (v_id, v_me);
  end if;

  return v_id;
end $$;

revoke all on function public.create_community(text, text) from public;
grant execute on function public.create_community(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 9. 보관 / 보관 해제 (스펙 16 · 3.3) — 시스템 관리자 전용
--
-- deleteBoard()는 글이 1건이라도 있으면 삭제를 거부한다(cascade 사고 방지).
-- 그 원칙을 깨지 않으면서 부적절한 동호회를 즉시 내리기 위한 경로다.
-- ---------------------------------------------------------------------
create or replace function public.archive_community(p_board_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archived_at timestamptz;
begin
  if not public.is_system_admin() then
    raise exception '동호회 보관은 시스템 관리자만 할 수 있습니다';
  end if;

  -- 이미 보관된 것을 다시 눌러도 처음 내린 시각을 덮어쓰지 않는다
  update public.boards
     set archived_at = coalesce(archived_at, now())
   where id = p_board_id
     and board_type = 'community'
  returning archived_at into v_archived_at;

  if not found then
    raise exception '동호회를 찾을 수 없습니다';
  end if;

  return v_archived_at;
end $$;

revoke all on function public.archive_community(uuid) from public;
grant execute on function public.archive_community(uuid) to authenticated;

create or replace function public.unarchive_community(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if not public.is_system_admin() then
    raise exception '동호회 보관 해제는 시스템 관리자만 할 수 있습니다';
  end if;

  select name into v_name
    from public.boards
   where id = p_board_id
     and board_type = 'community';

  if v_name is null then
    raise exception '동호회를 찾을 수 없습니다';
  end if;

  /*
   * 보관해 둔 사이에 같은 이름의 동호회가 새로 만들어질 수 있다 —
   * create_community()의 중복 검사가 보관본을 세지 않기 때문이다(그 전제로
   * 이름 재사용을 허용했다). 그대로 되돌리면 목록에 이름이 같은 카드가 두 장
   * 뜬다. boards_community_name_uniq가 최종 관문이지만, 그쪽에 맡기면
   * 관리자에게 unique 위반의 날것 메시지가 그대로 노출된다.
   */
  if exists (
    select 1 from public.boards
    where board_type = 'community'
      and archived_at is null
      and id <> p_board_id
      and lower(btrim(name)) = lower(btrim(v_name))
  ) then
    raise exception '같은 이름의 동호회가 운영 중이라 복구할 수 없습니다';
  end if;

  update public.boards
     set archived_at = null
   where id = p_board_id
     and board_type = 'community';
end $$;

revoke all on function public.unarchive_community(uuid) from public;
grant execute on function public.unarchive_community(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 10. posts_update의 board_id 구멍 (파일 머리 주석 2번)
--
-- 원본 정책:
--   with check (author_id = current_employee_id() or is_system_admin())
-- board_id를 전혀 보지 않는다. 그래서 자유게시판에 글을 쓴 뒤 board_id만
-- 바꾸면 posts_insert의 can_post_to_board() 검사를 통째로 우회한다.
--
-- WITH CHECK에 can_post_to_board(board_id)를 얹는 방법은 일부러 쓰지 않았다.
-- "쓸 수 있는가"와 "고칠 수 있는가"는 다른 규칙이라서, 그렇게 하면 팀장에서
-- 내려온 사람이 예전에 쓴 공지의 오타를 못 고치고 보관된 동호회의 글도
-- 작성자가 손댈 수 없게 된다. 실제로 막아야 하는 건 board_id 변경 자체다 —
-- 앱에는 글을 다른 게시판으로 옮기는 기능이 없다(updatePost는 board_id를
-- 아예 보내지 않는다).
--
-- INSERT는 posts_insert 정책의 can_post_to_board()가 이미 지키므로
-- 이 트리거는 UPDATE만 본다. 같은 구멍이 comments에도 있어서 아래 12장에
-- 같은 모양의 가드를 한 벌 더 건다(reactions·post_attachments·post_reads·
-- community_members는 UPDATE 정책 자체가 없어 갱신 경로가 닫혀 있다).
-- ---------------------------------------------------------------------
create or replace function public.posts_guard_board_id()
returns trigger
language plpgsql
-- SECURITY INVOKER를 명시한다. definer면 current_user가 소유자로 바뀌어
-- 아래 우회 분기가 항상 참이 된다(마이그레이션 12에서 실제로 겪은 함정).
security invoker
set search_path = public
as $$
begin
  -- 시딩·관리 스크립트(service_role)와 SECURITY DEFINER 함수 안의 갱신은 통과
  if current_user in ('postgres','supabase_admin','service_role')
     or auth.uid() is null then
    return new;
  end if;

  if new.board_id is distinct from old.board_id then
    raise exception '글을 다른 게시판으로 옮길 수 없습니다';
  end if;

  return new;
end $$;

drop trigger if exists posts_guard_board_id on public.posts;
create trigger posts_guard_board_id
  before update on public.posts
  for each row execute function public.posts_guard_board_id();

-- ---------------------------------------------------------------------
-- 11. 댓글·반응도 같은 문을 쓴다
--
-- 글쓰기만 막고 댓글을 열어두면 비가입자가 동호회 글에 그대로 끼어들고,
-- 보관된 동호회도 댓글로는 계속 살아 있다. 두 정책 모두 community가 아니면
-- true로 떨어지므로 공지·자유게시판의 기존 동작은 그대로다.
-- ---------------------------------------------------------------------
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
  for insert to authenticated
  with check (
    author_id = public.current_employee_id()
    and public.can_comment_on_post(post_id)
  );

drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions
  for insert to authenticated
  with check (
    employee_id = public.current_employee_id()
    and public.can_comment_on_post(post_id)
  );

-- ---------------------------------------------------------------------
-- 12. comments.post_id 가드 — 위 comments_insert를 우회하는 자리
--
-- 마이그레이션 09의 comments_update는 author_id만 본다(using/with check 모두
-- author_id = current_employee_id()). 그래서 자유게시판 글에 댓글을 하나 단 뒤
-- post_id만 남의 동호회 글로 바꿔치기하면, 위에서 얹은 can_comment_on_post()
-- 검사를 통째로 우회해 비가입자 댓글이 동호회 글에 그대로 붙는다. 보관된
-- 동호회도 같은 방법으로 계속 댓글을 받는다 — 화면은 "받지 않습니다"라고
-- 말하는데 실제로는 받는 상태다.
--
-- posts와 같은 이유로 정책이 아니라 트리거로 막는다: 댓글을 다른 글로 옮기는
-- 기능은 앱에 없고(updateComment 자체가 없다), WITH CHECK에 판정 함수를
-- 얹으면 탈퇴·보관 뒤에 작성자가 자기 댓글의 오타를 못 고치게 된다.
-- ---------------------------------------------------------------------
create or replace function public.comments_guard_post_id()
returns trigger
language plpgsql
-- posts_guard_board_id()와 같은 이유로 SECURITY INVOKER를 명시한다
security invoker
set search_path = public
as $$
begin
  if current_user in ('postgres','supabase_admin','service_role')
     or auth.uid() is null then
    return new;
  end if;

  if new.post_id is distinct from old.post_id then
    raise exception '댓글을 다른 글로 옮길 수 없습니다';
  end if;

  return new;
end $$;

drop trigger if exists comments_guard_post_id on public.comments;
create trigger comments_guard_post_id
  before update on public.comments
  for each row execute function public.comments_guard_post_id();

-- ---------------------------------------------------------------------
-- 13. 동호회 목록 — 카드 한 장에 필요한 값을 한 번에 준다
--
-- 목록 화면은 동호회마다 (멤버수, 내 가입 여부, 글 수)가 필요하다.
-- PostgREST 임베드로는 community_members(count)와 "내 가입 여부"를 한 질의로
-- 못 받아서 화면이 동호회 수만큼 질의를 더 쏘게 된다.
-- ---------------------------------------------------------------------
create or replace function public.list_communities(p_include_archived boolean default false)
returns table (
  id uuid,
  name text,
  description text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz,
  archived_at timestamptz,
  member_count int,
  post_count int,
  is_member boolean
)
language sql
stable
set search_path = public
as $$
  select
    b.id,
    b.name,
    b.description,
    b.created_by,
    e.name,
    b.created_at,
    b.archived_at,
    (select count(*) from public.community_members m where m.board_id = b.id)::int,
    (select count(*) from public.posts p where p.board_id = b.id)::int,
    public.is_community_member(b.id)
  from public.boards b
  left join public.employees e on e.id = b.created_by
  where b.board_type = 'community'
    and (p_include_archived or b.archived_at is null)
  order by (b.archived_at is not null), b.sort_order, b.name;
$$;

revoke all on function public.list_communities(boolean) from public;
grant execute on function public.list_communities(boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 14. 멤버 명단 — 상세 상단 (스펙 16 · 3.2)
-- ---------------------------------------------------------------------
create or replace function public.community_member_list(p_board_id uuid)
returns table (
  employee_id uuid,
  employee_name text,
  -- position은 Postgres 예약어라 RETURNS TABLE의 컬럼명으로 쓸 수 없다(문법 오류)
  employee_position text,
  department_name text,
  profile_image_url text,
  joined_at timestamptz,
  is_owner boolean
)
language sql
stable
set search_path = public
as $$
  select
    e.id,
    e.name,
    e.position,
    d.name,
    e.profile_image_url,
    m.joined_at,
    (b.created_by = e.id)
  from public.community_members m
  join public.boards b on b.id = m.board_id
  join public.employees e on e.id = m.employee_id
  left join public.departments d on d.id = e.department_id
  where m.board_id = p_board_id
  -- 개설자를 맨 위로, 나머지는 가입 순
  order by (b.created_by = e.id) desc, m.joined_at, e.name;
$$;

revoke all on function public.community_member_list(uuid) from public;
grant execute on function public.community_member_list(uuid) to authenticated;

comment on table public.community_members is
  '동호회 가입 명단. 가입 승인제는 스펙 16 · 6장에서 명시적으로 미룬 항목이다(누구나 자유 가입).';
