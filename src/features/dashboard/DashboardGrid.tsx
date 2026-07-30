"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { saveWidgetSettings } from "@/server/actions/widgets";
import { cn } from "@/lib/utils";

export interface WidgetSlot {
  key: string;
  label: string;
  node: React.ReactNode;
}

/**
 * 위젯 카드 그리드 + 편집 모드 (스펙 3.2 / 3.3)
 * - 데스크톱 2~3열, 모바일 1열 (디자인시스템 레이아웃)
 * - 편집 모드에서 각 카드에 표시/숨김 체크박스 노출, 저장 시 upsert
 * - 순서 변경(드래그앤드롭)은 후순위 — 고정 순서
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

  const isShown = (key: string) =>
    editing ? true : (visibility[key] ?? true);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="min-h-5">
          {message ? (
            <p className="text-label text-success">{message}</p>
          ) : editing ? (
            <p className="text-label text-muted">
              대시보드에 표시할 위젯을 선택하세요.
            </p>
          ) : null}
        </div>

        {editing ? (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={cancelEditing} disabled={pending}>
              <X className="size-3.5" />
              취소
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              <Check className="size-3.5" />
              {pending ? "저장 중…" : "저장"}
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={startEditing}>
            <Pencil className="size-3.5" />
            편집
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {slots.filter((slot) => isShown(slot.key)).map((slot) => (
          <div
            key={slot.key}
            className={cn(
              "relative",
              editing && !draft[slot.key] && "opacity-45",
            )}
          >
            {editing ? (
              <label
                className="absolute right-3 top-3.5 z-10 flex cursor-pointer items-center gap-1.5 rounded bg-surface/90 px-1.5 py-0.5 text-label text-ink"
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
                  className="size-3.5 accent-[#1D4E8F]"
                />
                표시
              </label>
            ) : null}
            {slot.node}
          </div>
        ))}
      </div>

      {!editing && slots.every((slot) => !isShown(slot.key)) ? (
        <p className="py-16 text-center text-caption">
          표시 중인 위젯이 없습니다. 편집에서 다시 켤 수 있습니다.
        </p>
      ) : null}
    </div>
  );
}
