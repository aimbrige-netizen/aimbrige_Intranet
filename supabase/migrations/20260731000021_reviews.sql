-- =====================================================================
-- 마이그레이션 21 — 스펙 12 업무평가
--
--   review_cycles  반기 평가 사이클 (관리자가 생성·단계 전환)
--   review_goals   사이클별 목표 (본인 작성 → 팀장 승인)
--   reviews        자기평가 + 팀장평가 (사이클×직원 1행)
--
-- 스펙 4장 스키마에서 한 가지를 더한다: reviews.goals_submitted_at.
-- 스펙 3.2의 흐름이 "목표 여러 개 등록 → 제출 → 팀장 승인 대기"인데,
-- 제출 시각을 담을 자리가 어디에도 없어서 팀장 화면에서 "아직 작성 중"과
-- "제출 완료"를 구분할 수 없다. 제출은 목표 하나가 아니라 그 사람의 목표
-- 묶음 전체에 대한 행위라 사이클×직원 행(reviews)에 둔다.
-- 승인은 스펙대로 목표별(review_goals.approved_by)로 남겨, 팀장이 일부만
-- 승인하는 경우를 표현할 수 있게 한다.
--
-- 권한 헬퍼는 기존 것을 그대로 쓴다 —
-- current_employee_id()/is_system_admin()(01), manages_employee()(06),
-- is_manager_or_admin()(19).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 평가 사이클
-- ---------------------------------------------------------------------
create table if not exists public.review_cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date,
  end_date date,
  status text not null default 'goal_setting'
    check (status in ('goal_setting', 'in_progress', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_cycles_name_not_blank check (btrim(name) <> ''),
  -- 기간이 거꾸로면 "해당 기간 업무일지" 사이드패널이 늘 빈다
  constraint review_cycles_period_order
    check (start_date is null or end_date is null or start_date <= end_date)
);

create index if not exists review_cycles_status_idx
  on public.review_cycles (status, start_date desc);

alter table public.review_cycles enable row level security;

-- 전 직원이 사이클을 봐야 자기 평가 화면에 들어올 수 있다
drop policy if exists review_cycles_select on public.review_cycles;
create policy review_cycles_select on public.review_cycles
  for select to authenticated using (true);

drop policy if exists review_cycles_write on public.review_cycles;
create policy review_cycles_write on public.review_cycles
  for all to authenticated
  using (public.is_system_admin())
  with check (public.is_system_admin());

-- ---------------------------------------------------------------------
-- 2. 자기평가 · 팀장평가
--    review_goals가 이 행을 참조하므로 먼저 만든다.
-- ---------------------------------------------------------------------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.review_cycles(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  -- 목표 묶음 제출 시각 (스펙 4장에 없지만 3.2 흐름에 필요 — 위 주석 참고)
  goals_submitted_at timestamptz,
  self_review text,
  self_submitted_at timestamptz,
  manager_review text,
  manager_id uuid references public.employees(id) on delete set null,
  manager_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, employee_id),
  -- 제출했는데 내용이 비어 있으면 "제출 완료"가 거짓말이 된다
  constraint reviews_self_submitted_has_content
    check (self_submitted_at is null or btrim(coalesce(self_review, '')) <> ''),
  constraint reviews_manager_submitted_has_content
    check (manager_submitted_at is null or btrim(coalesce(manager_review, '')) <> ''),
  -- 누가 평가했는지 없이 "팀장평가 완료"로 남으면 나중에 추적이 안 된다
  constraint reviews_manager_submitted_has_author
    check (manager_submitted_at is null or manager_id is not null)
);

create index if not exists reviews_employee_idx
  on public.reviews (employee_id, cycle_id);
create index if not exists reviews_cycle_idx
  on public.reviews (cycle_id);

alter table public.reviews enable row level security;

drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.manages_employee(employee_id)
    or public.is_system_admin()
  );

/*
 * 팀장도 INSERT를 할 수 있어야 한다. 팀원이 자기평가를 한 번도 저장하지
 * 않으면 행 자체가 없는데, 그 경우에도 팀장평가는 쓸 수 있어야 한다
 * (평가를 안 썼다는 사실 자체가 평가 대상이다).
 */
drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    employee_id = public.current_employee_id()
    or public.manages_employee(employee_id)
    or public.is_system_admin()
  );

drop policy if exists reviews_update on public.reviews;
create policy reviews_update on public.reviews
  for update to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.manages_employee(employee_id)
    or public.is_system_admin()
  )
  with check (
    employee_id = public.current_employee_id()
    or public.manages_employee(employee_id)
    or public.is_system_admin()
  );

-- 삭제는 관리자만. 평가는 지워지면 복구할 근거가 없다
drop policy if exists reviews_delete on public.reviews;
create policy reviews_delete on public.reviews
  for delete to authenticated using (public.is_system_admin());

/*
 * 열 단위 방어선.
 *
 * RLS는 행 단위라 "팀장은 이 행을 고칠 수 있다"까지만 말할 수 있고,
 * "단 self_review는 빼고"는 말하지 못한다. 정책만 두면 팀장이 팀원의
 * 자기평가를 갈아치울 수 있고, 반대로 본인이 자기 팀장평가를 써넣을 수 있다.
 * 평가 자료로서 의미가 사라지는 구멍이라 트리거로 막는다.
 *
 * ⚠ INSERT에도 반드시 걸어야 한다.
 * 이 화면들은 upsert(on conflict do update)로 쓰는데, 그 행이 처음 만들어지는
 * 순간은 conflict가 없어서 순수 INSERT다. update에만 트리거를 걸면 첫 쓰기가
 * 통째로 무방비가 된다 — 본인이 자기 manager_submitted_at을 채워 "팀장평가
 * 완료"를 위조하거나, 팀장이 팀원의 self_review를 대신 써서 제출 상태로
 * 못박아 버릴 수 있다(그 뒤에는 잠금 규칙이 본인의 수정까지 막는다).
 * 근태에서 같은 실수를 한 적이 있다(마이그레이션 08 → 12에서 수정).
 *
 * 제출 후 잠금(스펙 3.2 "제출 후에는 수정 불가")도 여기서 건다.
 * 관리자는 예외다 — 잘못 제출한 것을 되돌릴 사람이 아무도 없으면
 * 사이클 하나가 통째로 막힌다.
 */
create or replace function public.guard_review_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.current_employee_id();
begin
  if public.is_system_admin() then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    if new.employee_id = me then
      -- 본인이 만드는 행에는 팀장평가 칸이 비어 있어야 한다
      if new.manager_review is not null
         or new.manager_id is not null
         or new.manager_submitted_at is not null then
        raise exception '본인은 팀장평가를 작성할 수 없습니다';
      end if;
    elsif public.manages_employee(new.employee_id) then
      if new.self_review is not null
         or new.self_submitted_at is not null
         or new.goals_submitted_at is not null then
        raise exception '팀장은 팀원의 자기평가·목표 제출을 작성할 수 없습니다';
      end if;
      -- 남의 이름으로 평가 기록을 남길 수 없다
      if new.manager_id is not null and new.manager_id <> me then
        raise exception '팀장평가 작성자는 본인만 지정할 수 있습니다';
      end if;
    end if;
    return new;
  end if;

  -- 소속을 옮겨 남의 평가에 붙이는 것을 막는다
  if new.employee_id is distinct from old.employee_id
     or new.cycle_id is distinct from old.cycle_id then
    raise exception '평가의 대상자와 사이클은 변경할 수 없습니다';
  end if;

  if old.employee_id = me then
    if new.manager_review is distinct from old.manager_review
       or new.manager_id is distinct from old.manager_id
       or new.manager_submitted_at is distinct from old.manager_submitted_at then
      raise exception '본인은 팀장평가를 수정할 수 없습니다';
    end if;

    if old.self_submitted_at is not null
       and (new.self_review is distinct from old.self_review
            or new.self_submitted_at is distinct from old.self_submitted_at) then
      raise exception '이미 제출한 자기평가는 수정할 수 없습니다';
    end if;

    if old.goals_submitted_at is not null
       and new.goals_submitted_at is distinct from old.goals_submitted_at then
      raise exception '이미 제출한 목표는 다시 제출할 수 없습니다';
    end if;

  elsif public.manages_employee(old.employee_id) then
    if new.self_review is distinct from old.self_review
       or new.self_submitted_at is distinct from old.self_submitted_at
       or new.goals_submitted_at is distinct from old.goals_submitted_at then
      raise exception '팀장은 팀원의 자기평가·목표 제출을 수정할 수 없습니다';
    end if;

    if new.manager_id is not null and new.manager_id <> me then
      raise exception '팀장평가 작성자는 본인만 지정할 수 있습니다';
    end if;

    if old.manager_submitted_at is not null then
      raise exception '이미 제출한 팀장평가는 수정할 수 없습니다';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists reviews_guard_columns on public.reviews;
