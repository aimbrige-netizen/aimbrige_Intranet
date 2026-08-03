-- =====================================================================
-- 마이그레이션 28 — 스펙 12 사내 메일
--
-- 다우 메일함의 사내 메일(임직원 간 송수신)을 완전 동작으로 만든다.
-- 외부 메일(Gmail)은 어댑터 자리만 있고(스펙 11) 이 마이그레이션과 무관하다.
--
-- ── 데이터 모델: 메시지 한 벌 + 수신자별 상태 행 ─────────────────────
--
-- 메일은 "본문 한 벌(mail_messages) + 받은 사람 수만큼의 상태 행
-- (mail_recipients)"으로 나눈다. 읽음·별표·휴지통은 수신자마다 다른
-- 상태라 메시지에 둘 수 없고, 본문을 수신자마다 복사하면 첨부 용량
-- 집계가 수신자 수만큼 뻥튀기된다.
--
-- ── mail_recipients의 PK에 kind를 넣지 않은 이유 (설계 근거) ─────────
--
-- 스펙 초안은 pk(message_id, recipient_id, kind)를 검토하라고 했다.
-- kind를 PK에 넣으면 같은 사람이 to와 cc에 동시에 적혔을 때 행이 두 개
-- 생긴다 — 받은메일함에 같은 메일이 두 줄 뜨고, 안읽음 배지가 2를 세고,
-- 읽음·별표·휴지통 상태가 두 행으로 갈라진다. 실제 메일 시스템은 이때
-- 한 통만 배달한다. 그래서 PK는 (message_id, recipient_id)이고,
-- send_mail()이 to를 우선으로 중복을 정리한다(cc에서 to와 겹치는 사람 제거).
--
-- ── 발신자 상태는 메시지 쪽 컬럼이 맡는다 ────────────────────────────
--
-- 발신자에게는 mail_recipients 행이 없다(자기 자신에게 보낸 경우 제외).
-- 보낸메일함/휴지통/영구삭제는 sender_trashed·sender_deleted_at으로 표현한다.
-- 영구삭제를 실제 DELETE로 하지 않는 이유: 메시지 행을 지우면 cascade로
-- 수신자들의 받은메일까지 사라진다. 발신자의 영구삭제는 "발신자 화면에서만
-- 사라진다"가 맞는 의미다(실제 그룹웨어와 같다). 임시저장(수신자 없음)만
-- 실제 DELETE를 허용한다.
--
-- ── draft_to / draft_cc (스펙 스키마에 없는 컬럼의 근거) ─────────────
--
-- 임시저장의 받는사람을 mail_recipients에 넣으면 안읽음 배지 질의
-- (recipients만 세고 messages를 조인하지 않는다)가 남의 임시저장을 센다.
-- 그렇다고 버리면 임시보관함에서 다시 열 때 받는사람이 사라져 임시저장의
-- 의미가 없다. 그래서 발송 전에는 메시지 행의 uuid[]로만 들고 있다가
-- send_mail()이 발송 시점에 mail_recipients로 옮기고 배열을 비운다.
--
-- 보안 규약 준수 요약:
--   · SECURITY DEFINER 함수: set search_path = public + revoke
--     public/anon/authenticated 후 grant to authenticated (규약 1)
--   · 컬럼 가드 트리거는 전부 before insert or update (규약 2)
--   · PostgREST 노출 경로: recipients INSERT 정책 자체를 두지 않아
--     수신자 위조를 막고, 발송은 send_mail() 한 곳으로 몬다
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. mail_messages
-- ---------------------------------------------------------------------
create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  /*
   * on delete set null — 퇴사자의 employees 행이 지워져도 수신자들의
   * 받은메일은 남아야 한다(cascade면 발신자 퇴사와 함께 전 수신자의
   * 메일함에서 증발한다). 화면은 null 발신자를 "(퇴사자)"로 그린다.
   */
  sender_id uuid references public.employees(id) on delete set null,
  subject text not null default '',
  body text not null default '',
  is_draft boolean not null default true,
  /** 발송 시각. 임시저장은 null — 아래 CHECK가 is_draft와 묶는다 */
  sent_at timestamptz,
  /** 발신자 휴지통 (보낸메일함 → 휴지통) */
  sender_trashed boolean not null default false,
  /** 발신자 영구삭제 시각. 찍히면 발신자 화면 어디에도 안 나온다 */
  sender_deleted_at timestamptz,
  /** 임시저장의 받는사람/참조 — 발송 시 mail_recipients로 옮기고 비운다 */
  draft_to uuid[] not null default '{}',
  draft_cc uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 발송됐다 = sent_at이 있다. 어긋난 조합(발송인데 시각 없음 등)을 원천 차단
  constraint mail_messages_sent_state check (is_draft = (sent_at is null)),
  -- 임시저장에는 휴지통·영구삭제 개념이 없다(삭제는 실제 DELETE)
  constraint mail_messages_draft_no_trash
    check (not is_draft or (sender_trashed = false and sender_deleted_at is null))
);

