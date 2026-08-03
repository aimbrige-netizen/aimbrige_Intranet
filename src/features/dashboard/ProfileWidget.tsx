import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Card, CardBody } from "@/components/ui/Card";
import { formatDays } from "@/features/attendance/format";

/**
 * 홈 좌측 프로필 카드 — 다우오피스 홈 좌상단 카드의 배치 그대로.
 *
 *   아바타 → 이름(24/600) → 소속 한 줄
 *   → 큰 지표 2개(시안, 가운데 정렬) + 아래 13px 라벨
 *   → 구분선 → 13px 카운트 행 나열(라벨 왼쪽 · 숫자 오른쪽)
 *   → 마지막 행 "내 잔여 연차"만 값이 시안이다.
 *
 * 원본의 카운트 행(내 커뮤니티 새글/참여할 설문/…)은 우리 모듈로 치환했다.
 * 행 전체가 해당 모듈로 가는 링크다 — 원본과 같다.
 */
export function ProfileWidget({
  name,
  position,
  departmentName,
  profileImageUrl,
  myTurnApprovals,
  todayEvents,
  inProgressApprovals,
  unreadNotices,
  leaveRemaining,
  leaveNext,
}: {
  name: string;
  position: string | null;
  departmentName: string | null;
  profileImageUrl: string | null;
  /** 지금 내 차례인 결재 문서 수 */
  myTurnApprovals: number;
  /** 오늘 시작하는 일정 수 */
  todayEvents: number;
  /** 내가 관련된 진행중 결재 문서 수 */
  inProgressApprovals: number;
  unreadNotices: number;
  /** 잔여 연차(일) */
  leaveRemaining: number;
  /** 다음 연차 발생 — 없으면 null */
  leaveNext: { date: string; days: number } | null;
}) {
  const affiliation =
    [departmentName, position].filter(Boolean).join(" · ") || null;

  return (
    <Card>
      <CardBody density="widget" className="pt-8 text-center">
        <Avatar
          name={name}
          src={profileImageUrl}
          size="xlarge"
          className="mx-auto !bg-primary-light !text-primary-ink"
        />
        <p className="mt-3 text-title text-ink">{name}</p>
        {affiliation ? (
          <p className="mt-0.5 text-label text-muted">{affiliation}</p>
        ) : null}

        {/* 큰 지표 2개 — 원본의 "오늘 온 메일 / 오늘의 일정" 자리 */}
        <div className="mt-5 grid grid-cols-2">
          <BigStat href="/approvals" value={myTurnApprovals} label="결재할 문서" />
          <BigStat href="/calendar" value={todayEvents} label="오늘의 일정" />
        </div>

        <hr className="mt-5 border-line" />

        {/* 카운트 행 — 13px, 라벨 왼쪽 · 숫자 오른쪽 */}
        <ul className="mt-2 text-left">
          <CountRow href="/approvals" label="진행중 결재" value={inProgressApprovals} />
          <CountRow href="/board" label="미열람 공지" value={unreadNotices} />
          <CountRow
            href="/attendance"
            label="내 잔여 연차"
            value={`${formatDays(leaveRemaining)}일`}
            accent
          />
          {leaveNext ? (
            <CountRow
              href="/attendance"
              label="다음 연차 발생"
              value={`${leaveNext.date.slice(5)} +${formatDays(leaveNext.days)}일`}
            />
          ) : null}
        </ul>
      </CardBody>
    </Card>
  );
}

function BigStat({
  href,
  value,
  label,
}: {
  href: string;
  value: number;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-sm py-1 transition-colors duration-fast ease-standard hover:bg-subtle"
    >
      <span className="block text-[24px] font-medium tabular-nums leading-tight text-primary">
        {value}
      </span>
      <span className="mt-0.5 block text-label text-ink-sub">{label}</span>
    </Link>
  );
}

function CountRow({
  href,
  label,
  value,
  accent,
}: {
  href: string;
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-2 rounded-sm px-1 py-2 text-label transition-colors duration-fast ease-standard hover:bg-subtle"
      >
        <span className="truncate text-ink">{label}</span>
        <span
          className={
            accent
              ? "shrink-0 font-medium tabular-nums text-primary"
              : "shrink-0 tabular-nums text-muted"
          }
        >
          {value}
        </span>
      </Link>
    </li>
  );
}
