"use client";

import { useState, useTransition } from "react";
import { Check, LayoutGrid, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SectionHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { saveWidgetSettings } from "@/server/actions/widgets";
import { cn } from "@/lib/utils";

export interface WidgetSlot {
  key: string;
  label: string;
  node: React.ReactNode;
  /** 그리드에서 차지할 열 수. 주간 근태 스트립처럼 가로가 필요한 카드는 2 */
  span?: 1 | 2;
}

/**
 * 위젯 그리드 + 표시 설정.
 *
 * 예전에는 그리드 위에 '편집' 버튼만 있는 툴바가 가로 한 줄을 통째로 먹었고,
 * 그 왼쪽 메시지 슬롯(min-h-5)은 평소엔 빈 20px 여백으로 남았다. 지금은
 * 섹션 제목 줄이 그 자리를 쓰고, 안내 문구는 제목 아래 설명으로 들어간다.
 */
export function DashboardGrid({
  slots,
  initialVisibility,
}: {
  slots: WidgetSlot[];
  initialVisibility: Record<string, boolean>;
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

  // 편집 중에는 숨긴 카드도 원래 자리에 흐리게 남는다 — 켜고 끌 때마다
  // 레이아웃이 통째로 흔들리면 무엇을 만졌는지 알 수 없다
  const isShown = (key: string) => (editing ? true : (visibility[key] ?? true));
  const shown = slots.filter((slot) => isShown(slot.key));

  return (
    <div>
      <SectionHeader
        title="내 위젯"
        description={
          message ? (
            <span className="text-success">{message}</span>
          ) : editing ? (
            "표시할 위젯을 선택한 뒤 저장하세요."
          ) : undefined
        }
        action={
          editing ? (
            <div className="flex gap-2">
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
          )
        }
      />

      {shown.length === 0 ? (
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((slot) => (
            <div
              key={slot.key}
              className={cn(
                "relative",
                slot.span === 2 && "md:col-span-2",
                editing && !draft[slot.key] && "opacity-45",
              )}
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
                    className="size-3.5 accent-[#ff6f0f]"
                  />
                  표시
                </label>
              ) : null}
              {slot.node}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
