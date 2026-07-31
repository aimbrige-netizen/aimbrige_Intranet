"use client";

import { useMemo } from "react";
import { Input, Select, FormRow } from "@/components/ui/Field";
import type { EmploymentStatus } from "@/types/db";

export interface OrgOption {
  id: string;
  name: string;
  department_id?: string | null;
}

export interface EmployeeFormValues {
  name: string;
  email: string;
  department_id: string;
  team_id: string;
  position: string;
  hire_date: string;
  role: "manager" | "employee";
  employment_status?: EmploymentStatus;
}

const STATUS_OPTIONS: { value: EmploymentStatus; label: string }[] = [
  { value: "active", label: "재직중" },
  { value: "leave", label: "휴직" },
  { value: "terminated", label: "퇴사" },
];

/**
 * 임직원 등록/수정 공통 입력 필드.
 * 항목이 많은 폼이라 디자인시스템 원칙에 따라 라벨-옆-인풋 표 형태를 사용한다.
 */
export function EmployeeFields({
  values,
  onChange,
  errors,
  departments,
  teams,
  showStatus,
  lockRole,
  disabled,
}: {
  values: EmployeeFormValues;
  onChange: (patch: Partial<EmployeeFormValues>) => void;
  errors: Record<string, string>;
  departments: OrgOption[];
  teams: OrgOption[];
  /** 수정 화면에서만 재직상태 셀렉트 노출 */
  showStatus?: boolean;
  /** 대상이 시스템 관리자면 역할 변경 불가 */
  lockRole?: boolean;
  disabled?: boolean;
}) {
  // 부서 선택에 따라 팀 옵션을 필터링 (스펙 3.4)
  const teamOptions = useMemo(() => {
    if (!values.department_id) return teams;
    return teams.filter((team) => team.department_id === values.department_id);
  }, [teams, values.department_id]);

  return (
    <div className="ab-form-grid">
      <FormRow label="이름" required htmlFor="name" error={errors.name}>
        <Input
          id="name"
          value={values.name}
          onChange={(event) => onChange({ name: event.target.value })}
          invalid={!!errors.name}
          disabled={disabled}
          placeholder="홍길동"
          autoComplete="off"
        />
      </FormRow>

      <FormRow
        label="이메일"
        required
        htmlFor="email"
        error={errors.email}
        hint="회사 Google 계정과 동일한 주소여야 로그인이 됩니다."
      >
        <Input
          id="email"
          type="email"
          value={values.email}
          onChange={(event) => onChange({ email: event.target.value })}
          invalid={!!errors.email}
          disabled={disabled}
          placeholder="name@sding.kr"
          autoComplete="off"
        />
      </FormRow>

      <FormRow label="부서" htmlFor="department_id" error={errors.department_id}>
        <Select
          id="department_id"
          value={values.department_id}
          onChange={(event) =>
            // 부서를 바꾸면 선택된 팀은 초기화한다
            onChange({ department_id: event.target.value, team_id: "" })
          }
          disabled={disabled}
        >
          <option value="">선택 안 함</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
      </FormRow>

      <FormRow
        label="팀"
        htmlFor="team_id"
        error={errors.team_id}
        hint={
          teamOptions.length === 0
            ? "선택한 부서에 등록된 팀이 없습니다. 조직도 화면의 조직 구조 편집에서 팀을 추가할 수 있습니다."
            : undefined
        }
      >
        <Select
          id="team_id"
          value={values.team_id}
          onChange={(event) => onChange({ team_id: event.target.value })}
          disabled={disabled || teamOptions.length === 0}
        >
          <option value="">선택 안 함</option>
          {teamOptions.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </Select>
      </FormRow>

      <FormRow label="직급/직책" htmlFor="position" error={errors.position}>
        <Input
          id="position"
          value={values.position}
          onChange={(event) => onChange({ position: event.target.value })}
          disabled={disabled}
          placeholder="팀장, 대리 등"
        />
      </FormRow>

      <FormRow label="입사일" required htmlFor="hire_date" error={errors.hire_date}>
        <Input
          id="hire_date"
          type="date"
          value={values.hire_date}
          onChange={(event) => onChange({ hire_date: event.target.value })}
          invalid={!!errors.hire_date}
          disabled={disabled}
          className="md:max-w-52"
        />
      </FormRow>

      <FormRow
        label="역할"
        required
        htmlFor="role"
        error={errors.role}
        hint={
          lockRole
            ? "시스템 관리자 계정은 이 화면에서 역할을 변경할 수 없습니다."
            : "시스템 관리자 권한은 이 화면에서 부여하지 않습니다(단독 운영)."
        }
      >
        <Select
          id="role"
          value={values.role}
          onChange={(event) =>
            onChange({ role: event.target.value as "manager" | "employee" })
          }
          disabled={disabled || lockRole}
          className="md:max-w-52"
        >
          <option value="employee">일반직원</option>
          <option value="manager">팀장/매니저</option>
        </Select>
      </FormRow>

      {showStatus ? (
        <FormRow
          label="재직상태"
          required
          htmlFor="employment_status"
          error={errors.employment_status}
        >
          <Select
            id="employment_status"
            value={values.employment_status ?? "active"}
            onChange={(event) =>
              onChange({
                employment_status: event.target.value as EmploymentStatus,
              })
            }
            disabled={disabled}
            className="md:max-w-52"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormRow>
      ) : null}
    </div>
  );
}
