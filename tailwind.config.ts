import type { Config } from "tailwindcss";

/**
 * 에임브릿지 인트라넷 디자인 토큰
 * 출처: daou-survey/06-tokens-raw.md — 원본 CSS 변수(--doa-*) 632개 전량 덤프.
 * 눈대중·근사값이 아니라 원본 코드값 그대로다. 값을 바꾸고 싶으면 먼저
 * 그 문서에서 원본에 뭐가 있는지 확인할 것.
 *
 * 토큰 "이름"은 종전 시맨틱 체계(primary/ink/muted/line/surface/canvas…)를
 * 그대로 유지하고 "값"만 원본 코드값으로 교체한다.
 *
 * 원본 체계 요점:
 *   1. 페이지 바닥 회청(#edf0f3) + 흰 카드, 그림자 없음.
 *   2. 팔레트는 10계열 × 03~98 스텝(gray/primary/red/green/blue/orange/
 *      yellow/purple/…). hover는 **밝은 쪽**으로 간다 — primary hover가
 *      #3cbed7(40스텝), negative hover가 #ff502a(52스텝)다.
 *   3. font-weight는 r400/m500/b600 세 단뿐. 700은 코드에 없다.
 *   4. 강조는 전부 시안(#08a7bf) 축이다. 민트 같은 별도 액센트는 없다.
 *   5. radius 스케일: 2/4/6/8/12/16/24/32/40.
 */
