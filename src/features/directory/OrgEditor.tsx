"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus, Trash2, Users, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import {
  createDepartment,
  createTeam,
  deleteDepartment,
  deleteTeam,
  updateDepartment,
  updateTeam,
} from "@/server/actions/org";
import type { Department, Team } from "@/types/db";

type Target =
  | { mode: "create-department" }
  | { mode: "edit-department"; department: Department }
  | { mode: "create-team" }
  | { mode: "edit-team"; team: Team };

/**
 * 조직 편집 모드 (스펙 02 · 3.1)
 * 시스템 관리자에게만 렌더링된다. 부서·팀 추가/이름 변경/상위 이동/매니저 지정.
 */
export function OrgEditor({
  departments,
  teams,
  managerOptions,
}: {
  departments: Department[];
  teams: Team[];
  managerOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState<Target | null>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = (next: Target) => {
    setMessage(null);
    setTarget(next);
    if (next.mode === "edit-department") {
      setName(next.department.name);
      setParentId(next.department.parent_id ?? "");
      setManagerId(next.department.manager_id ?? "");
    } else if (next.mode === "edit-team") {
      setName(next.team.name);
      setParentId(next.team.department_id ?? "");
      setManagerId(next.team.manager_id ?? "");
    } else {
      setName("");
      setParentId("");
      setManagerId("");
    }
  };

  const close = () => {
    setTarget(null);
    setMessage(null);
  };

  const submit = () => {
    if (!target) return;
    setMessage(null);
    startTransition(async () => {
      const result =
        target.mode === "create-department"
          ? await createDepartment({ name, parentId: parentId || null })
          : target.mode === "edit-department"
            ? await updateDepartment(target.department.id, {
                name,
                parentId: parentId || null,
                managerId: managerId || null,
              })
            : target.mode === "create-team"
              ? await createTeam({ name, departmentId: parentId || null })
              : await updateTeam(target.team.id, {
                  name,
                  departmentId: parentId || null,
                  managerId: managerId || null,
                });

      if (result.ok) {
        close();
        router.refresh();
        return;
      }
      setMessage(result.message ?? "처리에 실패했습니다.");
    });
  };

  const remove = (kind: "department" | "team", id: string, label: string) => {
    if (
      !window.confirm(
        `"${label}"을(를) 삭제하시겠습니까? 소속 인원이 있으면 삭제되지 않습니다.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result =
        kind === "department"
          ? await deleteDepartment(id)
          : await deleteTeam(id);
      if (!result.ok) {
        window.alert(result.message ?? "삭제하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  const isDepartmentForm =
    target?.mode === "create-department" || target?.mode === "edit-department";
  const isEdit =
    target?.mode === "edit-department" || target?.mode === "edit-team";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="small" onClick={() => open({ mode: "create-department" })}>
          <Plus className="size-3.5" />
          부서 추가
        </Button>
        <Button
          size="small"
          variant="secondary"
          onClick={() => open({ mode: "create-team" })}
        >
          <Plus className="size-3.5" />팀 추가
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-label font-bold text-muted">
            <Building2 className="size-3.5" aria-hidden />
            부서 {departments.length}개
          </h3>
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {departments.length === 0 ? (
              <li className="px-3 py-6 text-center text-caption">
                등록된 부서가 없습니다.
              </li>
            ) : (
              departments.map((department) => (
                <li
                  key={department.id}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-body text-ink">
                    {department.name}
                    {department.parent_id ? (
                      <span className="ml-1.5 text-caption">
                        ↳{" "}
                        {departments.find((d) => d.id === department.parent_id)
                          ?.name ?? "-"}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <IconButton
                      label="수정"
                      onClick={() => open({ mode: "edit-department", department })}
                    >
                      <Pencil className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label="삭제"
                      danger
                      onClick={() =>
                        remove("department", department.id, department.name)
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-label font-bold text-muted">
            <Users className="size-3.5" aria-hidden />팀 {teams.length}개
          </h3>
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {teams.length === 0 ? (
              <li className="px-3 py-6 text-center text-caption">
                등록된 팀이 없습니다.
              </li>
            ) : (
              teams.map((team) => (
                <li
                  key={team.id}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-body text-ink">
                    {team.name}
                    <span className="ml-1.5 text-caption">
                      {departments.find((d) => d.id === team.department_id)
                        ?.name ?? "부서 미지정"}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <IconButton
                      label="수정"
                      onClick={() => open({ mode: "edit-team", team })}
                    >
                      <Pencil className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label="삭제"
                      danger
                      onClick={() => remove("team", team.id, team.name)}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      <Modal
        open={!!target}
        onClose={close}
        title={
          target?.mode === "create-department"
            ? "부서 추가"
            : target?.mode === "edit-department"
              ? "부서 수정"
              : target?.mode === "create-team"
                ? "팀 추가"
                : "팀 수정"
        }
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={pending}>
              취소
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="이름" required htmlFor="org-name">
            <Input
              id="org-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={pending}
              placeholder={isDepartmentForm ? "경영지원본부" : "인사팀"}
            />
          </Field>

          <Field
            label={isDepartmentForm ? "상위 부서" : "소속 부서"}
            htmlFor="org-parent"
          >
            <Select
              id="org-parent"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
              disabled={pending}
            >
              <option value="">
                {isDepartmentForm ? "최상위" : "선택 안 함"}
              </option>
              {departments
                .filter((d) =>
                  target?.mode === "edit-department"
                    ? d.id !== target.department.id
                    : true,
                )
                .map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
            </Select>
          </Field>

          {isEdit ? (
            <Field label="담당 매니저" htmlFor="org-manager">
              <Select
                id="org-manager"
                value={managerId}
                onChange={(event) => setManagerId(event.target.value)}
                disabled={pending}
              >
                <option value="">지정 안 함</option>
                {managerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {message ? (
            <p className="text-label text-danger">{message}</p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}

function IconButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        danger
          ? "rounded-sm p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
          : "rounded-sm p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink"
      }
    >
      {children}
    </button>
  );
}
