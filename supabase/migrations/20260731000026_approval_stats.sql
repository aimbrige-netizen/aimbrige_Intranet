-- =====================================================================
-- 마이그레이션 26 — 개인 결재 통계를 관리자 대시보드와 같은 기준으로
--
-- /approvals의 요약 밴드(getMyDocumentStats)와 /admin의 결재 처리 현황
-- (approval_activity, 마이그레이션 25)이 같은 회사 데이터를 두고 서로 다른
-- 숫자를 냈다. 개인 쪽이 틀린 세 가지:
--
--   (1) 평균 결재 소요를 updated_at - created_at으로 쟀다.
--       approval_docs_touch_updated_at 트리거가 모든 UPDATE에 붙어 있고
--       complete_approval_document()의 시행완료 처리가 updated_at을 다시 민다.
--       submit_approval_draft()·withdraw_approval_document()(13)도 민다.
--       즉 완료 문서의 '소요'는 승인까지가 아니라 시행완료까지였다.
--   (2) 임시저장(draft)이 '결재 완료'로 세어졌다. TS 루프가
--       status <> 'pending'이면 전부 decided로 쳤는데 draft가 거기 걸린다.
--       한 번도 상신한 적 없는 문서가 평균 소요일의 분모에 들어갔다.
--   (3) 기간 필터와 최장 대기일이 documents.created_at 기준이었다.
--       마이그레이션 13이 draft를 도입한 뒤로 그건 '임시저장을 만든 시각'이다.
--       6월에 임시저장하고 7월에 올린 문서가 6월 건수로 잡혔다.
--
-- 정답은 마이그레이션 25가 이미 갖고 있다:
--     상신 시각 = min(approval_steps.created_at)
--     결재 시각 = max(approval_steps.processed_at) filter (approved|rejected)
--     단계 없는 임시저장은 inner join으로 자연히 빠진다
--
-- ── 왜 로직을 복사하지 않고 뽑아냈나 ────────────────────────────────
--
-- 정의를 두 벌 두면 나중에 한쪽만 고쳐진다. 그게 애초에 이 마이그레이션이
-- 존재하는 이유다(25가 고친 것을 개인 화면이 못 받았다). 그래서 시각 계산과
-- 집계를 approval_activity_core() 하나에 두고, approval_activity()와
-- my_approval_activity()는 **권한 검사만 다른 얇은 껍데기**로 만든다.
-- 정의가 갈릴 수 있는 자리를 물리적으로 없앤다.
--
-- ── 왜 core에는 가드가 없나 (그리고 왜 그게 안전한가) ───────────────
--
-- core는 p_requester로 범위를 받는 순수 집계다. 가드를 core에 넣으면
-- '전사'와 '본인'이라는 서로 다른 두 권한을 한 함수가 알아야 해서 다시
-- 분기가 생긴다. 대신 core의 실행 권한을 **아무 역할에도 남기지 않아서**
-- 호출 경로를 definer 껍데기 둘로만 남긴다(껍데기는 소유자 권한으로
-- 실행되므로 호출자에게 core 권한이 없어도 된다).
-- 이때 revoke를 public에만 거는 것으로는 부족하다 — 이유는 1절 끝 참고.
--
-- ── 왜 my_ 쪽은 p_employee_id를 받고 본인인지 확인하나 ──────────────
--
-- 인자를 아예 안 받고 current_employee_id()만 쓰는 쪽이 더 짧다. 그런데
-- 호출부(src/features/approvals/data.ts)는 이미 employeeId를 인자로 들고
-- 다닌다 — getMyDocumentStats(employeeId, ...), getMyDocuments(employeeId, ...).
-- 인자 없는 함수를 그 자리에 끼우면, 언젠가 남의 id를 넘기려고 시도한
-- 호출부가 **에러 없이 조용히 호출자 본인의 숫자**를 돌려받는다. 화면에는
-- 그럴듯한 숫자가 뜨고 아무도 틀린 줄 모른다.
-- 그래서 p_employee_id를 받되 본인이 아니면 예외를 던진다. null이면 본인.
-- 관리자 우회는 두지 않는다 — 전사 숫자는 approval_activity()가 낸다.
-- p_employee_id를 마지막 인자로 둔 것은 위치 인자 호출에서
-- my_approval_activity('2026-07-01','2026-07-31')이 자연스럽게 '본인'이
-- 되게 하기 위해서다.
--
-- ── byStatus / byType의 기간 기준 (판단) ────────────────────────────
--
-- 상태별·유형별 건수는 그대로 approval_documents에서 센다. 문제는 기준 시각인데,
-- 임시저장은 상신 시각이 없고(단계가 없다) 그래도 목록에는 나와야 한다.
-- inner join으로 빼면 요약 밴드의 total과 filter chip의 draft 건수가
-- 사라지는데, 정작 표에는 그 문서가 보인다.
--
--   → coalesce(min(step.created_at), documents.created_at)
--     상신했으면 상신 시각, 아직 상신 전이면 만든 시각. 규칙 하나로 읽힌다:
--     "이 문서가 결재 흐름에 들어온 시각, 아직이면 손에 들어온 시각".
--     6월 임시저장 → 7월 상신 문서는 7월로 옮겨간다((3) 해결).
--     6월에 만들어 아직 안 올린 임시저장은 6월에 남는다(사라지지 않는다).
--
-- 목록 질의(getMyDocuments)도 같은 기준으로 옮겼다. 문서 테이블에는 그 시각이
-- 없으므로 4절의 approval_document_periods 뷰에서 **기간·상태·검색·정렬을 모두
-- 적용해** 문서 id를 뽑고, 목록 질의는 그 id의 본문만 채운다. 기준이 갈리면
-- '6월 임시저장 → 7월 상신' 문서가 표에는 6월, 필터칩 건수에는 7월로 잡히고,
-- 정렬만 옛 기준으로 남으면 사용자가 읽는 '기안일' 열이 내림차순이 아니게 된다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 공통 집계 — 시각의 출처는 여기 한 곳뿐
--
--    본문은 마이그레이션 25의 approval_activity() 본문을 그대로 옮긴 것이다.
--    달라진 것은 두 가지뿐:
--      · 권한 검사가 빠졌다(껍데기가 한다)
--      · p_requester로 범위를 좁힐 수 있다(null이면 전사)
--    경계 계산(date → 서울 자정 timestamptz)도 껍데기로 올렸다. core는
--    이미 계산된 [from_ts, to_ts)만 받는다 — 경계 규칙이 두 벌이 되면
--    그것도 갈라질 자리다.
-- ---------------------------------------------------------------------
create or replace function public.approval_activity_core(
  p_from_ts timestamptz,
  p_to_ts timestamptz,
  p_requester uuid default null
)
returns table (
  submitted_count int,
  approved_count int,
  rejected_count int,
  decided_count int,
  /** 상신 → 결재 완료 평균 소요일 (소수 첫째 자리). 결재된 건이 없으면 null */
  avg_decision_days numeric,
  /** 기간과 무관한 '지금' 값 — 기간 안 처리 건수만으로는 밀렸는지 알 수 없다 */
  pending_count int,
  oldest_pending_days int
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return query
  -- 답에 영향을 줄 수 있는 문서만 먼저 좁힌다. 이 CTE 없이 전체 이력을
  -- group by 하면 화면을 열 때마다 누적 문서 수에 비례해 무거워진다.
  with candidate as (
    select s.document_id as id
    from public.approval_steps s
    where ((s.created_at >= p_from_ts and s.created_at < p_to_ts)
        or (s.processed_at >= p_from_ts and s.processed_at < p_to_ts))
      -- 개인 조회면 여기서도 좁힌다. my_approval_activity()의 기간 단위 '전체'는
      -- 경계를 ±infinity로 열기 때문에 위 두 조건이 모든 행에 참이 된다 —
      -- 이 줄이 없으면 개인 화면 한 번이 전사 approval_steps를 후보로 올린 뒤
      -- 아래 doc CTE에서 남의 문서를 버린다(candidate CTE를 둔 이유가 사라진다)
      and (p_requester is null or exists (
             select 1
             from public.approval_documents d
             where d.id = s.document_id
               and d.requester_id = p_requester))
    union
    select d.id
    from public.approval_documents d
    -- pending은 기간과 무관한 '지금' 값이라 전부 필요하다.
    -- 개인 조회면 여기서 미리 좁힌다 — 전사 pending을 다 끌어온 뒤
    -- 조인해서 버리면 개인 화면 한 번에 전사 진행중 문서를 훑게 된다
    where d.status = 'pending'
      and (p_requester is null or d.requester_id = p_requester)
  ),
  doc as (
    select
      d.id,
      d.status,
      min(s.created_at) as submitted_at,
      max(s.processed_at) filter (
        where s.status in ('approved', 'rejected')
      ) as decided_at
    from candidate c
    join public.approval_documents d on d.id = c.id
    -- inner join — 단계가 없는 임시저장은 아직 상신된 문서가 아니다.
    -- 후보를 좁혔어도 min/max는 그 문서의 단계 전체에서 잰다
    join public.approval_steps s on s.document_id = d.id
    where p_requester is null or d.requester_id = p_requester
    group by d.id, d.status
  ),
  decided as (
    select
      doc.status,
      extract(epoch from (doc.decided_at - doc.submitted_at)) / 86400.0 as days
    from doc
    where doc.decided_at >= p_from_ts
      and doc.decided_at < p_to_ts
      and doc.status in ('approved', 'completed', 'rejected')
  )
  select
    (select count(*) from doc
      where doc.submitted_at >= p_from_ts and doc.submitted_at < p_to_ts)::int,
    -- completed(시행완료)는 승인을 거친 문서다. 빼면 승인 건수가 시간이
    -- 지날수록 줄어드는 숫자가 된다
    (select count(*) from decided
      where decided.status in ('approved', 'completed'))::int,
    (select count(*) from decided where decided.status = 'rejected')::int,
    (select count(*) from decided)::int,
    -- days < 0인 행은 평균에서 뺀다(건수에는 남는다). 결재 시각이 상신 시각보다
    -- 앞서는 것은 데이터가 깨진 것이지 '음수 소요일'이 아니다. 실제로 지금
    -- 시딩된 데모 문서가 그렇다 — seed-demo.ts가 processed_at을 스크립트를
    -- 돌린 PC 시계(new Date())로 쓰고 created_at은 DB의 now()라 두 시계가
    -- 어긋나 있다. 운영 경로(process_approval_step)는 둘 다 DB now()라 안 생긴다
    (select round(avg(decided.days)::numeric, 1) from decided
      where decided.days >= 0)::numeric,
    (select count(*) from doc where doc.status = 'pending')::int,
    (select coalesce(
       max(floor(extract(epoch from (now() - doc.submitted_at)) / 86400))::int, 0)
     from doc where doc.status = 'pending')::int;
end;
$$;

-- 가드가 없는 함수다. 껍데기(approval_activity / my_approval_activity)만
-- 부를 수 있도록 실행 권한을 아무에게도 남기지 않는다.
-- grant 줄이 없는 것은 누락이 아니다 — 넣는 순간 일반 직원이 p_requester=null로
-- 전사 결재 통계를 조회할 수 있다.
--
-- ⚠ revoke ... from public 한 줄로는 닫히지 않는다. Supabase 부트스트랩이
--   alter default privileges ... in schema public
--     grant all on functions to postgres, anon, authenticated, service_role
--   을 걸어 두기 때문에, 새로 만든 함수에는 세 역할에 대한 **명시적** EXECUTE가
--   함께 붙는다. from public은 PUBLIC 의사 롤의 기본 EXECUTE만 걷어낼 뿐
--   명시적 grant는 건드리지 못한다 — 그대로 두면 core가 PostgREST에 RPC로
--   노출되어 일반 직원이 is_system_admin() 가드 없이 전사 통계를 읽고,
--   p_requester에 남의 uuid를 넣어 my_approval_activity()의 본인 확인도
--   우회한다. 4절의 뷰에서 anon을 따로 revoke하는 것과 같은 이유다.
revoke all on function public.approval_activity_core(timestamptz, timestamptz, uuid) from public;
revoke all on function public.approval_activity_core(timestamptz, timestamptz, uuid)
  from anon, authenticated, service_role;

comment on function public.approval_activity_core(timestamptz, timestamptz, uuid) is
  '결재 집계의 유일한 정의. 가드가 없으므로 authenticated에 grant 금지 — approval_activity()/my_approval_activity()를 통해서만 호출한다.';

-- ---------------------------------------------------------------------
-- 2. 전사 집계 (마이그레이션 25 대체) — 권한 검사 + 경계 계산만 남는다
--
--    반환 컬럼·이름·순서는 25와 동일하다. src/features/admin/data.ts의
--    getApprovalActivity()와 scripts/e2e-admin.ts의 [D] 검증이 그대로 통과해야
--    한다(회귀 확인용이라 손대지 않았다).
-- ---------------------------------------------------------------------
create or replace function public.approval_activity(
  p_from date,
  p_to date
)
returns table (
  submitted_count int,
  approved_count int,
  rejected_count int,
  decided_count int,
  avg_decision_days numeric,
  pending_count int,
  oldest_pending_days int
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  -- 서울 자정 경계. [from 00:00, to+1일 00:00) — 종료일 당일을 포함한다
  from_ts timestamptz := (p_from::timestamp at time zone 'Asia/Seoul');
  to_ts   timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Seoul');
begin
  if not public.is_system_admin() then
    raise exception '전사 결재 현황은 시스템 관리자만 조회할 수 있습니다';
  end if;

  return query
  select * from public.approval_activity_core(from_ts, to_ts, null);
end;
$$;

revoke all on function public.approval_activity(date, date) from public;
grant execute on function public.approval_activity(date, date) to authenticated;

comment on function public.approval_activity(date, date) is
  '전사 결재 처리 현황. 집계 본문은 approval_activity_core()에 있다 — 여기는 관리자 가드와 서울 자정 경계 계산만 한다.';

-- ---------------------------------------------------------------------
-- 3. 개인 집계 — /approvals 요약 밴드
--
--    core가 내는 일곱 칸(상신·승인·반려·결재건수·평균소요·진행중·최장대기)에
--    화면이 쓰는 세 칸을 더한다: total_count / by_status / by_type.
--    앞의 일곱은 approval_activity()와 글자 그대로 같은 계산이다.
--
--    previous_total(직전 기간 대비 증감)은 컬럼으로 두지 않았다. 인자를
--    네 개(from/to/prev_from/prev_to)로 늘리면 '두 기간'이라는 개념이 함수
--    안으로 들어와서, 화면이 비교 기준을 바꿀 때마다 SQL을 고쳐야 한다.
--    호출부가 직전 기간으로 한 번 더 불러 total_count를 읽으면 된다
--    (지금 TS도 이미 질의를 두 번 던진다).
-- ---------------------------------------------------------------------
create or replace function public.my_approval_activity(
  p_from date default null,
  p_to date default null,
  p_employee_id uuid default null
)
returns table (
  submitted_count int,
  approved_count int,
  rejected_count int,
  decided_count int,
  avg_decision_days numeric,
  pending_count int,
  oldest_pending_days int,
  /** 기간 안 내 문서 총 건수 — 임시저장 포함 (목록·필터칩의 분모) */
  total_count int,
  /** {"draft":0,"pending":0,"approved":0,"completed":0,"rejected":0} — 0건도 키가 있다 */
  by_status jsonb,
  /** 문서유형 5종. 마찬가지로 0건도 키가 있다 */
  by_type jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  me uuid := public.current_employee_id();
  /*
   * 개인 화면에는 기간 단위 '전체'가 있다(lib/period의 unit='all'). 그때 호출부는
   * 경계를 넘길 값이 없어 null을 준다. null을 그대로 비교에 쓰면 모든 비교가
   * null이 되어 조용히 0건이 나온다 — 무한대로 열어 '전체 기간'을 뜻하게 한다.
   * 전사용 approval_activity(date, date)는 마이그레이션 25와 같은 모양을 지켜야
   * 하므로(관리자 화면은 항상 두 날짜를 넘긴다) 거기엔 이 처리를 두지 않는다.
   */
  from_ts timestamptz := coalesce(
    (p_from::timestamp at time zone 'Asia/Seoul'), '-infinity'::timestamptz);
  to_ts   timestamptz := coalesce(
    ((p_to + 1)::timestamp at time zone 'Asia/Seoul'), 'infinity'::timestamptz);
  core record;
begin
  if me is null then
    raise exception '결재 통계를 조회할 권한이 없습니다';
  end if;
  -- 남의 통계는 볼 수 없다. 관리자 우회도 없다 — 전사는 approval_activity()다.
  -- 조용히 본인 것으로 바꿔치기하지 않고 예외를 던지는 이유는 파일 머리말 참고.
  if p_employee_id is not null and p_employee_id <> me then
    raise exception '본인의 결재 통계만 조회할 수 있습니다';
  end if;

  select * into core
  from public.approval_activity_core(from_ts, to_ts, me);

  return query
  with mine as (
    -- 기준 시각 = 상신 시각, 없으면(아직 임시저장) 만든 시각.
    -- left join이라 단계 없는 임시저장도 남는다 — core의 inner join과
    -- 여기가 다른 이유는 목적이 다르기 때문이다. core는 '결재가 얼마나
    -- 걸렸나'라서 상신 안 된 문서에 답이 없고, 여기는 '내 서랍에 무엇이
    -- 있나'라서 임시저장이 빠지면 표와 숫자가 어긋난다.
    select
      d.id,
      d.status,
      d.document_type,
      coalesce(min(s.created_at), d.created_at) as effective_at
    from public.approval_documents d
    left join public.approval_steps s on s.document_id = d.id
    where d.requester_id = me
    group by d.id, d.status, d.document_type, d.created_at
  ),
  scoped as (
    select mine.id, mine.status, mine.document_type
    from mine
    where mine.effective_at >= from_ts
      and mine.effective_at < to_ts
  )
  select
    core.submitted_count,
    core.approved_count,
    core.rejected_count,
    core.decided_count,
    core.avg_decision_days,
    core.pending_count,
    core.oldest_pending_days,
    (select count(*) from scoped)::int,
    -- 0건인 상태도 키를 채워 내려준다. 화면이 없는 키를 undefined로 읽으면
    -- 필터칩 건수가 빈칸이 되고, 분모 계산에서 NaN이 난다.
    -- ⚠ 이 목록은 approval_documents_status_check(13)와
    --    src/features/approvals/types.ts의 DocumentStatus를 따라간다.
    --    상태를 추가하면 세 곳을 같이 고쳐야 한다.
    (select jsonb_object_agg(k.v, (select count(*) from scoped where scoped.status = k.v))
     from unnest(array['draft','pending','approved','completed','rejected']) as k(v)),
    -- ⚠ 마찬가지로 approval_documents_document_type_check(07)와
    --    types.ts의 DOCUMENT_TYPES를 따라간다.
    (select jsonb_object_agg(k.v, (select count(*) from scoped where scoped.document_type = k.v))
     from unnest(array['special_request','business_trip','expense',
                       'purchase_request','remote_work']) as k(v));
end;
$$;

revoke all on function public.my_approval_activity(date, date, uuid) from public;
grant execute on function public.my_approval_activity(date, date, uuid) to authenticated;

comment on function public.my_approval_activity(date, date, uuid) is
  '개인 결재 통계. 앞 7칸은 approval_activity()와 같은 계산(approval_activity_core)이다. 기간 기준은 상신 시각(임시저장은 생성 시각) — documents.created_at이 아니다. p_from/p_to가 null이면 전체 기간.';

-- ---------------------------------------------------------------------
-- 4. 목록 질의가 쓰는 뷰 — 표와 요약 밴드의 기간 기준을 하나로 묶는다
--
--    뷰로 내는 이유: 목록은 form_data·requester 조인·검색까지 얹혀 있어서
--    RPC 하나로 감싸면 그 함수가 목록 화면의 모든 조건을 다시 알아야 한다.
--    시각만 노출하고 나머지는 PostgREST 임베드에 맡긴다.
--
--    보안: security_invoker=on. 뷰가 정의자 권한으로 도는 것을 막는다
--    (기본값은 정의자 권한이라, 그대로 두면 이 뷰가 전 직원의 문서 시각을
--    RLS 없이 흘린다). invoker면 approval_documents의 SELECT 정책
--    (기안자·담당 결재자·관리자)이 그대로 적용된다.
--    ⚠ security_invoker는 PostgreSQL 15+ 문법이다. 14 이하에서는 이 CREATE가
--      실패한다 — 실패하는 편이 낫다. 조용히 정의자 권한 뷰가 생기면
--      전 직원의 결재 이력 시각이 새어 나간다.
--
--    쓰는 법: 임베드는 하지 않는다.
--      approval_documents ... , period:approval_document_periods!id(effective_at)
--    은 되지 않는다 — 뷰에는 FK가 없어 PostgREST가 관계를 확정하지 못한다.
--    getMyDocuments()는 이 뷰에서 **목록에 나올 문서 id를 순서까지 확정해서**
--    뽑고, 목록 질의는 그 id를 .in("id", ids)로 받아 본문만 채운다. 같은 조회로
--    행마다 찍을 상신·결재 시각도 함께 들고 간다(목록의 '소요'도 updated_at을
--    쓰면 안 되기 때문).
--
--    그래서 뷰에 status·document_type·title이 함께 있다. 시각만 노출하면
--    목록의 상태 필터·제목 검색이 문서 테이블 쪽에 남아, '기간 상위 200건을
--    먼저 자르고 그 안에서 필터'가 된다 — 필터칩 건수(기간 전체를 세는
--    my_approval_activity)와 표의 행 수가 모집단부터 어긋난다.
--    정렬 기준(effective_at)도 여기서만 표현할 수 있다: 문서 테이블에는
--    그 컬럼이 없어 .order()로 잡을 수 없다.
-- ---------------------------------------------------------------------
create or replace view public.approval_document_periods
with (security_invoker = on)
as
select
  d.id as document_id,
  d.requester_id,
  d.status,
  d.document_type,
  d.title,
  d.created_at,
  min(s.created_at) as submitted_at,
  max(s.processed_at) filter (
    where s.status in ('approved', 'rejected')
  ) as decided_at,
  -- my_approval_activity()의 mine CTE와 같은 규칙
  coalesce(min(s.created_at), d.created_at) as effective_at
from public.approval_documents d
left join public.approval_steps s on s.document_id = d.id
group by d.id, d.requester_id, d.status, d.document_type, d.title, d.created_at;

-- Supabase는 public 스키마의 새 테이블·뷰에 anon까지 기본 권한을 준다
-- (alter default privileges ... grant all on tables to anon, authenticated).
-- revoke ... from public은 anon 같은 명시적 역할의 권한을 걷어내지 못하므로
-- 따로 적는다. security_invoker + RLS로도 anon은 0행이지만, 권한을 두 겹으로 둔다.
revoke all on public.approval_document_periods from public;
revoke all on public.approval_document_periods from anon;
grant select on public.approval_document_periods to authenticated;

comment on view public.approval_document_periods is
  '문서별 상신·결재 시각. 목록 질의의 기간·상태·검색·정렬을 documents.created_at이 아니라 상신 시각(effective_at) 기준으로 확정하는 데 쓴다 — 여기서 id를 뽑고 목록은 그 id로 본문만 채운다. security_invoker=on이라 approval_documents의 RLS가 그대로 적용된다.';
