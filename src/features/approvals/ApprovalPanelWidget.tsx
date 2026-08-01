import Link from "next/link";
import { Meter } from "@/components/ui/Progress";
import { elapsedLabel } from "./format";

/**
 * 모듈 패널 하단 상주 위젯.
 *
 * 전자결재는 "지금 나한테 몇 건이 걸려 있나"가 화면을 여는 이유인데,
 * 그 숫자를 보려면 결재함 목록까지 들어가야 했다. 기안 화면이든 상세 화면이든
 * 항상 같은 자리에서 보이게 한다.
 */
export function ApprovalPanelWidget({
  showInbox,
  pendingCount,
  buckets,
  oldest,
  myPendingCount,
}: {
  showInbox: boolean;
  pendingCount: number;
  buckets: { fresh: number; aging: number; late: number };
  /** waitingSince = 결재선에 올라온 시각. 문서 생성 시각으로 재면 임시저장 기간까지 대기로 잡힌다 */
  oldest: { id: string; title: string; waitingSince: string } | null;
  myPendingCount: number;
}) {
  return (
    <div className="space-y-2.5">
      {showInbox ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-label text-muted">내 차례</span>
            <span className="text-h2 tabular-nums text-ink">
              {pendingCount}
              <span className="ml-0.5 text-label text-muted">건</span>
            </span>
          </div>

          <Meter
            max={pendingCount || 1}
            segments={[
              { value: buckets.fresh, tone: "positive", label: "2일 이내" },
              { value: buckets.aging, tone: "warning", label: "3~6일" },
              { value: buckets.late, tone: "critical", label: "7일 이상" },
            ]}
            size="sm"
            aria-label={`결재 대기 ${pendingCount}건`}
          />

          {oldest ? (
            <Link
              href={`/approvals/${oldest.id}`}
              className="block rounded-sm bg-subtle px-2 py-1.5 transition-colors duration-fast ease-standard hover:bg-line"
            >
              <span className="block truncate text-label text-ink">
                {oldest.title}
              </span>
              <span className="block text-nano tabular-nums text-muted">
                {elapsedLabel(oldest.waitingSince)} 대기 · 가장 오래된 문서
              </span>
            </Link>
          ) : (
            <p className="text-nano text-muted">지금 처리할 문서가 없습니다</p>
          )}
        </>
      ) : null}

      <div
        className={
          showInbox
            ? "flex items-baseline justify-between gap-2 border-t border-line pt-2.5"
            : "flex items-baseline justify-between gap-2"
        }
      >
        <span className="text-label text-muted">내 기안 진행중</span>
        <span className="text-label tabular-nums text-ink">
          {myPendingCount}건
        </span>
      </div>
    </div>
  );
}
