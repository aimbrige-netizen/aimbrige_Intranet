-- =====================================================================
-- 마이그레이션 29 — Gmail 연동 토큰 계층 (외부 수발신 1단계)
--
-- 회사가 @aimbrige.kr Google Workspace 로그인으로 전환하면서, 같은
-- Supabase Google OAuth에 Gmail 스코프를 추가해 provider refresh token으로
-- 본인 메일함을 읽고 보낸다. 이 마이그레이션은 그 refresh token을 담는
-- 서버 전용 저장소만 만든다 — Gmail API 호출·화면은 다른 계층의 일이다.
--
-- ── 토큰 계층 보안 원칙 (어기면 반려) ────────────────────────────────
--
-- refresh token은 사실상 "본인 메일함 열쇠"다. 클라이언트(브라우저)에
-- 절대 내려가면 안 되고, PostgREST 경로로도 읽히면 안 된다. 그래서:
--
--   1) RLS enable + 정책 0개 — anon/authenticated의 SELECT/INSERT/UPDATE/
--      DELETE가 전부 막힌다. RLS를 우회하는 service role(서버 코드의
--      createAdminSupabase)만 이 테이블에 닿는다. "정책이 없는 것"이
--      실수가 아니라 설계다.
--   2) authenticated에게 필요한 정보는 "내 연동이 있는가" 하나뿐이다.
--      그것만 has_gmail_connection() definer 함수로 노출한다 — boolean만
--      돌려주고 토큰·이메일 등 행 내용은 어떤 경로로도 내주지 않는다.
--   3) access token은 아예 저장하지 않는다(서버 프로세스 메모리 캐시만).
--      DB에 남는 것은 refresh token뿐이다.
--
-- 보안 규약 준수 요약:
--   · SECURITY DEFINER 함수: set search_path = public + revoke
--     public/anon/authenticated 후 grant to authenticated (규약 1)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. gmail_connections — 임직원별 Gmail 연동 (refresh token 금고)
-- ---------------------------------------------------------------------
create table if not exists public.gmail_connections (
  /*
   * employee_id가 곧 PK — 임직원당 연동은 하나다. 재로그인으로 새 refresh
   * token이 오면 upsert로 덮어쓴다(구 토큰은 Google 쪽에서 어차피 무효화될
   * 수 있다). on delete cascade: 임직원 행이 지워지면 열쇠도 함께 지운다.
   */
  employee_id uuid primary key
    references public.employees(id) on delete cascade,
  /** 연동된 Google 계정 이메일 (로그인 계정과 같지만 감사·표시용으로 기록) */
  google_email text not null,
  /** Google provider refresh token — 이 컬럼이 이 테이블의 존재 이유이자 절대 비노출 대상 */
  refresh_token text not null,
  /** 연동 당시 요청한 스코프 — gmail.readonly만 있던 시절 토큰인지 구분할 때 쓴다 */
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.gmail_connections is
  'Gmail provider refresh token 저장소. RLS 정책 0개 = service role 전용(의도된 설계). 클라이언트/PostgREST 접근 금지.';

drop trigger if exists gmail_connections_touch_updated_at on public.gmail_connections;
create trigger gmail_connections_touch_updated_at
  before update on public.gmail_connections
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 2. RLS — enable 하되 정책을 하나도 만들지 않는다
--
--    정책 0개 + RLS enable = anon/authenticated는 모든 명령이 거부되고,
--    RLS를 우회하는 service role만 통과한다. 이 테이블에 "본인 행은 읽게"
--    같은 정책을 추가하면 refresh token이 PostgREST로 새어 나간다 —
--    어떤 정책도 추가하지 말 것.
-- ---------------------------------------------------------------------
alter table public.gmail_connections enable row level security;

-- ---------------------------------------------------------------------
-- 3. has_gmail_connection() — "내 연동이 있는가"만 알려주는 구멍
--
--    화면(메일 설정, /mail 소스 분기)은 연동 여부만 알면 된다.
--    SECURITY DEFINER로 RLS를 우회해 존재 여부만 boolean으로 돌려준다.
--    행 내용(토큰·이메일·스코프)은 어떤 형태로도 반환하지 않는다.
--
--    NULL 안전(마이그레이션 04의 교훈): employees 행이 없는 auth 계정은
--    current_employee_id()가 NULL인데, `employee_id = NULL`은 어떤 행과도
--    매치되지 않고 exists는 NULL 없이 항상 true/false만 돌려준다 —
--    미등록 계정은 자연스럽게 false다.
-- ---------------------------------------------------------------------
create or replace function public.has_gmail_connection()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.gmail_connections c
    where c.employee_id = public.current_employee_id()
  )
$$;

revoke all on function public.has_gmail_connection() from public;
revoke all on function public.has_gmail_connection() from anon;
revoke all on function public.has_gmail_connection() from authenticated;
grant execute on function public.has_gmail_connection() to authenticated;