const config: Config = {
  /*
   * src 전체를 스캔한다.
   * create-next-app 기본값은 app/components/pages 세 폴더만 훑기 때문에
   * src/features 같은 폴더를 추가하면 그 안의 클래스가 CSS로 생성되지 않는다.
   */
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        /*
         * 브랜드: 시안. 원본 primary 팔레트(03~98 스텝) 그대로.
         *   DEFAULT  #08a7bf = --doa-color-primary-bg-level1 (팔레트 52)
         *   hover    #3cbed7 = --doa-color-button-bg-level1-hover (팔레트 40)
         *            — 원본 hover는 **밝아진다**. 어둡게 뒤집었던 건 내 추정이었다.
         *   pressed  #00889c = 팔레트 64
         *   light    #e2f1f5 = --doa-color-button-bg-level2 (팔레트 05)
         *   light-hover #cdeaf1 = --doa-color-button-bg-level2-hover (팔레트 08)
         *   light-pressed #bbe2ec = 팔레트 10
         *   ink      #00889c = --doa-color-primary-text-level2 (옅은 면 위 글자)
         */
        primary: {
          DEFAULT: "#08a7bf",
          hover: "#3cbed7",
          pressed: "#00889c",
          light: "#e2f1f5",
          "light-hover": "#cdeaf1",
          "light-pressed": "#bbe2ec",
          ink: "#00889c",
        },
        /*
         * 레일 — DevTools 재실측(.doa_gnb)으로 확정.
         *   배경 rgb(235,244,246) · 우측 경계 1px rgb(228,229,229)
         *   hover/active는 **칸이 아니라 아이콘 타일(32×32, radius 8)**에 칠한다.
         *   hover  #CDEAF1 (--doa-color-primary-bg-level3-hover 그대로)
         *   active #08A7BF (--doa-color-menu-bg-active) + 흰 글리프 + 라벨 시안
         * 한때 "칸 전체 통칠"로 잘못 만들었다가, 스크린샷 대조 때는 반대로
         * "레일이 흰색"이라고 또 오독했다. 이 값들은 원본 CSS 변수에서 읽었다.
         */
        sidebar: {
          DEFAULT: "#ebf4f6",
          hover: "#cdeaf1", // 아이콘 타일 hover
          text: "#323333", // 레일 라벨은 흐린 회색이 아니라 보조 먹색
          active: "#08a7bf", // 아이콘 타일 active — primary와 같은 값
          line: "#e4e5e5", // rgb(228,229,229) 레일 우측 경계
        },
        // 선택형 카드처럼 의도적으로 대비를 주는 다크 블록
        pick: "#1c1c1c",
        ink: {
          DEFAULT: "#1c1c1c", // rgb(28,28,28) 본문
          sub: "#323333", // rgb(50,51,51) 보조 — 라벨·레일 텍스트
        },
        muted: "#969799", // --doa-color-status-neutral-level1 (gray-52) 흐린 글자
        /*
         * 빈 상태 문구색 — 07-modules.md L15 실측 rgb(170,170,170).
         * 06의 632개 변수에는 없는 값(원본 하드코딩)이라 sunday·line-dark와
         * 같은 방식으로 07 실측을 근거 삼아 별도 토큰으로 둔다.
         * 06 최근접값은 gray-40 #aeafb1.
         */
        faint: "#aaaaaa",
        /*
         * 레일 gnb-band 화살표 밴드 글리프색 — 08-shell-extra.md
         * "gnb-band 화살표 밴드(h-24, #7a7b7d)". 06 팔레트 gray-64
         * (tab 글자 base·field 메시지와 같은 단) — muted(gray-52)보다
         * 한 단 진하다.
         */
        band: "#7a7b7d",
        canvas: "#edf0f3", // rgb(237,240,243) 페이지 배경 — 이번 변경의 핵심
        /*
         * canvas 위에 바로 놓인 행(패널 항목 등)의 hover.
         * subtle(#f8f8f8)은 canvas보다 **밝아서** 여기서 쓰면 hover가 어두워지는
         * 대신 밝아진다 — 흰 카드 위 표 행 hover(어두워짐)와 방향이 반대가 되고,
         * 밝아진 행이 "선택된 카드"처럼 읽힌다. 바닥 위 hover는 이 값을 쓴다.
         * 값은 gray-08(#e4e5e5 — 06의 chip hover·레일 우측 경계와 같은 단).
         * 종전 #e3e7eb는 06·07 어디에도 없는 즉흥 혼합값이라 06 인접 스텝으로
         * 교체했다. canvas(#edf0f3)보다 확실히 어두워 방향은 유지된다.
         */
        "canvas-hover": "#e4e5e5",
        surface: "#ffffff", // 카드 면
        subtle: "#f8f8f8", // gray-03 = --doa-color-button-bg-base-hover — 흰 면 위 hover·옅은 면
        line: "#eaecef", // rgb(234,236,239) 카드 테두리 — 홈 카드 실측값
        "line-strong": "#dbdcdc", // gray-10 = --doa-color-basic-border-level2
        /*
         * 패널 주요 버튼 테두리 (07-modules.md — 결재 "새 결재 진행"·게시판
         * "글쓰기" 실측 rgb(74,75,76)). line/line-strong보다 훨씬 진한 윤곽선
         * 단 — 색면 없이 테두리만으로 버튼의 무게를 만드는 자리에 쓴다.
         */
        "line-dark": "#4a4b4c",
        /*
         * 지표 강조. 한때 민트(#44d1a5)를 넣었는데 **원본 632개 변수 어디에도
         * 민트는 없다** — 초기 실측의 오독이었다. 원본 홈의 큰 숫자·강조는
         * 전부 primary 시안이다(프로필 카드 지표·잔여 연차·저장용량 전부
         * #08a7bf로 재실측). accent를 primary 축으로 재지정해 쓰던 자리
         * (StatCard positive·진행바·범례)가 한 번에 시안으로 돌아온다.
         */
        accent: {
          DEFAULT: "#08a7bf",
          ink: "#00889c",
          light: "#e2f1f5",
        },
        /*
         * 시맨틱 상태색.
         *
         * warn은 한때 primary와 같은 값(#ff6f0f)이었는데, 그러면 진행바에서
         * "정상 / 48h 경고 / 52h 초과" 3구간을 색으로 나눌 수 없다.
         * 액센트(primary)와 경고(warn)는 역할이 다르므로 분리한다 —
         * 앰버는 브랜드색이 아니라 계기판 색이고, 면적을 넓게 쓰지 않는다.
         */
        /*
         * 시맨틱 상태색 — 원본 status 스케일의 level1 그대로.
         *   positive #00af52 (green-52) · information #0d99ff (blue-52)
         *   notice   #f0bc00 (yellow-40, 면) / #d99f00 (yellow-52, 글자)
         *   negative #ee3010 (red-64, 면) / hover #ff502a (red-52 — 밝아진다)
         */
        success: "#00af52",
        info: "#0d99ff",
        /*
         * 캘린더 요일 헤더의 일요일 빨강 — 07-modules.md 실측 rgb(255,0,10).
         * 06-tokens-raw.md의 632개 변수 어디에도 없는 값이라(변수 아닌
         * 원본 하드코딩) danger(#ee3010) 축과 분리해 별도 토큰으로 둔다.
         * 토요일은 별도 토큰 없이 info(#0d99ff) 축을 그대로 쓴다.
         */
        sunday: "#ff000a", // 캘린더 요일 헤더 전용
        /*
         * 캘린더 화면 실측 하드코딩값 3종 — 09-calendar.md.
         * 셋 다 06의 632개 변수 목록에 없는 원본 하드코딩이라(09 '참고' 절)
         * sunday·line-dark·faint와 같은 취급으로 09 실측을 출처 삼아 둔다.
         *   check      #333333 — 패널 종류 필터 체크박스 체크됨 채움(+흰 체크)
         *   seg-active #38393a — 보기 전환 필 세그먼트 활성 채움(흰 글자)
         *   ghost      #bbbbbb — 월간 격자 이달 밖 날짜 숫자
         */
        check: "#333333",
        "seg-active": "#38393a",
        ghost: "#bbbbbb",
        warn: "#f0bc00", // --doa-color-tag-system-bg-notice
        /*
         * 진행바 채움용 경고색 — yellow-64 (06 팔레트 표).
         * warn(#f0bc00, yellow-40)은 트랙(line #eaecef) 대비 1.49:1이라
         * 4px 막대에서 경고 구간이 사실상 안 보인다. 채움은 positive
         * (#00889c=primary-64)·critical(#ee3010=red-64)과 같은 64스텝으로
         * 내린다 — 트랙 대비 2.78:1. (yellow-52 #d99f00은 1.99:1로 부족.
         * 3:1이 엄격히 필요해지면 yellow-72 #7e6206이 4.88:1이다.)
         */
        "warn-strong": "#b18803",
        danger: {
          DEFAULT: "#ee3010", // --doa-color-button-bg-negative
          hover: "#ff502a", // --doa-color-button-bg-negative-hover
          pressed: "#c92208", // red-72
        },
        /*
         * 각 상태의 옅은 면 — 원본 chip/tag 틴트(각 팔레트 05 스텝) 그대로.
         * /10 투명도 대신 solid 틴트를 쓰는 이유: 진행바 트랙이나 칩이
         * 이미 색이 있는 면 위에 올라가면 알파 합성 결과가 배경마다 달라진다.
         */
        "success-light": "#e0f4e2", // green-05
        "info-light": "#e6efff", // blue-05 = --doa-color-chip-bg-information
        "warn-light": "#fdebc2", // yellow-05 = --doa-color-chip-bg-notice
        "danger-light": "#ffe4dc", // red-05 = --doa-color-chip-bg-negative
        /*
         * 옅은 면·흰 배경 위 글자색 — 원본 tag-system-text-* 그대로.
         * (원본은 4.5:1을 고집하지 않는다. 코드값을 따른다.)
         */
        "success-ink": "#00af52",
        "info-ink": "#0d99ff",
        "warn-ink": "#d99f00", // --doa-color-tag-system-text-notice
        "danger-ink": "#ff502a", // --doa-color-tag-system-text-negative
        /*
         * 캘린더 이벤트 색상 (스펙 02 · 3.4)
         * SEED는 브랜드 색을 하나만 두므로, 이벤트 구분은 브랜드가 아니라
         * 유틸리티(semantic) 색으로 처리한다.
         */
        /*
         * 캘린더 리소스 예약 전용 톤. 다른 이벤트 종류는 전부 시맨틱 색
         * (primary/success/info/warn/ink)으로 재배정돼서 여기 남은 건 이것뿐이다.
         */
        event: {
          // muted와 같은 값. features/calendar/colors.ts의 resource_booking.hex와
          // 반드시 함께 움직인다 — 화면 점(bg-event-resource)과 ICS/프린트 export가
          // 같은 일정을 다른 색으로 그리면 안 된다.
          resource: "#969799", // gray-52
          "resource-ink": "#666768", // gray-72
        },
      },
      fontFamily: {
        /*
         * 실측 폰트가 PretendardVariable이다. 종전에는 시스템 폰트를 앞에 세워
         * 셀프호스팅한 Pretendard가 사실상 안 걸렸다 — 순서를 뒤집는다.
         * (layout.tsx의 localFont가 --font-pretendard를 채운다)
         */
        sans: [
          "var(--font-pretendard)",
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "Segoe UI",
          "Apple SD Gothic Neo",
          "Malgun Gothic",
          "sans-serif",
        ],
      },
      /*
       * 실측 굵기 분포: 400 ×1824 / 500 ×37 / 600 ×5. 700은 0건.
       *
       * 우리 코드에는 font-bold가 142곳에 흩어져 있다. 전부 손으로 고치면
       * 표현 계층 외 파일까지 건드리게 되므로, 유틸리티 "이름"은 남기고
       * "값"만 낮춘다 — font-bold를 쓴 자리가 700이 아니라 500을 낸다.
       * 진짜로 한 단계 더 필요한 극소수 자리에만 font-semibold(600)를 쓴다.
       */
      fontWeight: {
        normal: "400",
        medium: "500",
        semibold: "600",
        bold: "500", // 의도적. 700은 이 디자인에 존재하지 않는다.
      },
      fontSize: {
        /*
         * 원본 타이포 스케일 그대로 (--doa-font-size / line-height / letter-spacing).
         *   body: 2xs 11/11/-.22 · xs 12/16.5/-.24 · s 13/18/-.26 ·
         *         m 14/18/-.28 · l 16/20/-.32
         *   heading: s 16/24/-.32 · m 18/27/-.36 · l 20/30/-.4 ·
         *            xl 24/36/-.48 · 2xl 28/42/-.56
         * 우리 이름과의 대응: body=body-m, label=body-s, micro=body-xs,
         * nano=body-2xs, h3=heading-s, h2=heading-m, h1/title=heading-xl,
         * metric=heading-2xl. 19px·17px 같은 어중간한 단은 원본에 없어서 걷어냈다.
         * body와 body-sm이 같은 14px로 수렴하는 건 의도한 결과다.
         */
        h1: ["24px", { lineHeight: "36px", fontWeight: "600", letterSpacing: "-0.48px" }],
        h2: ["18px", { lineHeight: "27px", fontWeight: "600", letterSpacing: "-0.36px" }],
        h3: ["16px", { lineHeight: "24px", fontWeight: "600", letterSpacing: "-0.32px" }],
        title: ["24px", { lineHeight: "36px", fontWeight: "600", letterSpacing: "-0.48px" }],
        body: ["14px", { lineHeight: "18px", fontWeight: "400", letterSpacing: "-0.28px" }],
        "body-sm": ["14px", { lineHeight: "18px", fontWeight: "400", letterSpacing: "-0.28px" }],
        label: ["13px", { lineHeight: "18px", fontWeight: "400", letterSpacing: "-0.26px" }],
        micro: ["12px", { lineHeight: "16.5px", fontWeight: "400", letterSpacing: "-0.24px" }],
        nano: ["11px", { lineHeight: "11px", fontWeight: "400", letterSpacing: "-0.22px" }],
        /* 대시보드 큰 숫자 — heading-2xl. 굵기가 아니라 크기로 강조한다. */
        metric: ["28px", { lineHeight: "42px", fontWeight: "500", letterSpacing: "-0.56px" }],
      },
      borderRadius: {
        // 실측: 8 ×791 / 10 ×122 / 12 ×121 / 20 ×25 / 9999 ×3 — 기본 8, 카드 12
        DEFAULT: "8px",
        sm: "8px",
        card: "12px",
        pick: "12px",
        chip: "20px",
        pill: "9999px",
      },
      boxShadow: {
        /*
         * SEED §6: 면을 나누는 기본 수단은 hairline이다. 카드는 여전히 flat.
         *
         * 다만 "선택된 날짜가 회색 스트립 위로 튀어나온다"(R5)처럼
         * 같은 흰색 면이 겹칠 때는 경계선만으로 층이 구분되지 않는다.
         * 그래서 raised 한 단계만 되살린다 — 장식이 아니라 층 표시용이고,
         * 상시 노출되는 카드에는 쓰지 않는다.
         */
        card: "none",
        raised: "0 1px 3px rgba(33,33,36,0.08), 0 1px 2px rgba(33,33,36,0.04)",
        pop: "0 4px 16px rgba(33,33,36,0.10)",
        /*
         * 앱 런처(전체 메뉴) 흰 패널의 우측 그림자 — 08-shell-extra.md 실측
         * `rgba(20,30,50,0.2) 6px 0 24px -6px` 그대로. 오른쪽으로만 번지는
         * 방향성 그림자라 pop(사방 대칭)으로 대체하지 않는다.
         */
        launcher: "6px 0 24px -6px rgba(20,30,50,0.2)",
      },
      spacing: {
        // 실측 셸 치수. 4px 그리드는 유지된다(60/64/260/324 전부 4의 배수).
        topbar: "60px",
        rail: "64px", // 아이콘 32×32 + 라벨 14px가 들어가는 폭
        /*
         * 펼친 레일 — 06-tokens-raw.md `--doa-gnb-w: 200` ·
         * 08-shell-extra.md "폭 64 → 200px". 배경은 접힘과 동일 #ebf4f6.
         */
        "rail-wide": "200px",
        panel: "260px", // 2뎁스 모듈 패널
        shell: "324px", // rail(64) + panel(260) — 본문 시작 x
        drawer: "248px",
      },
      transitionTimingFunction: {
        // SEED §15. 스프링·오버슈트는 금지.
        enter: "cubic-bezier(0, 0, 0.2, 1)",
        exit: "cubic-bezier(0.4, 0, 1, 1)",
        standard: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      /*
       * 원본 transition 308건 집계(11-motion.md):
       * hover류 0.15s · 구조 이동/펼침 0.2s · 오버레이 0.3s.
       * fast는 이미 일치, standard 250→200 · slow 350→300으로 원본에 맞춘다.
       */
      transitionDuration: {
        fast: "150ms",
        standard: "200ms",
        slow: "300ms",
      },
      screens: {
        md: "768px",
      },
    },
  },
  plugins: [],
};
export default config;
