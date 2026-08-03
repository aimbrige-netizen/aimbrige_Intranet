# 다우오피스 채집 — 셸(레일·상단바)

*2026-08-02 · aimbrige.daouoffice.com 실계정 · 뷰포트 1920×945*
*2026-08-02 2차: DevTools로 재실측 — 1차의 라벨/간격 오독 정정. ★ 표시가 확정값*

## 좌측 레일 (★ 2차 확정 — .doa_gnb / ul.group_menu_list)

| 항목 | 값 | 근거 |
|---|---|---|
| 폭 | **64px** | aside.doa_gnb 실측 |
| 배경 | `rgb(235,244,246)` 연청록 | aside.doa_gnb computed |
| 우측 경계 | `1px solid rgb(228,229,229)` | 〃 |
| 칸 `<a>` | **64×64 · flex-col · margin-bottom 6px** (1차의 "gap 2"는 오독) | li>a computed |
| 아이콘 타일 `<i>` | **32×32 · radius 8** — hover/active를 **이 타일에만** 칠한다 | .AppIcon |
| 타일 hover | `#CDEAF1` (--doa-color-primary-bg-level3-hover) | CSS 변수 |
| 타일 active | `#08A7BF` (--doa-color-menu-bg-active) + 흰 글리프 | 〃 |
| 라벨 | **12px / 500** (1차의 "14px/400"은 오독) · 비활성 `rgb(50,51,51)` · 활성 `rgb(8,167,191)` | span.txt computed |
| 스크롤바 | **평상시 완전 숨김** — `.gnb-scroll { scrollbar-width:none }`. wide/편집 모드에서만 6px thin | 원본 CSS 규칙 |
| 칸 배경 | 투명 — **칸 전체를 칠하는 상태는 없다** | 〃 |

## 상단바 검색창 (★ 2차 확정 — .global-search-bar)

360×40 · radius 20 · **흰 바탕** · 테두리 `1px rgb(228,229,229)` · 입력 14px
(회색 채움이 아니다)

## 레일 모듈 24개 (순서 그대로)

```
홈            /home
AI            /ai/app
메일 (5)      /app/mail
결재          /gw/app/approval
Works         /gw/app/works
캘린더        /gw/app/calendar
게시판        /gw/app/board
보고          /gw/app/report
근태          /ehr/app/attend/my-attendance-status
휴가          /ehr/app/leave/my-leave-status
주소록        /gw/app/contact
예약          /gw/app/asset
설문          /gw/app/survey
전사결재함    /gw/app/docfolder
문서          /gw/app/docs
커뮤니티      /gw/app/community
ToDO+         /gw/app/todo
인사          /ess/app/#hr
급여          /ess/app/#payroll
계약          /ess/app/#econtract
교육          /ess/app/#legal-education
경비          /ess/app/#expenses
차량일지      /ess/app/#vehicle-log
드라이브      /drive/app
```

### 우리와 가장 큰 차이 — 레일 정책
- 다우오피스: **24개를 안 묶고 전부 노출**, 넘치면 스크롤. 라벨 14px로 크게.
- 우리: 11개로 묶음(업무=일지·할일·목표·평가 / 자산·복지 등). 라벨 11px.
- 즉 우리가 "76px에서 글자가 뭉개진다"고 판단해 묶은 것을, 저쪽은
  **아이콘을 32px로 키우고 라벨을 14px로 키워** 정면 돌파했다.

### URL 네임스페이스 (기능 소속이 드러남)
- `/gw/app/*` — 그룹웨어(결재·캘린더·게시판·보고·주소록·예약·설문·문서·커뮤니티·ToDo)
- `/ehr/app/*` — 근태·휴가
- `/ess/app/#*` — 인사·급여·계약·교육·경비·차량일지 (해시 라우팅, 한 앱 안의 탭)
- `/ai/app`, `/app/mail`, `/drive/app` — 독립

## 상단바
- 높이 **60px**
- 좌: 로고 + "다우오피스"
- 중앙: `전체 앱 ▾` 드롭다운 + 검색창(필터 아이콘 포함)
- 우: 아이콘 6종 + 알림 배지(5) + `앱 다운로드` + `경영업무포털` 버튼 + 아바타
