-- =====================================================================
-- 마이그레이션 13 — 기능 결손 보완 (Phase 5)
--
-- 1. 전자결재 임시저장 · 상신 회수
--    기안자가 제출한 문서를 되돌릴 수단이 전혀 없었다. 결재 모듈로서
--    성립하지 않는 수준이라 레이아웃과 무관하게 필요하다.
-- 2. 게시글 조회수
-- 3. 캘린더 장소 · 참석자
--    회의 일정인데 "누가 오는가"와 "어디서 하는가"를 적을 필드가 없었다.
--
-- approval_documents에는 SELECT 정책만 있고 INSERT/UPDATE/DELETE 정책이
-- 없다(= authenticated에게 직접 쓰기가 막혀 있다). 모든 쓰기는 SECURITY
-- DEFINER 함수를 통과한다. 그 설계를 그대로 따른다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 결재 문서 상태에 draft 추가
-- ---------------------------------------------------------------------
alter table public.approval_documents
  drop constraint if exists approval_documents_status_check;

alter table public.approval_documents
  add constraint approval_documents_status_check
  check (status in ('draft','pending','rejected','approved','completed'));

-- 임시저장은 결재선이 아직 없으므로 단계 0으로 둔다
alter table public.approval_documents
  drop constraint if exists approval_documents_draft_step;

alter table public.approval_documents
  add constraint approval_documents_draft_step
  check (status <> 'draft' or current_step = 0);

comment on column public.approval_documents.current_step is
  '진행 중인 결재 단계. 임시저장(draft)은 0.';

