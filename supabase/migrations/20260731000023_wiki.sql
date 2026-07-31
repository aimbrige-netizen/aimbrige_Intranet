-- =====================================================================
-- 마이그레이션 23 — 스펙 14 위키
--
--   wiki_pages           문서 (상위/하위 계층)
--   wiki_page_revisions  저장할 때마다 남기는 이전 버전 스냅샷
--
-- 저장은 함수로 한다. "이전 내용을 스냅샷으로 남기고 본문을 갱신"은 두 문장인데
-- PostgREST로 이어 쏘면 사이에서 끊겼을 때 스냅샷 없이 내용만 바뀌거나,
-- 스냅샷만 쌓이고 본문은 그대로인 상태가 남는다. 수정 이력이 본체인 모듈에서
-- 그건 기능이 없는 것과 같다.
-- =====================================================================

create table if not exists public.wiki_pages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null default '',
  /*
   * 상위 문서가 지워지면 하위는 최상위로 올라온다.
   * cascade면 상위 하나를 지울 때 그 아래 문서가 통째로 사라지는데,
   * 회사 위키에서 그건 사고다 — 지운 사람도 무엇이 같이 사라졌는지 모른다.
   */
  parent_id uuid references public.wiki_pages(id) on delete set null,
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wiki_pages_title_not_blank check (btrim(title) <> ''),
  -- 자기 자신을 상위로 두면 트리를 그리는 쪽이 무한히 돈다
  constraint wiki_pages_no_self_parent check (parent_id is null or parent_id <> id)
);

create index if not exists wiki_pages_parent_idx
  on public.wiki_pages (parent_id, title);
create index if not exists wiki_pages_updated_idx
  on public.wiki_pages (updated_at desc);

alter table public.wiki_pages enable row level security;

/*
 * 회사 위키는 누구나 읽고 누구나 기여한다(스펙 4장).
 * 삭제만 관리자다 — 잘못 쓴 문서는 고치면 되지만, 지운 문서는 되돌릴 방법이 없다.
 */
drop policy if exists wiki_pages_select on public.wiki_pages;
create policy wiki_pages_select on public.wiki_pages
  for select to authenticated using (true);

/*
 * INSERT·UPDATE 정책을 두지 않는다 — 쓰기는 save_wiki_page()만 한다.
 *
 * 처음엔 update 정책을 using(true)로 열어뒀는데, 그러면 함수를 만든 이유가
 * 통째로 사라진다. PostgREST로 wiki_pages를 직접 갱신하면
 * (updated_by만 자기 id로 맞추면 통과) 본문은 바뀌는데 wiki_page_revisions에는
 * 아무 흔적도 안 남는다. 스냅샷은 트리거가 아니라 함수 안의 명령문이라
 * 그 경로에서는 실행되지 않는다.
 *
 * 수정 이력이 본체인 모듈에서 "이력 없이 내용만 바뀐 문서"는 기능이 없는 것과
 * 같다. 그래서 통로를 하나만 남긴다.
 */

drop policy if exists wiki_pages_insert on public.wiki_pages;
drop policy if exists wiki_pages_update on public.wiki_pages;

drop policy if exists wiki_pages_delete on public.wiki_pages;
create policy wiki_pages_delete on public.wiki_pages
  for delete to authenticated using (public.is_system_admin());

-- ---------------------------------------------------------------------
-- 수정 이력
--
-- 한 번 쌓인 스냅샷은 아무도 못 고친다. 고칠 수 있으면 이력이 아니다 —
-- "누가 언제 무엇을 바꿨는가"의 근거로 쓸 수 없게 된다.
-- ---------------------------------------------------------------------
create table if not exists public.wiki_page_revisions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.wiki_pages(id) on delete cascade,
  title text not null,
  content text not null default '',
  edited_by uuid references public.employees(id) on delete set null,
  edited_at timestamptz not null default now()
);

create index if not exists wiki_revisions_page_idx
  on public.wiki_page_revisions (page_id, edited_at desc);

alter table public.wiki_page_revisions enable row level security;

drop policy if exists wiki_revisions_select on public.wiki_page_revisions;
create policy wiki_revisions_select on public.wiki_page_revisions
  for select to authenticated using (true);

/*
 * INSERT·UPDATE·DELETE 정책을 두지 않는다.
 * 스냅샷은 save_wiki_page() 함수만 남긴다 — 직접 쓸 수 있으면 있지도 않았던
 * 버전을 만들어 넣거나 불리한 버전을 지울 수 있다.
 */

drop trigger if exists wiki_pages_touch_updated_at on public.wiki_pages;
create trigger wiki_pages_touch_updated_at
  before update on public.wiki_pages
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 순환 참조 방어
--
-- CHECK로는 자기 자신만 막을 수 있다. A→B, B→A 처럼 두 단계 이상 돌아오는
-- 경우는 행 하나만 봐서는 알 수 없어서 트리거로 조상 사슬을 거슬러 올라간다.
-- 순환이 생기면 트리를 그리는 화면이 무한히 돌거나 문서 일부가 통째로
-- 화면에서 사라진다(어느 쪽이든 원인을 찾기 어렵다).
-- ---------------------------------------------------------------------
create or replace function public.guard_wiki_cycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ancestor uuid := new.parent_id;
  v_depth int := 0;
begin
  while v_ancestor is not null loop
    if v_ancestor = new.id then
      raise exception '상위 문서를 자기 하위 문서로 지정할 수 없습니다';
    end if;

    v_depth := v_depth + 1;
    -- 이미 순환이 있는 데이터를 만나도 여기서 멈춘다(무한 루프 방지)
    if v_depth > 50 then
      raise exception '문서 계층이 너무 깊습니다';
    end if;

    select parent_id into v_ancestor from public.wiki_pages where id = v_ancestor;
  end loop;

  return new;
