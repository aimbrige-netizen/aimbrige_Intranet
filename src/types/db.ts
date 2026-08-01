/**
 * DB 타입 정의 (수기 관리)
 * 스키마 근거: aimbridge_intranet_spec_01_auth_dashboard.md 4장
 *
 * 참고: 테이블이 늘어나면
 *   npx supabase gen types typescript --project-id <ref> > src/types/supabase.ts
 * 로 자동생성으로 전환하는 걸 권장한다.
 */

export type EmploymentStatus = "active" | "leave" | "terminated";
export type RoleName = "system_admin" | "manager" | "employee";

export type AuditAction =
  | "login"
  | "login_denied"
  | "employee_created"
  | "employee_updated"
  | "employment_status_changed"
  | "role_changed"
  | "profile_updated"
  // 스펙 02 — 조직 변경 이력 (3.2 프로필 상세 타임라인)
  | "employee_transferred"
  | "employee_promoted"
  | "department_created"
  | "department_updated"
  | "department_deleted"
  | "team_created"
  | "team_updated"
  | "team_deleted"
  /*
   * 스펙 04 — 결재. DB가 진작부터 쓰고 있던 값인데 여기에 없었다.
   * submit_approval_draft()/submit_approval_document()(마이그레이션 13·14)와
   * withdraw_approval_document()(13)가 audit_logs에 직접 insert한다.
   * 라벨 조회가 `LABELS[action] ?? action`이라 지금까지 감사 화면에
   * 원문 키가 그대로 찍혔고, 그룹 필터로는 아예 잡히지 않았다.
   */
  | "approval.submit"
  | "approval.withdraw";

/**
 * 대시보드 위젯 키 — 이 배열이 유일한 목록이다.
 *
 * 예전에는 같은 목록이 세 군데(타입 선언·저장 액션·기본 순서)에 따로 적혀 있었다.
 * 그래서 메일 위젯을 추가했을 때 화면에는 토글이 생겼는데 저장 액션은 그 키를
 * 모르는 상태가 됐다 — 끄고 저장하면 "저장했습니다"가 뜨고 위젯은 그대로 남았다.
 * 실패를 알리지도 않으니 화면만 보고는 원인을 알 수 없다.
 *
 * 새 위젯을 넣을 때 손대야 할 곳은 여기 + 마이그레이션 20의 CHECK 목록 둘뿐이다.
 */
export const WIDGET_KEYS = [
  "approval_pending",
  "attendance_today",
  "notices",
  "calendar_upcoming",
  "favorites",
  "mail",
] as const;

export type WidgetKey = (typeof WIDGET_KEYS)[number];

export interface Department {
  id: string;
  name: string;
  parent_id: string | null;
  manager_id: string | null;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  department_id: string | null;
  manager_id: string | null;
  created_at: string;
}

export interface Role {
  id: string;
  name: RoleName;
  label: string;
  is_system_role: boolean;
}

