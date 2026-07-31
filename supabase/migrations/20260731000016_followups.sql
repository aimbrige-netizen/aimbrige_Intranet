-- =====================================================================
-- 마이그레이션 16 — 후속 과제 (조회수 중복·감사로그 검색·참석 응답)
--
-- 1. 게시글 조회수가 새로고침마다 +1 되던 것 → 사람·날짜 단위로 묶는다
-- 2. 감사 로그를 행위자 이름으로 찾을 수 없던 것 → 조인 결과를 RPC로 연다
-- 3. 캘린더 참석자가 "누가 오는가"만 말하고 "온다고 했는가"를 못 하던 것
--
-- 3번은 expand-contract로 간다. 이 마이그레이션은 event_attendees를 만들고
-- 기존 배열을 옮겨 담되 attendee_ids를 **남겨둔다**. 코드가 새 테이블로 옮겨간
-- 뒤 별도 마이그레이션에서 지운다 — 지금 지우면 배포 사이에 화면이 깨진다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 조회수 — 같은 사람이 같은 날 여러 번 봐도 1회
-- ---------------------------------------------------------------------
create table if not exists public.post_view_logs (
  post_id uuid not null references public.posts(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  -- 서울 기준 날짜. 자정을 넘기면 다시 1회로 센다
  viewed_on date not null,
  primary key (post_id, employee_id, viewed_on)
);

comment on table public.post_view_logs is
  '조회수 중복 제거용. 총 조회 횟수가 아니라 "사람·날짜 단위 조회"를 센다. '
  'post_reads(누가 읽었나 — 공지 열람률)와는 다른 목적이다.';

alter table public.post_view_logs enable row level security;

-- 본인 기록만 보인다. 쓰기는 SECURITY DEFINER 함수만 한다
drop policy if exists post_view_logs_select on public.post_view_logs;
create policy post_view_logs_select on public.post_view_logs
  for select to authenticated
  using (employee_id = public.current_employee_id());

create or replace function public.increment_post_view(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer uuid := public.current_employee_id();
  today date := (now() at time zone 'Asia/Seoul')::date;
  is_author boolean;
  first_today boolean;
begin
  if viewer is null then
    return;
  end if;

  select author_id = viewer into is_author
  from public.posts where id = p_post_id;

  -- 글이 없거나 본인 글이면 세지 않는다
  if is_author is null or is_author then
    return;
  end if;

  insert into public.post_view_logs (post_id, employee_id, viewed_on)
  values (p_post_id, viewer, today)
  on conflict do nothing;

  get diagnostics first_today = row_count;

  if first_today then
    update public.posts
    set view_count = view_count + 1
    where id = p_post_id;
  end if;
end;
$$;

revoke all on function public.increment_post_view(uuid) from public;
grant execute on function public.increment_post_view(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. 감사 로그 — 행위자 이름으로 검색
--
-- audit_logs에는 actor_id만 있고 이름은 employees 조인 컬럼이라
-- PostgREST의 or(ilike)를 걸 수 없었다. 그래서 "이 사람이 한 일 전부"를
-- 이름으로 찾는 경로가 화면에 아예 없었다.
--
-- total_count를 모든 행에 실어 보내 페이지네이션을 한 번의 호출로 끝낸다.
-- ---------------------------------------------------------------------
create or replace function public.list_audit_logs(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_action text default null,
  p_q text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  actor_id uuid,
  actor_name text,
  actor_email text,
  action text,
  target_id uuid,
  detail jsonb,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  keyword text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not public.is_system_admin() then
    raise exception '감사 로그 조회 권한이 없습니다.';
  end if;

  return query
  with filtered as (
    select
      l.id, l.actor_id, e.name as actor_name, e.email as actor_email,
      l.action, l.target_id, l.detail, l.created_at
    from public.audit_logs l
    left join public.employees e on e.id = l.actor_id
    where (p_from is null or l.created_at >= p_from)
      and (p_to is null or l.created_at < p_to)
      and (p_action is null or l.action = p_action)
      and (
        keyword is null
        or e.name ilike '%' || keyword || '%'
        or e.email ilike '%' || keyword || '%'
        or l.action ilike '%' || keyword || '%'
      )
  )
  select f.*, count(*) over () as total_count
  from filtered f
  order by f.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.list_audit_logs(timestamptz, timestamptz, text, text, int, int) from public;
grant execute on function public.list_audit_logs(timestamptz, timestamptz, text, text, int, int) to authenticated;

/** 액션별 건수 — 필터 칩의 분모 */
create or replace function public.audit_action_counts(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (action text, count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    raise exception '감사 로그 조회 권한이 없습니다.';
  end if;

  return query
  select l.action, count(*)::bigint
  from public.audit_logs l
  where (p_from is null or l.created_at >= p_from)
    and (p_to is null or l.created_at < p_to)
  group by l.action
  order by count(*) desc;
end;
$$;

revoke all on function public.audit_action_counts(timestamptz, timestamptz) from public;
grant execute on function public.audit_action_counts(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 3. 참석 응답 — attendee_ids 배열을 테이블로 승격
--
-- 배열은 "누가 오는가"까지만 담는다. 수락/거절/미정을 담으려면 행이 필요하다.
-- 마이그레이션 13의 컬럼 주석에 적어둔 계획대로다.
-- ---------------------------------------------------------------------
create table if not exists public.event_attendees (
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  response text not null default 'pending'
    check (response in ('pending', 'accepted', 'declined', 'tentative')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (event_id, employee_id)
);

create index if not exists event_attendees_employee_idx
  on public.event_attendees (employee_id);

-- 기존 배열을 옮겨 담는다 (여러 번 실행해도 안전)
insert into public.event_attendees (event_id, employee_id)
select e.id, a.employee_id
from public.calendar_events e
cross join lateral unnest(e.attendee_ids) as a(employee_id)
on conflict do nothing;

alter table public.event_attendees enable row level security;

/**
 * 일정 열람 권한 판정.
 * SECURITY DEFINER로 두는 이유: event_attendees 정책 안에서 calendar_events를
 * 직접 조회하면 그쪽 RLS가 다시 이 테이블을 참조해 상호 재귀가 된다.
 * (마이그레이션 11에서 결재 모듈이 같은 문제로 통째로 멈춘 적이 있다)
 */
create or replace function public.can_view_event(p_event_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.calendar_events e
    where e.id = p_event_id
      and (
        e.owner_id = public.current_employee_id()
        or e.visibility = 'company'
        or (e.visibility = 'team' and public.is_my_team(e.team_id))
        or public.is_system_admin()
      )
  );
$$;

revoke all on function public.can_view_event(uuid) from public;
grant execute on function public.can_view_event(uuid) to authenticated;

/** 이 일정의 참석자인가 — calendar_events 정책에서 쓴다 */
create or replace function public.is_event_attendee(p_event_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.event_attendees a
    where a.event_id = p_event_id
      and a.employee_id = public.current_employee_id()
  );
$$;

revoke all on function public.is_event_attendee(uuid) from public;
grant execute on function public.is_event_attendee(uuid) to authenticated;

drop policy if exists event_attendees_select on public.event_attendees;
create policy event_attendees_select on public.event_attendees
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.can_view_event(event_id)
  );

/** 참석자 목록 편집은 일정 주인(과 관리자)만 */
drop policy if exists event_attendees_write on public.event_attendees;
create policy event_attendees_write on public.event_attendees
  for all to authenticated
  using (
    public.is_system_admin()
    or exists (
      select 1 from public.calendar_events e
      where e.id = event_id and e.owner_id = public.current_employee_id()
    )
  )
  with check (
    public.is_system_admin()
    or exists (
      select 1 from public.calendar_events e
      where e.id = event_id and e.owner_id = public.current_employee_id()
    )
  );

/**
 * 참석 응답 — 본인 것만 바꿀 수 있다.
 * UPDATE 정책 대신 함수로 여는 이유: 정책으로 열면 response 말고
 * event_id·employee_id까지 바꿀 수 있어 남의 행을 자기 것으로 만들 수 있다.
 */
create or replace function public.respond_to_event(
  p_event_id uuid,
  p_response text
)
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
  if p_response not in ('pending', 'accepted', 'declined', 'tentative') then
    raise exception '알 수 없는 응답입니다.';
  end if;

  update public.event_attendees
  set response = p_response,
      responded_at = now()
  where event_id = p_event_id and employee_id = me;

  if not found then
    raise exception '이 일정의 참석자가 아닙니다.';
  end if;
end;
$$;

revoke all on function public.respond_to_event(uuid, text) from public;
grant execute on function public.respond_to_event(uuid, text) to authenticated;

-- calendar_events 열람 정책을 새 테이블 기준으로도 열어 둔다.
-- attendee_ids 조건을 남겨두는 건 expand-contract 중이기 때문 —
-- 코드가 옮겨간 뒤 별도 마이그레이션에서 배열과 함께 지운다.
drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
  for select to authenticated
  using (
    owner_id = public.current_employee_id()
    or visibility = 'company'
    or (visibility = 'team' and public.is_my_team(team_id))
    or public.current_employee_id() = any (attendee_ids)
    or public.is_event_attendee(id)
    or public.is_system_admin()
  );
