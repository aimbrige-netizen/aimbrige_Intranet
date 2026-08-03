-- =====================================================================
-- 마이그레이션 30 — 스펙 13 ESS 3종 (인사·급여·계약)
--
-- payroll_profiles(급여상세) · payroll_slips(월별 명세) · payroll_slip_items
-- (지급/공제 항목) · certificate_requests(증명서 신청) · employment_contracts
-- (근로계약). 인사카드는 employees 기존 데이터를 그대로 쓰므로 이 파일에
-- 인사 테이블 신설은 없다.
--
-- ── 급여는 이 프로젝트의 최민감 데이터다 (RLS 경로 전수 점검) ─────────
-- payroll_* 세 테이블의 정책은 "본인 select + system_admin all" 뿐이다.
-- manager 정책은 **의도적으로 없다** — 팀장도 팀원 급여를 못 본다.
-- 샐 수 있는 경로를 전부 짚으면:
--   · 직접 SELECT / 집계 / count      — RLS가 행 단위로 먼저 거른다
--   · PostgREST embed(employees→payroll_*) — embed도 대상 테이블 RLS를
--     그대로 탄다. 다른 화면이 실수로 임베드해도 남의 행은 안 나온다
--   · payroll_slip_items 조인 경로    — 부모 slip 소유 검사(exists)를 거친다.
--     slips 정책은 items를 참조하지 않으므로 재귀 고리도 없다
--   · definer 함수                    — admin_save_payroll_slip()은 첫 줄에서
--     is_system_admin()을 검사한다. payroll_slip_items_recalc()는 파생 합계만
--     쓰고 아무것도 반환하지 않으며, 이를 태울 수 있는 DML 자체가 admin 전용이다
--   · current_employee_id()가 null(직원 행 없는 계정)이면 비교가 null →
--     어떤 행도 통과하지 않는다
--
-- ── 합계 3종은 "트리거 재계산"으로 정했다 (스펙이 요구한 결정 근거) ───
-- 명세의 진실은 항목(payroll_slip_items)이고 합계는 파생값이다. 입력 액션의
-- 서버 계산만으로는 관리자가 PostgREST로 항목 행을 직접 고치는 순간 합계가
-- 어긋나고, 그 상태는 화면 어디서도 이상해 보이지 않는다. 트리거는 쓰기
-- 경로와 무관하게 항상 맞는다. 합계 직접 수정은 가드 트리거가 막는다
-- (net = gross - deduction은 CHECK로도 이중 고정).
--
-- ── enum 값은 영문 토큰이다 ──────────────────────────────────────────
-- 스펙 표기는 연봉제/월급제·지급/공제·재직/경력이지만 DB 값은 코드베이스
-- 전체 규약(영문 토큰, 라벨은 화면에서)을 따른다:
--   pay_type annual/monthly · kind payment/deduction
--   cert_type employment/career · cert status requested/issued/rejected
--   contract status draft/signed/expired
--
-- 보안 규약 준수 요약:
--   · definer 함수: set search_path = public + revoke public/anon/
--     authenticated 후 grant authenticated (규약 1)
--   · 컬럼 가드 트리거는 전부 before insert or update (규약 2)
--   · 증명서 상태 전이는 requested→issued/rejected만, processed_at·
--     processed_by는 서버가 강제한다
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. payroll_profiles — 급여상세 (13-ess.md "급여상세" 섹션)
-- ---------------------------------------------------------------------
create table if not exists public.payroll_profiles (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  /** annual = 연봉제, monthly = 월급제 */
  pay_type text not null check (pay_type in ('annual','monthly')),
  annual_salary bigint check (annual_salary is null or annual_salary >= 0),
  monthly_salary bigint check (monthly_salary is null or monthly_salary >= 0),
  fixed_allowance bigint not null default 0 check (fixed_allowance >= 0),
  note text check (note is null or char_length(note) <= 1000),
  updated_at timestamptz not null default now()
);

