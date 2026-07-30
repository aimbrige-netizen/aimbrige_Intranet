"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  EmployeeFields,
  type EmployeeFormValues,
  type OrgOption,
} from "@/features/employees/EmployeeFields";
import { updateEmployee } from "@/server/actions/employees";
import type { EmploymentStatus } from "@/types/db";

/** 임직원 상세/수정 폼 (스펙 3.4) */
export function EmployeeEditForm({
  employeeId,
  initialValues,
  departments,
  teams,
  lockRole,
}: {
  employeeId: string;
  initialValues: EmployeeFormValues;
  departments: OrgOption[];
  teams: OrgOption[];
  lockRole: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<EmployeeFormValues>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmTermination, setConfirmTermination] = useState(false);
  const [pending, startTransition] = useTransition();

  const initialStatus: EmploymentStatus =
    initialValues.employment_status ?? "active";
  const nextStatus: EmploymentStatus = values.employment_status ?? "active";
  const isTerminating =
    nextStatus === "terminated" && initialStatus !== "terminated";

  const persist = () => {
    setErrors({});
    setMessage(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateEmployee(employeeId, values);
      setConfirmTermination(false);
      if (result.ok) {
        setSaved(true);
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message ?? null);
    });
  };

  const submit = () => {
    // 퇴사 처리는 접근 권한이 즉시 회수되므로 확인 모달을 띄운다 (스펙 3.4)
    if (isTerminating) {
      setConfirmTermination(true);
      return;
    }
    persist();
  };

  return (
    <>
      <EmployeeFields
        values={values}
        onChange={(patch) => {
          setValues((prev) => ({ ...prev, ...patch }));
          setSaved(false);
        }}
        errors={errors}
        departments={departments}
        teams={teams}
        showStatus
        lockRole={lockRole}
        disabled={pending}
      />

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {saved ? (
          <p className="mr-auto text-label text-success">저장했습니다.</p>
        ) : null}
        {message ? (
          <p className="mr-auto text-label text-danger">{message}</p>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => {
            setValues(initialValues);
            setErrors({});
            setMessage(null);
            setSaved(false);
          }}
          disabled={pending}
        >
          되돌리기
        </Button>
        <Button
          onClick={submit}
          disabled={pending}
          variant={isTerminating ? "danger" : "primary"}
        >
          {pending ? "저장 중…" : isTerminating ? "퇴사 처리 저장" : "저장"}
        </Button>
      </div>

      <Modal
        open={confirmTermination}
        onClose={() => setConfirmTermination(false)}
        title="퇴사 처리하시겠습니까?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmTermination(false)}
              disabled={pending}
            >
              취소
            </Button>
            <Button variant="danger" onClick={persist} disabled={pending}>
              {pending ? "처리 중…" : "확인"}
            </Button>
          </>
        }
      >
        <div className="flex gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div className="space-y-2 text-body">
            <p>저장하면 접근 권한이 즉시 회수됩니다. 계속하시겠습니까?</p>
            <p className="text-caption">
              로그인 세션이 끊기고 Google 계정으로도 다시 접근할 수 없습니다.
              재직중으로 되돌리면 접근이 복구됩니다.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}
