-- =====================================================================
-- 마이그레이션 22 — 스펙 13 자산관리 & 복지포인트
--
--   assets                   비품·장비
--   asset_loans              대여 신청·승인·반납 이력
--   welfare_point_balances   연도별 지급/사용 포인트
--   welfare_point_requests   포인트 사용 신청
--
-- 스펙 4장이 "승인은 하나의 트랜잭션으로 묶는다"고 못박고 있는데, PostgREST로는
-- 여러 문장을 한 트랜잭션에 넣을 수 없다. update 두 번을 이어 쏘면 사이에서
-- 끊겼을 때 "승인은 됐는데 포인트는 안 빠진" 상태가 남고, 그 상태는 화면 어디를
-- 봐도 정상으로 보인다. 그래서 승인 계열은 전부 함수로 만든다 —
-- 함수 본문은 단일 트랜잭션이라 중간에서 끊기지 않는다.
--
-- 결재(스펙 04)에서 쓰던 방식과 같다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 자산
-- ---------------------------------------------------------------------
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  asset_type text,
  serial_number text,
  status text not null default 'available'
    check (status in ('available', 'loaned', 'maintenance', 'retired')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assets_name_not_blank check (btrim(name) <> '')
);

/*
 * 시리얼번호는 있으면 유일해야 한다. 같은 번호가 두 개면 어느 실물인지
 * 특정할 수 없어 자산대장으로서 의미가 없다. 없는 자산(사무용품 등)도 많아서
 * NOT NULL은 아니고, 부분 유니크로 "값이 있을 때만" 건다.
 */
create unique index if not exists assets_serial_unique
  on public.assets (serial_number)
  where serial_number is not null and btrim(serial_number) <> '';

create index if not exists assets_status_idx on public.assets (status, asset_type, name);

alter table public.assets enable row level security;

drop policy if exists assets_select on public.assets;
create policy assets_select on public.assets
  for select to authenticated using (true);

drop policy if exists assets_write on public.assets;
create policy assets_write on public.assets
  for all to authenticated
  using (public.is_system_admin())
  with check (public.is_system_admin());

drop trigger if exists assets_touch_updated_at on public.assets;
create trigger assets_touch_updated_at
  before update on public.assets
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 2. 대여 이력
--
--    한 행이 신청 → 승인(대여) → 반납요청 → 반납확인까지 따라간다.
--    상태를 따로 컬럼으로 두지 않고 시각 컬럼의 조합으로 읽는다 —
--    "언제 무엇이 일어났는가"가 남아야 이력으로 쓸 수 있고, status 컬럼과
--    시각 컬럼이 따로 있으면 둘이 어긋난 행이 반드시 생긴다.
-- ---------------------------------------------------------------------
create table if not exists public.asset_loans (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  requested_at timestamptz not null default now(),
  loaned_at timestamptz,
  expected_return_date date,
  -- 본인이 "반납했습니다"를 누른 시각. 관리자 확인 전이다(스펙 3.2)
  return_requested_at timestamptz,
  returned_at timestamptz,
  -- 관리자가 신청을 거절한 경우
  rejected_at timestamptz,
  note text,
  constraint asset_loans_returned_after_loan
    check (returned_at is null or loaned_at is not null),
  -- 승인과 거절이 동시에 남으면 어느 쪽이 사실인지 알 수 없다
  constraint asset_loans_not_both
    check (loaned_at is null or rejected_at is null)
);

create index if not exists asset_loans_employee_idx
  on public.asset_loans (employee_id, requested_at desc);
create index if not exists asset_loans_asset_idx
  on public.asset_loans (asset_id, requested_at desc);

/*
 * 자산 하나에 "대여 중"인 건은 하나뿐이다.
 * 이게 없으면 두 사람이 같은 노트북을 신청하고 관리자가 둘 다 승인했을 때
 * 자산 상태는 loaned 하나인데 대여자가 두 명인 상태가 만들어진다.
 *
 * 조건을 '승인된 것'으로 좁힌 이유: 신청까지 막으면 먼저 누른 사람 말고는
 * 신청 자체를 못 한다. 여러 명이 신청하고 관리자가 고르는 게 자연스럽고,
 * 두 번째 승인은 approve_asset_loan()이 "지금 대여할 수 없는 자산"으로
 * 막아준다 — 그쪽이 읽을 수 있는 문장이다.
 */