-- 발송된 메일의 draft 배열은 비어 있어야 한다(send_mail()이 비운다)
alter table public.mail_messages
  drop constraint if exists mail_messages_sent_draft_cleared;
alter table public.mail_messages
  add constraint mail_messages_sent_draft_cleared
  check (is_draft or (draft_to = '{}' and draft_cc = '{}'));

-- 목록 레이아웃을 무너뜨리는 값은 DB에서 막는다(마이그레이션 24의
-- boards_community_text_limits와 같은 이유 — 서버 검증은 RPC 경로에만 적용된다)
alter table public.mail_messages
  drop constraint if exists mail_messages_text_limits;
alter table public.mail_messages
  add constraint mail_messages_text_limits
  check (char_length(subject) <= 200 and char_length(body) <= 100000);

drop trigger if exists mail_messages_touch_updated_at on public.mail_messages;
create trigger mail_messages_touch_updated_at
  before update on public.mail_messages
  for each row execute function public.touch_updated_at();

-- 보낸메일함·임시보관함은 "내 것 최신순"이 기본 질의다
create index if not exists mail_messages_sender_idx
  on public.mail_messages (sender_id, is_draft, sent_at desc);

comment on table public.mail_messages is
  '사내 메일 본문(스펙 12). 발신자 쪽 상태(보낸메일함/휴지통/영구삭제)는 이 행의 컬럼, 수신자 쪽 상태는 mail_recipients가 맡는다.';
comment on column public.mail_messages.sender_deleted_at is
  '발신자의 영구삭제. 행을 지우면 수신자 메일함까지 cascade로 사라지므로 시각만 찍고 발신자 화면에서 숨긴다.';

-- ---------------------------------------------------------------------
-- 2. mail_recipients — 수신자별 상태 행
-- ---------------------------------------------------------------------
create table if not exists public.mail_recipients (
  message_id uuid not null references public.mail_messages(id) on delete cascade,
  recipient_id uuid not null references public.employees(id) on delete cascade,
  kind text not null check (kind in ('to','cc')),
  folder text not null default 'inbox' check (folder in ('inbox','trash')),
  /** 읽은 시각 = 수신확인. 가드가 한 번 찍히면 못 되돌리게 한다 */
  read_at timestamptz,
  starred boolean not null default false,
  /** 배달 시각. 받은메일함 정렬 기준(메시지 sent_at과 같은 트랜잭션 값) */
  created_at timestamptz not null default now(),
  -- kind는 PK에 넣지 않는다 — 같은 사람이 to/cc에 겹치면 한 통만 배달
  -- (파일 머리 설계 근거 참고). 중복 정리는 send_mail()이 한다.
  primary key (message_id, recipient_id)
);

-- 받은메일함 목록(폴더별 최신순)과 안읽음 배지가 매 화면 묻는다
create index if not exists mail_recipients_recipient_idx
  on public.mail_recipients (recipient_id, folder, created_at desc);
create index if not exists mail_recipients_unread_idx
  on public.mail_recipients (recipient_id)
  where folder = 'inbox' and read_at is null;

comment on table public.mail_recipients is
  '수신자별 메일 상태(읽음·별표·폴더). PK가 (message_id, recipient_id)라 한 사람은 한 통을 한 번만 받는다 — to/cc 중복은 send_mail()이 to 우선으로 정리.';

