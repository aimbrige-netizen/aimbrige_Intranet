"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  CircleAlert,
  Info,
  ShieldAlert,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 공용 토스트 — 2026-08-07 UI/UX 감사: 앱 전체에 성공/실패 피드백을
 * 3~5초 뒤 스스로 사라지며 스크린리더에도 알리는 공통 통로가 없었다
 * (자산 등록은 성공해도 피드백 자체가 없었다). Callout과 같은 톤 체계
 * (neutral/info/warn/danger/success)를 그대로 쓴다 — 새 색 규칙을
 * 만들지 않는다.
 *
 * 폼 안에 이미 있는 인라인 Callout(예: 실패 사유를 필드 옆에 계속 보여줘야
 * 하는 경우)을 대체하려는 게 아니다 — "한 번 뜨고 사라지면 되는 알림"
 * 전용이다. 오래 보여야 하는 오류 설명은 계속 Callout을 쓴다.
 */

type ToastTone = "neutral" | "info" | "warn" | "danger" | "success";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const TONE_META: Record<ToastTone, { icon: LucideIcon; className: string }> = {
  neutral: { icon: Info, className: "border-line bg-surface text-ink" },
  info: { icon: Info, className: "border-info/30 bg-info-light text-ink" },
  warn: { icon: TriangleAlert, className: "border-warn/40 bg-warn-light text-ink" },
  danger: { icon: CircleAlert, className: "border-danger/30 bg-danger-light text-ink" },
  success: { icon: ShieldAlert, className: "border-success/30 bg-success-light text-ink" },
};

const AUTO_DISMISS_MS = 4000;

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = "success") => {
      const id = nextId.current++;
      setItems((prev) => [...prev, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/*
        화면 우하단 고정 스택. aria-live="polite"라 다른 안내를 끊지 않고
        차례로 읽힌다 — 토스트 자체가 role="status"라 danger 톤도 assertive로
        올리지 않는다(Callout의 인라인 오류와 달리 화면 흐름을 막지 않는 자리).
      */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
      >
        {items.map((item) => {
          const meta = TONE_META[item.tone];
          const Icon = meta.icon;
          return (
            <div
              key={item.id}
              role="status"
              className={cn(
                "pointer-events-auto flex items-start gap-2.5 rounded-card border px-4 py-3 shadow-pop",
                meta.className,
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1 text-label leading-relaxed">{item.message}</p>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="알림 닫기"
                className="-m-1 shrink-0 rounded-sm p-1 text-muted transition-colors hover:text-ink"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** `toast("등록했습니다")` · `toast("등록하지 못했습니다", "danger")` */
export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) {
    throw new Error("useToast는 ToastProvider 안에서만 쓸 수 있습니다.");
  }
  return toast;
}