create unique index if not exists asset_loans_one_active
  on public.asset_loans (asset_id)
  where loaned_at is not null and returned_at is null;

/*
 * 한 사람이 같은 자산에 대기 중인 신청을 둘 이상 쌓을 수 없다.
 * 서버 액션도 미리 세어 막지만, 조회와 INSERT 사이에 두 번 제출되면
 * 그 검사를 통과한다 — 관리자 화면에 같은 사람이 두 줄로 뜨는 상태를
 * 인덱스로 확실히 없앤다.
 */
create unique index if not exists asset_loans_one_pending_per_person
  on public.asset_loans (asset_id, employee_id)
  where loaned_at is null and rejected_at is null;

alter table public.asset_loans enable row level security;

drop policy if exists asset_loans_select on public.asset_loans;
create policy asset_loans_select on public.asset_loans
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.is_system_admin()
  );

drop policy if exists asset_loans_insert on public.asset_loans;
create policy asset_loans_insert on public.asset_loans
  for insert to authenticated
  with check (employee_id = public.current_employee_id());

/*
 * 본인이 UPDATE할 수 있는 것은 "반납하겠다"는 표시 하나뿐이다.
 * 정책은 열 단위를 말하지 못하므로 트리거로 나머지를 막는다 —
 * 안 그러면 본인이 loaned_at·returned_at을 직접 채워 대여 이력을 지어낼 수 있다.
 *
 * 스펙 4장 RLS 원칙은 "asset_loans UPDATE는 관리자만"이라고 적혀 있는데
 * 여기서 본인 UPDATE를 연다. 스펙 3.2가 "본인이 반납 처리 버튼을 누른다"고
 * 하므로 둘 중 하나는 지킬 수 없고, 화면 요구를 택하고 컬럼을 트리거로 좁혔다.
 */
drop policy if exists asset_loans_update on public.asset_loans;
create policy asset_loans_update on public.asset_loans
  for update to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.is_system_admin()
  )
  with check (
    employee_id = public.current_employee_id()
    or public.is_system_admin()
  );

/*
 * 본인은 아직 승인 전인 자기 신청을 취소할 수 있다.
 * 관리자만 지울 수 있게 두면 화면의 '취소' 버튼이 RLS에 걸려 0행 삭제로
 * 끝나는데, 오류가 아니라 조용한 실패라 "이미 처리된 신청"이라는 엉뚱한
 * 안내가 뜬다 — 실제로는 아무 문제 없는 대기 중 신청이다.
 * 승인·거절된 건은 이력이라 본인도 못 지운다.
 */
drop policy if exists asset_loans_delete on public.asset_loans;
create policy asset_loans_delete on public.asset_loans
  for delete to authenticated
  using (
    public.is_system_admin()
    or (
      employee_id = public.current_employee_id()
      and loaned_at is null
      and rejected_at is null
    )
  );

create or replace function public.guard_asset_loan_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_system_admin() then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    -- 신청은 신청일 뿐이다. 승인·반납 시각을 직접 채워 넣을 수 없다
    if new.loaned_at is not null
       or new.returned_at is not null
       or new.rejected_at is not null
       or new.return_requested_at is not null then
      raise exception '대여 신청에는 승인·반납 정보를 넣을 수 없습니다';
    end if;
    -- 신청 시각을 과거로 적어 처리 대기 목록의 순서를 앞당길 수 없다
    new.requested_at := now();
    new.note := null;
    return new;
  end if;

  if new.asset_id is distinct from old.asset_id
     or new.employee_id is distinct from old.employee_id
     or new.requested_at is distinct from old.requested_at then
    raise exception '대여의 자산·대여자·신청시각은 변경할 수 없습니다';
  end if;

  if new.loaned_at is distinct from old.loaned_at
     or new.returned_at is distinct from old.returned_at
     or new.rejected_at is distinct from old.rejected_at
     or new.expected_return_date is distinct from old.expected_return_date
     -- note는 관리자의 반려 사유가 들어가는 칸이다
     or new.note is distinct from old.note then
    raise exception '대여 승인·반납 처리는 관리자만 할 수 있습니다';
  end if;

  -- 아직 대여 중이 아닌 건에 반납 표시를 남길 수 없다
  if new.return_requested_at is not null and old.loaned_at is null then
    raise exception '대여 승인 전에는 반납 요청을 할 수 없습니다';
  end if;

  -- 반납 요청 시각도 지금이어야 한다. 임의 시각을 적으면 기록이 사실과 갈린다
  if new.return_requested_at is distinct from old.return_requested_at
     and new.return_requested_at is not null then
    new.return_requested_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists asset_loans_guard_columns on public.asset_loans;