-- ---------------------------------------------------------------------
-- 3. mail_attachments + 저장소 (게시판 첨부 문법 재사용)
-- ---------------------------------------------------------------------
create table if not exists public.mail_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.mail_messages(id) on delete cascade,
  /** 스토리지 경로: <auth uid>/<message id>/<파일명> — 경로 자체가 권한 판정 */
  path text not null,
  name text not null,
  size bigint not null default 0 check (size >= 0),
  uploaded_at timestamptz not null default now()
);

create index if not exists mail_attachments_message_idx
  on public.mail_attachments (message_id);

-- ---------------------------------------------------------------------
-- 4. 권한 판정 헬퍼 (SECURITY DEFINER)
--
-- messages 정책이 recipients를 보고 recipients 정책이 messages를 보면
-- RLS가 서로를 재귀 호출한다("infinite recursion detected"). definer 함수로
-- 빼면 함수 안 질의가 RLS를 타지 않아 고리가 끊긴다(마이그레이션 24의
-- is_community_member()와 같은 수법).
-- ---------------------------------------------------------------------

/** 내가 이 메일의 발신자인가 */
create or replace function public.is_mail_sender(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.mail_messages m
    where m.id = p_message_id
      and m.sender_id = public.current_employee_id()
  )
$$;

revoke all on function public.is_mail_sender(uuid) from public;
revoke all on function public.is_mail_sender(uuid) from anon;
revoke all on function public.is_mail_sender(uuid) from authenticated;
grant execute on function public.is_mail_sender(uuid) to authenticated;

/** 내가 이 메일의 수신자인가 (수신자 행 존재 = 이미 발송된 메일) */
create or replace function public.is_mail_recipient(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.mail_recipients r
    where r.message_id = p_message_id
      and r.recipient_id = public.current_employee_id()
  )
$$;

revoke all on function public.is_mail_recipient(uuid) from public;
revoke all on function public.is_mail_recipient(uuid) from anon;
revoke all on function public.is_mail_recipient(uuid) from authenticated;
grant execute on function public.is_mail_recipient(uuid) to authenticated;

/**
 * 이 메일을 읽을 수 있는가 — 발신자이거나, 발송된 메일의 수신자.
 * 임시저장은 발신자만 본다(is_draft 검사). 수신자 행은 발송 시에만 생기지만
 * 이중으로 잠근다 — 언젠가 다른 경로가 행을 만들어도 draft는 안 샌다.
 */
create or replace function public.can_read_mail(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.mail_messages m
    where m.id = p_message_id
      and (
        m.sender_id = public.current_employee_id()
        or (
          not m.is_draft
          and exists (
            select 1
            from public.mail_recipients r
            where r.message_id = m.id
              and r.recipient_id = public.current_employee_id()
          )
        )
      )
  )
$$;

