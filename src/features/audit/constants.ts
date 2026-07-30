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
];
