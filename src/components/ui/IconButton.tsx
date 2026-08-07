import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * 아이콘만 있는 보조 액션 버튼(행 안의 수정·삭제·다운로드 등).
 *
 * 2026-08-07 UI/UX 감사: 이 자리가 프로젝트 마일스톤·즐겨찾기·외부연락처·
 * 조직 편집기(OrgEditor의 로컬 버전)·결재/게시글 첨부파일 6곳에 각자
 * `p-1.5`(26~28px 히트영역)로 손복사돼 있었다. 공용 컴포넌트로 묶고
 * 기본 히트영역을 44px(min-h-11 min-w-11)로 올린다 — 시각적 아이콘 크기는
 * 그대로, 보이지 않는 패딩만 커진다.
 */
export const IconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    /** 삭제 등 위험 액션 — hover가 danger 톤으로 바뀐다 */
    danger?: boolean;
  }
>(({ label, danger, className, type, ...props }, ref) => (
  <button
    ref={ref}
    type={type ?? "button"}
    aria-label={label}
    title={label}
    className={cn(
      "grid min-h-11 min-w-11 place-items-center rounded-sm text-muted transition-colors duration-fast ease-standard disabled:cursor-not-allowed disabled:opacity-40",
      danger
        ? "hover:bg-danger-light hover:text-danger"
        : "hover:bg-subtle hover:text-ink",
      className,
    )}
    {...props}
  />
));
IconButton.displayName = "IconButton";
