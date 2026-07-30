-- =====================================================================
-- 보안 수정 — SECURITY DEFINER 함수의 권한 검사 강화
--
-- 배경:
--   마이그레이션 03의 get_emergency_contact()는 아래처럼 검사했다.
--
--     if not (target = current_employee_id() or is_system_admin()) then
--       raise exception ...
--
--   employees 행이 없는 auth 계정(초대만 받고 미등록, 또는 퇴사 후 행 삭제 등)은
--   current_employee_id()가 NULL이다. 그러면
--     target = NULL        -> NULL
--     NULL or false        -> NULL
--     not NULL             -> NULL
--   이 되고 `if NULL then`은 분기를 타지 않아 권한 검사가 통째로 건너뛰어졌다.
--   함수가 SECURITY DEFINER라 RLS도 우회하므로, 그런 계정이 임의 임직원의
--   비상연락처를 읽을 수 있었다(실제 재현 확인).
--
--   NULL이 섞인 boolean 식을 if 조건에 그대로 쓰지 않도록 전부 고쳐 쓴다.
-- =====================================================================

create or replace function public.get_emergency_contact(target_employee_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller_id uuid := public.current_employee_id();
  is_admin  boolean := coalesce(public.is_system_admin(), false);
  result    text;
begin
  -- 인자 누락
  if target_employee_id is null then
    raise exception '조회 대상이 지정되지 않았습니다.';
  end if;

  -- 임직원으로 등록되지 않은 계정은 무조건 거부(NULL 비교로 새지 않게 먼저 차단)
  if caller_id is null then
    raise exception '비상연락처를 조회할 권한이 없습니다.';
  end if;

  if target_employee_id <> caller_id and not is_admin then
    raise exception '비상연락처를 조회할 권한이 없습니다.';
  end if;

  select emergency_contact into result
  from public.employees
  where id = target_employee_id;

  return result;
end $$;

revoke all on function public.get_emergency_contact(uuid) from public;
grant execute on function public.get_emergency_contact(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 조직 변경 이력도 등록된 임직원만 조회할 수 있게 한다.
-- (민감도는 낮지만 SECURITY DEFINER라 RLS를 우회하므로 동일하게 막는다)
-- ---------------------------------------------------------------------
create or replace function public.list_org_history(target_employee_id uuid)
returns table (id uuid, action text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_employee_id() is null then
    raise exception '조회 권한이 없습니다.';
  end if;

  return query
    select l.id, l.action, l.created_at
    from public.audit_logs l
    where l.target_id = target_employee_id
      and l.action in (
        'employee_created',
        'employee_transferred',
        'employee_promoted'
      )
    order by l.created_at desc
    limit 30;
end $$;

revoke all on function public.list_org_history(uuid) from public;
grant execute on function public.list_org_history(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- is_my_team도 NULL 안전하게 정리 (현재도 동작하지만 의도를 명확히 남긴다)
-- ---------------------------------------------------------------------
create or replace function public.is_my_team(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    target_team_id is not null
    and exists (
      select 1 from public.employees e
      where e.auth_user_id = auth.uid()
        and e.team_id = target_team_id
    ),
    false
  )
$$;

revoke all on function public.is_my_team(uuid) from public;
grant execute on function public.is_my_team(uuid) to authenticated;
