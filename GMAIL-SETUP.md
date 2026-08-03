# Gmail 연동 설정 가이드 (GMAIL-SETUP)

인트라넷 **/mail(메일)** 화면이 회사 Gmail(@aimbrige.kr)로 실제 메일을 읽고 보내게
만드는 설정 문서입니다. **비개발자 기준으로, 화면에 보이는 버튼 이름 그대로**
안내합니다. 전부 무료이며, 한 번만 해두면 됩니다(예상 소요 20~30분).

> 메뉴 이름은 2026년 기준 Google Cloud 콘솔·Supabase 대시보드 화면을 기준으로
> 적었습니다. Google이 화면을 자주 바꾸므로, 이름이 정확히 일치하지 않으면
> **"(유사 명칭)"이라고 표시된 항목은 비슷한 이름의 메뉴**를 찾으면 됩니다.

**순서 요약**

| 단계 | 하는 곳 | 내용 |
|---|---|---|
| 0 | — | 전제 조건 확인 |
| 1 | Google Cloud 콘솔 | 프로젝트 만들고 Gmail API 켜기 |
| 2 | Google Cloud 콘솔 | OAuth 동의 화면 — **내부(Internal)** 로 만들기 |
| 3 | Google Cloud 콘솔 | Gmail 권한(스코프) 2개 등록 |
| 4 | Google Cloud 콘솔 | OAuth 클라이언트 ID 만들기(웹) |
| 5 | Supabase 대시보드 | Google 로그인에 클라이언트 ID/비밀번호 입력 |
| 6 | 프로젝트 폴더 | `.env.local` 값 3개 추가 |
| 7 | Supabase 대시보드 | 마이그레이션 29 SQL 실행 |
| 8 | 인트라넷 | 재로그인해서 Gmail 권한 승인 → 확인 |

---

## 0. 전제 조건

1. 회사 도메인 **aimbrige.kr** 이 **Google Workspace** 에 등록되어 있고,
   `이름@aimbrige.kr` 계정으로 **Gmail 웹(mail.google.com)에서 이미 메일
   수발신이 되는 상태**여야 합니다. (아직 안 된다면 이 문서보다 Workspace
   도메인/MX 설정이 먼저입니다.)
2. 아래 작업은 **Workspace 관리자 권한이 있는 @aimbrige.kr 계정**으로
   진행하세요. 개인 gmail.com 계정으로 하면 2단계에서 "내부(Internal)"를
   선택할 수 없습니다.

---

## 1. Google Cloud 프로젝트 만들기 + Gmail API 켜기

1. 브라우저에서 <https://console.cloud.google.com> 접속 →
   **@aimbrige.kr 관리자 계정**으로 로그인합니다.
2. 화면 **왼쪽 위**의 프로젝트 선택 상자(프로젝트 이름이 적힌 드롭다운) 클릭 →
   **새 프로젝트** → 이름에 `aimbridge-intranet` 입력 → **만들기**.
   - 만든 뒤, 같은 드롭다운에서 방금 만든 프로젝트가 **선택된 상태**인지 꼭
     확인하세요. (이후 모든 작업은 이 프로젝트 안에서 합니다.)
3. 왼쪽 햄버거 메뉴(≡) → **API 및 서비스** → **라이브러리** 클릭.
4. 검색창에 `Gmail API` 입력 → **Gmail API** 선택 → 파란 **사용**(Enable)
   버튼 클릭. "API 사용 설정됨"이 되면 완료입니다.

---

## 2. OAuth 동의 화면 — 반드시 "내부(Internal)"

> Google 콘솔에서 이 메뉴는 2024~2025년에 **"Google Auth Platform"** 이라는
> 이름으로 개편되었습니다. ≡ 메뉴 → **API 및 서비스** → **OAuth 동의 화면**
> 을 누르면 자동으로 Google Auth Platform 화면으로 이동합니다.