create trigger reviews_guard_columns
  before insert or update on public.reviews
  for each row execute function public.guard_review_columns();

drop trigger if exists reviews_touch_updated_at on public.reviews;
create trigger reviews_touch_updated_at
  before update on public.reviews
  for each row execute function public.touch_updated_at();

drop trigger if exists review_cycles_touch_updated_at on public.review_cycles;
create trigger review_cycles_touch_updated_at
  before update on public.review_cycles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. 사이클별 목표
-- ---------------------------------------------------------------------
create table if not exists public.review_goals (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.review_cycles(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  content text not null,
  sort_order int not null default 0,
  approved_by uuid references public.employees(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_goals_content_not_blank check (btrim(content) <> ''),
  -- 승인자 없이 승인 시각만 남으면 누가 승인했는지 알 수 없다
  constraint review_goals_approved_consistent
    check ((approved_by is null and approved_at is null)
        or (approved_by is not null and approved_at is not null))
);

create index if not exists review_goals_cycle_employee_idx
  on public.review_goals (cycle_id, employee_id, sort_order);

alter table public.review_goals enable row level security;

drop policy if exists review_goals_select on public.review_goals;
create policy review_goals_select on public.review_goals
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.manages_employee(employee_id)
    or public.is_system_admin()
  );

-- 목표는 본인만 등록한다. 팀장이 대신 써주면 자기 목표가 아니게 된다
drop policy if exists review_goals_insert on public.review_goals;
create policy review_goals_insert on public.review_goals
  for insert to authenticated
  with check (employee_id = public.current_employee_id());

drop policy if exists review_goals_update on public.review_goals;
create policy review_goals_update on public.review_goals
  for update to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.manages_employee(employee_id)
    or public.is_system_admin()
  )
  with check (
    employee_id = public.current_employee_id()
    or public.manages_employee(employee_id)
    or public.is_system_admin()
  );

drop policy if exists review_goals_delete on public.review_goals;
create policy review_goals_delete on public.review_goals
  for delete to authenticated
  using (employee_id = public.current_employee_id() or public.is_system_admin());

/*
 * 목표도 같은 이유로 열 단위 방어선이 필요하다.
 * 팀장이 할 수 있는 것은 승인(approved_by/at)뿐이고 내용은 못 고친다 —
 * 승인 절차의 의미가 "팀장이 마음에 들게 고쳐놓고 승인"이 되면 안 된다.
 *
 * INSERT도 막는다. 정책은 employee_id가 본인인지만 보므로, 목표를 등록하면서
 * approved_by/approved_at을 같이 넣으면 자기 목표를 스스로 승인한 것으로
 * 만들 수 있다. 남의 id를 승인자로 적어 넣는 것도 같은 경로다.
 */
create or replace function public.guard_review_goal_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.current_employee_id();
begin
  if public.is_system_admin() then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    if new.approved_by is not null or new.approved_at is not null then
      raise exception '목표를 등록하면서 승인할 수 없습니다';
    end if;
    return new;
  end if;

  if new.employee_id is distinct from old.employee_id
     or new.cycle_id is distinct from old.cycle_id then
    raise exception '목표의 대상자와 사이클은 변경할 수 없습니다';
  end if;

  if old.employee_id = me then
    if new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at then
      raise exception '본인은 목표를 승인할 수 없습니다';
    end if;
    -- 승인된 목표를 고치면 팀장이 승인한 내용과 달라진다
    if old.approved_at is not null
       and new.content is distinct from old.content then
      raise exception '승인된 목표는 수정할 수 없습니다';
    end if;

  elsif public.manages_employee(old.employee_id) then
    if new.content is distinct from old.content
       or new.sort_order is distinct from old.sort_order then
      raise exception '팀장은 팀원의 목표 내용을 수정할 수 없습니다';
    end if;
    -- 승인자는 본인이어야 한다. 남의 이름으로 승인 기록을 남길 수 없다
    if new.approved_by is not null and new.approved_by <> me then
      raise exception '승인자는 본인만 지정할 수 있습니다';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists review_goals_guard_columns on public.review_goals;
