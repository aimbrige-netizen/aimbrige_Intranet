-- =====================================================================
-- 공휴일 (캘린더 표시 + 스펙 03 연차 계산 기준)
--
-- 음력 기반 공휴일(설날·추석·부처님오신날)과 대체공휴일은 규칙만으로 계산할 수 없어
-- 데이터로 관리한다. 임시공휴일(선거일 등)도 정부 고시로 수시로 생기므로
-- 관리자가 화면에서 추가·삭제할 수 있어야 한다.
-- =====================================================================

create table if not exists public.holidays (
  date date primary key,
  name text not null,
  kind text not null default 'public'
    check (kind in ('public','substitute','temporary','statutory_leave')),
  -- 근무일 산정에서 제외할지 (연차 차감·근무시간 집계에 사용)
  is_non_working boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.holidays.kind is
  'public=법정공휴일 / substitute=대체공휴일 / temporary=임시공휴일(선거일 등) / statutory_leave=근로기준법상 유급휴일(근로자의 날)';

create index if not exists holidays_date_idx on public.holidays (date);

drop trigger if exists holidays_touch_updated_at on public.holidays;
create trigger holidays_touch_updated_at
  before update on public.holidays
  for each row execute function public.touch_updated_at();

alter table public.holidays enable row level security;

drop policy if exists holidays_select on public.holidays;
create policy holidays_select on public.holidays
  for select to authenticated using (true);

drop policy if exists holidays_write on public.holidays;
create policy holidays_write on public.holidays
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

-- ---------------------------------------------------------------------
-- 2026년 공휴일 시딩
--
-- 출처를 교차 확인한 값이지만, 임시공휴일 추가·대체공휴일 확정은 정부 고시에
-- 따라 바뀔 수 있다. 최종 확정은 관리자 화면(/admin/holidays)에서 조정한다.
--
-- 대체공휴일 적용 근거(관공서의 공휴일에 관한 규정 제3조):
--   삼일절 3/1(일) → 3/2 / 부처님오신날 5/24(일) → 5/25
--   광복절 8/15(토) → 8/17 / 개천절 10/3(토) → 10/5
--   현충일 6/6(토)은 대체공휴일 대상이 아니라 대체 없음
--   추석 연휴 9/26(토)은 '일요일과 겹칠 때'만 대체 대상이라 대체 없음
-- ---------------------------------------------------------------------
insert into public.holidays (date, name, kind) values
  ('2026-01-01', '신정',                  'public'),
  ('2026-02-16', '설날 연휴',             'public'),
  ('2026-02-17', '설날',                  'public'),
  ('2026-02-18', '설날 연휴',             'public'),
  ('2026-03-01', '삼일절',                'public'),
  ('2026-03-02', '삼일절 대체공휴일',      'substitute'),
  ('2026-05-01', '근로자의 날',            'statutory_leave'),
  ('2026-05-05', '어린이날',              'public'),
  ('2026-05-24', '부처님오신날',           'public'),
  ('2026-05-25', '부처님오신날 대체공휴일', 'substitute'),
  ('2026-06-03', '지방선거일',             'temporary'),
  ('2026-06-06', '현충일',                'public'),
  ('2026-08-15', '광복절',                'public'),
  ('2026-08-17', '광복절 대체공휴일',      'substitute'),
  ('2026-09-24', '추석 연휴',             'public'),
  ('2026-09-25', '추석',                  'public'),
  ('2026-09-26', '추석 연휴',             'public'),
  ('2026-10-03', '개천절',                'public'),
  ('2026-10-05', '개천절 대체공휴일',      'substitute'),
  ('2026-10-09', '한글날',                'public'),
  ('2026-12-25', '성탄절',                'public')
on conflict (date) do update
  set name = excluded.name,
      kind = excluded.kind;
