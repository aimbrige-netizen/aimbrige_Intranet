import type { AuditAction } from "@/types/db";

/**
 * 감사 로그 액션 목록.
 * 서버 컴포넌트(라벨 매핑)와 클라이언트 필터가 함께 쓰므로
 * "use client" 모듈이 아닌 별도 파일에 둔다.
 */
export const AUDIT_ACTION_OPTIONS: { value: AuditAction; label: string }[] = [
  { value: "login", label: "로그인" },
  { value: "login_denied", label: "로그인 차단" },
  { value: "employee_created", label: "계정 등록" },
  { value: "employee_updated", label: "정보 수정" },
  { value: "employment_status_changed", label: "재직상태 변경" },
  { value: "role_changed", label: "역할 변경" },
  { value: "profile_updated", label: "프로필 수정" },
  // 스펙 02
  { value: "employee_transferred", label: "조직 이동" },
  { value: "employee_promoted", label: "승진" },
  { value: "department_created", label: "부서 생성" },
  { value: "department_updated", label: "부서 수정" },
  { value: "department_deleted", label: "부서 삭제" },
  { value: "team_created", label: "팀 생성" },
  { value: "team_updated", label: "팀 수정" },
  { value: "team_deleted", label: "팀 삭제" },
  // 스펙 04 — 결재 함수들이 직접 남기는 값 (마이그레이션 13·14)
  { value: "approval.submit", label: "결재 상신" },
  { value: "approval.withdraw", label: "결재 회수" },
];

export const AUDIT_ACTION_LABELS = Object.fromEntries(
  AUDIT_ACTION_OPTIONS.map((option) => [option.value, option.label]),
) as Record<string, string>;

export type AuditGroupKey =
  | "all"
  | "auth"
  | "access"
  | "hr"
  | "org"
  | "approval";

/**
 * 액션을 그대로 나열하면 드롭다운 하나에 접혀서 "무엇이 몇 건인지"가
 * 보이지 않는다. 감사 관점에서 심각도가 다른 갈래로 묶어 요약 밴드가
 * 곧 필터가 되게 한다.
 *
 * 그룹의 합은 전체 건수와 같아야 한다 — 어디에도 안 들어간 액션이 있으면
 * 칩 건수를 다 더해도 표의 건수에 못 미치고, 그 차이는 화면에 설명이 없다.
 * 결재 상신·회수가 정확히 그 상태였다.
 */
export const AUDIT_GROUPS: {
  key: Exclude<AuditGroupKey, "all">;
  label: string;
  description: string;
  actions: AuditAction[];
}[] = [
  {
    key: "auth",
    label: "로그인",
    description: "성공·차단 이력",
    actions: ["login", "login_denied"],
  },
  {
    key: "access",
    label: "권한·재직상태",
    description: "가장 위험한 변경",
    actions: ["role_changed", "employment_status_changed"],
  },
  {
    key: "hr",
    label: "계정·인사정보",
    description: "등록·수정·승진",
    actions: [
      "employee_created",
      "employee_updated",
      "employee_promoted",
      "employee_transferred",
      "profile_updated",
    ],
  },
  {
    key: "org",
    label: "조직 구조",
    description: "부서·팀 생성과 삭제",
    actions: [
      "department_created",
      "department_updated",
      "department_deleted",
      "team_created",
      "team_updated",
      "team_deleted",
    ],
  },
  {
    key: "approval",
    label: "결재",
    description: "상신·회수",
    actions: ["approval.submit", "approval.withdraw"],
  },
];

export function actionsOfGroup(group: string | undefined): AuditAction[] | null {
  const found = AUDIT_GROUPS.find((item) => item.key === group);
  return found ? found.actions : null;
}