create trigger review_goals_guard_columns
  before insert or update on public.review_goals
  for each row execute function public.guard_review_goal_columns();

drop trigger if exists review_goals_touch_updated_at on public.review_goals;
create trigger review_goals_touch_updated_at
  before update on public.review_goals
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. 팀원 평가 현황 — 팀장 화면(/reviews/[cycleId]/team)용
--
--    reviews 행이 아직 없는 팀원도 목록에 나와야 한다. 자기평가를 한 번도
--    저장하지 않은 사람이 목록에서 사라지면, 팀장 입장에서는 "평가할 사람이
--    없다"로 보인다 — 정작 그 사람이 제일 확인이 필요한 사람이다.
-- ---------------------------------------------------------------------
create or replace function public.review_team_status(p_cycle_id uuid)
returns table (
  employee_id uuid,
  name text,
  "position" text,
  team_name text,
  review_id uuid,
  goal_count int,
  approved_goal_count int,
  goals_submitted_at timestamptz,
  self_submitted_at timestamptz,
  manager_submitted_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    e.id,
    e.name,
    e.position,
    t.name,
    r.id,
    coalesce(g.total, 0)::int,
    coalesce(g.approved, 0)::int,
    r.goals_submitted_at,
    r.self_submitted_at,
    r.manager_submitted_at
  from public.employees e
  left join public.teams t on t.id = e.team_id
  left join public.reviews r
    on r.employee_id = e.id and r.cycle_id = p_cycle_id
  left join lateral (
    select count(*) as total, count(rg.approved_at) as approved
    from public.review_goals rg
    where rg.employee_id = e.id and rg.cycle_id = p_cycle_id
  ) g on true
  where e.employment_status = 'active'
    and e.id <> public.current_employee_id()
    and (public.manages_employee(e.id) or public.is_system_admin())
  order by t.name nulls last, e.name;
$$;

revoke all on function public.review_team_status(uuid) from public;
grant execute on function public.review_team_status(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. 사이클 전체 진행 현황 — 관리자 화면(/admin/reviews)용
--
--    "목표설정 완료 n / 자기평가 완료 m / 팀장평가 완료 k"를 화면에서
--    직원 수만큼 질의해 세면 인원이 늘수록 느려지고, 무엇보다 '전체 인원'의
--    정의(재직자만인지)가 화면마다 갈린다. 한 번에 세서 내려준다.
-- ---------------------------------------------------------------------
--    security definer라 RLS를 우회한다. 전사 집계는 관리자 화면에서만 쓰이므로
--    함수 안에서 직접 막는다 — 안 막으면 전 직원이 "누가 몇 명 안 냈는지"를
--    조회할 수 있게 된다.
create or replace function public.review_cycle_progress(p_cycle_id uuid)
returns table (
  total_employees int,
  goals_submitted int,
  self_submitted int,
  manager_submitted int
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    raise exception '평가 사이클 진행 현황은 시스템 관리자만 조회할 수 있습니다';
  end if;

  return query
  select
    (select count(*) from public.employees
      where employment_status = 'active')::int,
    count(*) filter (where r.goals_submitted_at is not null)::int,
    count(*) filter (where r.self_submitted_at is not null)::int,
    count(*) filter (where r.manager_submitted_at is not null)::int
  from public.reviews r
  where r.cycle_id = p_cycle_id;
end;
$$;

revoke all on function public.review_cycle_progress(uuid) from public;
grant execute on function public.review_cycle_progress(uuid) to authenticated;