end;
$$;

drop trigger if exists wiki_pages_guard_cycle on public.wiki_pages;
create trigger wiki_pages_guard_cycle
  before insert or update of parent_id on public.wiki_pages
  for each row when (new.parent_id is not null)
  execute function public.guard_wiki_cycle();

-- ---------------------------------------------------------------------
-- 저장 — 스냅샷과 갱신을 한 트랜잭션에 묶는다 (스펙 3.3)
--
-- 스냅샷은 "저장 직전의 내용"이다. 새로 저장한 내용이 아니라 덮어쓰기 전
-- 버전을 남겨야, 이력 목록이 "이 문서가 이렇게 생겼던 시점들"이 된다.
-- ---------------------------------------------------------------------
create or replace function public.save_wiki_page(
  p_page_id uuid,
  p_title text,
  p_content text,
  p_parent_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_employee_id();
  v_old record;
begin
  if v_me is null then
    raise exception '로그인이 필요합니다';
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    raise exception '제목을 입력하세요';
  end if;

  if p_page_id is null then
    insert into public.wiki_pages (title, content, parent_id, created_by, updated_by)
    values (btrim(p_title), coalesce(p_content, ''), p_parent_id, v_me, v_me)
    returning id into p_page_id;
    return p_page_id;
  end if;

  select title, content into v_old
  from public.wiki_pages
  where id = p_page_id
  for update;

  -- record 변수는 행이 없어도 null이 아니라 필드가 전부 null인 상태다.
  -- found를 봐야 "행이 없었다"를 정확히 판정할 수 있다.
  if not found then
    raise exception '문서를 찾을 수 없습니다';
  end if;

  -- 덮어쓰기 전 버전을 먼저 남긴다
  insert into public.wiki_page_revisions (page_id, title, content, edited_by)
  values (p_page_id, v_old.title, v_old.content, v_me);

  update public.wiki_pages
     set title = btrim(p_title),
         content = coalesce(p_content, ''),
         parent_id = p_parent_id,
         updated_by = v_me
   where id = p_page_id;

  return p_page_id;
end;
$$;

revoke all on function public.save_wiki_page(uuid, text, text, uuid) from public;
grant execute on function public.save_wiki_page(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- LIKE 특수문자 이스케이프
--
-- 검색어에 들어온 %와 _는 사용자가 친 글자지 와일드카드가 아니다.
-- ---------------------------------------------------------------------
create or replace function public.like_escape(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(replace(replace(coalesce(p_text, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

grant execute on function public.like_escape(text) to authenticated;

-- ---------------------------------------------------------------------
-- 통합검색 (스펙 3.1)
--
-- 제목과 본문을 함께 본다. PostgREST의 or(ilike)로도 되지만, 본문이 길어지면
-- 매칭된 주변 몇 줄을 함께 보여줘야 어느 문서인지 판단할 수 있어서 함수로 뺐다.
-- ---------------------------------------------------------------------
create or replace function public.search_wiki(p_query text)
returns table (
  id uuid,
  title text,
  parent_id uuid,
  updated_at timestamptz,
  updated_by_name text,
  /** 검색어 주변 발췌. 제목만 맞으면 본문 앞부분을 준다 */
  snippet text
)
language sql
stable
set search_path = public
as $$
  select
    p.id,
    p.title,
    p.parent_id,
    p.updated_at,
    e.name,
    case
      when position(lower(p_query) in lower(p.content)) > 0 then
        '…' || substr(
          p.content,
          greatest(position(lower(p_query) in lower(p.content)) - 40, 1),
          160
        ) || '…'
      else left(p.content, 160)
    end
  from public.wiki_pages p
  left join public.employees e on e.id = p.updated_by
  where btrim(coalesce(p_query, '')) <> ''
    /*
     * 검색어의 % 와 _ 를 이스케이프한다. 안 하면 사용자가 친 글자가 LIKE
     * 와일드카드로 해석돼 "50%_할인"이 엉뚱한 문서를 끌어온다.
     * 백슬래시를 먼저 바꿔야 뒤 치환이 만든 이스케이프까지 이중으로 먹지 않는다.
     */
    and (
      p.title ilike '%' || public.like_escape(p_query) || '%' escape '\'
      or p.content ilike '%' || public.like_escape(p_query) || '%' escape '\'
    )
  order by
    -- 제목이 맞은 문서가 먼저다. 본문에 한 번 스친 문서보다 정확할 확률이 높다
    (p.title ilike '%' || public.like_escape(p_query) || '%' escape '\') desc,
    p.updated_at desc
  limit 50;
$$;

revoke all on function public.search_wiki(text) from public;
grant execute on function public.search_wiki(text) to authenticated;

-- ---------------------------------------------------------------------
-- 트리 조회 — 본문 없이 목록만
--
-- 트리에 본문까지 실어 보내면 문서가 200개일 때 응답이 수 MB가 된다.
-- 화면에 필요한 건 제목·계층·수정정보뿐이다.
-- ---------------------------------------------------------------------
create or replace function public.list_wiki_pages()
returns table (
  id uuid,
  title text,
  parent_id uuid,
  updated_at timestamptz,
  updated_by_name text,
  child_count int
)
language sql
stable
set search_path = public
as $$
  select
    p.id,
    p.title,
    p.parent_id,
    p.updated_at,
    e.name,
    (select count(*) from public.wiki_pages c where c.parent_id = p.id)::int
  from public.wiki_pages p
  left join public.employees e on e.id = p.updated_by
  order by p.title;
$$;

revoke all on function public.list_wiki_pages() from public;
grant execute on function public.list_wiki_pages() to authenticated;
