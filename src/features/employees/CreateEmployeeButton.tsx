"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  EmployeeFields,
  type EmployeeFormValues,
  type OrgOption,
} from "@/features/employees/EmployeeFields";
import { createEmployee } from "@/server/actions/employees";
import { todayInSeoul } from "@/lib/utils";

const emptyValues = (): EmployeeFormValues => ({
  name: "",
  email: "",
  department_id: "",
  team_id: "",
  position: "",
  hire_date: todayInSeoul(),
  role: "employee",
});

/** 임직원 추가 버튼 + 등록 모달 (스펙 3.4) */
export function CreateEmployeeButton({
  departments,
  teams,
}: {
  departments: OrgOption[];
  teams: OrgOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<EmployeeFormValues>(emptyValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = () => {
    setOpen(false);
    setValues(emptyValues());
    setErrors({});
    setMessage(null);
  };

  const submit = () => {
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await createEmployee(values);
      if (result.ok) {
        close();
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message ?? null);
    });
  };

  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" />
        임직원 추가
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="임직원 추가"
        description="등록하면 해당 회사 Google 계정으로 바로 로그인할 수 있습니다."
        size="lg"
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
        <EmployeeFields
          values={values}
          onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
          errors={errors}
          departments={departments}
          teams={teams}
          disabled={pending}
        />
        {message ? (
          <p className="mt-3 text-label text-danger">{message}</p>
        ) : null}
      </Modal>
    </>
  );
}
