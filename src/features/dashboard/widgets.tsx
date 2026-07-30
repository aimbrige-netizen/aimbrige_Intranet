import Link from "next/link";
import {
  Calendar,
  Clock,
  FileCheck,
  Megaphone,
  Star,
  Plug,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { toSeoulTime, toSeoulYmd } from "@/features/calendar/date";
import type { Favorite } from "@/types/db";

/** 아직 연동되지 않은 위젯의 공통 빈 상태 */
function NotConnected({ pendingSpec }: { pendingSpec: string }) {
  return (
    <EmptyState
      icon={Plug}
      title="아직 연동되지 않았습니다"
      description={`${pendingSpec} 작업 때 실제 데이터가 연결됩니다.`}
      compact
    />
  );
}

export function ApprovalPendingWidget({
  pendingSpec,
}: {
  pendingSpec: string;
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <FileCheck className="size-4 text-primary" aria-hidden />
            결재 대기
          </span>
        }
        action={<Badge tone="neutral">0</Badge>}
      />
      <CardBody>
        <NotConnected pendingSpec={pendingSpec} />
      </CardBody>
    </Card>
  );
}

export function AttendanceTodayWidget({
  pendingSpec,
}: {
  pendingSpec: string;
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Clock className="size-4 text-primary" aria-hidden />
            오늘의 근태
          </span>
        }
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-3 divide-x divide-line rounded-card bg-canvas py-3 text-center">
          {[
            { label: "출근", value: "--:--" },
            { label: "퇴근", value: "--:--" },
            { label: "잔여 연차", value: "-" },
          ].map((item) => (
            <div key={item.label}>
              <p className="text-caption">{item.label}</p>
              <p className="mt-0.5 text-body font-semibold text-ink">
                {item.value}
              </p>
            </div>
          ))}
        </div>

        {/* 출근/퇴근 버튼은 이번 모듈에서 비활성 (스펙 3.2 위젯 표) */}
        <div className="flex gap-2">
          <Button disabled className="flex-1" title="출퇴근관리 모듈에서 활성화됩니다">
            출근하기
          </Button>
          <Button
            variant="secondary"
            disabled
            className="flex-1"
            title="출퇴근관리 모듈에서 활성화됩니다"
          >
            퇴근하기
          </Button>
        </div>

        <NotConnected pendingSpec={pendingSpec} />
      </CardBody>
    </Card>
  );
}

export function NoticesWidget({ pendingSpec }: { pendingSpec: string }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Megaphone className="size-4 text-primary" aria-hidden />
            공지사항
          </span>
        }
      />
      <CardBody>
        <NotConnected pendingSpec={pendingSpec} />
      </CardBody>
    </Card>
  );
}

export interface UpcomingEvent {
  id: string;
  title: string;
  startsAt: string;
  allDay: boolean;
}

/** 다가오는 일정 — 스펙 02에서 실제 연동됨 */
export function CalendarUpcomingWidget({
  events,
}: {
  events: UpcomingEvent[];
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Calendar className="size-4 text-primary" aria-hidden />
            다가오는 일정
          </span>
        }
        action={
          <Link href="/calendar" className="text-label text-primary hover:underline">
            전체보기
          </Link>
        }
      />
      <CardBody>
        {events.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title="향후 7일간 일정이 없습니다"
            description="캘린더에서 일정을 추가할 수 있습니다."
            compact
          />
        ) : (
          <ul className="divide-y divide-line">
            {events.map((event) => (
              <li key={event.id} className="flex items-center gap-3 py-2.5">
                <span className="w-24 shrink-0 text-label tabular-nums text-muted">
                  {event.allDay
                    ? `${toSeoulYmd(event.startsAt)} 종일`
                    : `${toSeoulYmd(event.startsAt).slice(5)} ${toSeoulTime(event.startsAt)}`}
                </span>
                <span className="truncate text-body text-ink">{event.title}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** 즐겨찾기 — 이번 모듈에서 실제 작동하는 유일한 위젯 */
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
            <Star className="size-4 text-warn" aria-hidden />
            즐겨찾기
          </span>
        }
        action={
          <Link
            href="/profile#favorites"
            className="text-label text-primary hover:underline"
          >
            관리
          </Link>
        }
      />
      <CardBody>
        {favorites.length === 0 ? (
          <EmptyState
            icon={Star}
            title="즐겨찾기가 비어 있습니다"
            description="왼쪽 사이드바 메뉴를 우클릭하거나 ⋮ 메뉴에서 즐겨찾기에 추가할 수 있습니다."
            compact
          />
        ) : (
          <ul className="-mx-1 divide-y divide-line">
            {favorites.map((favorite) => (
              <li key={favorite.id}>
                <Link
                  href={favorite.target_path}
                  className="flex items-center justify-between gap-2 rounded px-1 py-2.5 transition-colors hover:bg-primary-light"
                >
                  <span className="truncate text-body text-ink">
                    {favorite.label}
                  </span>
                  <span className="shrink-0 text-caption">
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