1. ≡ 메뉴 → **API 및 서비스** → **OAuth 동의 화면** 클릭.
2. 처음이면 **시작하기**(Get started) 버튼이 보입니다. 클릭 후:
   - **앱 이름**: `에임브릿지 인트라넷` (임직원 동의 화면에 표시되는 이름)
   - **사용자 지원 이메일**: 관리자 본인 @aimbrige.kr 주소
   - **대상**(Audience): **내부**(Internal) 선택 ← **가장 중요**
   - 연락처 이메일 입력 → 동의 체크 → **만들기**
3. "내부"의 의미: **@aimbrige.kr 계정만** 이 앱에 로그인할 수 있고, Google의
   **앱 심사(수 주 걸리는 검증 절차)가 필요 없습니다.** Gmail 권한은 원래
   "제한된 범위"라 외부(External) 앱은 심사를 받아야 하지만, 내부 앱은
   면제입니다.
   - "내부" 선택지가 아예 안 보이면 → 지금 로그인한 계정이 Workspace 계정이
     아닌 것입니다. @aimbrige.kr 관리자 계정으로 다시 로그인하세요.

---

## 3. Gmail 권한(스코프) 2개 등록

1. Google Auth Platform 화면의 왼쪽 메뉴에서 **데이터 액세스**(Data Access)
   클릭. (안 보이면 "OAuth 동의 화면" 하위의 **범위/Scopes** — 유사 명칭)
2. **범위 추가 또는 삭제**(Add or remove scopes) 버튼 클릭.
3. 오른쪽 패널의 필터/검색에 `Gmail API` 입력 후, 아래 **두 줄을 정확히**
   찾아 체크합니다:

   ```
   https://www.googleapis.com/auth/gmail.modify
   https://www.googleapis.com/auth/gmail.send
   ```

   - `gmail.modify` = 메일 읽기 + 읽음/보관 처리 (영구 삭제는 불가능한 권한)
   - `gmail.send` = 본인 계정으로 메일 보내기
   - 목록에 안 보이면 패널 아래쪽 "직접 입력"(Manually add scopes — 유사
     명칭) 칸에 위 두 줄을 붙여넣어도 됩니다.
4. **업데이트** → 화면 아래 **저장** 클릭.

---

## 4. OAuth 클라이언트 ID 만들기 (웹 애플리케이션)

1. Google Auth Platform 왼쪽 메뉴에서 **클라이언트**(Clients) 클릭.
   (구화면에서는 **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기
   → OAuth 클라이언트 ID** — 같은 곳으로 연결됩니다)
2. **+ 클라이언트 만들기**(Create client) 클릭.
3. 다음과 같이 입력:
   - **애플리케이션 유형**: **웹 애플리케이션**
   - **이름**: `aimbridge-intranet-web`
   - **승인된 리디렉션 URI** → **+ URI 추가** 클릭 후 아래 주소를 **한 글자도
     틀리지 않게** 붙여넣기:

     ```
     https://sybranykcbyalsekglfr.supabase.co/auth/v1/callback
     ```
4. **만들기** 클릭 → **클라이언트 ID** 와 **클라이언트 보안 비밀**(Client
   secret)이 표시됩니다.

   > ⚠️ **보안 비밀은 이 화면에서만 온전히 보여주고, 창을 닫으면 다시 볼 수
   > 없습니다**(2025년부터 Google 정책). 두 값을 지금 바로 메모장에
   > 복사해 두거나 **JSON 다운로드** 버튼으로 저장하세요.
   > 이 파일/메모는 비밀번호와 같습니다 — 카톡·메일로 공유하지 마세요.
   - 만약 복사를 못 하고 닫았다면: 클라이언트 목록에서 해당 클라이언트 →
     "보안 비밀 재설정"(유사 명칭)으로 새로 발급받으면 됩니다.

---

## 5. Supabase 대시보드 — Google 로그인에 값 입력

인트라넷 로그인은 이미 Supabase의 Google 로그인을 쓰고 있습니다. 4단계에서
만든 클라이언트를 여기에 연결합니다.

