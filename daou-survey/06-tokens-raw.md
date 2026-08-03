# 다우오피스 원본 CSS 변수 — 코드 그대로

*2026-08-02 · aimbrige.daouoffice.com /home · document.styleSheets에서 `--doa-*` 632개 전량 추출*
*(색 394 · 팔레트 150 · 타이포/치수 88). 이 문서가 값의 단일 출처다 — 눈대중 실측(04-tokens.md)과 다르면 이쪽이 이긴다.*

## 이 추출로 뒤집힌 것

| 항목 | 종전(근사) | 원본 코드값 |
|---|---|---|
| primary hover | 어둡게 #0794a9 | **밝게 #3cbed7** (`button-bg-level1-hover`) |
| primary light | #e7f6f9 | **#e2f1f5** (`button-bg-level2`, 팔레트 05) |
| primary ink | #056e7e | **#00889c** (`primary-text-level2`, 팔레트 64) |
| 민트 accent #44d1a5 | 지표 강조색이라 판단 | **존재하지 않음** — 강조는 전부 시안 |
| muted | #9b9c9e | **#969799** (gray-52) |
| subtle | #f7f8fa | **#f8f8f8** (gray-03 = `button-bg-base-hover`) |
| success | #1aa174 | **#00af52** (green-52) |
| info | #009ceb | **#0d99ff** (blue-52) |
| warn | #f59f0a | **#f0bc00** 면 / **#d99f00** 글자 |
| danger | #fa2314 | **#ee3010** 면, hover **#ff502a**(밝게), 틴트 #ffe4dc |
| 레일 배경 | (실측 rgb값만) | `--doa-palette-primary-globalbg: #ebf4f6` — 이름까지 확인 |
| font-weight | 700 부재(빈도 추정) | `--doa-font-weight-r/m/b = 400/500/600` — **코드로 확정** |

## 팔레트 (10계열 × 03·05·08·10·18·26·40·52·64·72·80·86·92·95·98)

핵심 스텝만 표기. 전체 값은 추출 원문(대화 기록) 참조.

| 계열 | 03 | 05 | 08 | 10 | 26 | 40 | 52 | 64 | 72 |
|---|---|---|---|---|---|---|---|---|---|
| primary | #f1fafc | #e2f1f5 | #cdeaf1 | #bbe2ec | #74cde1 | #3cbed7 | **#08a7bf** | #00889c | #117182 |
| gray | #f8f8f8 | #eeeeef | #e4e5e5 | #dbdcdc | #c0c1c2 | #aeafb1 | #969799 | #7a7b7d | #666768 |
| red | #fff0ed | #ffe4dc | #ffd3c3 | #ffbcaf | #ff8271 | #ff5d4b | #ff502a | #ee3010 | #c92208 |
| green | #effbf1 | #e0f4e2 | #caeecf | #b7e7bf | #6ed688 | #37c768 | #00af52 | #008f40 | #0d7738 |
| blue | #f3f8ff | #e6efff | #d5e5ff | #c5dcff | #84c3ff | #4cb3ff | #0d99ff | #047ed5 | #1a6aaf |
| orange | #fff7ed | #ffeddc | bisque | #ffd9b0 | #ffa45e | #ff8a3d | #e47b37 | #b96530 | #99562c |
| yellow | #fff5de | #fdebc2 | #fce198 | #fad977 | #f4cd0e | #f0bc00 | #d99f00 | #b18803 | #7e6206 |
| purple | #fcf5ff | #f5eaff | #f0ddff | #ebd1ff | #d8acff | #c895ff | #af79ff | #8c5be6 | #794ec7 |

특수: `--doa-palette-black #1c1c1c` · `white #fff` · `primary-globalbg #ebf4f6`(레일)
· gray 80~98: #525253 / #424343 / #323333 / #2a2b2c / #222324

## 시맨틱 그룹 (light 테마 실값)