export interface Employee {
  id: string;
  auth_user_id: string | null;
  email: string;
  name: string;
  department_id: string | null;
  team_id: string | null;
  position: string | null;
  role_id: string;
  employment_status: EmploymentStatus;
  hire_date: string | null;
  phone: string | null;
  /** 담당업무 (스펙 02 · 3.2) */
  responsibilities: string | null;
  profile_image_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 비상연락처는 컬럼 권한으로 일반 조회에서 제외돼 있어 Employee에 포함하지 않는다.
 * 본인·관리자는 get_emergency_contact() RPC로만 읽는다 (마이그레이션 03 참고).
 */

/** 목록·상세에서 조인해 쓰는 형태 */
export interface EmployeeWithRelations extends Employee {
  role: Pick<Role, "id" | "name" | "label"> | null;
  department: Pick<Department, "id" | "name"> | null;
  team: Pick<Team, "id" | "name"> | null;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: AuditAction;
  target_id: string | null;
  detail: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
  created_at: string;
}


export interface DashboardWidget {
  id: string;
  employee_id: string;
  widget_key: WidgetKey;
  is_visible: boolean;
  sort_order: number;
}

export interface Favorite {
  id: string;
  employee_id: string;
  label: string;
  target_path: string;
  sort_order: number;
  created_at: string;
}

/** 로그인한 사용자 세션 컨텍스트 */
export interface SessionEmployee extends EmployeeWithRelations {
  roleName: RoleName;
  isSystemAdmin: boolean;
  isManager: boolean;
}

// =====================================================================
// 스펙 02 — 조직도 & 디렉토리, 캘린더
// =====================================================================

export type ContactCategory = "vendor" | "client" | "partner";

export interface ExternalContact {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
  memo: string | null;
  category: ContactCategory | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExternalContactWithCreator extends ExternalContact {
  creator: Pick<Employee, "id" | "name"> | null;
}

export type EventVisibility = "personal" | "team" | "company";

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  visibility: EventVisibility;
  /** 회의 장소. 자유 입력 — 사내 회의실은 리소스 예약이 따로 있다 */
  location: string | null;
  /**
   * 참석자 employees.id 배열.
   *
   * 참석 여부(수락/거절/미정)는 event_attendees가 진실이고 이 배열은 호환용으로만
   * 남아 있다. SELECT 정책이 아직 배열과 테이블을 둘 다 보므로 저장할 때는 양쪽에
   * 같은 값을 쓴다 — 읽을 때는 테이블만 본다.
   */
  attendee_ids: string[];
  owner_id: string;
  team_id: string | null;
  google_calendar_event_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventWithOwner extends CalendarEvent {
  owner: Pick<Employee, "id" | "name" | "profile_image_url"> | null;
}

/** 참석 응답. respond_to_event()가 받는 값과 같은 집합 */
export type EventResponse = "pending" | "accepted" | "declined" | "tentative";

export interface EventAttendee {
  event_id: string;
  employee_id: string;
  response: EventResponse;
  responded_at: string | null;
  created_at: string;
}

export type ResourceType = "meeting_room" | "vehicle" | "equipment";

export interface Resource {
  id: string;
  name: string;
  type: ResourceType;
  capacity: number | null;
  location: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ResourceBooking {
  id: string;
  resource_id: string;
  booked_by: string;
  start_at: string;
  end_at: string;
  purpose: string | null;
  created_at: string;
}

export interface ResourceBookingWithRelations extends ResourceBooking {
  resource: Pick<Resource, "id" | "name" | "type" | "location"> | null;
  booker: Pick<Employee, "id" | "name"> | null;
}

// =====================================================================
// 스펙 03 — 출퇴근관리 (연차·반차)
// =====================================================================

export type WorkStatus = "normal_office" | "field_work" | "remote" | "training";
export type AttendanceStatus = "normal" | "late" | "early_leave" | "absent";

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  work_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  check_in_ip: string | null;
  check_in_location: string | null;
  location_warning: string | null;
  work_status: WorkStatus;
  status: AttendanceStatus;
  manual_adjustment_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type LeaveType = "full_day" | "half_day_am" | "half_day_pm" | "hourly";
export type LeaveCategory =
  | "annual"
  | "industrial_accident"
  | "family_care"
  | "maternity"
  | "menstrual"
  | "congratulation_condolence";
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type: LeaveType;
  leave_category: LeaveCategory;
  start_date: string;
  end_date: string;
  start_time: string | null;
  hours: number | null;
  days: number;
  reason: string | null;
  status: RequestStatus;
  approver_id: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export interface OvertimeRequest {
  id: string;
  employee_id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  reason: string;
  compensate_as_leave: boolean;
  status: Exclude<RequestStatus, "cancelled">;
  approver_id: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export interface CorrectionRequest {
  id: string;
  employee_id: string;
  target_date: string;
  requested_check_in: string | null;
  requested_check_out: string | null;
  reason: string;
  status: Exclude<RequestStatus, "cancelled">;
  approver_id: string | null;
  rejection_reason: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface LeaveBalance {
  employee_id: string;
  accrued_days: number;
  used_days: number;
  adjustment_days: number;
  updated_at: string;
}

export interface LeaveAdjustment {
  id: string;
  employee_id: string;
  days: number;
  reason: string;
  adjusted_by: string | null;
  created_at: string;
}

/** 승인함에서 종류가 다른 신청을 한 목록으로 다루기 위한 표현 */
export type ApprovalKind = "leave" | "overtime" | "correction";

export interface ApprovalItem {
  id: string;
  kind: ApprovalKind;
  employeeId: string;
  employeeName: string;
  /** 화면에 보여줄 유형 라벨 */
  typeLabel: string;
  dateLabel: string;
  detailLabel: string;
  reason: string | null;
  status: RequestStatus;
  createdAt: string;
  rejectionReason: string | null;
}

export type HolidayKind =
  | "public"
  | "substitute"
  | "temporary"
  | "statutory_leave";

export interface Holiday {
  date: string;
  name: string;
  kind: HolidayKind;
  is_non_working: boolean;
  created_at: string;
  updated_at: string;
}

/** 캘린더 화면에서 종류가 다른 항목을 한 배열로 다루기 위한 표현 */
export type CalendarItemKind =
  | "personal"
  | "team"
  | "company"
  /** 남이 만든 일정에 내가 참석자로 지정된 것 */
  | "invited"
  | "resource_booking"
  | "leave"
  | "approval"
  /** 스펙 10 연동 — 프로젝트 마일스톤의 목표일 */
  | "milestone";

/** 일정 참석자 표시에 필요한 최소 정보 */
export interface CalendarAttendee {
  id: string;
  name: string;
  profileImageUrl: string | null;
  /** 오겠다고 했는가. 응답 전이면 'pending' */
  response: EventResponse;
  /** 이 참석자가 나인가 — 목록에서 '나'를 짚고 응답 버튼을 붙이는 데 쓴다 */
  isMe: boolean;
}

export interface CalendarItem {
  id: string;
  kind: CalendarItemKind;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  ownerId: string | null;
  ownerName: string | null;
  /** 어디서 하는가. 리소스 예약은 리소스에 등록된 위치를 그대로 쓴다 */
  location: string | null;
  /** 누가 오는가. 일정 외 종류(휴가·결재·예약)는 빈 배열 */
  attendees: CalendarAttendee[];
  /**
   * 내 참석 응답. 내가 참석자로 지정되지 않았으면(등록자이거나 무관한 항목) null.
   * attendees 안의 isMe 항목과 같은 값이다 — 칩처럼 목록을 훑지 않고 바로
   * 봐야 하는 자리가 많아 항목 수준에도 올려 둔다.
   */
  myResponse: EventResponse | null;
  /** 본인이 수정·삭제할 수 있는 항목인지 */
  editable: boolean;
  /**
   * 달성 여부. 지금은 프로젝트 마일스톤만 쓴다.
   * 목표점은 "날짜가 지났는가"가 아니라 "달성했는가"로 읽어야 해서 날짜만으로는
   * 상태를 알 수 없다. 달성이라는 개념이 없는 종류(일정·휴가·예약)는 undefined —
   * false로 두면 "아직 못 했다"는 뜻이 생겨 버린다.
   */
  completed?: boolean;
  /**
   * 이 항목의 원본 화면. 캘린더는 표시만 하고 편집은 원본 모듈에서 한다 —
   * 마일스톤처럼 고칠 곳이 따로 있는 항목은 상세에서 그 자리로 보낸다.
   */
  sourceHref?: string | null;
}
