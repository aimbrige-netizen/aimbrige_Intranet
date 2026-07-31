-- =====================================================================
-- 마이그레이션 15 — 첨부 스토리지 정리 권한과 감사 로그 인덱스
--
-- 1. 관리자가 남의 글을 지우면 스토리지 객체가 고아로 남던 문제
-- 2. 감사 로그가 기간·액션 필터를 타기 시작해 인덱스가 필요해진 문제
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 첨부 스토리지 삭제 권한
--
-- post_attachments / approval_attachments 행은 RLS상 시스템 관리자도
-- 지울 수 있는데, 스토리지 정책은 경로 첫 세그먼트가 본인 uid일 때만
-- 삭제를 허용했다. 그래서 관리자가 남의 글을 삭제하면 DB 행만 사라지고
-- 실제 파일은 버킷에 영구히 남았다(앱은 console.error로만 남기고 넘어간다).
--
-- 경로 규칙({auth.uid()}/...)은 그대로 두고, 관리자에게만 예외를 연다.
-- 업로드 정책은 건드리지 않는다 — 경로 형식이 곧 소유자 표시이기 때문이다.
-- ---------------------------------------------------------------------
drop policy if exists "post attach owner delete" on storage.objects;
create policy "post attach owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'post-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_system_admin()
    )
  );

drop policy if exists "approval attach owner delete" on storage.objects;
create policy "approval attach owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'approval-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_system_admin()
    )
  );

-- ---------------------------------------------------------------------
-- 2. 감사 로그 인덱스
--
-- 목록이 기본 최근 30일로 범위를 잡고 액션별 건수를 따로 세면서
-- created_at·action을 타는 질의가 화면 한 번에 여러 개 나간다.
-- ---------------------------------------------------------------------
create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);

create index if not exists audit_logs_action_created_at_idx
  on public.audit_logs (action, created_at desc);

-- 문서 목록이 requester_id + 기간으로 자주 필터된다
create index if not exists approval_documents_requester_created_idx
  on public.approval_documents (requester_id, created_at desc);

-- 결재 대기함은 approver_id + status를 탄다
create index if not exists approval_steps_approver_status_idx
  on public.approval_steps (approver_id, status);

-- 게시글 목록은 board_id + 고정글/최신순
create index if not exists posts_board_pinned_created_idx
  on public.posts (board_id, is_pinned desc, created_at desc);