create trigger asset_loans_guard_columns
  before insert or update on public.asset_loans
  for each row execute function public.guard_asset_loan_columns();

-- ---------------------------------------------------------------------
-- 3. 복지포인트 잔액 (연도별)
--
--    스펙 03 연차와 같은 원칙 — 지급과 사용은 시점이 다른 사건이라
--    각각 저장하고 잔여는 화면에서 뺄셈으로 보여준다.
-- ---------------------------------------------------------------------
create table if not exists public.welfare_point_balances (
  employee_id uuid not null references public.employees(id) on delete cascade,
  year int not null,
  granted_points numeric(12, 2) not null default 0,
  used_points numeric(12, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (employee_id, year),
  constraint welfare_points_non_negative
    check (granted_points >= 0 and used_points >= 0),
  -- 지급보다 많이 쓴 상태로 저장되면 잔여가 음수로 표시된다
  constraint welfare_points_not_overspent
    check (used_points <= granted_points)
);

alter table public.welfare_point_balances enable row level security;

drop policy if exists welfare_balances_select on public.welfare_point_balances;
create policy welfare_balances_select on public.welfare_point_balances
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.is_system_admin()
  );

/*
 * 쓰기 정책을 아예 만들지 않는다.
 * 잔액은 승인 함수(security definer)를 통해서만 움직여야 한다. 정책을 열어두면
 * 관리자 실수 한 번으로 신청 이력 없이 잔액만 바뀌고, 그러면 "이 숫자가 왜
 * 이 값인지"를 설명할 근거가 사라진다.
 */

drop trigger if exists welfare_balances_touch_updated_at on public.welfare_point_balances;
create trigger welfare_balances_touch_updated_at
  before update on public.welfare_point_balances
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. 포인트 사용 신청
-- ---------------------------------------------------------------------
create table if not exists public.welfare_point_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  -- 어느 해의 포인트를 쓰는지. 연말 신청이 해를 넘겨 승인되는 경우가 있다
  year int not null,
  amount numeric(12, 2) not null,
  purpose text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references public.employees(id) on delete set null,
  reject_reason text,
  constraint welfare_requests_amount_positive check (amount > 0),
  constraint welfare_requests_purpose_not_blank check (btrim(purpose) <> ''),
  -- 처리했는데 누가 언제 했는지 없으면 나중에 다툼이 생겼을 때 근거가 없다
  constraint welfare_requests_processed_consistent
    check ((status = 'pending' and processed_at is null and processed_by is null)
        or (status <> 'pending' and processed_at is not null and processed_by is not null))
);

create index if not exists welfare_requests_employee_idx
  on public.welfare_point_requests (employee_id, requested_at desc);
create index if not exists welfare_requests_status_idx
  on public.welfare_point_requests (status, requested_at);

alter table public.welfare_point_requests enable row level security;

drop policy if exists welfare_requests_select on public.welfare_point_requests;
create policy welfare_requests_select on public.welfare_point_requests
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.is_system_admin()
  );

drop policy if exists welfare_requests_insert on public.welfare_point_requests;
create policy welfare_requests_insert on public.welfare_point_requests
  for insert to authenticated
  with check (
    employee_id = public.current_employee_id()
    and status = 'pending'
  );

-- 신청 취소(대기 중인 것만). 처리된 신청은 이력이라 지우지 않는다
drop policy if exists welfare_requests_delete on public.welfare_point_requests;
create policy welfare_requests_delete on public.welfare_point_requests
  for delete to authenticated
  using (employee_id = public.current_employee_id() and status = 'pending');

/*
 * UPDATE 정책은 두지 않는다 — 승인·반려는 함수로만 한다.
 * 정책으로 열면 관리자가 status만 바꾸고 잔액은 안 바꾸는 경로가 생기는데,
 * 그게 정확히 스펙 4장이 "하나의 트랜잭션"이라고 못박은 이유다.
 */

