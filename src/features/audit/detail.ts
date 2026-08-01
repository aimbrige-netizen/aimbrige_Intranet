import type { AuditLog } from "@/types/db";

/**
 * 감사 로그 detail(jsonb) 정리 규칙.
 *
 * 표 셀(DetailCell)과 CSV가 같은 규칙을 써야 한다 — 감사 요청에 답할 때
 * "화면에 보이던 것"과 "내려받은 파일"이 다르면 그 파일은 근거가 되지 못한다.
 * 내보내기가 서버 액션으로 옮겨가면서 두 호출부가 다른 파일에 놓였으므로
 * 규칙만 여기로 꺼내 둔다.
 */

/** 감사 로그에 노출할 필드 라벨 */
export const FIELD_LABELS: Record<string, string> = {
  name: "이름",
  email: "이메일",
  department_id: "부서",
  team_id: "팀",
  position: "직급",
  hire_date: "입사일",
  role_id: "역할",
  role: "역할",
  employment_status: "재직상태",
  phone: "휴대폰",
  emergency_contact: "비상연락처",
  profile_image_url: "프로필 사진",
  reason: "사유",
};

const STATUS_LABELS: Record<string, string> = {
  active: "재직중",
  leave: "휴직",
  terminated: "퇴사",
  not_registered: "미등록 계정",
};

/** before/after 키를 한 번만 정리한다 — 표 셀과 CSV가 같은 규칙을 쓴다 */
export function detailEntries(detail: AuditLog["detail"]) {
  const before = (detail?.before ?? {}) as Record<string, unknown>;
  const after = (detail?.after ?? {}) as Record<string, unknown>;
  const keys = Array.from(
    new Set([...Object.keys(before), ...Object.keys(after)]),
  ).filter((key) => key !== "role_id" || !("role" in after));
  const rest = Object.entries(detail ?? {}).filter(
    ([key]) => key !== "before" && key !== "after",
  );
  return { before, after, keys, rest };
}

export function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(없음)";
  const text = String(value);
  return STATUS_LABELS[text] ?? text;
}

/** CSV용 한 줄 요약 */
export function detailText(detail: AuditLog["detail"]): string {
  if (!detail) return "";
  const { before, after, keys, rest } = detailEntries(detail);

  if (keys.length === 0) {
    return rest
      .map(([key, value]) => `${FIELD_LABELS[key] ?? key}: ${display(value)}`)
      .join(" · ");
  }

  return keys
    .map((key) => {
      const label = FIELD_LABELS[key] ?? key;
      const arrow = key in before ? `${display(before[key])} → ` : "";
      return `${label}: ${arrow}${display(after[key])}`;
    })
    .join(" · ");
}