revoke all on function public.can_read_mail(uuid) from public;
revoke all on function public.can_read_mail(uuid) from anon;
revoke all on function public.can_read_mail(uuid) from authenticated;
grant execute on function public.can_read_mail(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------
alter table public.mail_messages enable row level security;
alter table public.mail_recipients enable row level security;
alter table public.mail_attachments enable row level security;

-- 발신자는 자기 메일 전부(임시저장 포함), 수신자는 발송된 것만
drop policy if exists mail_messages_select on public.mail_messages;
create policy mail_messages_select on public.mail_messages
  for select to authenticated
  using (
    sender_id = public.current_employee_id()
    or ((not is_draft) and public.is_mail_recipient(id))
  );

-- 직접 INSERT는 임시저장뿐이다. 발송(수신자 생성과 원자적)은 send_mail() 경유.
drop policy if exists mail_messages_insert on public.mail_messages;
create policy mail_messages_insert on public.mail_messages
  for insert to authenticated
  with check (
    sender_id = public.current_employee_id()
    and is_draft
    and sent_at is null
  );

-- 발신자만 갱신. 무엇을 갱신할 수 있는지는 6장의 가드 트리거가 컬럼 단위로 죈다.
drop policy if exists mail_messages_update on public.mail_messages;
create policy mail_messages_update on public.mail_messages
  for update to authenticated
  using (sender_id = public.current_employee_id())
  with check (sender_id = public.current_employee_id());

-- 실제 DELETE는 임시저장만 — 발송된 메일을 지우면 수신자 메일함까지 cascade
drop policy if exists mail_messages_delete on public.mail_messages;
create policy mail_messages_delete on public.mail_messages
  for delete to authenticated
  using (sender_id = public.current_employee_id() and is_draft);

/*
 * 수신자 행 조회: 본인 행 + 발신자(수신확인).
 *
 * can_read_mail 기반으로 열면 수신자 누구나 같은 메일의 **타 수신자 행
 * 전체 컬럼**(read_at·starred·folder)을 읽는다 — 수신확인은 스펙 12가
 * 발신자의 보낸메일함 기능으로만 정의한 값이고, 별표·휴지통은 개인 상태다.
 * RLS는 행 단위라 컬럼만 가릴 수 없으므로 행 자체를 좁히고, 수신자끼리
 * 서로 봐야 하는 to/cc 명단은 아래 mail_recipient_list()(definer)가
 * 상태 컬럼 없이 따로 돌려준다.
 */
drop policy if exists mail_recipients_select on public.mail_recipients;
create policy mail_recipients_select on public.mail_recipients
  for select to authenticated
  using (
    recipient_id = public.current_employee_id()
    or public.is_mail_sender(message_id)
  );

/**
 * 받는사람/참조 명단 — 메일을 읽을 수 있는 사람(발신자·수신자)에게
 * (수신자, kind, 이름)만 돌려준다. read_at·starred·folder는 내보내지
 * 않는다 — 그건 발신자 전용(수신확인)이거나 본인 전용(별표·폴더)이다.
 */
create or replace function public.mail_recipient_list(p_message_id uuid)
returns table (recipient_id uuid, kind text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select r.recipient_id, r.kind, e.name
  from public.mail_recipients r
  left join public.employees e on e.id = r.recipient_id
  where r.message_id = p_message_id
    and public.can_read_mail(p_message_id)
$$;

revoke all on function public.mail_recipient_list(uuid) from public;
revoke all on function public.mail_recipient_list(uuid) from anon;
revoke all on function public.mail_recipient_list(uuid) from authenticated;
grant execute on function public.mail_recipient_list(uuid) to authenticated;

-- INSERT 정책이 없다 = PostgREST로 수신자 행을 못 만든다(수신자 위조 차단).
-- 행 생성은 send_mail()(definer, 소유자 권한이라 RLS 미적용)만 한다.

-- read_at/starred/folder는 수신자 본인만 — 컬럼 단위는 가드 트리거가 죈다
drop policy if exists mail_recipients_update on public.mail_recipients;
create policy mail_recipients_update on public.mail_recipients
  for update to authenticated
  using (recipient_id = public.current_employee_id())
  with check (recipient_id = public.current_employee_id());

-- 영구삭제는 휴지통에서만 (스펙 12 액션 규칙)
drop policy if exists mail_recipients_delete on public.mail_recipients;
create policy mail_recipients_delete on public.mail_recipients
  for delete to authenticated
  using (recipient_id = public.current_employee_id() and folder = 'trash');

-- 첨부: 메일을 읽을 수 있으면 목록도 본다. 등록·삭제는 발신자가
-- **임시저장 상태에서만** — 발송 후 첨부 추가·교체를 허용하면 본문 동결
-- (mail_messages_guard의 "발송된 메일은 수정할 수 없습니다")이 무의미해진다.
-- 수신자가 읽은 첨부가 바뀌는 건 본문 변조와 등가다.
-- (m 서브쿼리는 mail_messages RLS 아래에서 돌지만 발신자는 자기 메일을
--  항상 SELECT할 수 있으므로 판정이 어긋나지 않는다)
drop policy if exists mail_attachments_select on public.mail_attachments;
create policy mail_attachments_select on public.mail_attachments
  for select to authenticated
  using (public.can_read_mail(message_id));

drop policy if exists mail_attachments_insert on public.mail_attachments;
create policy mail_attachments_insert on public.mail_attachments
  for insert to authenticated
  with check (
    public.is_mail_sender(message_id)
    and exists (
      select 1 from public.mail_messages m
      where m.id = message_id and m.is_draft
    )
  );

drop policy if exists mail_attachments_delete on public.mail_attachments;
create policy mail_attachments_delete on public.mail_attachments
  for delete to authenticated
  using (
    public.is_mail_sender(message_id)
    and exists (
      select 1 from public.mail_messages m
      where m.id = message_id and m.is_draft
    )
  );

-- ---------------------------------------------------------------------
-- 6. 컬럼 가드 트리거 — 규약 2: 반드시 before insert or update
--    (before update만 걸면 upsert의 INSERT 경로가 뚫린다)
--
--    SECURITY INVOKER 명시 — definer면 current_user가 소유자로 바뀌어
--    아래 우회 분기가 항상 참이 된다(마이그레이션 12에서 실제 겪은 함정).
--    send_mail() 안의 갱신은 definer 실행 중이라 이 분기로 통과한다.
-- ---------------------------------------------------------------------
create or replace function public.mail_messages_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('postgres','supabase_admin','service_role')
     or auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- 직접 INSERT는 임시저장뿐. INSERT 정책과 같은 규칙을 upsert 경로까지 이중으로.
    if (not new.is_draft) or new.sent_at is not null then
      raise exception '메일 발송은 send_mail()로만 할 수 있습니다';
    end if;
    new.sender_trashed := false;
    new.sender_deleted_at := null;
    return new;
  end if;

  if new.sender_id is distinct from old.sender_id then
    raise exception '발신자는 변경할 수 없습니다';
  end if;

  if old.is_draft then
    -- 임시저장: 제목·본문·받는사람 수정 자유. 발송 승격만 RPC로 몬다 —
    -- 여기서 is_draft를 내리게 두면 수신자 행 없는 "보낸 메일"이 생긴다.
    if (not new.is_draft) or new.sent_at is not null then
      raise exception '메일 발송은 send_mail()로만 할 수 있습니다';
    end if;
  else
    -- 발송된 메일: 본문 불변. 수신자들이 이미 읽은 내용이 바뀌면 안 된다.
    if new.subject is distinct from old.subject
       or new.body is distinct from old.body
       or new.is_draft is distinct from old.is_draft
       or new.sent_at is distinct from old.sent_at
       or new.draft_to is distinct from old.draft_to
       or new.draft_cc is distinct from old.draft_cc then
      raise exception '발송된 메일은 수정할 수 없습니다';
    end if;

    -- 영구삭제: 휴지통에서만, 되돌릴 수 없고, 시각은 서버가 찍는다
    if new.sender_deleted_at is distinct from old.sender_deleted_at then
      if old.sender_deleted_at is not null then
        raise exception '영구삭제는 되돌릴 수 없습니다';
      end if;
      if not old.sender_trashed then
        raise exception '휴지통에 있는 메일만 영구삭제할 수 있습니다';
      end if;
      new.sender_deleted_at := now();
    end if;
  end if;

  return new;
end $$;

drop trigger if exists mail_messages_guard on public.mail_messages;
create trigger mail_messages_guard
  before insert or update on public.mail_messages
  for each row execute function public.mail_messages_guard();

create or replace function public.mail_recipients_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('postgres','supabase_admin','service_role')
     or auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- INSERT 정책이 없어 여기 올 수 없지만, 규약 2에 따라 upsert의 INSERT
    -- 경로를 트리거에서도 막는다 — 정책이 언젠가 열려도 위조는 안 뚫린다.
    raise exception '수신자 등록은 send_mail()로만 할 수 있습니다';
  end if;

  -- 수신 사실 자체(누가·어느 메일·to/cc)는 상태가 아니라 기록이다
  if new.message_id is distinct from old.message_id
     or new.recipient_id is distinct from old.recipient_id
     or new.kind is distinct from old.kind
     or new.created_at is distinct from old.created_at then
    raise exception '수신 정보는 변경할 수 없습니다';
  end if;

  /*
   * 수신확인(read_at)의 무결성: 한 번 찍히면 못 되돌린다. 되돌리게 두면
   * 발신자의 수신확인이 "읽었다가 안 읽은 것"이 된다. 값도 클라이언트를
   * 믿지 않고 서버 시각으로 덮는다.
   */
  if new.read_at is distinct from old.read_at then
    if old.read_at is not null then
      raise exception '읽음 확인은 되돌릴 수 없습니다';
    end if;
    new.read_at := now();
  end if;

  return new;
end $$;

drop trigger if exists mail_recipients_guard on public.mail_recipients;
create trigger mail_recipients_guard
  before insert or update on public.mail_recipients
  for each row execute function public.mail_recipients_guard();

-- ---------------------------------------------------------------------
-- 7. send_mail() — 발송의 유일한 관문 (메시지 + 수신자 원자 생성)
--
-- p_draft_id가 있으면 임시저장을 발송으로 승격한다(제목·본문은 폼의 최신
-- 값으로 덮는다 — 저장 안 된 마지막 수정이 유실되지 않게).
-- ---------------------------------------------------------------------
create or replace function public.send_mail(
  p_subject text,
  p_body text,
  p_to uuid[],
  p_cc uuid[] default null,
  p_draft_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_employee_id();
  v_subject text := btrim(coalesce(p_subject, ''));
  v_body text := coalesce(p_body, '');
  v_to uuid[];
  v_cc uuid[];
  v_all uuid[];
  v_valid int;
  v_id uuid;
begin
  if v_me is null then
    raise exception '로그인이 필요합니다';
  end if;
  if v_subject = '' then
    raise exception '제목을 입력하세요';
  end if;
  -- CHECK 제약에 맡기면 날것 위반 메시지가 사용자에게 그대로 노출된다
  if char_length(v_subject) > 200 then
    raise exception '제목은 200자 이내로 입력하세요';
  end if;
  if char_length(v_body) > 100000 then
    raise exception '본문이 너무 깁니다(10만 자 이내)';
  end if;

  -- to: null 제거 + 중복 제거
  select coalesce(array_agg(distinct t.x), '{}'::uuid[])
    into v_to
    from unnest(coalesce(p_to, '{}'::uuid[])) as t(x)
   where t.x is not null;

  -- cc: to와 겹치는 사람 제거 — PK(message_id, recipient_id) 설계의 전제.
  -- to/cc 양쪽에 적힌 사람은 to로 한 통만 받는다(파일 머리 설계 근거).
  select coalesce(array_agg(distinct t.x), '{}'::uuid[])
    into v_cc
    from unnest(coalesce(p_cc, '{}'::uuid[])) as t(x)
   where t.x is not null and not (t.x = any(v_to));

  if array_length(v_to, 1) is null then
    raise exception '받는사람을 지정하세요';
  end if;

  -- 수신자 수 상한 — zod(액션 계층)와 같은 값. 방어선을 RPC 안에도 둔다:
  -- 이 함수는 authenticated에 grant돼 있어 PostgREST rpc() 직접 호출로
  -- 액션 계층을 우회할 수 있다(전 임직원 대상 사내 스팸 차단).
  -- 실재 검증(아래 employees 조회)보다 먼저 — 상한 초과 배열로 조회를
  -- 굴릴 이유가 없다.
  if cardinality(v_to) > 100 or cardinality(v_cc) > 100 then
    raise exception '받는사람은 100명 이내로 지정하세요';
  end if;

  v_all := v_to || v_cc;

  -- 수신자 전원이 실재하는 임직원인지. 퇴사자에게는 배달하지 않는다 —
  -- 그 메일함은 아무도 다시 열지 않는다(휴직자는 복귀하면 읽으므로 허용).
  select count(*) into v_valid
    from public.employees e
   where e.id = any(v_all)
     and e.employment_status <> 'terminated';
  if v_valid <> cardinality(v_all) then
    raise exception '받을 수 없는 수신자가 있습니다(퇴사자이거나 없는 계정)';
  end if;

  if p_draft_id is not null then
    -- 남의 임시저장을 승격하는 경로를 sender_id 조건으로 막는다.
    -- definer 함수라 RLS가 지켜 주지 않는다 — 조건이 곧 권한 검사다.
    update public.mail_messages
       set subject = v_subject,
           body = v_body,
           is_draft = false,
           sent_at = now(),
           draft_to = '{}',
           draft_cc = '{}'
     where id = p_draft_id
       and sender_id = v_me
       and is_draft
    returning id into v_id;

    if v_id is null then
      raise exception '임시보관 메일을 찾을 수 없습니다';
    end if;

    -- 방어: 임시저장에 수신자 행이 있을 수 없지만, 있어도 아래 INSERT가
    -- PK 충돌로 발송 전체를 굴리지 않도록 정리해 둔다
    delete from public.mail_recipients where message_id = v_id;
  else
    insert into public.mail_messages (sender_id, subject, body, is_draft, sent_at)
    values (v_me, v_subject, v_body, false, now())
    returning id into v_id;
  end if;

  insert into public.mail_recipients (message_id, recipient_id, kind)
  select v_id, r.x, 'to' from unnest(v_to) as r(x);

  insert into public.mail_recipients (message_id, recipient_id, kind)
  select v_id, r.x, 'cc' from unnest(v_cc) as r(x);

  return v_id;
end $$;

-- 규약 1: revoke public만으로는 안 닫힌다 — Supabase 기본 default privileges가
-- anon·authenticated에 명시적 EXECUTE를 함께 붙인다(마이그레이션 26 참고).
revoke all on function public.send_mail(text, text, uuid[], uuid[], uuid) from public;
revoke all on function public.send_mail(text, text, uuid[], uuid[], uuid) from anon;
revoke all on function public.send_mail(text, text, uuid[], uuid[], uuid) from authenticated;
grant execute on function public.send_mail(text, text, uuid[], uuid[], uuid) to authenticated;

comment on function public.send_mail(text, text, uuid[], uuid[], uuid) is
  '메일 발송의 유일한 관문 — 메시지+수신자 원자 생성, 임시저장 승격, to/cc 중복 정리. 직접 INSERT 경로는 정책·가드가 막는다.';

-- ---------------------------------------------------------------------
-- 8. 첨부 저장소 — 게시판 첨부(마이그레이션 09)의 버킷·정책 문법 재사용
--    경로 규칙: <auth uid>/<message id>/<파일명>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mail-attachments',
  'mail-attachments',
  false,
  10485760,
  -- 게시판 목록 + 메일에서 실제로 오가는 문서·압축 형식.
  -- hwp는 브라우저가 주는 MIME이 제각각이라 알려진 값을 전부 적는다.
  array[
    'image/png','image/jpeg','image/webp','image/gif','application/pdf',
    'application/zip','text/plain','text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/x-hwp','application/haansofthwp','application/vnd.hancom.hwp'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 업로드는 경로 규칙 전체를 검사한다: 1세그먼트 = 본인 uid, 2세그먼트 =
-- **본인 소유 임시저장 메일의 id**. uid만 보면 메일과 무관한 파일을 버킷에
-- 무제한 적재할 수 있다(quota 검사는 registerMailAttachment를 지나야만
-- 걸린다). 발송 후 업로드도 여기서 함께 막힌다(첨부 동결과 한 세트).
drop policy if exists "mail attach owner insert" on storage.objects;
create policy "mail attach owner insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'mail-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.mail_messages m
      where m.id::text = (storage.foldername(name))[2]
        and m.sender_id = public.current_employee_id()
        and m.is_draft
    )
  );

drop policy if exists "mail attach owner delete" on storage.objects;
create policy "mail attach owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'mail-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

/*
 * 다운로드는 게시판과 다르다 — 게시판 첨부는 전 임직원 공개지만 메일 첨부는
 * 발신자(경로 첫 세그먼트 = 본인 uid)와 그 메일의 수신자만 연다.
 * 수신자 판정은 경로 둘째 세그먼트(message id)로 내 수신자 행을 찾는 것으로
 * 한다 — 수신자 행은 발송된 메일에만 존재하므로 임시저장 첨부는 안 샌다.
 * (mail_recipients 조회에는 본인 행 SELECT 정책이 그대로 적용된다)
 */
drop policy if exists "mail attach select" on storage.objects;
create policy "mail attach select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'mail-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1
        from public.mail_recipients r
        where r.recipient_id = public.current_employee_id()
          and r.message_id::text = (storage.foldername(name))[2]
      )
    )
  );
