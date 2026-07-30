# 에임브릿지 인트라넷

에임브릿지 전 임직원용 통합 사내 시스템.

- 기획: `../aimbridge_intranet_plan.md`
- 디자인: `../aimbridge_intranet_design_system.md`
- 모듈 스펙: `../aimbridge_intranet_spec_01~18_*.md`

## 스택

| 영역 | 선택 |
|---|---|
| 프론트엔드 | Next.js 14 (App Router) · TypeScript · Tailwind CSS |
| 백엔드/DB | Supabase (PostgreSQL · Auth · Storage) |
| 인증 | Supabase Auth + Google OAuth (sding.kr 도메인 제한) |
| 폰트 | Pretendard Variable (셀프호스팅) |
| 배포 | Vercel |

## 구현 현황

| 스펙 | 모듈 | 상태 |
|---|---|---|
| 01 | 계정/인증 & 홈대시보드 | ✅ 구현 |
| 02 | 조직도·디렉토리 & 캘린더 | ✅ 구현 |
| 03 | 출퇴근관리 (연차·반차) | ✅ 구현 |
| 04 | 전자결재 | ✅ 구현 |
| 05 | 게시판 & 공지사항 | ✅ 구현 |
| 06 | 개인 파일함 (Drive) | ✅ 구현 |
| 07~18 | Phase 2·3 | ⬜ |

**MVP 전체 완료.** 홈 대시보드 위젯 5종(결재대기·근태·공지·일정·즐겨찾기)이 모두 실제 데이터에 연결됐습니다.

## 최초 세팅 (순서대로)

### 1. Supabase 프로젝트 생성

1. https://supabase.com/dashboard 에서 **New project**
2. Organization 선택 → 프로젝트 정보 입력
   - Name: `aimbridge-intranet`
   - Database Password: 생성 후 **비밀번호 관리자에 보관** (분실 시 재설정 필요)
   - Region: `Northeast Asia (Seoul)` — 국내 사용자 지연시간 최소
3. 생성 완료까지 2~3분 대기

### 2. 스키마 적용

Supabase 대시보드 → **SQL Editor** → **New query** 에서, 아래 파일들을 **파일 내용 전체를 복사해** 순서대로 붙여넣고 각각 Run 합니다. (파일 경로를 붙여넣는 게 아닙니다)

| # | 파일 | 내용 |
|---|---|---|
| 01 | `20260730000001_init_auth_dashboard.sql` | 테이블·RLS·역할 3종 |
| 02 | `20260730000002_avatar_storage.sql` | 프로필 사진 버킷 |
| 03 | `20260730000003_org_calendar.sql` | 조직도·캘린더·리소스 |
| 04 | `20260730000004_fix_definer_guards.sql` | SECURITY DEFINER 권한 검사 수정 |
| 05 | `20260730000005_holidays.sql` | 공휴일 + 2026년 21일 시딩 |
| 06 | `20260730000006_attendance_leave.sql` | 출퇴근·연차·초과근무 |
| 07 | `20260730000007_approvals.sql` | 전자결재 + 첨부 버킷 |
| 08 | `20260730000008_attendance_hardening.sql` | 근태 보안 보강 |
| 09 | `20260730000009_boards.sql` | 게시판 + 게시판 2개 시딩 |
| 10 | `20260730000010_drive_files.sql` | Drive 매핑 테이블 |
| 11 | `20260730000011_approvals_hardening.sql` | 결재 보안 보강 |

> 08·11은 각각 06·07의 보안 결함을 고치는 마이그레이션입니다. **반드시 번호 순서대로**
> 실행하세요. 새로 세팅하는 환경에서는 01~11을 순서대로 한 번씩 실행하면 됩니다.

> Supabase CLI를 쓰면 `supabase link --project-ref <ref>` 후 `supabase db push` 로도 됩니다.

### 3. Google OAuth 클라이언트 발급

