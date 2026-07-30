-- =====================================================================
-- 스펙 04 보안·정합성 보강
--
-- 코드 리뷰에서 확인된 결함 수정. 치명적인 것 두 가지가 핵심이다.
--
-- (1) RLS 정책 상호 재귀 [치명적]
--     approval_docs_select가 approval_steps를 참조하고, approval_steps_select가
--     다시 approval_documents를 참조해서 Postgres가
--       ERROR: infinite recursion detected in policy for relation ...
--     를 낸다. 정책 본문은 행마다 지연 평가가 아니라 rewrite 시점에 구조적으로
--     확장되므로, OR 분기를 타지 않는 조회(본인 문서 목록 등)에서도 터진다.
--     즉 결재 모듈 전체가 동작하지 않는 상태였다.
--     → 마이그레이션 07이 이미 만들어둔 definer 함수 패턴을 두 정책에 실제로
--       적용한다. definer 함수 안에서는 RLS가 우회되므로 순환이 끊긴다.
--
-- (2) 최종 승인자의 자가승인이 막혀 있지 않았다 [치명적]
--     step1(팀장)만 "기안자 == 검토자" 검사를 했고, step2(최종승인자)에는
--     아무 검사가 없었다. 최종승인자는 관리자가 임직원 중 누구든 지정할 수
--     있어서, 경비청구서 최종승인자로 지정된 사람이 자기 경비청구서를 올려
--     스스로 최종 승인할 수 있었다. 2인 검증 원칙이 무력화된다.
--     → process_approval_step에서 기안자 == 처리자를 전면 차단하고,
--       애초에 그런 문서가 만들어지지 않도록 제출 단계에서도 막는다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 순환을 끊는 definer 헬퍼
-- ---------------------------------------------------------------------
create or replace function public.is_approval_step_approver(doc_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (
    select 1 from public.approval_steps s
    where s.document_id = doc_id
      and s.approver_id = public.current_employee_id()
  ), false)
$$;

create or replace function public.is_approval_requester(doc_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (
    select 1 from public.approval_documents d
    where d.id = doc_id
      and d.requester_id = public.current_employee_id()
  ), false)
$$;