1. <https://supabase.com/dashboard> 접속 → `aimbridge-intranet` 프로젝트 선택.
2. 왼쪽 메뉴 **Authentication** → **Sign In / Providers** 클릭.
   (대시보드 버전에 따라 **Providers** 또는 **Sign In / Up** — 유사 명칭)
3. 목록에서 **Google** 클릭:
   - **Enable Sign in with Google** 스위치가 켜져 있는지 확인(이미 켜져
     있을 것입니다 — 현재 로그인이 Google이므로).
   - **Client ID**(또는 Client IDs): 4단계의 **클라이언트 ID** 붙여넣기.
     - 칸에 기존 값이 이미 있다면(과거 다른 클라이언트) **새 값으로 교체**
       합니다.
   - **Client Secret**: 4단계의 **클라이언트 보안 비밀** 붙여넣기.
   - **Save** 클릭.
4. 같은 화면에 표시되는 **Callback URL** 이
   `https://sybranykcbyalsekglfr.supabase.co/auth/v1/callback` 인지 확인 —
   4단계에서 Google에 등록한 주소와 같아야 합니다.

> 참고: Supabase의 Google 설정 화면에는 **스코프(Scopes) 입력란이 없습니다.**
> Gmail 권한은 6단계의 `.env.local` 값으로 **앱이 로그인할 때 직접
> 요청**합니다. (혹시 대시보드에 Scopes 칸이 보이는 버전이라면 비워 두어도
> 되고, 3단계의 두 주소를 넣어도 무방합니다.)

---

## 6. `.env.local` 에 값 3개 추가

프로젝트 폴더(`aimbridge-intranet`) 안의 **`.env.local`** 파일을 메모장으로
열어, 아래 세 줄을 추가/수정합니다. (`값` 자리에 4단계에서 복사한 실제 값)

```bash
# Gmail 연동 — 4단계에서 만든 웹 클라이언트 (Supabase에 넣은 것과 같은 값)
GOOGLE_OAUTH_CLIENT_ID=값
GOOGLE_OAUTH_CLIENT_SECRET=값

# 로그인할 때 Gmail 권한을 요청하도록 켜는 스위치 (두 주소를 공백 하나로 구분, 한 줄)
NEXT_PUBLIC_GOOGLE_EXTRA_SCOPES=https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send
```

- `NEXT_PUBLIC_GOOGLE_EXTRA_SCOPES` 줄이 **이미 있고 값이 들어 있다면**(예:
  캘린더 `calendar.events`) 지우지 말고 **뒤에 공백 하나를 두고 이어**
  붙입니다. 전부 **한 줄**이어야 합니다:

  ```bash
  NEXT_PUBLIC_GOOGLE_EXTRA_SCOPES=https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send
  ```
- 저장 후, 개발 서버를 쓰는 중이면 **껐다가 다시 켭니다**
  (`npm run dev` 재실행). env 파일은 재시작해야 반영됩니다.
- **Vercel(운영 배포)을 쓰는 경우**: Vercel 대시보드 → 프로젝트 →
  **Settings → Environment Variables** 에도 같은 세 값을 추가하고
  **재배포(Redeploy)** 해야 운영 사이트에 반영됩니다.

---

## 7. 마이그레이션 29 적용 (토큰 금고 테이블)

Gmail 연동 열쇠(refresh token)를 보관할 서버 전용 테이블을 만듭니다.

1. Supabase 대시보드 → 왼쪽 메뉴 **SQL Editor** → **New query**(새 쿼리).
2. 프로젝트 폴더의 이 파일을 메모장으로 열어 **내용 전체를 복사**합니다
   (파일 경로가 아니라 **내용**입니다):

   ```
   supabase/migrations/20260803000029_gmail_tokens.sql
   ```
3. SQL Editor에 붙여넣고 **Run**. "Success. No rows returned" 이면 정상입니다.
4. 확인: 왼쪽 **Table Editor** 에 `gmail_connections` 테이블이 생겼으면
   완료. 이 테이블은 **일부러 아무도(로그인한 임직원 포함) 못 읽게** 만들어져
   있습니다 — 서버만 접근하는 금고입니다. 대시보드에서 내용이 안 보여도
   고장이 아닙니다.

