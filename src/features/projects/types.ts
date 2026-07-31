import type { Employee, Team } from "@/types/db";

/**
 * 프로젝트 관리 (스펙 10)
 *
 * 컬럼은 마이그레이션 19를 그대로 따른다. 특히 두 가지를 코드가 먼저 지킨다:
 *   projects_name_not_blank            공백만 있는 이름 금지
 *   projects_date_order                종료일 >= 시작일
 *   milestones_title_not_blank         공백만 있는 마일스톤 제목 금지
 *   milestones_completed_consistent    is_completed와 completed_at은 항상 함께
 *
 * 진행률(%)은 컬럼으로 저장하지 않는다 — 완료 마일스톤 수 / 전체 수로
 * 그때그때 센다(마이그레이션 19 주석, 스펙 10 · 4장).
 */

export const PROJECT_STATUSES = [
  "planning",
  "in_progress",
  "completed",
  "on_hold",
  "cancelled",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "기획중",
  in_progress: "진행중",
  completed: "완료",
  on_hold: "보류",
  cancelled: "취소",
};

/**
 * 보류·취소는 위반이 아니라 "지금 굴리지 않기로 한 것"이다.
 * 이 모듈은 danger를 아예 쓰지 않는다 — 색을 올리는 값은 "종료일이 지났는데
 * 아직 완료가 아닌" 지연 하나뿐이고, 그것도 warn이다(일정이 밀린 것이지
 * 규정 위반이 아니다). 할일·목표의 '기한 지남'과 같은 색 축을 쓴다.
 */
export const PROJECT_STATUS_TONES: Record<
  ProjectStatus,
  "neutral" | "info" | "success" | "warn"
> = {
  planning: "neutral",
  in_progress: "info",
  completed: "success",
  on_hold: "warn",
  cancelled: "neutral",
};

/** 취소는 같은 중립이라도 한 단계 뒤로 물린다 (기획중과 무게가 다르다) */
export const PROJECT_STATUS_BADGE_CLASS: Partial<Record<ProjectStatus, string>> =
  {
    cancelled: "opacity-60",
  };

/** 상태 분포 막대에 쓰는 Meter 톤 — 뱃지 톤과 같은 의미 축이다 */
export const PROJECT_STATUS_METER_TONES: Record<
  ProjectStatus,
  "neutral" | "informative" | "positive" | "warning"
> = {
  planning: "neutral",
  in_progress: "informative",
  completed: "positive",
  on_hold: "warning",
  cancelled: "neutral",
};

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return (
    typeof value === "string" &&
    (PROJECT_STATUSES as readonly string[]).includes(value)
  );
}

export interface Project {
  id: string;
  name: string;
  team_id: string | null;
  owner_id: string | null;
  status: ProjectStatus;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  /** 완료 전환 시 남기는 결과 요약 (스펙 3.3 결과·산출물 탭) */
  result_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectMilestone {
  id: string;
  project_id: string;
  title: string;
  due_date: string | null;
  is_completed: boolean;
  /** is_completed와 짝으로만 바뀐다 (milestones_completed_consistent) */
  completed_at: string | null;
  sort_order: number;
  created_at: string;
}

export interface ProjectFile {
  id: string;
  project_id: string;
  /** 공개 URL이 아니라 스토리지 경로다. 다운로드는 서명 URL로만 한다 */
  file_url: string;
  file_name: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export type ProjectTeam = Pick<Team, "id" | "name">;
export type ProjectOwner = Pick<
  Employee,
  "id" | "name" | "position" | "profile_image_url"
>;

/** 목록 행 — 진행률에 필요한 최소 컬럼만 함께 가져온다 */
export interface ProjectListRow extends Project {
  team: ProjectTeam | null;
  owner: ProjectOwner | null;
  milestones: { id: string; is_completed: boolean; due_date: string | null }[];
}

export interface ProjectDetail extends Project {
  team: ProjectTeam | null;
  owner: ProjectOwner | null;
  milestones: ProjectMilestone[];
  files: ProjectFile[];
}

/**
 * 이 프로젝트로 태깅된 업무일지 (스펙 09 연동, 읽기전용).
 * work_logs의 RLS는 본인 것 + 팀장이 보는 팀원 것 + 관리자 전체만 통과시키므로,
 * 여기 담기는 건 "보는 사람이 볼 권한이 있는" 기록이다.
 */
export interface ProjectWorkLog {
  id: string;
  employee_id: string;
  log_date: string;
  content: string;
  created_at: string;
  employee: Pick<Employee, "id" | "name" | "position"> | null;
}

/**
 * 상세의 섹션 전환.
 * 모듈 내부 이동이 아니라 한 문서의 섹션 전환이라 본문 안 세그먼티드 컨트롤로 둔다
 * (결재 상세의 신청 내역 탭과 같은 성격). 상태는 searchParams가 유지한다.
 */
export const PROJECT_TABS = ["milestones", "worklog", "files"] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

export const PROJECT_TAB_LABELS: Record<ProjectTab, string> = {
  milestones: "마일스톤",
  worklog: "업무일지",
  files: "결과·산출물",
};

/** 목록 밖의 값이 URL로 들어와도 화면이 깨지지 않게 기본값으로 떨어뜨린다 */
export function parseProjectTab(value: unknown): ProjectTab {
  return typeof value === "string" &&
    (PROJECT_TABS as readonly string[]).includes(value)
    ? (value as ProjectTab)
    : "milestones";
}

/** 산출물 버킷 — 이름·크기·형식은 마이그레이션 19의 버킷 설정과 같아야 한다 */
export const PROJECT_FILE_BUCKET = "project-files";
export const PROJECT_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const PROJECT_FILE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "application/zip",
] as const;