drop trigger if exists payroll_profiles_touch_updated_at on public.payroll_profiles;
create trigger payroll_profiles_touch_updated_at
  before update on public.payroll_profiles
  for each row execute function public.touch_updated_at();

comment on table public.payroll_profiles is
  '급여상세(스펙 13). 최민감 데이터 — RLS는 본인 select + system_admin all 뿐, manager 접근 불가.';

-- ---------------------------------------------------------------------
-- 2. payroll_slips — 월별 급(상)여 명세
-- ---------------------------------------------------------------------
create table if not exists public.payroll_slips (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  /** 급여월 — 항상 그 달 1일. RPC가 date_trunc로 정규화한다 */
  pay_month date not null check (extract(day from pay_month) = 1),
  pay_date date not null,
  gross_total bigint not null default 0 check (gross_total >= 0),
  deduction_total bigint not null default 0 check (deduction_total >= 0),
  net_total bigint not null default 0,
  memo text check (memo is null or char_length(memo) <= 1000),
  created_at timestamptz not null default now(),
  constraint payroll_slips_employee_month_key unique (employee_id, pay_month),
  -- 합계 정합의 마지막 방어선 — 재계산 트리거가 늘 이 관계로 쓴다
  constraint payroll_slips_net_consistent
    check (net_total = gross_total - deduction_total)
);

create index if not exists payroll_slips_employee_idx
  on public.payroll_slips (employee_id, pay_month desc);
-- 관리자 화면의 "이 달에 누구 명세가 들어갔나" 질의
create index if not exists payroll_slips_month_idx
  on public.payroll_slips (pay_month);

comment on table public.payroll_slips is
  '월별 급여명세(스펙 13). 합계 3종은 payroll_slip_items에서 트리거로 재계산되는 파생값 — 직접 수정은 가드가 막는다.';

-- ---------------------------------------------------------------------
-- 3. payroll_slip_items — 지급/공제 항목
-- ---------------------------------------------------------------------
create table if not exists public.payroll_slip_items (
  id uuid primary key default gen_random_uuid(),
  slip_id uuid not null references public.payroll_slips(id) on delete cascade,
  /** payment = 지급, deduction = 공제 */
  kind text not null check (kind in ('payment','deduction')),
  name text not null check (btrim(name) <> '' and char_length(name) <= 60),
  amount bigint not null default 0 check (amount >= 0),
  sort int not null default 0
);

create index if not exists payroll_slip_items_slip_idx
  on public.payroll_slip_items (slip_id, sort);

comment on table public.payroll_slip_items is
  '급여명세 항목(지급/공제). RLS는 부모 slip을 따라간다 — 본인 slip의 항목만 select.';