---

## 8. 재로그인 → Gmail 권한 승인 → 확인

1. 인트라넷에서 **로그아웃** 후 다시 **Google로 로그인**합니다.
2. 이번에는 Google 동의 화면에 **"Gmail에서 이메일 읽기, 작성, 전송…"**
   같은 항목이 추가로 나타납니다 → **허용/계속** 클릭. (이 동의는 계정마다
   **최초 1회**만 나옵니다.)
3. **/mail(메일)** 화면을 열어 받은메일함에 **실제 Gmail 메일**이 보이면
   성공입니다. 테스트: 본인 Gmail로 스스로에게 메일을 하나 보내 보고,
   /mail에서 발신·수신이 되는지 확인하세요.
4. 다른 임직원들도 각자 **한 번 재로그인**해야 본인 Gmail이 연동됩니다.
   (전사 공지 한 줄이면 됩니다: "인트라넷에서 로그아웃 후 다시 로그인하고,
   Gmail 권한을 허용해 주세요.")

---

## 9. 꼭 알아둘 것 — 연동 열쇠(refresh token)는 "최초 동의" 때만 발급

Google은 메일함 열쇠(refresh token)를 **처음 동의하는 순간에만** 내려줍니다.
평소 재로그인에서는 다시 주지 않습니다(이미 저장된 열쇠를 계속 씁니다).

열쇠가 깨져서(아래 10번의 `invalid_grant` 등) **다시 발급받아야 할 때**는:

1. <https://myaccount.google.com/connections> 접속
   (= Google 계정 → **보안** → **서드 파티 앱 및 서비스** — 유사 명칭)
2. 목록에서 **에임브릿지 인트라넷**(2단계에서 정한 앱 이름) 클릭 →
   **액세스 삭제**(연결 해제).
3. 인트라넷에서 로그아웃 → 다시 로그인 → 동의 화면이 다시 나타나면 허용.
   → 새 열쇠가 발급되어 저장됩니다.

인트라넷 화면에 "다시 연결" 버튼이 보이는 경우에는 그 버튼이 같은 일을
해주므로 1~2번 없이 버튼만 눌러도 됩니다.

---

## 10. 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| 로그인 동의 화면에 Gmail 항목이 **안 나옴** | ① `.env.local`의 `NEXT_PUBLIC_GOOGLE_EXTRA_SCOPES` 미설정/오타, 또는 서버 재시작 안 함 ② 3단계 스코프 미등록 ③ 이미 예전에 동의한 계정이라 화면 자체가 생략됨 | ① 6단계 값 확인 후 서버 재시작(Vercel이면 재배포) ② 3단계 다시 확인 ③ 9번 절차로 앱 액세스 삭제 후 재로그인 |
| **"액세스 차단됨: 이 앱은 확인되지 않았습니다"** | 동의 화면이 **외부(External)** 로 만들어짐 | Google Auth Platform → **대상**(Audience)에서 **내부**로 변경. "내부" 불가면 Workspace 계정으로 작업했는지 확인 |
| **"이 앱은 조직 내에서만 사용 가능"** / 로그인 거부 | @aimbrige.kr 이 아닌 계정(개인 gmail.com)으로 로그인 시도 | 회사 계정으로 로그인. 개인 계정 병행은 내부 메일(기존 기능)로만 사용 가능 |
| **redirect_uri_mismatch** 오류 | 4단계 리디렉션 URI 오타 | Google 콘솔 → 클라이언트 → 승인된 리디렉션 URI가 `https://sybranykcbyalsekglfr.supabase.co/auth/v1/callback` 과 정확히 같은지(끝의 `/callback`까지) 확인 |
| **invalid_client** / "OAuth 클라이언트를 찾을 수 없음" | Supabase에 넣은 Client ID/Secret 오타(앞뒤 공백 포함 복사 등) | 5단계 값 재입력 후 Save. Secret을 분실했으면 4단계 참고해 재발급 |
| **invalid_grant** / "Gmail 연동이 만료되었습니다" | 열쇠(refresh token)가 폐기됨 — 비밀번호 변경, 9번의 액세스 삭제, 장기간(6개월+) 미사용, 관리자 세션 회수 등 | 9번 절차로 재발급(액세스 삭제 → 재로그인). 시스템이 죽은 연동을 자동 정리하므로 재로그인만 하면 됩니다 |
| 동의까지 했는데 **/mail이 여전히 사내(내부) 메일만** 보여줌 | ① 7단계 마이그레이션 미적용 ② `.env.local`의 `GOOGLE_OAUTH_CLIENT_ID/SECRET` 미설정 ③ 동의 시점에 열쇠가 저장되지 않음 | ①② 각 단계 확인 ③ 9번 절차(액세스 삭제 → 재로그인). 그래도 안 되면 개발자에게 아래 "개발자 확인 사항" 전달 |
| 메일 **읽기는 되는데 보내기만 실패**(403) | `gmail.send` 스코프가 빠진 옛 동의로 발급된 열쇠 | 3단계에 gmail.send 등록 확인 → 6단계 env 확인 → 9번 절차로 재동의 |
| 동의 화면에서 **"관리자 승인이 필요합니다"** | Workspace 관리 콘솔이 서드파티 앱 접근을 차단 중 | admin.google.com → **보안 → API 제어 → 앱 액세스 제어**(유사 명칭)에서 이 앱(클라이언트 ID)을 **신뢰할 수 있는 앱**으로 허용 |
| Supabase Table Editor에서 `gmail_connections`가 **비어 보임/접근 불가** | 정상 — 의도된 보안 설계(서버 전용 금고) | 조치 불필요 |

---

## 부록 A. 개발자 확인 사항 (문제 해결용)

사장님은 몰라도 되는 내용입니다. 위 표로 해결이 안 될 때 개발자에게 이 절을
전달하세요.

- 로그인 `signInWithOAuth` 호출에 `queryParams: { access_type: "offline" }` 이
  포함되어야 Google이 `provider_refresh_token` 을 내려줍니다(Supabase 공식
  문서 기준). 재동의 버튼에는 `prompt: "consent"` 도 함께 필요합니다.
  코드 위치: `src/app/login/GoogleSignInButton.tsx`,
  `src/features/google/GoogleReauthNotice.tsx`
- 열쇠 저장 여부는 서버 로그의 `[gmail-tokens]` 접두사로 추적됩니다
  (`src/server/gmail/tokens.ts`). 저장 실패는 로그인 흐름을 막지 않고
  로그만 남깁니다.
- 연동 여부 확인은 DB 함수 `select public.has_gmail_connection();`
  (해당 임직원 세션으로 호출 시 true/false).
- `gmail_connections` 는 RLS enable + 정책 0개(= service role 전용)가
  **의도된 설계**입니다. "본인 행 읽기" 정책을 추가하면 refresh token이
  클라이언트로 새어 나가므로 절대 추가하지 마세요.

## 부록 B. 이 구조가 안전한 이유 (1분 설명)

- 임직원의 Gmail 열쇠(refresh token)는 **서버만 여는 금고 테이블**에 저장되고,
  브라우저·다른 임직원·대시보드 어디서도 읽을 수 없습니다.
- 서버는 메일을 읽거나 보낼 때마다 이 열쇠로 **1시간짜리 임시
  출입증(access token)** 을 발급받아 쓰고, 임시 출입증은 어디에도 저장하지
  않습니다.
- 서버는 항상 **"로그인한 본인"의 열쇠로 "본인 메일함"** 만 엽니다. 남의
  메일함을 여는 경로는 없습니다.
- 앱이 "내부(Internal)"라서 @aimbrige.kr 밖의 계정은 아예 연동할 수 없습니다.
