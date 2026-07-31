-- =====================================================================
-- 마이그레이션 14 — 1차 팀장 검토를 문서유형별로 켜고 끈다
--
-- 지금까지는 "기안자 팀의 팀장(없으면 부서장)"이 무조건 1차 검토자로
-- 끼어들었다. 팀장이 아직 실제 인원으로 지정되지 않은 상태에서는 결재가
-- 엉뚱한 사람에게 가므로, 당분간 신청자 → 최종결재자 2단계로 운영한다.
--
-- 삭제가 아니라 스위치로 만든 이유: 팀장 배치가 끝나면 화면에서 켜기만 하면
-- 신청자 → 팀장 → 결재자 3단계로 돌아온다. 로직을 지웠다가 다시 짜지 않는다.
--
-- 켜져 있어도 팀장이 없거나 기안자 본인이면 그 단계는 자동으로 건너뛴다.
-- =====================================================================

alter table public.approval_line_configs
  add column if not exists use_team_review boolean not null default false;

comment on column public.approval_line_configs.use_team_review is
  '1차 팀장 검토 사용 여부. false면 신청자 → 최종결재자 2단계. '
  '팀장이 실제 인원으로 지정된 뒤에 켠다.';

-- ---------------------------------------------------------------------
-- 결재선 산정 — use_team_review를 반영
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
  team_review boolean;
begin
  select c.step2_approver_id, c.use_team_review
    into s2, team_review
  from public.approval_line_configs c
  where c.document_type = p_document_type;

  if s2 is null then
    raise exception '이 문서유형의 최종 승인자가 지정되지 않았습니다. 시스템 관리자에게 문의하세요.';
  end if;

  -- 본인이 최종 승인자면 아무도 승인할 수 없는 문서가 된다
  if s2 = p_requester then
    raise exception '본인이 이 문서유형의 최종 승인자로 지정되어 있어 직접 기안할 수 없습니다. 시스템 관리자에게 문의하세요.';
  end if;

  if coalesce(team_review, false) then
    select coalesce(t.manager_id, d.manager_id) into s1
    from public.employees e
    left join public.teams t on t.id = e.team_id
    left join public.departments d on d.id = e.department_id
    where e.id = p_requester;

    -- 팀장이 없거나 기안자 자신이면 1차를 건너뛴다
    if s1 = p_requester then
      s1 := null;
    end if;
  else
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
-- 바로 상신(임시저장을 거치지 않는 경로)도 같은 규칙을 쓰게 한다.
--
-- 마이그레이션 11의 submit_approval_document는 결재선 산정 로직을 자체
-- 복사본으로 갖고 있었다. 그대로 두면 "임시저장 후 상신"은 2단계인데
-- "바로 상신"은 3단계가 되어 같은 문서유형이 경로에 따라 다르게 흐른다.
-- ---------------------------------------------------------------------
create or replace function public.submit_approval_document(
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
  line record;
  new_doc_id uuid;
begin
  if requester is null then
    raise exception '기안 권한이 없습니다.';
  end if;

  select * into line
  from public.resolve_approval_line(requester, p_document_type);

  insert into public.approval_documents (
    document_type, title, form_data, requester_id, status, current_step
  )
  values (
    p_document_type, p_title, coalesce(p_form_data, '{}'::jsonb), requester,
    'pending', case when line.step1_approver is null then 2 else 1 end
  )
  returning id into new_doc_id;

  if line.step1_approver is not null then
    insert into public.approval_steps (document_id, step_order, approver_id)
    values (new_doc_id, 1, line.step1_approver);
  end if;

  insert into public.approval_steps (document_id, step_order, approver_id)
  values (new_doc_id, 2, line.step2_approver);

  insert into public.audit_logs (actor_id, action, target_id, detail)
  values (requester, 'approval.submit', new_doc_id,
          jsonb_build_object('from', 'direct'));

  return new_doc_id;
end;
$$;

revoke all on function public.submit_approval_document(text, text, jsonb) from public;
grant execute on function public.submit_approval_document(text, text, jsonb) to authenticated;
