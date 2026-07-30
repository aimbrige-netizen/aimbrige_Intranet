/** 로그인 차단 사유 코드 — 미들웨어/콜백 → /login 화면으로 전달 */
export const AUTH_ERRORS = {
  not_registered: {
    title: "접근 권한이 없습니다",
    message:
      "계정이 등록되지 않았거나 접근 권한이 없습니다. 시스템 관리자에게 문의하세요.",
  },
  terminated: {
    title: "접근 권한이 회수되었습니다",
    message:
      "퇴사 처리된 계정입니다. 문의사항이 있으면 시스템 관리자에게 연락하세요.",
  },
  on_leave: {
    title: "휴직 중인 계정입니다",
    message:
      "휴직 상태에서는 인트라넷에 접근할 수 없습니다. 복직 처리 후 이용해 주세요.",
  },
  invalid_domain: {
    title: "허용되지 않은 계정입니다",
    message: "회사 계정(@sding.kr)으로만 로그인할 수 있습니다.",
  },
  oauth_failed: {
    title: "로그인에 실패했습니다",
    message: "인증 과정에서 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  },
} as const;

export type AuthErrorCode = keyof typeof AUTH_ERRORS;

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === "string" && value in AUTH_ERRORS;
}
