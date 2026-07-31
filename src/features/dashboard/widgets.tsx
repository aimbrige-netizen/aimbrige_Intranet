import Link from "next/link";
import {
  Calendar,
  CalendarPlus,
  Clock,
  FileCheck,
  FilePlus2,
  Megaphone,
  Star,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";
import { DayStrip, type StripDay } from "@/components/ui/ChipStrip";
import { toSeoulTime, toSeoulYmd, weekdayOf } from "@/features/calendar/date";
import { formatHours } from "@/features/attendance/format";
import type { WeeklyDay, WeeklyHours } from "@/features/attendance/data";
import type {
  NoticeItem,
  PendingApprovalItem,
  UpcomingEvent,
} from "@/features/dashboard/widget-data";
import type { Favorite } from "@/types/db";
import { cn } from "@/lib/utils";

/**
 * 홈 위젯.
 *
 * 손본 것은 세 가지다.
 *  1. 카드 헤더의 '전체보기' 링크 5개를 걷어냈다. 모듈 이동은 왼쪽 패널이 한다.
 *  2. 헤더 Badge 카운트를 걷어냈다. 같은 숫자가 상단 밴드(파랑)와 배지(빨강)로
 *     두 번 나와서, 사용자는 같은 3을 두 가지 위험도로 봤다.
 *  3. 빈 상태 4곳의 action 슬롯을 채웠다. 빈 화면은 막다른 길이 아니라 시작점이다.
 */

/** 결재 대기 — 지금 내 차례인 문서 */
export function ApprovalPendingWidget({
  items,
}: {
  items: PendingApprovalItem[];
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <FileCheck className="size-4 text-muted" aria-hidden />
            결재 대기
          </span>
        }
        description="지금 내 차례인 문서"
        density="compact"
      />
      <CardBody density="compact">
        {items.length === 0 ? (
          <EmptyState
            icon={FileCheck}
            title="승인할 문서가 없습니다"
            description="본인 차례인 결재 문서가 생기면 여기에 표시됩니다."
            action={
              <LinkButton href="/approvals/new" size="small" variant="secondary">
                <FilePlus2 className="size-3.5" aria-hidden />
                기안하기
              </LinkButton>
            }
            compact
          />
        ) : (
          <ul className="-mx-1 divide-y divide-line">
            {items.map((doc) => (
              <li key={doc.id}>
                <Link
                  href={`/approvals/${doc.id}`}
                  className="flex items-center gap-3 rounded-sm px-1 py-2 transition-colors duration-fast ease-standard hover:bg-canvas"
                >
                  <span className="w-14 shrink-0 truncate text-label text-muted">
                    {doc.requester}
                  </span>
                  <span className="truncate text-body-sm text-ink">
                    {doc.title}
                  </span>
                  <span className="ml-auto shrink-0 text-label tabular-nums text-muted">
                    {toSeoulYmd(doc.requestedAt).slice(5)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * 주간 근태.
 *
 * 출퇴근 버튼은 근태 모듈 패널 하단에 상주하므로 여기서는 뺐다. 홈에 남는 것은
 * "이 주가 어떻게 흘러갔는가" — 기록이 없는 날도 점선 칩으로 골격을 남겨서,
 * 신규 입사자도 한 주가 어떤 단위로 관리되는지 먼저 본다.
 */
export function WeekAttendanceWidget({
  week,
  today,
  title,
}: {
  week: WeeklyHours;
  today: string;
  title: string;
}) {
  const avgPerWorkedDay =
    week.workedDayCount > 0 ? week.regularHours / week.workedDayCount : 0;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Clock className="size-4 text-muted" aria-hidden />
            {title}
          </span>
        }
        description="정규 근무 09:00~18:00 · 주 40시간 기준"
        density="compact"
      />
      <CardBody density="compact">
        <DayStrip days={week.days.map((day) => toStripDay(day, today))} />

        <dl className="mt-3 grid grid-cols-3 divide-x divide-line border-t border-line pt-3 text-center">
          <SummaryCell label="정규" value={formatHours(week.regularHours)} />
          <SummaryCell
            label="승인 초과"
            value={formatHours(week.overtimeHours)}
            tone={week.overtimeHours > 0 ? "warn" : undefined}
          />
          <SummaryCell
            label="근무일 평균"
            value={
              week.workedDayCount > 0 ? formatHours(avgPerWorkedDay) : "—"
            }
          />
        </dl>
      </CardBody>
    </Card>
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div>
      <dt className="text-label text-muted">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-body-sm font-bold tabular-nums",
          tone === "warn" ? "text-warn-ink" : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** WeeklyDay → 스트립 한 칸. 카드 폭이 좁아 칩 문구를 짧게 쓴다 */
function toStripDay(day: WeeklyDay, today: string): StripDay {
  const chips: NonNullable<StripDay["chips"]> = [];

  if (day.workedHours > 0 || day.checkIn) {
    chips.push({
      lines: [
        day.workedHours > 0 ? formatHours(day.workedHours) : "근무 중",
        {
          text: `${day.checkIn ? toSeoulTime(day.checkIn) : "--:--"}~${
            day.checkOut ? toSeoulTime(day.checkOut) : "--:--"
          }`,
          dim: true,
        },
      ],
      tone: day.workedHours > 0 ? "success" : "info",
      title: `${day.date} 근무`,
    });
  }

  if (day.overtimeHours > 0) {
    chips.push({
      lines: [`초과 ${formatHours(day.overtimeHours)}`],
      tone: "warn",
    });
  }

  if (day.onLeave) {
    chips.push({ lines: ["휴가"], tone: "primary" });
  }

  const isNonWorking = day.isWeekend || !!day.holidayName;

  return {
    date: day.date,
    chips,
    holiday: day.holidayName ?? undefined,
    // 주말·공휴일·미래는 "기록 없음"이 아니다
    muted: isNonWorking || day.date > today,
    selected: day.date === today,
  };
}

/** 미열람 공지 */
export function NoticesWidget({ notices }: { notices: NoticeItem[] }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Megaphone className="size-4 text-muted" aria-hidden />
            공지사항
          </span>
        }
        description="아직 읽지 않은 글"
        density="compact"
      />
      <CardBody density="compact">
        {notices.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="미열람 공지가 없습니다"
            description="새 공지가 올라오면 여기에 표시됩니다."
            action={
              <LinkButton href="/board" size="small" variant="secondary">
                공지 게시판 열기
              </LinkButton>
            }
            compact
          />
        ) : (
          <ul className="-mx-1 divide-y divide-line">
            {notices.map((notice) => (
              <li key={notice.id}>
                <Link
                  href={`/board/${notice.boardId}/${notice.id}`}
                  className="flex items-center gap-2 rounded-sm px-1 py-2 transition-colors duration-fast ease-standard hover:bg-canvas"
                >
                  <span className="shrink-0 truncate text-label text-muted">
                    {notice.boardName}
                  </span>
                  <span className="truncate text-body-sm font-bold text-ink">
                    {notice.title}
                  </span>
                  <span className="ml-auto shrink-0 text-label tabular-nums text-muted">
                    {toSeoulYmd(notice.createdAt).slice(5)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

const EVENT_KIND_LABELS: Record<string, string> = {
  personal: "개인",
  team: "팀",
  company: "전사",
};

/** 다가오는 일정 — 범위를 헤더에 명시한다 */
export function CalendarUpcomingWidget({
  events,
  rangeLabel,
}: {
  events: UpcomingEvent[];
  rangeLabel: string;
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Calendar className="size-4 text-muted" aria-hidden />
            다가오는 일정
          </span>
        }
        description={rangeLabel}
        density="compact"
      />
      <CardBody density="compact">
        {events.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title="이 기간에 일정이 없습니다"
            description={`${rangeLabel} 사이에 등록된 일정이 없습니다.`}
            action={
              <LinkButton href="/calendar?new=1" size="small" variant="secondary">
                <CalendarPlus className="size-3.5" aria-hidden />
                일정 추가
              </LinkButton>
            }
            compact
          />
        ) : (
          <ul className="divide-y divide-line">
            {events.map((event) => {
              const ymd = toSeoulYmd(event.startsAt);
              const weekday = weekdayOf(ymd);
              return (
                <li key={event.id} className="flex items-center gap-2 py-2">
                  <span
                    className={cn(
                      "w-11 shrink-0 text-label font-bold tabular-nums",
                      weekday === 0
                        ? "text-danger"
                        : weekday === 6
                          ? "text-info"
                          : "text-ink",
                    )}
                  >
                    {ymd.slice(5)}
                  </span>
                  <span className="w-11 shrink-0 text-label tabular-nums text-muted">
                    {event.allDay ? "종일" : toSeoulTime(event.startsAt)}
                  </span>
                  <span className="truncate text-body-sm text-ink">
                    {event.title}
                  </span>
                  <span className="ml-auto shrink-0 text-label text-muted">
                    {EVENT_KIND_LABELS[event.kind] ?? ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** 즐겨찾기 */
export function FavoritesWidget({
  favorites,
}: {
  favorites: Pick<Favorite, "id" | "label" | "target_path">[];
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Star className="size-4 text-muted" aria-hidden />
            즐겨찾기
          </span>
        }
        description="자주 쓰는 화면"
        density="compact"
      />
      <CardBody density="compact">
        {favorites.length === 0 ? (
          <EmptyState
            icon={Star}
            title="즐겨찾기가 비어 있습니다"
            description="자주 쓰는 화면을 등록하면 여기에서 바로 열 수 있습니다."
            action={
              <LinkButton
                href="/profile#favorites"
                size="small"
                variant="secondary"
              >
                <Star className="size-3.5" aria-hidden />
                즐겨찾기 추가
              </LinkButton>
            }
            compact
          />
        ) : (
          <ul className="-mx-1 divide-y divide-line">
            {favorites.map((favorite) => (
              <li key={favorite.id}>
                <Link
                  href={favorite.target_path}
                  className="flex items-center justify-between gap-2 rounded-sm px-1 py-2 transition-colors duration-fast ease-standard hover:bg-primary-light"
                >
                  <span className="truncate text-body-sm text-ink">
                    {favorite.label}
                  </span>
                  <span className="shrink-0 truncate text-label text-muted">
                    {favorite.target_path}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