**button**: base #fff/글자 #1c1c1c·hover #f8f8f8 | level1(브랜드 채움) #08a7bf·hover #3cbed7 | level2(옅은 면) #e2f1f5·hover #cdeaf1·글자 #08a7bf | negative #ee3010·hover #ff502a
**badge**: accent(빨강 카운트) **#ff502a** · primary #08a7bf · 틴트 #e2f1f5 · neutral #969799
**chip**: basic #eeeeef·hover #e4e5e5 | information #e6efff | negative #ffe4dc | notice #fdebc2 · 글자 #1c1c1c
**tab**: 글자 base **#7a7b7d** / active #08a7bf · solid형은 bg #08a7bf+흰 글자 · border-active #08a7bf · disabled #c0c1c2
**controls**(체크박스·라디오): active #08a7bf · border #cccdce·hover #aeafb1
**toggle switch**: 트랙 #e4e5e5 → active #08a7bf · 노브 #fff · 북마크 별 **#f9d500**
**field**(인풋): bg #fff · placeholder #969799 · invalid #ff502a · 메시지 #7a7b7d
**status** (level1, 글자·아이콘 공용): positive #00af52 · information #0d99ff · notice #d99f00 · caution #e47b37 · negative/accent #ff502a · neutral #969799 · special #af79ff
**tag-system**: bg(진한 면) positive #6ed688 · information #84c3ff · negative #ff8271 · notice #f0bc00 · neutral #aeafb1 · special #d8acff / 위 글자는 흰색. 옅은 면(level2)은 각 팔레트 05.
**근태 태그(tag-attendance)** — bg(점) / border / text:
- 출근 work: #6ed688 / #b7e7bf / #00af52
- 휴가 vacation: #84c3ff / #c5dcff / #0d99ff
- 결근 absent: #ff8271 / #ffbcaf / #ff502a
- 외출 outing: #d8acff / #ebd1ff / #af79ff
- 파업/특이 strike: #ffa45e / #ffd9b0 / #e47b37
- 휴무 off: #aeafb1 / #dbdcdc / #969799
**menu(=wide GNB, 다크)**: bg #1c1c1c · hover #323333 · active #08a7bf · 글자 #cccdce/active 흰색 — 접힌 64px 레일이 아니라 **펼친 200px GNB가 다크**라는 뜻이다.

## 타이포 (`--doa-font-*`)

| 이름 | size / line-height / letter-spacing |
|---|---|
| body-2xs | 11 / 11 / -.22px |
| body-xs | 12 / 16.5 / -.24px |
| body-s | 13 / 18 / -.26px |
| **body-m** | **14 / 18 / -.28px** |
| body-l | 16 / 20 / -.32px |
| heading-s | 16 / 24 / -.32px |
| heading-m | 18 / 27 / -.36px |
| heading-l | 20 / 30 / -.4px |
| heading-xl | 24 / 36 / -.48px |
| heading-2xl | 28 / 42 / -.56px |
| heading-3xl | 40 / 48 / -.8px |

weight: r 400 · m 500 · b 600 — 세 단뿐, 700 없음.

## 치수

- radius: 3xs 2 · 2xs 4 · xs 6 · **s 8 · m 12 · l 16** · xl 24 · 2xl 32 · 3xl 40
- space: 4xs 2 · 3xs 4 · 2xs 6 · xs 8 · s 12 · m 16 · **l 24** · xl 32 · 2xl 36 · 3xl 40 · 4xl 48 (+ indent depth1~15 = 20~300, 20px 단위)
- height(컨트롤): 3xs 8 ~ 5xl 56 (4px 그리드: 8/12/16/20/24/28/32/36/40/48/56)
- 셸: header-h 60 · organizer-w 4rem(=64, 접힌 레일) · gnb-w 200(펼친 레일) · shell-min-w 1440 · ai-panel-w 360
- layer 그림자: y 8px · blur 16px (#000000b3 계열)

## 우리 토큰에 반영된 매핑 (tailwind.config.ts)

primary {08a7bf, hover 3cbed7, pressed 00889c, light e2f1f5, light-hover cdeaf1, light-pressed bbe2ec, ink 00889c} · accent → primary 축 재지정 · muted 969799 · subtle f8f8f8 · line-strong dbdcdc · success 00af52 · info 0d99ff · warn f0bc00/ink d99f00 · danger {ee3010, hover ff502a, pressed c92208}/light ffe4dc/ink ff502a · fontSize 전 단 원본 lh/ls로 교체(h2 19→18, h3 17→16)