**Google Cloud Console** (https://console.cloud.google.com)

1. 프로젝트 선택(또는 신규 생성)
2. **API 및 서비스 → OAuth 동의 화면**
   - User Type: **내부(Internal)** — sding.kr 워크스페이스 계정만 쓰므로 내부로 두면 검증 심사가 필요 없습니다
   - 앱 이름 / 지원 이메일 입력
3. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
   - 애플리케이션 유형: **웹 애플리케이션**
   - 승인된 리디렉션 URI에 아래를 추가
     ```
     https://<프로젝트ref>.supabase.co/auth/v1/callback
     ```
     (`<프로젝트ref>`는 Supabase 프로젝트 URL의 서브도메인)
4. 발급된 **클라이언트 ID / 클라이언트 보안 비밀** 복사
5. **스코프 등록** — 새 UI에서는 좌측 **데이터 액세스** 메뉴입니다(예전 "OAuth 동의 화면 → 범위").
   **범위 추가 또는 삭제** → 필요한 스코프 체크 → 업데이트 → 저장
   - 스펙 02 캘린더 동기화: `https://www.googleapis.com/auth/calendar.events`
   - 스펙 06 Drive / 스펙 11 Gmail 은 해당 모듈 작업 때 추가

6. **테스트 사용자 등록** — 좌측 **대상(Audience)** → **테스트 사용자** → 사용자 추가

   앱 게시 상태가 "테스트"인 동안 **민감 스코프(`calendar.events` 등)는 여기 등록된
   계정만 통과**합니다. 미등록 계정은 `403 access_denied`로 **로그인 자체가 막힙니다.**
   기본 스코프(email·profile)만 쓸 때는 이 제한이 걸리지 않아 눈치채기 어렵습니다.
   임직원을 새로 추가할 때 이 목록에도 넣어야 합니다(최대 100명).

   > **순서 주의**: ① 스코프 등록 → ② 테스트 사용자 등록 → ③ `.env.local`의
   > `NEXT_PUBLIC_GOOGLE_EXTRA_SCOPES` 채우기. 순서를 건너뛰면 전 사용자 로그인이 막힙니다.
   > 이미 로그인한 사용자는 로그아웃 후 다시 로그인해야 새 스코프가 토큰에 반영됩니다.
   >
   > 회사 Workspace 도메인(`aimbrige.kr`)을 만들어 User Type을 **내부(Internal)**로 바꾸면
   > 테스트 사용자 등록·검증 심사가 모두 불필요해집니다. 전 직원용 인트라넷이므로
   > 장기적으로는 이 방향이 맞습니다.

**Supabase 대시보드** → **Authentication → Sign In / Providers → Google**

1. Google 활성화
2. 위에서 받은 Client ID / Client Secret 입력
3. **Authentication → URL Configuration**
   - Site URL: `http://localhost:3000` (배포 후 Vercel 도메인으로 변경)
   - Redirect URLs 에 추가:
     ```
     http://localhost:3000/auth/callback
     https://<배포도메인>/auth/callback
     ```

### 4. 환경변수 설정

```bash
cp .env.local.example .env.local
```

`.env.local` 에 아래 값을 채웁니다. Supabase 대시보드 **Project Settings → API** 에서 확인.

| 변수 | 값 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / public 키 (신규 프로젝트는 Publishable key `sb_publishable_...`) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role 키 (신규 프로젝트는 Secret key `sb_secret_...`) — **절대 클라이언트에 노출 금지** |
| `SEED_ADMIN_EMAIL` | 본인(PM) 회사 이메일 |
| `SEED_ADMIN_NAME` | 본인 이름 |
| `SEED_DEPARTMENTS` | (선택) 초기 부서. 예: `경영지원본부,사업본부` |

### 5. 최초 관리자 시딩

UI로는 최초 관리자를 만들 수 없어서(닭과 달걀) 스크립트로 등록합니다.

```bash
npm run seed
```

여러 번 실행해도 안전합니다(이메일 기준 upsert).

### 6. 실행

```bash
npm run dev
```

http://localhost:3000 → `/login` 으로 리다이렉트 → Google 로그인.
최초 로그인 시 auth 계정이 시딩된 `employees` 레코드에 자동으로 연결됩니다.

## 명령어

```bash
npm run dev        # 개발 서버
npm run build      # 프로덕션 빌드
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm run seed       # 최초 관리자·부서 시딩
```

## 구조

```
src/
  app/
    (app)/                  로그인 이후 화면 (사이드바+상단바 셸)
      page.tsx              홈 대시보드
      profile/              내 프로필
      admin/employees/      임직원 관리 (시스템 관리자)
      admin/roles/          권한관리
      admin/audit-logs/     감사 로그
    auth/callback/          Google OAuth 콜백 (도메인 검증·계정 링크)
    login/                  로그인
  components/
    layout/                 Sidebar · Topbar · AppShell
    ui/                     디자인시스템 컴포넌트 (Button/Card/Badge/Field/…)
  features/
    dashboard/              위젯 + 위젯 데이터 fetch 레이어
    employees/ profile/ audit/
  lib/
    supabase/               client(브라우저) · server(RSC) · admin(service_role) · middleware
    auth/                   세션 조회, 접근 차단 사유
    audit.ts nav.ts env.ts utils.ts
  middleware.ts             인증·재직상태·관리자 라우트 게이트
supabase/migrations/        SQL 마이그레이션
scripts/seed.ts             시딩
```

### 권한 처리 방식

- **읽기**는 RLS로 제어합니다. `employees`는 본인 행 + 시스템 관리자 전체.
- **관리자 쓰기**(계정 등록·역할·재직상태)는 Server Action에서 `requireSystemAdmin()` 확인 후
  service_role 클라이언트로 수행하고, 모든 변경을 `audit_logs`에 남깁니다.
- **본인 프로필 쓰기**는 사용자 세션으로 UPDATE하며, 허용 필드(사진·휴대폰·비상연락처) 외
  변경은 DB 트리거 `employees_guard_self_update`가 막습니다.
- 퇴사·휴직 처리 시 Supabase Auth 계정을 ban 처리해 발급된 토큰까지 무효화합니다.

### 위젯 데이터 연동 지점

`src/features/dashboard/widget-data.ts` 의 각 함수가 유일한 교체 지점입니다.
지금은 `{ connected: false }` 를 돌려주고 위젯이 빈 상태를 그립니다.
해당 모듈 스펙 작업 시 함수 본문만 실제 쿼리로 바꾸면 UI 수정 없이 연동됩니다.

새 메뉴를 켤 때는 `src/lib/nav.ts` 의 `ready: false` → `true` 로 바꿉니다.
