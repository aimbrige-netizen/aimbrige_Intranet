# 다우오피스 채집 — 모션 (transition 규칙 308건 집계)

*2026-08-02 · document.styleSheets 전수 집계, 빈도순*

| 패턴 | 건수 | 용도 추정 |
|---|---|---|
| background-color **0.15s** (± color/border-color) | 55+ | hover 전반 |
| **0.2s** (무지정 all / transform, ease-in-out 포함) | 44 | 펼침·이동·transform |
| **0.3s** | 18 | 오버레이·큰 전환 |
| 0.5s | 12 | 특수(배너 등) |
| transform 0.15s cubic-bezier(0.4,0,0.2,1) | 4 | 소형 인터랙션 |

## 결론 (우리 토큰 대응)

- hover류 = **150ms** — 우리 `duration-fast` 150ms와 이미 일치 ✓
- 구조 이동·펼침 = **200ms** — 우리 `duration-standard`가 250ms라 50ms 느림 → **200ms로 조정**
- 오버레이·큰 전환 = **300ms** — 우리 `duration-slow` 350ms → **300ms로 조정**
- easing: ease-in-out과 cubic-bezier(0.4,0,0.2,1) 혼용 — 우리 `ease-standard`(0.4,0,0.2,1) 유지로 충분
