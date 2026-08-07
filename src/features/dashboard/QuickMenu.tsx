import Link from "next/link";
import {
  CalendarPlus,
  FilePlus2,
  Mail,
  NotebookPen,
  PencilLine,
  Umbrella,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { gmailInboxUrl } from "@/features/mail/format";

/**
 * Quick Menu — 다우오피스 홈 가운데 열 첫 카드의 배치 그대로.
 *
 *   제목 20/600 → 타일 그리드(3열 · radius 16 · 아이콘+12px 라벨)
 *   → 전체 폭 시안 버튼 한 개
 *
 * 타일 면은 02에 색 기록이 없다. 한때 bg #fcfcfc를 하드코딩했는데 02·06
 * 어디에도 없는 값이라(흰색과 사실상 구분도 안 된다) 걷어내고, 06 button
 * base 문법(bg #fff · hover #f8f8f8=subtle)을 그대로 쓴다 — 타일은 흰 카드
 * 면 위의 버튼이다.
 *
 * 원본 타일(메일쓰기/연락처 추가/일정등록/게시판 글쓰기/설문작성)은 우리
 * 모듈의 같은 성격 액션으로 치환했고, 하단 "PC메신저 다운로드" 자리는
 * 사내 메일쓰기(/mail/compose)가 받는다 — 원본 타일 1번(메일쓰기)과 같은
 * 성격의 상수 액션이다(스펙 12 · 메일 모듈 신설).
 */
const TILES = [
  { href: "/approvals/new", label: "기안 작성", icon: FilePlus2 },
  { href: "/calendar?new=1", label: "일정 등록", icon: CalendarPlus },
  { href: "/board", label: "게시판 글쓰기", icon: PencilLine },
  { href: "/worklog", label: "업무일지", icon: NotebookPen },
  { href: "/attendance", label: "연차 신청", icon: Umbrella },
];

/**
 * 외부메일(Gmail) 딥링크 복귀 스위치 — Google OAuth 승인(사장님 몫) 후
 * 어댑터가 연결되면 되살린다(12-mail.md 구현 결정: 그 전까지 Gmail 자리는
 * 링크만 보존). 사내 메일 전환 후 하단 시안 버튼은 메일쓰기가 받는다.
 */
const USE_GMAIL_CTA: boolean = false;

export function QuickMenuWidget({ email }: { email: string }) {
  return (
    <Card>
      <CardHeader title="Quick Menu" density="widget" />
      <CardBody density="widget">
        <ul className="grid grid-cols-3 gap-3">
          {TILES.map((tile) => {
            const Icon = tile.icon;
            return (
              <li key={tile.href}>
                <Link
                  href={tile.href}
                  className="flex h-[78px] flex-col items-center justify-center gap-1.5 rounded-2xl transition-colors duration-fast ease-standard hover:bg-subtle"
                >
                  <Icon
                    className="size-6 text-ink-sub"
                    // 2026-08-07 UI/UX 감사: 셸(사이드바·유틸바·앱런처)과 같은 1.75로 통일
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="text-[12px] font-medium text-ink">
                    {tile.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* 원본: 전체 폭 h40 시안 채움 버튼 */}
        {USE_GMAIL_CTA ? (
          <a
            href={gmailInboxUrl(email)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-primary text-body-sm font-medium text-white transition-colors duration-fast ease-standard hover:bg-primary-hover active:bg-primary-pressed"
          >
            <Mail className="size-4" aria-hidden />
            Gmail 받은편지함 열기
          </a>
        ) : (
          <Link
            href="/mail/compose"
            className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-primary text-body-sm font-medium text-white transition-colors duration-fast ease-standard hover:bg-primary-hover active:bg-primary-pressed"
          >
            <Mail className="size-4" aria-hidden />
            메일쓰기
          </Link>
        )}
      </CardBody>
    </Card>
  );
}