-- ---------------------------------------------------------------------
-- 4. certificate_requests — 증명서 발급 신청 (#hr/cert-isu)
-- ---------------------------------------------------------------------
create table if not exists public.certificate_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  /** employment = 재직증명서, career = 경력증명서 */
  cert_type text not null check (cert_type in ('employment','career')),
  purpose text not null default '' check (char_length(purpose) <= 500),
  status text not null default 'requested'
    check (status in ('requested','issued','rejected')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references public.employees(id) on delete set null,
  reject_reason text check (reject_reason is null or char_length(reject_reason) <= 500),
  -- 처리됐다 = 처리 시각이 있다. 어긋난 조합을 원천 차단
  constraint certificate_requests_processed_state
    check ((status = 'requested') = (processed_at is null)),
  -- 반려 사유는 반려에만 있다
  constraint certificate_requests_reject_reason
    check (status = 'rejected' or reject_reason is null)
);

create index if not exists certificate_requests_employee_idx
  on public.certificate_requests (employee_id, requested_at desc);
-- 관리자 처리 대기열은 requested만 훑는다
create index if not exists certificate_requests_pending_idx
  on public.certificate_requests (requested_at)
  where status = 'requested';

comment on table public.certificate_requests is
  '증명서 발급 신청(스펙 13). 상태 전이는 requested→issued/rejected만 — 가드 트리거가 processed_at·processed_by를 서버 값으로 강제한다.';

-- ---------------------------------------------------------------------
-- 5. employment_contracts — 근로계약 (#econtract, 모두싸인 연동 대기)
-- ---------------------------------------------------------------------
create table if not exists public.employment_contracts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  title text not null check (btrim(title) <> '' and char_length(title) <= 200),
  /** draft = 작성중, signed = 서명완료, expired = 만료 */
  status text not null default 'draft'
    check (status in ('draft','signed','expired')),
  /*
   * 체결일 — 계약은 서면으로 먼저 체결되고 시스템에는 사후 등록될 수 있어
   * 서버 now()가 아니라 관리자가 입력한 날짜를 받는다. 서명완료에는 필수.
   */
  signed_at date,
  /** 스토리지 경로: <employee_id>/<파일명> — 첫 세그먼트가 열람 권한 판정 */
  file_path text check (file_path is null or char_length(file_path) <= 1024),
  created_at timestamptz not null default now(),
  constraint employment_contracts_signed_date
    check (status <> 'signed' or signed_at is not null)
);

create index if not exists employment_contracts_employee_idx
  on public.employment_contracts (employee_id, created_at desc);

comment on table public.employment_contracts is
  '근로계약(스펙 13). 모두싸인 연동 전까지 목록·열람만 동작. 파일은 employment-contracts 비공개 버킷.';

-- ---------------------------------------------------------------------
-- 6. RLS — 급여 3테이블은 본인 select + system_admin all "만"
-- ---------------------------------------------------------------------
alter table public.payroll_profiles     enable row level security;
alter table public.payroll_slips        enable row level security;
alter table public.payroll_slip_items   enable row level security;
alter table public.certificate_requests enable row level security;
alter table public.employment_contracts enable row level security;

drop policy if exists payroll_profiles_select_self on public.payroll_profiles;
create policy payroll_profiles_select_self on public.payroll_profiles
  for select to authenticated
  using (employee_id = public.current_employee_id());

drop policy if exists payroll_profiles_admin on public.payroll_profiles;
create policy payroll_profiles_admin on public.payroll_profiles
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

drop policy if exists payroll_slips_select_self on public.payroll_slips;
create policy payroll_slips_select_self on public.payroll_slips
  for select to authenticated
  using (employee_id = public.current_employee_id());

drop policy if exists payroll_slips_admin on public.payroll_slips;
create policy payroll_slips_admin on public.payroll_slips
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

/*
 * 항목은 부모 slip의 소유를 따른다. 서브쿼리는 payroll_slips의 RLS 아래에서
 * 돌지만 본인 slip은 본인 select 정책으로 항상 보이므로 판정이 어긋나지
 * 않는다. slips 정책이 items를 참조하지 않으니 재귀(무한 고리)도 없다.
 */
drop policy if exists payroll_slip_items_select_self on public.payroll_slip_items;
create policy payroll_slip_items_select_self on public.payroll_slip_items
  for select to authenticated
  using (
    exists (
      select 1 from public.payroll_slips s
      where s.id = slip_id
        and s.employee_id = public.current_employee_id()
    )
  );

drop policy if exists payroll_slip_items_admin on public.payroll_slip_items;
create policy payroll_slip_items_admin on public.payroll_slip_items
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

-- 증명서: 본인 신청·조회·취소(requested 한정 DELETE) + 관리자 처리
drop policy if exists certificate_requests_select_self on public.certificate_requests;
create policy certificate_requests_select_self on public.certificate_requests
  for select to authenticated
  using (employee_id = public.current_employee_id());

drop policy if exists certificate_requests_insert_self on public.certificate_requests;
create policy certificate_requests_insert_self on public.certificate_requests
  for insert to authenticated
  with check (employee_id = public.current_employee_id());

-- 취소 = 행 삭제. 처리된 신청(발급/반려)은 기록이라 본인도 못 지운다
drop policy if exists certificate_requests_delete_self on public.certificate_requests;
create policy certificate_requests_delete_self on public.certificate_requests
  for delete to authenticated
  using (employee_id = public.current_employee_id() and status = 'requested');

drop policy if exists certificate_requests_admin on public.certificate_requests;
create policy certificate_requests_admin on public.certificate_requests
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

-- 계약: 본인 select + 관리자 all
drop policy if exists employment_contracts_select_self on public.employment_contracts;
create policy employment_contracts_select_self on public.employment_contracts
  for select to authenticated
  using (employee_id = public.current_employee_id());

drop policy if exists employment_contracts_admin on public.employment_contracts;
create policy employment_contracts_admin on public.employment_contracts
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

-- ---------------------------------------------------------------------
-- 7. 컬럼 가드 트리거 — 규약 2: 반드시 before insert or update
--    SECURITY INVOKER 명시 — definer면 current_user가 소유자로 바뀌어
--    우회 분기가 항상 참이 된다(마이그레이션 12·28에서 겪은 함정).
--    admin_save_payroll_slip()·재계산 트리거는 definer 실행 중이라
--    이 분기로 통과한다.
-- ---------------------------------------------------------------------

/** 합계는 파생값 — 클라이언트 경로의 직접 지정을 막는다 */
create or replace function public.payroll_slips_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('postgres','supabase_admin','service_role')
     or auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- 어떤 값을 보내든 0에서 시작한다 — 항목이 들어오면 트리거가 채운다
    new.gross_total := 0;
    new.deduction_total := 0;
    new.net_total := 0;
    return new;
  end if;

  -- 명세를 다른 직원에게 옮기는 경로 차단 — 급여 데이터의 소유는 불변
  if new.employee_id is distinct from old.employee_id then
    raise exception '명세의 대상 직원은 변경할 수 없습니다';
  end if;

  if new.gross_total is distinct from old.gross_total
     or new.deduction_total is distinct from old.deduction_total
     or new.net_total is distinct from old.net_total then
    raise exception '합계는 항목에서 자동 계산됩니다';
  end if;

  return new;
end $$;

drop trigger if exists payroll_slips_guard on public.payroll_slips;
create trigger payroll_slips_guard
  before insert or update on public.payroll_slips
  for each row execute function public.payroll_slips_guard();

/**
 * 항목의 slip_id 이동 차단 — 옮기면 재계산 트리거가 새 slip만 갱신해
 * 원래 slip의 합계가 낡은 값으로 남는다. (INSERT 경로는 막을 것이 없지만
 * 규약 2에 따라 before insert or update로 등록한다)
 */
create or replace function public.payroll_slip_items_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('postgres','supabase_admin','service_role')
     or auth.uid() is null then
    return new;
  end if;

  -- INSERT는 여기서 막을 것이 없다. old 참조는 UPDATE 분기 안에서만 —
  -- plpgsql 조건식은 단락 평가가 보장되지 않아 tg_op 검사와 한 식에 두면
  -- INSERT 경로에서 "old is not assigned" 예외가 날 수 있다.
  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.slip_id is distinct from old.slip_id then
    raise exception '항목을 다른 명세로 옮길 수 없습니다';
  end if;

  return new;
end $$;

drop trigger if exists payroll_slip_items_guard on public.payroll_slip_items;
create trigger payroll_slip_items_guard
  before insert or update on public.payroll_slip_items
  for each row execute function public.payroll_slip_items_guard();

/** 증명서 상태 전이 가드 — requested→issued/rejected만, 처리 정보는 서버 강제 */
create or replace function public.certificate_requests_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('postgres','supabase_admin','service_role')
     or auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- RLS with check와 같은 규칙을 upsert의 INSERT 경로까지 이중으로
    if new.employee_id is distinct from public.current_employee_id()
       and not public.is_system_admin() then
      raise exception '증명서는 본인 명의로만 신청할 수 있습니다';
    end if;
    -- 신청은 항상 requested로 시작한다 — 처리 정보를 실어 보내도 무시
    new.status := 'requested';
    new.requested_at := now();
    new.processed_at := null;
    new.processed_by := null;
    new.reject_reason := null;
    return new;
  end if;

  -- 신청 원본(누가·무엇을·언제)은 기록이다
  if new.employee_id is distinct from old.employee_id
     or new.cert_type is distinct from old.cert_type
     or new.purpose is distinct from old.purpose
     or new.requested_at is distinct from old.requested_at then
    raise exception '신청 내용은 변경할 수 없습니다';
  end if;

  if new.status is distinct from old.status then
    -- RLS가 이미 관리자만 update를 허용하지만 이중으로 잠근다
    if not public.is_system_admin() then
      raise exception '증명서 처리는 시스템 관리자만 할 수 있습니다';
    end if;
    if old.status <> 'requested' then
      raise exception '이미 처리된 신청입니다';
    end if;
    -- new.status는 CHECK로 3값뿐이고 requested→requested는 이 분기에
    -- 들어오지 않으므로 남는 전이는 issued/rejected 둘뿐이다
    if new.status = 'rejected' then
      if new.reject_reason is null or btrim(new.reject_reason) = '' then
        raise exception '반려 사유를 입력하세요';
      end if;
    else
      new.reject_reason := null;
    end if;
    -- 처리 시각·처리자는 클라이언트를 믿지 않는다
    new.processed_at := now();
    new.processed_by := public.current_employee_id();
  else
    -- 상태 전이 없이 처리 정보만 만지는 경로 차단
    if new.processed_at is distinct from old.processed_at
       or new.processed_by is distinct from old.processed_by
       or new.reject_reason is distinct from old.reject_reason then
      raise exception '처리 정보는 상태 전이와 함께만 기록됩니다';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists certificate_requests_guard on public.certificate_requests;
create trigger certificate_requests_guard
  before insert or update on public.certificate_requests
  for each row execute function public.certificate_requests_guard();

/** 계약 가드 — 소유 불변 + 파일 경로 규칙(첫 세그먼트 = 대상 직원 id) */
create or replace function public.employment_contracts_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('postgres','supabase_admin','service_role')
     or auth.uid() is null then
    return new;
  end if;

  -- old 참조는 UPDATE 분기 안에서만(위 items 가드와 같은 이유)
  if tg_op = 'UPDATE' then
    if new.employee_id is distinct from old.employee_id then
      -- 옮기면 파일 경로의 권한 판정(첫 세그먼트)이 남의 것을 가리키게 된다
      raise exception '계약의 대상 직원은 변경할 수 없습니다';
    end if;
  end if;

  -- 스토리지 select 정책이 경로 첫 세그먼트로 열람자를 판정하므로,
  -- 경로가 다른 직원을 가리키면 그 직원에게 이 계약 파일이 샌다
  if new.file_path is not null
     and split_part(new.file_path, '/', 1) <> new.employee_id::text then
    raise exception '계약 파일 경로가 올바르지 않습니다';
  end if;

  return new;
end $$;

drop trigger if exists employment_contracts_guard on public.employment_contracts;
create trigger employment_contracts_guard
  before insert or update on public.employment_contracts
  for each row execute function public.employment_contracts_guard();

-- ---------------------------------------------------------------------
-- 8. 합계 재계산 — 항목이 바뀔 때마다 부모 명세의 3종 합계를 다시 만든다
--
--    SECURITY DEFINER인 이유: 갱신이 payroll_slips_guard(invoker)를 지나야
--    하는데, definer 실행 중에는 current_user가 소유자(postgres)라 우회
--    분기로 통과한다. 이 함수를 태울 수 있는 DML(items 쓰기)은 RLS상
--    system_admin뿐이고, 함수가 하는 일은 파생 합계 갱신이 전부라
--    definer로도 권한이 넓어지지 않는다.
--
--    행 단위 AFTER 트리거라 항목 n건 교체 시 n번 재계산되지만, 명세 하나의
--    항목은 수십 건 규모라 합계 질의가 충분히 싸다. slip 자체가 지워지는
--    cascade 경로에서는 부모 행이 이미 없어 update가 0행으로 끝난다(무해).
-- ---------------------------------------------------------------------
create or replace function public.payroll_slip_items_recalc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slip uuid;
begin
  if tg_op = 'DELETE' then
    v_slip := old.slip_id;
  else
    v_slip := new.slip_id;
  end if;

  update public.payroll_slips s
     set gross_total = c.gross,
         deduction_total = c.ded,
         net_total = c.gross - c.ded
    from (
      select
        coalesce(sum(amount) filter (where kind = 'payment'), 0) as gross,
        coalesce(sum(amount) filter (where kind = 'deduction'), 0) as ded
      from public.payroll_slip_items
      where slip_id = v_slip
    ) c
   where s.id = v_slip;

  return null;
end $$;

-- 트리거 전용 — 직접 호출 경로를 아예 닫는다(returns trigger라 PostgREST에
-- 노출되지도 않지만, definer 함수는 규약대로 revoke를 명시한다). 트리거
-- 발화는 EXECUTE 권한을 재검사하지 않으므로 grant 없이도 동작한다.
revoke all on function public.payroll_slip_items_recalc() from public;
revoke all on function public.payroll_slip_items_recalc() from anon;
revoke all on function public.payroll_slip_items_recalc() from authenticated;

drop trigger if exists payroll_slip_items_recalc on public.payroll_slip_items;
create trigger payroll_slip_items_recalc
  after insert or update or delete on public.payroll_slip_items
  for each row execute function public.payroll_slip_items_recalc();

-- ---------------------------------------------------------------------
-- 9. admin_save_payroll_slip() — 명세 + 항목 원자 등록/수정
--
--    명세 upsert와 항목 교체가 한 트랜잭션이어야 한다 — PostgREST로
--    나눠 쏘면 사이에서 끊겼을 때 "명세는 새 지급일인데 항목은 지난달
--    것"인 행이 남고, 그 상태는 화면 어디를 봐도 정상으로 보인다.
-- ---------------------------------------------------------------------
create or replace function public.admin_save_payroll_slip(
  p_employee_id uuid,
  p_pay_month date,
  p_pay_date date,
  p_memo text default null,
  p_items jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date;
  v_memo text := nullif(btrim(coalesce(p_memo, '')), '');
  v_item jsonb;
  v_kind text;
  v_name text;
  v_amount bigint;
  v_sort int;
  v_idx int := 0;
  v_id uuid;
begin
  -- definer 함수라 RLS가 지켜 주지 않는다 — 이 검사가 곧 권한이다
  if not public.is_system_admin() then
    raise exception '급여명세 등록은 시스템 관리자만 할 수 있습니다';
  end if;
  if p_employee_id is null or p_pay_month is null or p_pay_date is null then
    raise exception '대상 직원·급여월·지급일을 입력하세요';
  end if;
  if not exists (select 1 from public.employees e where e.id = p_employee_id) then
    raise exception '대상 직원을 찾을 수 없습니다';
  end if;
  -- 타입 검사를 길이 검사와 한 식에 두지 않는다 — SQL or는 단락 평가가
  -- 보장되지 않아 배열이 아닌 값에 jsonb_array_length가 날것 예외를 낼 수 있다
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception '항목 형식이 올바르지 않습니다';
  end if;
  if jsonb_array_length(p_items) = 0 then
    -- 항목 없는 명세는 합계가 전부 0이 된다 — 등록 의미가 없다
    raise exception '지급·공제 항목을 1건 이상 입력하세요';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception '항목은 100건 이내로 입력하세요';
  end if;
  if v_memo is not null and char_length(v_memo) > 1000 then
    raise exception '메모는 1000자 이내로 입력하세요';
  end if;

  v_month := date_trunc('month', p_pay_month)::date;

  insert into public.payroll_slips (employee_id, pay_month, pay_date, memo)
  values (p_employee_id, v_month, p_pay_date, v_memo)
  on conflict (employee_id, pay_month) do update
    set pay_date = excluded.pay_date,
        memo = excluded.memo
  returning id into v_id;

  -- 항목은 전체 교체 — 부분 수정을 허용하면 화면 상태와 어긋났을 때
  -- 남은 행을 추적할 방법이 없다. 재계산 트리거가 행마다 합계를 맞춘다.
  delete from public.payroll_slip_items where slip_id = v_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_idx := v_idx + 1;
    v_kind := v_item->>'kind';
    v_name := btrim(coalesce(v_item->>'name', ''));

    if v_kind is null or v_kind not in ('payment','deduction') then
      raise exception '항목 종류가 올바르지 않습니다 (%번째)', v_idx;
    end if;
    if v_name = '' or char_length(v_name) > 60 then
      raise exception '항목명은 1~60자로 입력하세요 (%번째)', v_idx;
    end if;
    -- CHECK에 맡기면 날것 위반 메시지가 그대로 노출된다. 소수·음수·문자 차단
    if coalesce(v_item->>'amount', '') !~ '^[0-9]{1,13}$' then
      raise exception '금액이 올바르지 않습니다 (%번째)', v_idx;
    end if;
    v_amount := (v_item->>'amount')::bigint;
    if v_item->>'sort' is not null and v_item->>'sort' !~ '^-?[0-9]{1,6}$' then
      raise exception '정렬값이 올바르지 않습니다 (%번째)', v_idx;
    end if;
    v_sort := coalesce((v_item->>'sort')::int, v_idx);

    insert into public.payroll_slip_items (slip_id, kind, name, amount, sort)
    values (v_id, v_kind, v_name, v_amount, v_sort);
  end loop;

  return v_id;
end $$;

-- 규약 1: revoke public만으로는 안 닫힌다 — Supabase 기본 default privileges가
-- anon·authenticated에 명시적 EXECUTE를 붙인다(마이그레이션 26·28 참고).
revoke all on function public.admin_save_payroll_slip(uuid, date, date, text, jsonb) from public;
revoke all on function public.admin_save_payroll_slip(uuid, date, date, text, jsonb) from anon;
revoke all on function public.admin_save_payroll_slip(uuid, date, date, text, jsonb) from authenticated;
grant execute on function public.admin_save_payroll_slip(uuid, date, date, text, jsonb) to authenticated;

comment on function public.admin_save_payroll_slip(uuid, date, date, text, jsonb) is
  '급여명세 등록/수정의 유일한 관문 — 명세 upsert + 항목 전체 교체를 한 트랜잭션으로. 합계는 재계산 트리거가 만든다. 첫 줄의 is_system_admin() 검사가 곧 권한이다.';

-- ---------------------------------------------------------------------
-- 10. 계약서 저장소 — 마이그레이션 28의 비공개 버킷 문법 재사용
--     경로 규칙: <employee_id>/<파일명> — 첫 세그먼트가 열람 권한 판정.
--     메일과 달리 업로더(관리자)와 열람자(당사자)가 달라 auth.uid()가
--     아니라 대상 직원의 employees.id를 경로에 쓴다.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employment-contracts',
  'employment-contracts',
  false,
  10485760,
  array[
    'application/pdf','image/png','image/jpeg','image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/x-hwp','application/haansofthwp','application/vnd.hancom.hwp'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 업로드·삭제는 관리자만. 경로 첫 세그먼트가 실재 직원인지도 여기서 죈다 —
-- 아무 문자열이나 쓰면 어느 직원에게도 열리지 않는 유령 파일이 쌓인다.
drop policy if exists "contract file admin insert" on storage.objects;
create policy "contract file admin insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'employment-contracts'
    and public.is_system_admin()
    and exists (
      select 1 from public.employees e
      where e.id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "contract file admin delete" on storage.objects;
create policy "contract file admin delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'employment-contracts'
    and public.is_system_admin()
  );

-- 열람은 당사자(경로 첫 세그먼트 = 내 직원 id)와 관리자만
drop policy if exists "contract file select" on storage.objects;
create policy "contract file select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'employment-contracts'
    and (
      public.is_system_admin()
      or (storage.foldername(name))[1] = public.current_employee_id()::text
    )
  );
