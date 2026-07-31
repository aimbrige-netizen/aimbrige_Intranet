import type { ProjectStatus } from "@/features/projects/types";

/**
 * 업무일지 (스펙 09 · 3.1)
 *
 * work_logs 컬럼은 마이그레이션 18을 그대로 따른다.
 * project_id는 마이그레이션 19에서 projects(id) FK로 승격되지만,
 * 그 전까지는 제약 없는 uuid 컬럼이라 이름 해석을 조회 계층에서 따로 한다.
 */
export interface WorkLog {
  id: string;
  employee_id: string;
  log_date: string;
  content: string;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 조회 결과 + 실패 사실.
 *
 * 빈 배열로 뭉개면 "이 기간에 기록이 없다"와 "불러오지 못했다"가 같은 화면이 된다.
 * 둘은 사용자가 해야 할 행동이 완전히 다르므로 분리해서 올린다.
 */
export interface WorkLogQuery {
  logs: WorkLog[];
  error: string | null;
}

/** my_team_members() RPC 반환 행 (마이그레이션 18) */
export interface TeamMember {
  id: string;
  name: string;
  position: string | null;
  team_name: string | null;
}

/**
 * 프로젝트 태깅 드롭다운 항목 — status <> 'cancelled' 만.
 *
 * status를 그냥 string으로 두면 프로젝트 모듈이 상태 하나를 더 늘려도 여기서는
 * 아무 신호가 없다. 라벨·정렬을 프로젝트 모듈의 것을 그대로 쓰기 위해 같은
 * 유니온을 참조한다(스펙 10 types.ts가 마이그레이션 19의 CHECK와 짝이다).
 */
export interface ProjectOption {
  id: string;
  name: string;
  status: ProjectStatus;
}

/**
 * 연속 기록일수.
 * 주말·공휴일은 끊지도 세지도 않는다 — 업무일지는 근무일에 쓰는 기록이라
 * 토·일을 공백으로 판정하면 모든 사람의 연속이 매주 0으로 리셋된다.
 */
export interface WorklogStreak {
  /** 오늘(또는 마지막 근무일)까지 이어진 연속 근무일 수 */
  current: number;
  /** 조회 창(최근 12주) 안에서의 최장 연속 */
  longest: number;
  /** 가장 최근 기록일 */
  lastDate: string | null;
}

/** DayStrip 한 칸의 골격 — 칩 내용은 클라이언트에서 logs로 채운다 */
export interface WorklogStripDay {
  date: string;
  holiday: string | null;
  /** 주말·공휴일·미래 — "기록 없음"으로 판정하지 않는 칸 */
  muted: boolean;
  /** 이 칸을 눌러 입력 날짜로 지정할 수 있는가 */
  selectable: boolean;
}
