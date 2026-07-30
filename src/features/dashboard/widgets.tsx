import Link from "next/link";
import { Calendar, Clock, FileCheck, Megaphone, Star } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { toSeoulTime, toSeoulYmd } from "@/features/calendar/date";
import { CheckInOut } from "@/features/attendance/CheckInOut";
import type { AttendanceRecord, Favorite } from "@/types/db";

// 스펙 01에서 껍데기로 만든 위젯 5종이 이제 모두 실제 데이터에 연결됐다.
// (결재 대기=스펙04, 오늘의 근태=스펙03, 공지사항=스펙05,
//  다가오는 일정=스펙02, 즐겨찾기=스펙01)

export interface PendingApproval {
  id: string;
  title: string;
  requester: string;
  requestedAt: string;
}

/** 결재 대기 — 스펙 04에서 실제 연동됨 */
export function ApprovalPendingWidget({
  documents,
}: {
  documents: PendingApproval[];
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
        action={
          <span className="flex items-center gap-2">
            <Badge tone={documents.length > 0 ? "danger" : "neutral"}>
              {documents.length}
            </Badge>
            <Link
              href="/approvals?tab=inbox"
              className="text-label text-primary hover:underline"
            >
              전체보기
            </Link>
          </span>
        }
      />
      <CardBody>
        {documents.length === 0 ? (
          <EmptyState
            icon={FileCheck}
            title="승인할 문서가 없습니다"
            description="본인 차례인 결재 문서가 생기면 여기에 표시됩니다."
            compact
          />
        ) : (
          <ul className="divide-y divide-line">
            {documents.map((doc) => (
              <li key={doc.id}>
                <Link
                  href={`/approvals/${doc.id}`}
                  className="flex items-center gap-3 rounded px-1 py-2.5 transition-colors hover:bg-canvas"
                >
                  <span className="w-16 shrink-0 text-label text-muted">
                    {doc.requester}
                  </span>
                  <span className="truncate text-body text-ink">{doc.title}</span>
                  <span className="ml-auto shrink-0 text-caption">
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

/** 오늘의 근태 — 스펙 03에서 실제 연동됨 */
export function AttendanceTodayWidget({
  record,
  remainingLeave,
}: {
  record: AttendanceRecord | null;
  remainingLeave: number;
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
        action={
          <Link
            href="/attendance"
            className="text-label text-primary hover:underline"
          >
            전체보기
          </Link>
        }
      />
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between rounded-card bg-primary-light px-4 py-2.5">
          <span className="text-body text-ink">잔여 연차</span>
          <span className="text-h2 tabular-nums text-primary">
            {remainingLeave}일
          </span>
        </div>
        <CheckInOut record={record} compact />
      </CardBody>
    </Card>
  );
}

export interface NoticeItem {
  id: string;
  title: string;
  boardName: string;
  createdAt: string;
}

/** 공지사항 — 스펙 05에서 실제 연동됨 (미열람 글) */
export function NoticesWidget({ notices }: { notices: NoticeItem[] }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Megaphone className="size-4 text-primary" aria-hidden />
            공지사항
          </span>
        }
        action={
          <span className="flex items-center gap-2">
            {notices.length > 0 ? (
              <Badge tone="danger">{notices.length}</Badge>
            ) : null}
            <Link href="/board" className="text-label text-primary hover:underline">
              전체보기
            </Link>
          </span>
        }
      />
      <CardBody>
        {notices.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="미열람 공지가 없습니다"
            description="새 공지가 올라오면 여기에 표시됩니다."
            compact
          />
        ) : (
          <ul className="divide-y divide-line">
            {notices.map((notice) => (
              <li key={notice.id}>
                <Link
                  href={`/board`}
                  className="flex items-center gap-3 rounded px-1 py-2.5 transition-colors hover:bg-canvas"
                >
                  <span className="shrink-0 text-label text-muted">
                    {notice.boardName}
                  </span>
                  <span className="truncate text-body font-medium text-ink">
                    {notice.title}
                  </span>
                  <span className="ml-auto shrink-0 text-caption">
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