-- ---------------------------------------------------------------------
-- 2. 결재선 산정 헬퍼
--    submit_approval_document(마이그레이션 11)과 새 submit_approval_draft이
--    같은 규칙을 써야 해서 한 곳으로 뺀다.
--      1차 = 기안자 팀장(없으면 부서장), 기안자 본인이면 건너뜀
--      2차 = 문서유형별 최종 승인자 (approval_line_configs)
-- ---------------------------------------------------------------------
create or replace function public.resolve_approval_line(
  p_requester uuid,
  p_document_type text
)
returns table (step1_approver uuid, step2_approver uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  s1 uuid;
  s2 uuid;
begin
  select coalesce(t.manager_id, d.manager_id) into s1
  from public.employees e
  left join public.teams t on t.id = e.team_id
  left join public.departments d on d.id = e.department_id
  where e.id = p_requester;

  select c.step2_approver_id into s2
  from public.approval_line_configs c
  where c.document_type = p_document_type;

  if s2 is null then
    raise exception '이 문서유형의 최종 승인자가 지정되지 않았습니다. 시스템 관리자에게 문의하세요.';
  end if;

  if s2 = p_requester then
    raise exception '본인이 이 문서유형의 최종 승인자로 지정되어 있어 직접 기안할 수 없습니다. 시스템 관리자에게 문의하세요.';
  end if;

  -- 1차 검토자가 없거나 기안자 자신이면 1차를 건너뛴다
  if s1 is null or s1 = p_requester then
    s1 := null;
  end if;

  step1_approver := s1;
  step2_approver := s2;
  return next;
end;
$$;

revoke all on function public.resolve_approval_line(uuid, text) from public;
grant execute on function public.resolve_approval_line(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. 임시저장 — 새로 만들거나 기존 draft를 덮어쓴다
--    결재선이 아직 지정되지 않았어도 저장은 된다. 상신할 때만 막힌다.
-- ---------------------------------------------------------------------
create or replace function public.save_approval_draft(
  p_document_id uuid,
  p_document_type text,
  p_title text,
  p_form_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  requester uuid := public.current_employee_id();
  doc_id uuid;
  existing record;
begin
  if requester is null then
    raise exception '기안 권한이 없습니다.';
  end if;

  if p_document_id is null then
    insert into public.approval_documents (
      document_type, title, form_data, requester_id, status, current_step
    )
    values (
      p_document_type,
      coalesce(nullif(btrim(p_title), ''), '제목 없음'),
      coalesce(p_form_data, '{}'::jsonb),
      requester,
      'draft',
      0
    )
    returning id into doc_id;
    return doc_id;
  end if;

  select id, requester_id, status into existing
  from public.approval_documents
  where id = p_document_id;

  if existing.id is null then
    raise exception '문서를 찾을 수 없습니다.';
  end if;
  if existing.requester_id is distinct from requester then
    raise exception '본인이 작성한 임시저장만 수정할 수 있습니다.';
  end if;
  if existing.status <> 'draft' then
    raise exception '이미 상신된 문서는 임시저장으로 수정할 수 없습니다.';
  end if;

  update public.approval_documents
  set document_type = p_document_type,
      title = coalesce(nullif(btrim(p_title), ''), '제목 없음'),
      form_data = coalesce(p_form_data, '{}'::jsonb),
      updated_at = now()
  where id = p_document_id;

  return p_document_id;
end;
$$;

revoke all on function public.save_approval_draft(uuid, text, text, jsonb) from public;
grant execute on function public.save_approval_draft(uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 4. 임시저장 상신
-- ---------------------------------------------------------------------
create or replace function public.submit_approval_draft(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  requester uuid := public.current_employee_id();
  doc record;
  line record;
begin
  if requester is null then
    raise exception '기안 권한이 없습니다.';
  end if;

  select id, requester_id, status, document_type into doc
  from public.approval_documents
  where id = p_document_id;

  if doc.id is null then
    raise exception '문서를 찾을 수 없습니다.';
  end if;
  if doc.requester_id is distinct from requester then
    raise exception '본인이 작성한 문서만 상신할 수 있습니다.';
  end if;
  if doc.status <> 'draft' then
    raise exception '임시저장 상태의 문서만 상신할 수 있습니다.';
  end if;

  select * into line
  from public.resolve_approval_line(requester, doc.document_type);

  -- 회수 후 재상신이면 이전 결재선이 남아 있을 수 있다
  delete from public.approval_steps where document_id = p_document_id;

  if line.step1_approver is not null then
    insert into public.approval_steps (document_id, step_order, approver_id)
    values (p_document_id, 1, line.step1_approver);
  end if;

  insert into public.approval_steps (document_id, step_order, approver_id)
  values (p_document_id, 2, line.step2_approver);

  update public.approval_documents
  set status = 'pending',
      current_step = case when line.step1_approver is null then 2 else 1 end,
      updated_at = now()
  where id = p_document_id;

  insert into public.audit_logs (actor_id, action, target_id, detail)
  values (requester, 'approval.submit', p_document_id,
          jsonb_build_object('from', 'draft'));

  return p_document_id;
end;
$$;

revoke all on function public.submit_approval_draft(uuid) from public;
grant execute on function public.submit_approval_draft(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. 상신 회수
--    아직 아무도 승인하지 않은 문서만 되돌릴 수 있다. 한 단계라도 승인된
--    뒤에 회수를 허용하면 그 승인 기록이 조용히 사라진다.
--    회수한 문서는 임시저장으로 돌아가 수정 후 다시 올릴 수 있다.
-- ---------------------------------------------------------------------
create or replace function public.withdraw_approval_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requester uuid := public.current_employee_id();
  doc record;
  approved_count int;
begin
  if requester is null then
    raise exception '권한이 없습니다.';
  end if;

  select id, requester_id, status into doc
  from public.approval_documents
  where id = p_document_id;

  if doc.id is null then
    raise exception '문서를 찾을 수 없습니다.';
  end if;
  if doc.requester_id is distinct from requester then
    raise exception '본인이 올린 문서만 회수할 수 있습니다.';
  end if;
  if doc.status <> 'pending' then
    raise exception '진행 중인 문서만 회수할 수 있습니다.';
  end if;

  select count(*) into approved_count
  from public.approval_steps
  where document_id = p_document_id and status = 'approved';

  if approved_count > 0 then
    raise exception '이미 결재가 진행된 문서는 회수할 수 없습니다. 승인자에게 반려를 요청하세요.';
  end if;

  delete from public.approval_steps where document_id = p_document_id;

  update public.approval_documents
  set status = 'draft', current_step = 0, updated_at = now()
  where id = p_document_id;

  insert into public.audit_logs (actor_id, action, target_id, detail)
  values (requester, 'approval.withdraw', p_document_id, '{}'::jsonb);
end;
$$;

revoke all on function public.withdraw_approval_document(uuid) from public;
grant execute on function public.withdraw_approval_document(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. 임시저장 삭제
--    상신된 문서는 지울 수 없다(감사 추적). draft만 허용.
-- ---------------------------------------------------------------------
create or replace function public.delete_approval_draft(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requester uuid := public.current_employee_id();
  doc record;
begin
  select id, requester_id, status into doc
  from public.approval_documents
  where id = p_document_id;

  if doc.id is null then
    raise exception '문서를 찾을 수 없습니다.';
  end if;
  if doc.requester_id is distinct from requester then
    raise exception '본인이 작성한 임시저장만 삭제할 수 있습니다.';
  end if;
  if doc.status <> 'draft' then
    raise exception '상신된 문서는 삭제할 수 없습니다.';
  end if;

  delete from public.approval_documents where id = p_document_id;
end;
$$;

revoke all on function public.delete_approval_draft(uuid) from public;
grant execute on function public.delete_approval_draft(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. 게시글 조회수
--    post_reads는 "누가 읽었나"(공지 열람률용)이고, 이건 총 조회수다.
--    본인 글은 세지 않는다.
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists view_count int not null default 0;

create or replace function public.increment_post_view(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer uuid := public.current_employee_id();
begin
  if viewer is null then
    return;
  end if;

  update public.posts
  set view_count = view_count + 1
  where id = p_post_id
    and author_id is distinct from viewer;
end;
$$;

revoke all on function public.increment_post_view(uuid) from public;
grant execute on function public.increment_post_view(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. 캘린더 장소 · 참석자
-- ---------------------------------------------------------------------
alter table public.calendar_events
  add column if not exists location text;

alter table public.calendar_events
  add column if not exists attendee_ids uuid[] not null default '{}';

comment on column public.calendar_events.attendee_ids is
  '참석자 employees.id 배열. 조인 테이블 대신 배열을 쓴 이유는 참석 여부 응답(수락/거절)을 아직 다루지 않기 때문. 응답이 필요해지면 별도 테이블로 승격한다.';

-- 개인 일정이어도 참석자로 지정됐으면 보여야 한다
drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
  for select to authenticated
  using (
    owner_id = public.current_employee_id()
    or visibility = 'company'
    or (visibility = 'team' and public.is_my_team(team_id))
    or public.current_employee_id() = any (attendee_ids)
    or public.is_system_admin()
  );

-- 참석자 배열 조회를 위한 GIN 인덱스 (내 일정 필터가 이 배열을 탄다)
create index if not exists calendar_events_attendees_idx
  on public.calendar_events using gin (attendee_ids);