-- ---------------------------------------------------------------------
-- 5. 자산 대여 처리 (관리자)
-- ---------------------------------------------------------------------
create or replace function public.approve_asset_loan(
  p_loan_id uuid,
  p_expected_return_date date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset uuid;
  v_status text;
begin
  if not public.is_system_admin() then
    raise exception '자산 대여 승인은 시스템 관리자만 할 수 있습니다';
  end if;

  select l.asset_id, a.status into v_asset, v_status
  from public.asset_loans l
  join public.assets a on a.id = l.asset_id
  where l.id = p_loan_id
    and l.loaned_at is null
    and l.rejected_at is null
  -- 같은 자산에 신청이 둘 들어왔을 때 동시에 승인되는 것을 막는다
  for update of a;

  if v_asset is null then
    raise exception '처리할 수 있는 대여 신청이 아닙니다';
  end if;
  if v_status <> 'available' then
    raise exception '지금 대여할 수 없는 자산입니다 (현재 상태: %)', v_status;
  end if;

  update public.asset_loans
     set loaned_at = now(),
         expected_return_date = coalesce(p_expected_return_date, expected_return_date)
   where id = p_loan_id;

  update public.assets set status = 'loaned' where id = v_asset;
end;
$$;

create or replace function public.reject_asset_loan(p_loan_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    raise exception '자산 대여 처리는 시스템 관리자만 할 수 있습니다';
  end if;

  update public.asset_loans
     set rejected_at = now(), note = coalesce(p_reason, note)
   where id = p_loan_id and loaned_at is null and rejected_at is null;

  if not found then
    raise exception '처리할 수 있는 대여 신청이 아닙니다';
  end if;
end;
$$;

/** 반납 확인 — 자산을 다시 available로 되돌린다 */
create or replace function public.confirm_asset_return(p_loan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset uuid;
begin
  if not public.is_system_admin() then
    raise exception '반납 확인은 시스템 관리자만 할 수 있습니다';
  end if;

  update public.asset_loans
     set returned_at = now()
   where id = p_loan_id and loaned_at is not null and returned_at is null
  returning asset_id into v_asset;

  if v_asset is null then
    raise exception '반납 처리할 수 있는 대여가 아닙니다';
  end if;

  /*
   * 수리중·폐기로 바꿔둔 자산은 건드리지 않는다. 반납 확인이 그 상태를
   * available로 되돌리면, 고장나서 빼둔 장비가 다시 대여 목록에 올라온다.
   */
  update public.assets
     set status = 'available'
   where id = v_asset and status = 'loaned';
end;
$$;

revoke all on function public.approve_asset_loan(uuid, date) from public;
revoke all on function public.reject_asset_loan(uuid, text) from public;
revoke all on function public.confirm_asset_return(uuid) from public;
grant execute on function public.approve_asset_loan(uuid, date) to authenticated;
grant execute on function public.reject_asset_loan(uuid, text) to authenticated;
grant execute on function public.confirm_asset_return(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. 복지포인트 처리 (관리자)
-- ---------------------------------------------------------------------

/**
 * 사용 신청 승인 — 상태 변경과 잔액 차감을 한 트랜잭션에 묶는다(스펙 4장).
 *
 * 잔액이 모자라면 승인 자체가 실패한다. CHECK 제약(used_points <= granted_points)이
 * 마지막 방어선이지만, 제약 위반 메시지로 알리면 관리자는 무엇이 문제인지 모른다.
 */
create or replace function public.approve_welfare_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee uuid;
  v_year int;
  v_amount numeric;
  v_granted numeric;
  v_used numeric;
  v_me uuid := public.current_employee_id();
begin
  if not public.is_system_admin() then
    raise exception '복지포인트 승인은 시스템 관리자만 할 수 있습니다';
  end if;

  select employee_id, year, amount into v_employee, v_year, v_amount
  from public.welfare_point_requests
  where id = p_request_id and status = 'pending'
  for update;

  if v_employee is null then
    raise exception '처리할 수 있는 신청이 아닙니다';
  end if;

  -- 잔액 행을 잠근다. 두 신청이 동시에 승인되며 잔액을 초과하는 것을 막는다
  select granted_points, used_points into v_granted, v_used
  from public.welfare_point_balances
  where employee_id = v_employee and year = v_year
  for update;

  if v_granted is null then
    raise exception '% 년도 지급 내역이 없어 승인할 수 없습니다', v_year;
  end if;

  if v_used + v_amount > v_granted then
    raise exception '잔여 포인트가 부족합니다 (잔여 %, 신청 %)',
      v_granted - v_used, v_amount;
  end if;

  update public.welfare_point_balances
     set used_points = used_points + v_amount
   where employee_id = v_employee and year = v_year;

  update public.welfare_point_requests
     set status = 'approved', processed_at = now(), processed_by = v_me
   where id = p_request_id;
end;
$$;

create or replace function public.reject_welfare_request(
  p_request_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    raise exception '복지포인트 처리는 시스템 관리자만 할 수 있습니다';
  end if;

  update public.welfare_point_requests
     set status = 'rejected',
         processed_at = now(),
         processed_by = public.current_employee_id(),
         reject_reason = p_reason
   where id = p_request_id and status = 'pending';

  if not found then
    raise exception '처리할 수 있는 신청이 아닙니다';
  end if;
end;
$$;

/**
 * 연초 일괄 지급 (스펙 3.5)
 *
 * 이미 지급된 해에 다시 돌려도 두 배가 되지 않는다 — 그 해 지급액을 p_points로
 * 맞춘다(더하기가 아니라 설정). 일괄 지급은 실수로 두 번 누르기 쉬운 버튼이고,
 * 두 배가 된 것은 화면 어디에도 표시되지 않아 발견이 늦다.
 *
 * 이미 쓴 포인트보다 적게 지급하려 하면 막는다 — 그 상태는 잔여가 음수다.
 */
create or replace function public.grant_welfare_points(p_year int, p_points numeric)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_overspent int;
begin
  if not public.is_system_admin() then
    raise exception '복지포인트 지급은 시스템 관리자만 할 수 있습니다';
  end if;
  if p_points < 0 then
    raise exception '지급 포인트는 0 이상이어야 합니다';
  end if;

  select count(*) into v_overspent
  from public.welfare_point_balances
  where year = p_year and used_points > p_points;

  if v_overspent > 0 then
    raise exception '이미 % 포인트보다 많이 사용한 임직원이 %명 있어 지급액을 낮출 수 없습니다',
      p_points, v_overspent;
  end if;

  insert into public.welfare_point_balances (employee_id, year, granted_points)
  select e.id, p_year, p_points
  from public.employees e
  where e.employment_status = 'active'
  on conflict (employee_id, year)
    do update set granted_points = excluded.granted_points, updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.approve_welfare_request(uuid) from public;
revoke all on function public.reject_welfare_request(uuid, text) from public;
revoke all on function public.grant_welfare_points(int, numeric) from public;
grant execute on function public.approve_welfare_request(uuid) to authenticated;
grant execute on function public.reject_welfare_request(uuid, text) to authenticated;
grant execute on function public.grant_welfare_points(int, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 7. 자산 목록 + 현재 대여자 — /assets 화면용
--
--    대여자 이름은 asset_loans에 있는데 그 테이블은 본인·관리자만 볼 수 있다
--    (RLS). 스펙 3.1은 "현재 대여자"를 전 직원에게 보여주라고 하므로,
--    이름만 꺼내오는 함수를 따로 둔다 — 대여 이력 전체를 열지 않으면서
--    "지금 누가 쓰고 있는지"만 공개한다.
-- ---------------------------------------------------------------------
create or replace function public.list_assets()
returns table (
  id uuid,
  name text,
  asset_type text,
  serial_number text,
  status text,
  note text,
  holder_name text,
  expected_return_date date,
  /** 내가 이 자산에 넣어둔 대기 중 신청이 있는지 */
  my_pending_loan_id uuid
)
language sql
security definer
stable
set search_path = public
as $$
  select
    a.id, a.name, a.asset_type, a.serial_number, a.status, a.note,
    holder.name,
    active.expected_return_date,
    mine.id
  from public.assets a
  left join lateral (
    select l.employee_id, l.expected_return_date
    from public.asset_loans l
    where l.asset_id = a.id and l.loaned_at is not null and l.returned_at is null
    limit 1
  ) active on true
  left join public.employees holder on holder.id = active.employee_id
  left join lateral (
    select l.id
    from public.asset_loans l
    where l.asset_id = a.id
      and l.employee_id = public.current_employee_id()
      and l.loaned_at is null
      and l.rejected_at is null
    limit 1
  ) mine on true
  order by a.asset_type nulls last, a.name;
$$;

revoke all on function public.list_assets() from public;
grant execute on function public.list_assets() to authenticated;
