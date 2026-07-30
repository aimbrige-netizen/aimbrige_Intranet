-- =====================================================================
-- 스펙 04 — 전자결재
-- 근거: aimbridge_intranet_spec_04_approval.md 4장·5장
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 문서 (공통 테이블 + 유형별 JSON)
-- ---------------------------------------------------------------------
create table if not exists public.approval_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null
    check (document_type in ('special_request','business_trip','expense','purchase_request','remote_work')),
  title text not null,
  form_data jsonb not null default '{}'::jsonb,
  requester_id uuid not null references public.employees(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','rejected','approved','completed')),
  current_step int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists approval_docs_requester_idx
  on public.approval_documents (requester_id, created_at desc);
create index if not exists approval_docs_status_idx
  on public.approval_documents (status, created_at desc);
create index if not exists approval_docs_type_idx
  on public.approval_documents (document_type);

drop trigger if exists approval_docs_touch_updated_at on public.approval_documents;
create trigger approval_docs_touch_updated_at
  before update on public.approval_documents
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 2. 단계별 처리 이력
-- ---------------------------------------------------------------------
create table if not exists public.approval_steps (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.approval_documents(id) on delete cascade,
  step_order int not null,
  approver_id uuid references public.employees(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  comment text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (document_id, step_order)
);

create index if not exists approval_steps_approver_idx
  on public.approval_steps (approver_id, status);
create index if not exists approval_steps_document_idx
  on public.approval_steps (document_id, step_order);

-- ---------------------------------------------------------------------
-- 3. 첨부파일
-- ---------------------------------------------------------------------
create table if not exists public.approval_attachments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.approval_documents(id) on delete cascade,
  file_url text not null,
  file_name text,
  file_size int,
  uploaded_at timestamptz not null default now()
);

create index if not exists approval_attachments_document_idx
  on public.approval_attachments (document_id);

-- ---------------------------------------------------------------------
-- 4. 문서유형별 결재라인 설정
--    1차 검토는 "기안자 팀의 팀장"으로 규칙 고정이라 컬럼이 없다 (스펙 3.5)
-- ---------------------------------------------------------------------
create table if not exists public.approval_line_configs (
  id uuid primary key default gen_random_uuid(),
  document_type text not null unique
    check (document_type in ('special_request','business_trip','expense','purchase_request','remote_work')),
  step2_approver_id uuid references public.employees(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- 5종 행을 미리 만들어 둔다(최종승인자는 미지정 상태로 시작)
insert into public.approval_line_configs (document_type)
values ('special_request'), ('business_trip'), ('expense'),
       ('purchase_request'), ('remote_work')
on conflict (document_type) do nothing;

drop trigger if exists approval_line_touch_updated_at on public.approval_line_configs;
create trigger approval_line_touch_updated_at
  before update on public.approval_line_configs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 5. 문서 접근 권한 판정
--    approval_documents 정책과 approval_steps 정책이 서로를 참조하면 재귀가 나므로
--    definer 함수 하나로 판정을 모은다.
-- ---------------------------------------------------------------------
create or replace function public.can_view_approval_document(doc_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select
        d.requester_id = public.current_employee_id()
        or public.is_system_admin()
        or exists (
          select 1 from public.approval_steps s
          where s.document_id = d.id
            and s.approver_id = public.current_employee_id()
        )
      from public.approval_documents d
      where d.id = doc_id
    ),
    false
  )
$$;

revoke all on function public.can_view_approval_document(uuid) from public;
grant execute on function public.can_view_approval_document(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. 기안 제출 — 문서 + 2단계 생성을 한 트랜잭션으로 (스펙 5장 1번)
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

  -- 1차 검토자 = 기안자가 속한 팀의 팀장. 팀이 없으면 부서장으로 대체한다.
  select coalesce(t.manager_id, d.manager_id) into step1_approver
  from public.employees e
  left join public.teams t on t.id = e.team_id
  left join public.departments d on d.id = e.department_id
  where e.id = requester;

  -- 최종 승인자 = 문서유형별 지정값
  select c.step2_approver_id into step2_approver
  from public.approval_line_configs c
  where c.document_type = p_document_type;

  if step2_approver is null then
    raise exception '이 문서유형의 최종 승인자가 지정되지 않았습니다. 시스템 관리자에게 문의하세요.';
  end if;

  -- 1차 검토자가 없거나 기안자 자신이면 1차를 건너뛰고 최종 승인자부터 시작한다.
  -- (팀장 미지정 조직이나 팀장 본인이 기안한 경우 문서가 영구히 멈추는 것을 막는다)
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
-- 7. 승인 / 반려 (스펙 5장 2·3번)
--    단계 상태와 문서 상태를 함께 갱신해야 하므로 함수로 원자 처리한다.
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

  -- 현재 단계의 담당자 본인만 처리할 수 있다
  select * into step from public.approval_steps
  where document_id = p_document_id
    and step_order = doc.current_step
  for update;

  if step is null then
    raise exception '처리할 결재 단계가 없습니다.';
  end if;
  if step.approver_id is distinct from actor then
    raise exception '현재 단계의 결재자만 처리할 수 있습니다.';
  end if;
  if step.status <> 'pending' then
    raise exception '이미 처리한 단계입니다.';
  end if;

  if not p_approve and (p_comment is null or btrim(p_comment) = '') then
    raise exception '반려 사유는 필수입니다.';
  end if;

  update public.approval_steps
  set status = case when p_approve then 'approved' else 'rejected' end,
      comment = p_comment,
      processed_at = now()
  where id = step.id;

  if not p_approve then
    update public.approval_documents
    set status = 'rejected'
    where id = p_document_id;
    return;
  end if;

  -- 다음 단계가 있으면 진행, 없으면 최종 승인
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

/** 시행완료 처리 — 승인된 문서에 대해 관리자만 (스펙 3.4) */
create or replace function public.complete_approval_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  doc record;
begin
  if not public.is_system_admin() then
    raise exception '시행완료 처리는 시스템 관리자만 할 수 있습니다.';
  end if;

  select * into doc from public.approval_documents
  where id = p_document_id for update;

  if doc is null then
    raise exception '문서를 찾을 수 없습니다.';
  end if;
  if doc.status <> 'approved' then
    raise exception '승인 완료된 문서만 시행완료로 바꿀 수 있습니다.';
  end if;

  update public.approval_documents
  set status = 'completed'
  where id = p_document_id;
end $$;

revoke all on function public.submit_approval_document(text, text, jsonb) from public;
revoke all on function public.process_approval_step(uuid, boolean, text) from public;
revoke all on function public.complete_approval_document(uuid) from public;

grant execute on function public.submit_approval_document(text, text, jsonb) to authenticated;
grant execute on function public.process_approval_step(uuid, boolean, text) to authenticated;
grant execute on function public.complete_approval_document(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. RLS
--    문서 status/current_step은 위 함수로만 바뀌어야 하므로 UPDATE 정책을 열지 않는다.
--    (정책으로 열면 승인자가 status를 'approved'로 직접 바꿔 단계를 건너뛸 수 있다)
-- ---------------------------------------------------------------------
alter table public.approval_documents    enable row level security;
alter table public.approval_steps        enable row level security;
alter table public.approval_attachments  enable row level security;
alter table public.approval_line_configs enable row level security;

drop policy if exists approval_docs_select on public.approval_documents;
create policy approval_docs_select on public.approval_documents
  for select to authenticated
  using (
    requester_id = public.current_employee_id()
    or public.is_system_admin()
    or exists (
      select 1 from public.approval_steps s
      where s.document_id = public.approval_documents.id
        and s.approver_id = public.current_employee_id()
    )
  );

-- INSERT/UPDATE 정책 없음 — 기안·승인은 전부 definer 함수 경유

drop policy if exists approval_steps_select on public.approval_steps;
create policy approval_steps_select on public.approval_steps
  for select to authenticated
  using (
    approver_id = public.current_employee_id()
    or public.is_system_admin()
    or exists (
      select 1 from public.approval_documents d
      where d.id = public.approval_steps.document_id
        and d.requester_id = public.current_employee_id()
    )
  );

drop policy if exists approval_attachments_select on public.approval_attachments;
create policy approval_attachments_select on public.approval_attachments
  for select to authenticated
  using (public.can_view_approval_document(document_id));

-- 첨부는 기안자 본인만 등록·삭제 (작성 중)
drop policy if exists approval_attachments_insert on public.approval_attachments;
create policy approval_attachments_insert on public.approval_attachments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.approval_documents d
      where d.id = document_id
        and d.requester_id = public.current_employee_id()
    )
  );

drop policy if exists approval_attachments_delete on public.approval_attachments;
create policy approval_attachments_delete on public.approval_attachments
  for delete to authenticated
  using (
    exists (
      select 1 from public.approval_documents d
      where d.id = document_id
        and d.requester_id = public.current_employee_id()
        and d.status = 'pending'
    )
  );

drop policy if exists approval_line_select on public.approval_line_configs;
create policy approval_line_select on public.approval_line_configs
  for select to authenticated using (true);

drop policy if exists approval_line_write on public.approval_line_configs;
create policy approval_line_write on public.approval_line_configs
  for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

-- ---------------------------------------------------------------------
-- 9. 첨부파일 저장소 (스펙 4장 — 건당 10MB, 이미지·PDF만)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'approval-attachments',
  'approval-attachments',
  false,                                  -- 결재 문서 첨부는 비공개
  10485760,                               -- 10MB
  array['image/png','image/jpeg','image/webp','application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 업로드 경로 규칙: approval-attachments/<기안자 auth uid>/<문서id>/<파일명>
drop policy if exists "approval attach owner insert" on storage.objects;
create policy "approval attach owner insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'approval-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "approval attach owner delete" on storage.objects;
create policy "approval attach owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'approval-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 조회는 문서 열람 권한이 있는 사람 전체. 경로 1번째 세그먼트로 업로더를 찾고
-- 그 사람이 기안한 문서를 볼 수 있는지 확인한다.
drop policy if exists "approval attach viewer select" on storage.objects;
create policy "approval attach viewer select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'approval-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_system_admin()
      or exists (
        select 1
        from public.approval_attachments a
        where a.file_url = storage.objects.name
          and public.can_view_approval_document(a.document_id)
      )
    )
  );
