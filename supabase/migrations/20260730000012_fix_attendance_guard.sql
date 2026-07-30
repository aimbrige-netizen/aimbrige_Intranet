-- =====================================================================
-- 근태 자기수정 가드가 무력화돼 있던 문제 수정
--
-- 마이그레이션 08의 attendance_guard_self()는 SECURITY DEFINER로 선언돼 있었다.
-- SECURITY DEFINER 함수 안에서는 current_user가 호출자가 아니라 **함수 소유자**
-- (postgres)로 바뀐다. 그런데 함수 첫 줄이
--
--   if current_user in ('postgres','supabase_admin','service_role') ... then
--     return new;
--
-- 이라서, 일반 사용자가 호출해도 current_user가 'postgres'로 평가돼
-- **항상 통과**했다. 결과적으로 가드가 한 번도 동작하지 않았고
--   - 지난 날짜 근태를 임의로 만들 수 있었고
--   - 관리자 전용 manual_adjustment_reason을 직접 쓸 수 있었으며
--   - status(정상/지각)도 클라이언트 값이 그대로 저장됐다
-- (실제 재현 확인함)
--
-- 트리거는 호출자 권한(SECURITY INVOKER, 기본값)으로 돌아야 current_user가
-- 실제 롤(authenticated)로 잡힌다. 관리자 경로(approve_correction_request,
-- admin_set_attendance)는 그 자체가 SECURITY DEFINER라 그 안에서 실행될 때
-- current_user가 postgres가 되므로 의도대로 계속 우회된다.
--
-- 아울러 is_system_admin() 우회 분기를 제거했다. 관리자도 본인 출퇴근은 같은
-- 규칙을 따라야 하고, 남의 기록 수정은 admin_set_attendance RPC로 하면 된다.
-- =====================================================================

create or replace function public.attendance_guard_self()
returns trigger
language plpgsql
-- SECURITY INVOKER (명시). DEFINER로 두면 current_user가 소유자로 바뀌어
-- 아래 우회 분기가 항상 참이 된다 — 이 함수는 반드시 호출자 권한으로 돌아야 한다.
security invoker
set search_path = public
as $$
begin
  -- service_role 경유 쓰기와 SECURITY DEFINER 함수(관리자 경로) 안에서의
  -- 쓰기는 그대로 통과시킨다.
  if current_user in ('postgres','supabase_admin','service_role')
     or auth.uid() is null then
    return new;
  end if;

  if new.employee_id is distinct from public.current_employee_id() then
    raise exception '본인 근태만 기록할 수 있습니다.';
  end if;

  -- 지난 날짜를 직접 만들거나 고치는 것은 막는다. 정정은 수정요청 경로로.
  if new.work_date <> (now() at time zone 'Asia/Seoul')::date then
    raise exception '오늘 날짜의 근태만 직접 기록할 수 있습니다. 지난 기록은 근태 수정요청을 이용하세요.';
  end if;

  -- 관리자·승인 경로 전용 필드는 사용자가 쓸 수 없다
  if tg_op = 'UPDATE' then
    new.manual_adjustment_reason := old.manual_adjustment_reason;
    if old.check_in_at is not null
       and new.check_in_at is distinct from old.check_in_at then
      raise exception '기록된 출근 시각은 직접 변경할 수 없습니다. 근태 수정요청을 이용하세요.';
    end if;
  else
    new.manual_adjustment_reason := null;
  end if;

  -- 상태는 클라이언트 값을 신뢰하지 않고 항상 시각에서 재계산한다
  new.status := public.compute_attendance_status(new.check_in_at, new.check_out_at);

  return new;
end $$;

drop trigger if exists attendance_guard_self on public.attendance_records;
create trigger attendance_guard_self
  before insert or update on public.attendance_records
  for each row execute function public.attendance_guard_self();

-- ---------------------------------------------------------------------
-- 같은 함정이 다른 트리거에도 있는지 점검
--   employees_guard_self_update(마이그레이션 01)도 동일한 패턴이다.
--   이쪽은 컬럼 단위 UPDATE 권한(마이그레이션 03)이 이미 본인 수정 범위를
--   phone·emergency_contact·profile_image_url로 강제하고 있어 실제 피해는
--   없었지만, 방어선이 하나 죽어 있는 상태이므로 같이 고친다.
-- ---------------------------------------------------------------------
create or replace function public.employees_guard_self_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('postgres','supabase_admin','service_role')
     or auth.uid() is null
     or public.is_system_admin() then
    return new;
  end if;

  if new.email             is distinct from old.email
     or new.name           is distinct from old.name
     or new.department_id   is distinct from old.department_id
     or new.team_id         is distinct from old.team_id
     or new.position        is distinct from old.position
     or new.role_id         is distinct from old.role_id
     or new.employment_status is distinct from old.employment_status
     or new.hire_date       is distinct from old.hire_date
     or new.auth_user_id    is distinct from old.auth_user_id then
    raise exception '본인이 직접 수정할 수 없는 항목입니다. 시스템 관리자에게 문의하세요.';
  end if;

  return new;
end $$;

drop trigger if exists employees_guard_self_update on public.employees;
create trigger employees_guard_self_update
  before update on public.employees
  for each row execute function public.employees_guard_self_update();
