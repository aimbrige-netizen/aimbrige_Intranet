-- =====================================================================
-- 마이그레이션 27 — calendar_events.attendee_ids 제거 (expand-contract 마무리)
--
-- 마이그레이션 16이 참석자를 event_attendees로 승격하면서 배열을 남겨 뒀다.
-- "코드가 새 테이블로 옮겨간 뒤 별도 마이그레이션에서 지운다"고 적어 둔 그
-- 마이그레이션이다. 조회 경로는 이미 event_attendees만 본다(features/calendar
-- /data.ts의 EVENT_COLUMNS에 attendee_ids가 없다). 남아 있던 건 RLS 두 곳과
-- 서버 액션의 이중 쓰기뿐이고, 그 이중 쓰기는 이 마이그레이션과 같은 사이클에
-- 걷어냈다.
--
-- 순서를 지켜야 한다: 백필 → 읽는 곳(함수·정책) → 컬럼.
-- 뒤집으면 배열만 갖고 있던 참석자가 그대로 사라진다.
--
-- 이 마이그레이션을 돌리기 전까지의 창(窓): 코드는 이미 배열을 쓰지 않으므로
-- 그 사이 참석자를 **뺀** 일정은 배열에 옛 명단이 남는다. 아직 살아 있는 정책의
-- `any (attendee_ids)` 조건 때문에 빠진 사람에게 일정이 계속 보일 수 있다.
-- 반대 방향(배열 때문에 안 보이는 사람)은 생기지 않는다 — 배열은 열람을 더할
-- 뿐 빼지 않고, 지금 명단의 진실인 event_attendees는 is_event_attendee()가
-- 이미 같은 정책 안에서 보고 있다. 확인 시점의 참석자 데이터가 0건이라 실제로
-- 걸릴 일정도 0건이지만, 창을 길게 두지 말고 코드 배포와 같은 사이클에 돌려라.
--
-- 이 창의 현상이 "일시적·읽기 전용"으로 끝나려면 1번 백필이 그 옛 명단을 다시
-- 주워 담지 않아야 한다. 조건 없이 unnest(attendee_ids)를 insert하면 창 안에서
-- 제외된 참석자가 event_attendees의 행으로 되살아나 컬럼이 사라진 뒤에도
-- 영구히 남는다(응답까지 default 'pending'으로 초기화된 새 행이다). 1번에
-- 가드를 붙인 이유다.
--
-- 실행 시점 확인(2026-08-01, service role): calendar_events 1건 / attendee_ids
-- 원소 0개 / event_attendees 0행. 즉 "양쪽이 일치한다"가 아니라 "양쪽 다
-- 비어 있다"를 확인한 것이다. 표본이 비어 있어 아무것도 증명해 주지 않으므로
-- 백필을 안전망으로 남겨 두되 위 방향을 막는 가드를 붙였다 — 조건 + on conflict
-- do nothing이라 몇 번을 돌려도 같다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 안전망 백필
--
-- 노리는 건 하나뿐이다: 이중 쓰기 시절 syncEventAttendees가 실패해서
-- **테이블만 비어 있는** 일정(배열 쓰기는 일정 insert/update와 같은 문장이라
-- 반드시 반영되고 테이블 쪽만 빠질 수 있는 구조였다). 오늘은 0행이 들어간다.
--
-- 마이그레이션 16의 문장을 그대로 쓰지 않는다. 지금은 배열이 진실이 아니라
-- 뒤처진 사본이다 — 코드가 배열 쓰기를 끊은 뒤로는 참석자를 빼도 배열이 그대로
-- 남으므로, 조건 없는 insert는 "덜 옮겨진 사람을 채우는" 게 아니라 "일부러 뺀
-- 사람을 되살리는" 문장이 된다. 그래서 event_attendees에 행이 **하나도 없는**
-- 일정만 채운다. 행이 하나라도 있으면 sync가 돈 적이 있다는 뜻이고, 그 일정의
-- 진실은 배열이 아니라 테이블이다.
--
-- 남는 구멍 하나: 창 안에서 참석자를 전원 제외한 일정은 여기서도 테이블이 비어
-- 보여 배열이 되살아난다. 데이터만 보고는 "sync가 실패했다"와 구별할 수 없다.
-- 확인 시점 배열 원소가 0개라 실제 대상이 없고, 창을 짧게 두는 것 말고는
-- 막을 방법이 없다.
-- ---------------------------------------------------------------------
-- 컬럼 존재 여부로 감싸는 이유: 이 파일을 두 번 돌리면 3번에서 컬럼이 이미
-- 사라져 unnest(e.attendee_ids)가 'column does not exist'로 죽는다. 사람이
-- 손으로 실행하는 마이그레이션이라 두 번 돌아가는 일이 실제로 생긴다.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'calendar_events'
      and column_name = 'attendee_ids'
  ) then
    insert into public.event_attendees (event_id, employee_id)
    select e.id, a.employee_id
    from public.calendar_events e
    cross join lateral unnest(e.attendee_ids) as a(employee_id)
    where not exists (
      select 1 from public.event_attendees ea where ea.event_id = e.id
    )
    on conflict do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. 읽는 곳을 끊는다
--
-- 두 곳 다 바로 옆에 is_event_attendee()/event_attendees 조건이 이미 있다.
-- 명단이 테이블에만 있는 일정은 1번 백필이 채웠으니 열람을 잃는 사람이 없고,
-- 배열에만 남아 있던 이름(= 창 안에서 제외된 사람)은 여기서 열람을 잃는다 —
-- 그게 원래 의도한 결과다. 지금 명단의 진실은 event_attendees다.
-- ---------------------------------------------------------------------

/**
 * 일정 열람 권한 판정 (마이그레이션 16 → 17 → 여기).
 * SECURITY DEFINER인 이유는 16에 적은 그대로 — event_attendees 정책 안에서
 * calendar_events를 직접 조회하면 상호 재귀가 된다.
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
        -- 초대받은 사람도 그 일정의 참석자 명단을 볼 수 있어야 한다(17번)
        or public.is_event_attendee(e.id)
        or public.is_system_admin()
      )
  );
$$;

revoke all on function public.can_view_event(uuid) from public;
grant execute on function public.can_view_event(uuid) to authenticated;

-- 개인 일정이어도 참석자로 지정됐으면 보여야 한다 — 이제 판정은 조인 테이블만 본다
drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
  for select to authenticated
  using (
    owner_id = public.current_employee_id()
    or visibility = 'company'
    or (visibility = 'team' and public.is_my_team(team_id))
    or public.is_event_attendee(id)
    or public.is_system_admin()
  );

-- ---------------------------------------------------------------------
-- 3. 컬럼 제거
--
-- cascade를 붙이지 않는다. 아직 이 컬럼을 참조하는 정책이 남아 있을 때
-- cascade를 쓰면 그 정책이 조용히 통째로 삭제되고, calendar_events에 SELECT
-- 정책이 하나도 없는 상태(= RLS 기본 거부)가 되어 전 사용자의 캘린더가 빈
-- 화면이 된다. 의존 객체가 있으면 여기서 실패하게 두는 편이 안전하다 —
-- 실패가 곧 "2번이 덜 됐다"는 신호다.
--
-- GIN 인덱스 calendar_events_attendees_idx(마이그레이션 13)는 컬럼과 함께
-- 자동으로 사라진다. 따로 drop하지 않는다.
-- ---------------------------------------------------------------------
alter table public.calendar_events drop column if exists attendee_ids;