revoke all on function public.is_approval_step_approver(uuid) from public;
revoke all on function public.is_approval_requester(uuid) from public;
grant execute on function public.is_approval_step_approver(uuid) to authenticated;
grant execute on function public.is_approval_requester(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. 정책 교체 — 서로를 직접 참조하지 않게
-- ---------------------------------------------------------------------
drop policy if exists approval_docs_select on public.approval_documents;
create policy approval_docs_select on public.approval_documents
  for select to authenticated
  using (
    requester_id = public.current_employee_id()
    or public.is_system_admin()
    or public.is_approval_step_approver(id)
  );

drop policy if exists approval_steps_select on public.approval_steps;
create policy approval_steps_select on public.approval_steps
  for select to authenticated
  using (
    approver_id = public.current_employee_id()
    or public.is_system_admin()
    or public.is_approval_requester(document_id)
  );

-- ---------------------------------------------------------------------
-- 3. 자가승인 차단 + 관리자 대리 처리 허용
--    스펙 3.6은 "팀장 부재 시 관리자 대리 처리"를 요구하는데, 기존 함수는
--    담당자 본인만 허용해서 담당자가 퇴사·휴직하면 문서가 영구히 멈췄다.
-- ---------------------------------------------------------------------
create or replace function public.process_approval_step(
  p_document_id uuid,
  p_approve boolean,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := public.current_employee_id();
  doc record;
  step record;
  has_next boolean;
begin
  if actor is null then
    raise exception '처리 권한이 없습니다.';
  end if;

  select * into doc from public.approval_documents
  where id = p_document_id for update;

  if doc is null then
    raise exception '문서를 찾을 수 없습니다.';
  end if;
  if doc.status <> 'pending' then
    raise exception '이미 처리가 완료된 문서입니다.';
  end if;

  -- 기안자는 어떤 단계도 스스로 처리할 수 없다(관리자도 예외 없음).
  -- 최종승인자 자리에 기안자 본인이 지정돼 있어도 여기서 막힌다.
  if doc.requester_id = actor then
    raise exception '본인이 기안한 문서는 스스로 결재할 수 없습니다.';
  end if;

  select * into step from public.approval_steps
  where document_id = p_document_id
    and step_order = doc.current_step
  for update;

  if step is null then
    raise exception '처리할 결재 단계가 없습니다.';
  end if;
  if step.status <> 'pending' then
    raise exception '이미 처리한 단계입니다.';
  end if;

  -- 지정 담당자 본인, 또는 시스템 관리자의 대리 처리만 허용
  if not (step.approver_id = actor or public.is_system_admin()) then
    raise exception '현재 단계의 결재자만 처리할 수 있습니다.';
  end if;

  if not p_approve and (p_comment is null or btrim(p_comment) = '') then
    raise exception '반려 사유는 필수입니다.';
  end if;

  update public.approval_steps
  set status = case when p_approve then 'approved' else 'rejected' end,
      comment = p_comment,
      -- 대리 처리한 경우 실제 처리자를 남긴다(감사 추적)
      approver_id = coalesce(step.approver_id, actor),
      processed_at = now()
  where id = step.id;

  if not p_approve then
    update public.approval_documents
    set status = 'rejected'
    where id = p_document_id;
    return;
  end if;

  select exists (
    select 1 from public.approval_steps
    where document_id = p_document_id and step_order > doc.current_step
  ) into has_next;

  if has_next then
    update public.approval_documents
    set current_step = (
      select min(step_order) from public.approval_steps
      where document_id = p_document_id and step_order > doc.current_step
    )
    where id = p_document_id;
  else
    update public.approval_documents
    set status = 'approved'
    where id = p_document_id;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. 제출 단계에서도 막는다 — 승인 불가능한 문서를 애초에 만들지 않게
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
  step1_approver uuid;
  step2_approver uuid;
  new_doc_id uuid;
begin
  if requester is null then
    raise exception '기안 권한이 없습니다.';
  end if;

  select coalesce(t.manager_id, d.manager_id) into step1_approver
  from public.employees e
  left join public.teams t on t.id = e.team_id
  left join public.departments d on d.id = e.department_id
  where e.id = requester;

  select c.step2_approver_id into step2_approver
  from public.approval_line_configs c
  where c.document_type = p_document_type;

  if step2_approver is null then
    raise exception '이 문서유형의 최종 승인자가 지정되지 않았습니다. 시스템 관리자에게 문의하세요.';
  end if;

  -- 본인이 최종 승인자면 아무도 승인할 수 없는 문서가 된다
  if step2_approver = requester then
    raise exception '본인이 이 문서유형의 최종 승인자로 지정되어 있어 직접 기안할 수 없습니다. 시스템 관리자에게 문의하세요.';
  end if;

  -- 1차 검토자가 없거나 기안자 자신이면 1차를 건너뛴다
  if step1_approver is null or step1_approver = requester then
    step1_approver := null;
  end if;

  insert into public.approval_documents (
    document_type, title, form_data, requester_id, status, current_step
  )
  values (
    p_document_type, p_title, coalesce(p_form_data, '{}'::jsonb), requester,
    'pending', case when step1_approver is null then 2 else 1 end
  )
  returning id into new_doc_id;

  if step1_approver is not null then
    insert into public.approval_steps (document_id, step_order, approver_id)
    values (new_doc_id, 1, step1_approver);
  end if;

  insert into public.approval_steps (document_id, step_order, approver_id)
  values (new_doc_id, 2, step2_approver);

  return new_doc_id;
end $$;

-- ---------------------------------------------------------------------
-- 5. 첨부파일 — 진행중 문서에만 추가 가능
--    삭제 정책에는 status='pending' 조건이 있었는데 등록에는 없어서
--    승인·반려가 끝난 문서에 사후 첨부가 가능했다.
-- ---------------------------------------------------------------------
drop policy if exists approval_attachments_insert on public.approval_attachments;
create policy approval_attachments_insert on public.approval_attachments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.approval_documents d
      where d.id = document_id
        and d.requester_id = public.current_employee_id()
        and d.status = 'pending'
    )
  );

