-- =====================================================================
-- 마이그레이션 17 — 참석자가 참석자 명단을 못 보던 문제
--
-- 마이그레이션 16의 can_view_event()에 "내가 이 일정의 참석자인가" 조건이
-- 빠져 있었다. calendar_events 쪽 정책에는 is_event_attendee()를 넣었는데
-- 헬퍼에는 안 넣어서, visibility='personal'인 남의 일정에 초대된 사람은
--   · 일정 자체는 보이고 (calendar_events 정책이 열어 줌)
--   · 참석 응답도 되는데 (respond_to_event는 본인 행만 본다)
--   · 참석자 명단은 "나 1명"으로 축소된다
--     (event_attendees_select가 '본인 행' 조건만 통과시키므로)
-- 회의 참석자가 다른 참석자를 못 보는 상태다.
--
-- 조건 하나를 더한다. 재귀는 나지 않는다 — 두 헬퍼 모두 SECURITY DEFINER라
-- 호출 안에서 RLS가 다시 평가되지 않는다.
-- =====================================================================

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
        -- 초대받은 사람도 그 일정의 참석자 명단을 볼 수 있어야 한다
        or public.current_employee_id() = any (e.attendee_ids)
        or public.is_event_attendee(e.id)
        or public.is_system_admin()
      )
  );
$$;

revoke all on function public.can_view_event(uuid) from public;
grant execute on function public.can_view_event(uuid) to authenticated;
