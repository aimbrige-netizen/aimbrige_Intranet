-- =====================================================================
-- 마이그레이션 20 — 스펙 11 메일 연동
--
-- 스펙 11 문서는 "별도 테이블이 필요 없습니다"라고 적혀 있고 그건 맞다.
-- 다만 dashboard_widgets.widget_key에 CHECK 제약이 걸려 있어서(마이그레이션 01)
-- 새 위젯 키를 허용 목록에 넣지 않으면 이런 일이 벌어진다:
--
--   위젯은 기본 순서(defaultWidgetOrder)로 잘 렌더된다 → 사용자가 '편집'에서
--   메일 위젯을 끈다 → upsert가 CHECK 위반으로 실패 → "저장에 실패했습니다"
--
-- 즉 위젯이 보이는 동안에는 멀쩡하다가 끄려는 순간에만 깨진다. 실제로 쓰기가
-- 일어나는 경로가 설정 저장 한 곳뿐이라 놓치기 쉬운 자리다.
-- =====================================================================

alter table public.dashboard_widgets
  drop constraint if exists dashboard_widgets_widget_key_check;

alter table public.dashboard_widgets
  add constraint dashboard_widgets_widget_key_check
  check (widget_key in (
    'approval_pending',
    'attendance_today',
    'notices',
    'calendar_upcoming',
    'favorites',
    'mail'
  ));

comment on column public.dashboard_widgets.widget_key is
  '위젯 식별자. 새 위젯을 추가할 때는 이 CHECK 목록과 types/db.ts의 WidgetKey를 함께 고쳐야 한다.';