-- ---------------------------------------------------------------------
-- 6. 첨부 스토리지 조회 정책 정리
--    기존 정책은 approval_attachments.file_url이 storage.objects.name과
--    정확히 같은 문자열이어야 매칭됐다. 앱이 공개 URL을 저장하면 절대 매칭되지
--    않아 조용히 안 보이는 함정이 된다. 경로 규칙(uid/문서id/파일명)만으로
--    판정하도록 바꿔 문자열 포맷 의존을 없앤다.
-- ---------------------------------------------------------------------
create or replace function public.can_view_attachment_path(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  parts text[];
  doc_id uuid;
begin
  if public.current_employee_id() is null then
    return false;
  end if;

  parts := storage.foldername(object_name);
  -- 규칙: <업로더 auth uid>/<문서 id>/<파일명>
  if array_length(parts, 1) < 2 then
    return false;
  end if;

  -- 본인이 올린 파일은 항상 볼 수 있다
  if parts[1] = auth.uid()::text then
    return true;
  end if;

  begin
    doc_id := parts[2]::uuid;
  exception when others then
    return false;
  end;

  return public.can_view_approval_document(doc_id);
end $$;

revoke all on function public.can_view_attachment_path(text) from public;
grant execute on function public.can_view_attachment_path(text) to authenticated;

drop policy if exists "approval attach viewer select" on storage.objects;
create policy "approval attach viewer select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'approval-attachments'
    and public.can_view_attachment_path(name)
  );

-- 업로드도 <uid>/<문서id>/ 규칙을 강제한다
drop policy if exists "approval attach owner insert" on storage.objects;
create policy "approval attach owner insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'approval-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) >= 2
  );

-- ---------------------------------------------------------------------
-- 7. 캘린더용 출장·재택 조회 (스펙 04 · 7장)
--
--    approval_documents RLS는 "기안자 + 담당 결재자 + 관리자"라, 동료의 출장을
--    팀·전사 캘린더에서 볼 수 없었다. 스펙 7장은 승인된 출장·재택을 캘린더에
--    표시하라고 요구한다. 휴가에서 쓴 것과 같은 패턴으로, 표시에 필요한
--    최소 정보(이름·기간·유형)만 돌려주는 함수를 연다. 사유·경비는 노출하지 않는다.
-- ---------------------------------------------------------------------
create or replace function public.list_calendar_approvals(
  p_from date,
  p_to date
)
returns table (
  id uuid,
  requester_id uuid,
  requester_name text,
  document_type text,
  start_date date,
  end_date date
)
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
    select
      d.id,
      d.requester_id,
      e.name,
      d.document_type,
      (d.form_data->>'startDate')::date,
      coalesce((d.form_data->>'endDate')::date, (d.form_data->>'startDate')::date)
    from public.approval_documents d
    join public.employees e on e.id = d.requester_id
    where d.status in ('approved','completed')
      and d.document_type in ('business_trip','remote_work')
      and d.form_data->>'startDate' is not null
      -- 날짜 형식이 깨진 문서가 섞여도 전체 조회가 실패하지 않게
      and d.form_data->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$'
      and (d.form_data->>'startDate')::date <= p_to
      and coalesce(
            nullif(d.form_data->>'endDate','')::date,
            (d.form_data->>'startDate')::date
          ) >= p_from;
end $$;

revoke all on function public.list_calendar_approvals(date, date) from public;
grant execute on function public.list_calendar_approvals(date, date) to authenticated;
