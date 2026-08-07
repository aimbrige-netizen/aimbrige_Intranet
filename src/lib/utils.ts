import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * tailwind-merge는 기본 설정만으로는 우리 커스텀 스케일을 모른다.
 *
 * `text-*`는 폰트 크기와 글자색이 이름 공간을 공유한다. 기본 config에는
 * text-metric / text-body-sm / text-h2 같은 이름이 없으므로 twMerge가 이를
 * "글자색"으로 분류하고, 뒤에 오는 진짜 색 클래스가 이들을 지워버린다.
 *
 *   twMerge("text-metric tabular-nums text-accent")
 *     → "tabular-nums text-accent"   ← 28px이 조용히 사라진다
 *   twMerge("bg-primary text-white … text-body-sm")
 *     → "bg-primary … text-body-sm"  ← 흰 글자가 조용히 사라진다
 *
 * 임의값(text-[15px])은 폰트 크기로 올바르게 분류돼서 살아남았기 때문에
 * 토큰 이름으로 바꾼 자리에서만 증상이 났다. 커스텀 스케일을 등록해
 * "이 이름들은 크기다"라고 알려준다.
 *
 * radius/shadow도 같은 이유로 등록한다 — rounded-sm과 rounded-card가 둘 다
 * 남으면 어느 쪽이 이길지 CSS 출력 순서에 달리게 된다.
 * (tailwind.config.ts의 fontSize/borderRadius/boxShadow 키와 1:1로 맞춘다)
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "h1",
            "h2",
            "h3",
            "title",
            "title-l",
            "body",
            "body-sm",
            "label",
            "micro",
            "nano",
            "metric",
          ],
        },
      ],
      rounded: [{ rounded: ["card", "pick", "chip", "pill"] }],
      shadow: [{ shadow: ["card", "raised", "pop", "launcher"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 2026-07-30 형태 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul",
  })
    .format(date)
    .replace(/\.\s?$/, "")
    .replace(/\.\s/g, "-")
    .replace(/\./g, "-");
}

/** 2026-07-30 14:22 형태 (감사 로그 등) */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** 아바타 이니셜 — 한글은 성 한 글자, 영문은 앞 두 단어 첫 글자 */
export function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  if (/^[가-힣]/.test(trimmed)) return trimmed.slice(0, 1);
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** 오늘 날짜를 Asia/Seoul 기준 yyyy-MM-dd 로 */
export function todayInSeoul(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
