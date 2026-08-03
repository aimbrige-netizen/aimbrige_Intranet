"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Mail,
  MailOpen,
  Paperclip,
  Star,
  Trash2,
} from "lucide-react";
import { Button, LinkButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import {
  deleteMailDraft,
  deleteMailPermanently,
  markMailRead,
  toggleMailStar,
  trashMail,
} from "@/server/actions/mail";
import {
  markGmailReadAction,
  starGmailAction,
  trashGmailAction,
} from "@/server/actions/gmail-mail";
import { isInternalMailId } from "@/features/mail/gmail-view";
import {
  toSeoulTime,
  toSeoulYmd,
  weekdayOf,
  WEEKDAY_LABELS,
} from "@/features/calendar/date";

/**
 * 사내 메일 목록 (daou-survey/12-mail.md 받은메일함 실측).
 *
 * MailListRow는 이 화면의 뷰모델이다. page.tsx가 data.ts(getMailList)의
 * MailListItem을 이 모양으로 어댑트해 넘긴다 — DB row 타입을 여기에 직접
 * 들이지 않는다. 툴바(읽음·별표·삭제)와 행 별표는 src/server/actions/mail.ts
 * 의 단건 액션을 행마다 반복 호출한다(벌크 액션을 따로 두지 않는 이유:
 * RLS 0행 확인 규약(보안 3)이 단건 count 검사로 서 있고, 목록 선택은
 * 한 페이지 20건이 상한이라 반복 비용이 문제되지 않는다).
 *
 * ── 외부 수발신(Gmail 소스) 분기
 * Gmail 행은 id가 uuid가 아니다(isInternalMailId — 읽기 화면과 같은 판별).
 * 내부 액션은 uuid 검증을 전제하므로 Gmail 행에 그대로 쏘면 PostgREST
 * 22P02로 전부 실패한다 — 행 단위로 gmail-mail.ts 액션(읽음·별표·휴지통)
 * 으로 분기한다. Gmail 영구삭제·임시보관 삭제는 1차 미제공(안내만).
 * 내부 메일 경로는 그대로다 — 분기 추가일 뿐 개조가 아니다.
 */

export type MailboxKey = "inbox" | "sent" | "receipts" | "drafts" | "trash";
/** 빠른검색 — 구현 결정(12-mail.md): 안읽음·별표·오늘 3종 */
export type MailQuickFilter = "unread" | "starred" | "today";

/**
 * 이 행의 상태가 어느 쪽에 사는가 — 액션 분기의 근거.
 *   received: 수신자 행(읽음·별표·휴지통 folder)  |  sent: 발신자 상태
 *   (sender_trashed·sender_deleted_at)  |  draft: 임시저장(즉시 DELETE)
 */
export type MailRowSide = "received" | "sent" | "draft";

export interface MailListRow {
  id: string;
  /** 상대방 표시명 — 받은함은 발신자, 보낸함 계열은 수신자 요약("홍길동 외 2") */
  counterpart: string;
  subject: string;
  /** 본문+첨부 크기(바이트). "3.6KB" 표기는 이쪽에서 만든다 */
  sizeBytes: number;
  /** ISO 문자열 — 받은함은 수신 시각, 보낸함은 발송 시각 */
  sentAt: string;
  /**
   * 안읽음 강조(600 먹색)의 근거. 받은함은 내 read_at 유무.
   * 보낸함·임시보관·휴지통은 어댑터가 true로 둔다(강조 없음) —
   * 수신확인은 receiptLabel이 따로 맡는다.
   */
  isRead: boolean;
  isStarred: boolean;
  hasAttachment: boolean;
  /** 읽음·별표·삭제가 어느 쪽 상태를 만질지 — 어댑터(page.tsx)가 정한다 */
  side: MailRowSide;
  /** 수신확인함용 요약("읽음 2/3") — 어댑터가 문자열로 만들어 넘긴다 */
  receiptLabel?: string;
}

/**
 * 메일 크기 표기 — 다우 실측 "3.6KB・08-02", 용량 게이지 "500.0MB 중 244.0KB".
 * 원본이 소수 한 자리를 고정으로 쓰므로 toFixed(1)로 맞춘다.
 * MailPanel(용량 게이지)·MailComposer(첨부 크기)가 같이 쓴다.
 */
export function formatMailSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0B";
  if (bytes < 1024) return `${Math.round(bytes)}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  return `${(mb / 1024).toFixed(1)}GB`;
}

const EMPTY_COPY: Record<MailboxKey, { title: string; description?: string }> = {
  inbox: {
    title: "받은 메일이 없습니다",
    description: "임직원이 보낸 사내 메일이 이곳에 쌓입니다.",
  },
  sent: {
    title: "보낸 메일이 없습니다",
    description: "메일을 보내면 발송 이력과 수신확인이 여기에 남습니다.",
  },
  receipts: {
    title: "수신확인할 메일이 없습니다",
    description: "보낸 메일을 상대가 읽었는지 여기에서 확인합니다.",
  },
  drafts: {
    title: "임시보관된 메일이 없습니다",
    description: "작성 중 임시저장한 메일이 여기에 보관됩니다.",
  },
  trash: { title: "휴지통이 비어 있습니다" },
};

export function MailList({
  box,
  filter,
  rows,
}: {
  box: MailboxKey;
  /** 빠른검색(패널)에서 걸어 들어온 조건 — 없으면 null */
  filter: MailQuickFilter | null;
  /** sent_at desc 정렬 전제 — 날짜 그룹은 받은 순서를 그대로 자른다 */
  rows: MailListRow[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const today = toSeoulYmd(new Date());

  /** 날짜 그룹 라벨 — 실측 "오늘, 2026-08-03 (월)" / 이전 날은 날짜만 */
  const groups = useMemo(() => {
    const out: { ymd: string; label: string; rows: MailListRow[] }[] = [];
    for (const row of rows) {
      const ymd = toSeoulYmd(row.sentAt);
      const last = out[out.length - 1];
      if (last && last.ymd === ymd) {
        last.rows.push(row);
      } else {
        const base = `${ymd} (${WEEKDAY_LABELS[weekdayOf(ymd)]})`;
        out.push({
          ymd,
          label: ymd === today ? `오늘, ${base}` : base,
          rows: [row],
        });
      }
    }
    return out;
  }, [rows, today]);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const hasSelection = selected.size > 0;

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  };

  const selectedRows = rows.filter((row) => selected.has(row.id));

  /** 액션 뒤처리 — 실패 문장만 남기고 선택을 풀고 목록을 다시 그린다 */
  const settle = (failMessage: string | null) => {
    setNotice(failMessage);
    setSelected(new Set());
    router.refresh();
  };

  /** 툴바 읽음 — 받은 메일(수신자 행)만 대상이다. markMailRead는 void(0행 무해) */
  const readSelected = () => {
    startTransition(async () => {
      const targets = selectedRows.filter(
        (row) => row.side === "received" && !row.isRead,
      );
      if (targets.length === 0) {
        setNotice("읽음 처리할 안읽은 받은 메일이 없습니다.");
        return;
      }
      await Promise.all(
        targets.map((row) =>
          isInternalMailId(row.id)
            ? markMailRead(row.id)
            : markGmailReadAction(row.id),
        ),
      );
      settle(null);
    });
  };

  /**
   * 툴바 별표 — 하나라도 꺼져 있으면 전부 켜고, 전부 켜져 있으면 끈다.
   * 별표는 수신자 행에만 있다(actions/mail.ts) — 발신자 쪽 행은 건너뛴다.
   */
  const starSelected = () => {
    startTransition(async () => {
      const targets = selectedRows.filter((row) => row.side === "received");
      if (targets.length === 0) {
        setNotice("별표는 받은 메일에만 붙일 수 있습니다.");
        return;
      }
      const next = targets.some((row) => !row.isStarred);
      const results = await Promise.all(
        targets.map((row) =>
          isInternalMailId(row.id)
            ? toggleMailStar(row.id, next)
            : starGmailAction(row.id, next),
        ),
      );
      const failed = results.find((result) => !result.ok);
      settle(failed?.message ?? null);
    });
  };

  /**
   * 툴바 삭제 — 함에 따라 의미가 갈린다:
   *   임시보관함: 즉시 삭제(발송 전이라 휴지통 없이 지운다 — actions 규약)
   *   휴지통: 영구삭제(수신자 행 DELETE / 발신자 sender_deleted_at 스탬프)
   *   그 외: 휴지통 이동(수신자 folder / 발신자 sender_trashed)
   */
  const deleteSelected = () => {
    if (selectedRows.length === 0) return;
    /*
     * Gmail 행이 낀 휴지통·임시보관 삭제는 서버까지 안 가고 안내만 한다 —
     * Gmail 영구삭제는 제공하지 않고(client.ts가 일부러 안 노출), Gmail
     * 임시보관함은 1차 읽기 전용이다. confirm을 띄운 뒤 실패시키지 않도록
     * 확인 창보다 먼저 거른다.
     */
    if (
      (box === "trash" || box === "drafts") &&
      selectedRows.some((row) => !isInternalMailId(row.id))
    ) {
      setNotice(
        box === "trash"
          ? "Gmail 영구삭제는 제공하지 않습니다 — Gmail 웹에서 지워 주세요."
          : "Gmail 임시보관함은 읽기 전용입니다 — 삭제는 Gmail 웹에서 해주세요.",
      );
      return;
    }
    if (
      box === "trash" &&
      !window.confirm("영구삭제는 되돌릴 수 없습니다. 계속할까요?")
    ) {
      return;
    }
    if (
      box === "drafts" &&
      !window.confirm("임시보관 메일은 복구할 수 없이 바로 삭제됩니다. 계속할까요?")
    ) {
      return;
    }
    startTransition(async () => {
      const results = await Promise.all(
        selectedRows.map((row) => {
          // Gmail 행(휴지통·임시보관 밖) — 휴지통 이동만 제공
          if (!isInternalMailId(row.id)) return trashGmailAction(row.id);
          if (row.side === "draft") return deleteMailDraft(row.id);
          const side = row.side === "received" ? "received" : "sent";
          return box === "trash"
            ? deleteMailPermanently(row.id, side)
            : trashMail(row.id, side);
        }),
      );
      const failed = results.find((result) => !result.ok);
      settle(failed?.message ?? null);
    });
  };

  /** 행 별표 토글 — 받은 메일이 아니면 서버까지 안 가고 안내만 한다 */
  const starRow = (row: MailListRow) => {
    startTransition(async () => {
      if (row.side !== "received") {
        setNotice("별표는 받은 메일에만 붙일 수 있습니다.");
        return;
      }
      const result = isInternalMailId(row.id)
        ? await toggleMailStar(row.id, !row.isStarred)
        : await starGmailAction(row.id, !row.isStarred);
      setNotice(result.ok ? null : (result.message ?? null));
      router.refresh();
    });
  };

  /** 목록으로 돌아가는 링크 — 필터만 벗긴다 */
  const clearFilterHref = box === "inbox" ? "/mail" : `/mail?box=${box}`;

  if (rows.length === 0) {
    const copy = EMPTY_COPY[box];
    return filter ? (
      <EmptyState
        icon={Mail}
        title="조건에 맞는 메일이 없습니다"
        description="빠른검색 조건을 벗기면 메일함 전체가 보입니다."
        action={
          <LinkButton href={clearFilterHref} size="small" variant="secondary">
            필터 해제
          </LinkButton>
        }
      />
    ) : (
      <EmptyState
        icon={Mail}
        title={copy.title}
        description={copy.description}
        cta={
          box === "inbox" || box === "sent"
            ? { label: "메일쓰기", href: "/mail/compose" }
            : undefined
        }
      />
    );
  }

  return (
    <div>
      {/*
        상단 고스트 툴바 — 실측 h-32 · 13px, 선택 없으면 disabled.
        실측 disabled 색 #c0c1c2(gray-26)는 기존 토큰에 없다 — 최근접 토큰
        ghost(#bbbbbb, 09 실측 축)로 근사. TODO(리뷰): 토큰 추가 여부 검토.
      */}
      <div className="mb-1 flex items-center gap-1 border-b border-line pb-2">
        <MailCheckbox
          checked={allSelected}
          onChange={toggleAll}
          label="전체선택"
        />
        <Button
          variant="ghost"
          size="xsmall"
          disabled={!hasSelection || pending}
          onClick={readSelected}
          className="disabled:text-ghost"
        >
          <MailOpen className="size-4" aria-hidden />
          읽음
        </Button>
        <Button
          variant="ghost"
          size="xsmall"
          disabled={!hasSelection || pending}
          onClick={starSelected}
          className="disabled:text-ghost"
        >
          <Star className="size-4" aria-hidden />
          별표
        </Button>
        <Button
          variant="ghost"
          size="xsmall"
          disabled={!hasSelection || pending}
          onClick={deleteSelected}
          className="disabled:text-ghost"
        >
          <Trash2 className="size-4" aria-hidden />
          삭제
        </Button>

        <div className="ml-auto flex items-center gap-2">
          {notice ? (
            <span className="text-label text-muted">{notice}</span>
          ) : null}
          {filter ? (
            <LinkButton href={clearFilterHref} size="xsmall" variant="ghost">
              필터 해제
            </LinkButton>
          ) : null}
        </div>
      </div>

      <ul>
        {groups.map((group) => (
          <Fragment key={group.ymd}>
            {/* 날짜 그룹 라벨 12px muted (실측) */}
            <li className="pb-1 pt-4 text-micro text-muted first:pt-2">
              {group.label}
            </li>
            {group.rows.map((row) => (
              <MailRow
                key={row.id}
                row={row}
                box={box}
                today={today}
                checked={selected.has(row.id)}
                onToggle={() => toggleRow(row.id)}
                onStar={() => starRow(row)}
              />
            ))}
          </Fragment>
        ))}
      </ul>
    </div>
  );
}

/**
 * 메일 행 — 실측 h~41 · border-bottom #eeeeef.
 *
 * 이 목록은 **행 구분선이 있는 유일한 목록**이다. 일반 표 문법(.ab-table)은
 * "행 구분선 없음 + hover"인데, 메일함 원본은 행마다 1px 선을 긋는다 —
 * 표 문법으로 통일하지 말 것. 실측 #eeeeef(gray-05)는 기존 토큰에 없어
 * 최근접 line(#eaecef)으로 근사한다. TODO(리뷰): 토큰 추가 여부 검토.
 */
function MailRow({
  row,
  box,
  today,
  checked,
  onToggle,
  onStar,
}: {
  row: MailListRow;
  box: MailboxKey;
  today: string;
  checked: boolean;
  onToggle: () => void;
  onStar: () => void;
}) {
  // 임시보관함 행은 읽기가 아니라 이어쓰기로 간다
  const href =
    box === "drafts" ? `/mail/compose?draft=${row.id}` : `/mail/${row.id}`;

  // 오늘 온 메일은 시각, 그 전은 MM-DD (MailWidget과 같은 규칙)
  const ymd = toSeoulYmd(row.sentAt);
  const when = ymd === today ? toSeoulTime(row.sentAt) : ymd.slice(5);

  return (
    <li className="border-b border-line">
      <div className="flex h-[41px] items-center gap-2 pr-1 transition-colors duration-fast ease-standard hover:bg-subtle">
        {/* [체크 16 + 별 16 + 상태 아이콘] = 실측 76px 고정 폭 */}
        <div className="flex w-[76px] shrink-0 items-center">
          <MailCheckbox
            checked={checked}
            onChange={onToggle}
            label={`${row.subject || "제목 없음"} 선택`}
          />
          <button
            type="button"
            onClick={onStar}
            aria-pressed={row.isStarred}
            aria-label={row.isStarred ? "별표 해제" : "별표"}
            className="grid size-6 shrink-0 place-items-center rounded-sm transition-colors duration-fast ease-standard hover:bg-line"
          >
            <Star
              className={cn(
                "size-4",
                // 별표 켜짐은 기존 별 문법(fill-warn) — Sidebar 즐겨찾기와 동일
                row.isStarred ? "fill-warn text-warn" : "text-line-strong",
              )}
              aria-hidden
            />
          </button>
          {row.isRead ? (
            <MailOpen
              className="size-4 shrink-0 text-line-strong"
              aria-label="읽음"
            />
          ) : (
            <Mail className="size-4 shrink-0 text-muted" aria-label="안읽음" />
          )}
        </div>

        {/* 발신자 120px · 13px — 안읽음만 600 먹색 */}
        <span
          className={cn(
            "w-[120px] shrink-0 truncate text-label text-ink",
            !row.isRead && "font-semibold",
          )}
        >
          {row.counterpart}
        </span>

        {/* 제목 flex-1 · 14px — 안읽음 600 #1c1c1c / 읽음 400 */}
        <Link
          href={href}
          className="flex min-w-0 flex-1 items-center gap-1.5"
        >
          <span
            className={cn(
              "truncate text-body-sm text-ink",
              !row.isRead && "font-semibold",
            )}
          >
            {row.subject || "(제목 없음)"}
          </span>
          {row.hasAttachment ? (
            <Paperclip
              className="size-3.5 shrink-0 text-muted"
              aria-label="첨부 있음"
            />
          ) : null}
          {row.receiptLabel ? (
            <span className="shrink-0 text-micro text-muted">
              {row.receiptLabel}
            </span>
          ) : null}
        </Link>

        {/* 크기·날짜 168px · 12px muted — "3.6KB・08-02" */}
        <span className="w-[168px] shrink-0 text-right text-micro tabular-nums text-muted">
          {formatMailSize(row.sizeBytes)}・{when}
        </span>
      </div>
    </li>
  );
}

/**
 * 체크박스 — 캘린더 패널 필터의 실측 문법 재사용(16×16 · radius 4 ·
 * 체크됨 #333(check 토큰) 채움 + 흰 체크).
 */
function MailCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="grid size-6 shrink-0 cursor-pointer place-items-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className="peer sr-only"
      />
      <span
        className={cn(
          "grid size-4 place-items-center rounded-[4px] border transition-colors duration-fast ease-standard peer-focus-visible:ring-2 peer-focus-visible:ring-primary/20",
          checked ? "border-check bg-check" : "border-line-strong bg-surface",
        )}
        aria-hidden
      >
        {checked ? (
          <Check className="size-3 text-white" strokeWidth={3} aria-hidden />
        ) : null}
      </span>
    </label>
  );
}
