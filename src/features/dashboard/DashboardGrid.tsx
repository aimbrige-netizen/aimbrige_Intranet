"use client";

import { useState, useTransition } from "react";
import { Check, LayoutGrid, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { saveWidgetSettings } from "@/server/actions/widgets";
import { cn } from "@/lib/utils";

/** 위젯이 놓이는 열 — 다우오피스 홈의 3열 구조 그대로 */
export type WidgetColumn = "side" | "main" | "aux";

export interface WidgetSlot {
  key: string;
  label: string;
  node: React.ReactNode;
  column: WidgetColumn;
}

/**
 * 홈 대시보드 그리드 — 다우오피스 홈 실측 구조.
 *
 *   3열: 좌 298px 고정 + 가변 2열 · 카드 사이 gap 24px
 *   xl 미만: 3열째(aux)가 가운데 열 아래로 접힌다
 *   md 미만: 전부 한 열
 *
 * 상단은 대시보드 탭 줄(18px/600)이다 — 원본의 "전사 대시보드 / 내 대시보드"
 * 자리. 우리는 대시보드가 하나라 제목 + 위젯 편집 버튼만 놓는다.
 *
 * sideLead(프로필 카드)와 mainLead(Quick Menu)는 위젯이 아니라 상시
 * 고정 요소다 — dashboard_widgets의 widget_key CHECK 제약에 키를 추가하는
 * 마이그레이션 없이 넣기 위해서이기도 하다.
 *
 * 편집 중에는 숨긴 카드도 원래 자리에 흐리게 남는다 — 켜고 끌 때마다
 * 레이아웃이 통째로 흔들리면 무엇을 만졌는지 알 수 없다.
 */
export function DashboardGrid({
  slots,
  initialVisibility,
  sideLead,
  mainLead,
}: {
  slots: WidgetSlot[];
  initialVisibility: Record<string, boolean>;
  sideLead?: React.ReactNode;
  mainLead?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [visibility, setVisibility] =
    useState<Record<string, boolean>>(initialVisibility);
  const [draft, setDraft] = useState<Record<string, boolean>>(initialVisibility);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const startEditing = () => {
    setDraft(visibility);
    setMessage(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setDraft(visibility);
    setEditing(false);
  };

  const save = () => {
    startTransition(async () => {
      const result = await saveWidgetSettings(draft);
      if (result.ok) {
        setVisibility(draft);
        setEditing(false);
        setMessage("위젯 설정을 저장했습니다.");
      } else {
        setMessage(result.message ?? "저장에 실패했습니다.");
      }
    });
  };

  const isShown = (key: string) => (editing ? true : (visibility[key] ?? true));
  const shown = slots.filter((slot) => isShown(slot.key));
  const column = (col: WidgetColumn) =>
    shown.filter((slot) => slot.column === col);

  const renderSlot = (slot: WidgetSlot) => (
    <div
      key={slot.key}
      className={cn("relative", editing && !draft[slot.key] && "opacity-45")}
    >
      {editing ? (
        <label
          className="absolute right-3 top-2.5 z-10 flex cursor-pointer items-center gap-1.5 rounded-sm bg-surface/90 px-1.5 py-0.5 text-label text-ink"
          title={`${slot.label} 표시 여부`}
        >
          <input
            type="checkbox"
            checked={draft[slot.key] ?? true}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                [slot.key]: event.target.checked,
              }))
            }
            className="size-3.5 accent-primary"
          />
          표시
        </label>
      ) : null}
      {slot.node}
    </div>
  );

  return (
    <div>
      {/* 대시보드 탭 줄 — 원본 18px/600, 우측에 편집 컨트롤 */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-[18px] font-semibold text-ink">대시보드</h1>
          {message ? (
            <span className="truncate text-label text-success">{message}</span>
          ) : editing ? (
            <span className="truncate text-label text-muted">
              표시할 위젯을 선택한 뒤 저장하세요.
            </span>
          ) : null}
        </div>
        {editing ? (
          <div className="flex shrink-0 gap-2">
            <Button
              variant="ghost"
              size="small"
              onClick={cancelEditing}
              disabled={pending}
            >
              <X className="size-3.5" />
              취소
            </Button>
            <Button size="small" onClick={save} disabled={pending}>
              <Check className="size-3.5" />
              {pending ? "저장 중…" : "저장"}
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="small" onClick={startEditing}>
            <Pencil className="size-3.5" />
            위젯 편집
          </Button>
        )}
      </div>

      {shown.length === 0 && !sideLead && !mainLead ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState
            icon={LayoutGrid}
            title="표시 중인 위젯이 없습니다"
            /* 목록을 문구에 박아두면 위젯이 늘 때마다 여기만 옛날 목록으로 남는다 */
            description={`${slots
              .map((slot) => slot.label)
              .join("·")} 중 필요한 것을 골라 두세요.`}
            action={
              <Button size="small" variant="secondary" onClick={startEditing}>
                <Pencil className="size-3.5" />
                위젯 선택
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[298px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            {sideLead}
            {column("side").map(renderSlot)}
          </div>
          {/*
            우측 영역을 안쪽 그리드로 한 번 더 가른다 — xl에서 2열(총 3열),
            그 아래에서는 main → aux 순서로 한 열 스택. 3열을 한 그리드로
            만들면 md에서 aux가 main "아래 행"으로 떨어져 side가 길 때
            가운데 열에 빈 공간이 생긴다.
          */}
          <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-6">
              {mainLead}
              {column("main").map(renderSlot)}
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              {column("aux").map(renderSlot)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
