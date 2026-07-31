"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Contact, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Textarea, Select } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  createExternalContact,
  deleteExternalContact,
  updateExternalContact,
} from "@/server/actions/contacts";
import type {
  ContactCategory,
  ExternalContactWithCreator,
} from "@/types/db";

const CATEGORY_LABELS: Record<ContactCategory, string> = {
  vendor: "벤더",
  client: "거래처",
  partner: "파트너",
};

interface FormValues {
  name: string;
  company: string;
  role: string;
  phone: string;
  email: string;
  category: string;
  memo: string;
}

const emptyForm = (): FormValues => ({
  name: "",
  company: "",
  role: "",
  phone: "",
  email: "",
  category: "",
  memo: "",
});

/**
 * 외부 연락처 탭 (스펙 02 · 3.3)
 * 전체 임직원이 조회·등록 가능, 수정·삭제는 등록자 본인 또는 시스템 관리자만.
 */
export function ExternalContacts({
  contacts,
  currentEmployeeId,
  isSystemAdmin,
}: {
  contacts: ExternalContactWithCreator[];
  currentEmployeeId: string;
  isSystemAdmin: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ExternalContactWithCreator | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canModify = (contact: ExternalContactWithCreator) =>
    isSystemAdmin || contact.created_by === currentEmployeeId;

  const openCreate = () => {
    setValues(emptyForm());
    setErrors({});
    setMessage(null);
    setCreating(true);
  };

  const openEdit = (contact: ExternalContactWithCreator) => {
    setValues({
      name: contact.name,
      company: contact.company ?? "",
      role: contact.role ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      category: contact.category ?? "",
      memo: contact.memo ?? "",
    });
    setErrors({});
    setMessage(null);
    setEditing(contact);
  };

  const close = () => {
    setCreating(false);
    setEditing(null);
    setErrors({});
    setMessage(null);
  };

  const submit = () => {
    setErrors({});
    setMessage(null);
    const payload = {
      ...values,
      category: values.category === "" ? null : values.category,
    };

    startTransition(async () => {
      const result = editing
        ? await updateExternalContact(editing.id, payload)
        : await createExternalContact(payload);

      if (result.ok) {
        close();
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message ?? null);
    });
  };

  const remove = (contact: ExternalContactWithCreator) => {
    if (!window.confirm(`"${contact.name}" 연락처를 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      const result = await deleteExternalContact(contact.id);
      if (!result.ok) {
        window.alert(result.message ?? "삭제하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-caption">
          벤더·거래처 등 외부 비즈니스 연락처 {contacts.length}건
        </p>
        <Button size="small" onClick={openCreate}>
          <Plus className="size-3.5" />
          연락처 추가
        </Button>
      </div>

      {contacts.length === 0 ? (
        <EmptyState
          icon={Contact}
          title="등록된 외부 연락처가 없습니다"
          description="벤더·거래처·파트너 연락처를 등록해 함께 관리하세요."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="ab-table min-w-[860px]">
            <thead>
              <tr>
                <th>이름</th>
                <th>소속 회사</th>
                <th>직책</th>
                <th>전화번호</th>
                <th>이메일</th>
                <th>카테고리</th>
                <th>메모</th>
                <th className="w-24">관리</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td className="font-bold text-ink">{contact.name}</td>
                  <td>{contact.company ?? "-"}</td>
                  <td>{contact.role ?? "-"}</td>
                  <td className="text-muted">{contact.phone ?? "-"}</td>
                  <td className="text-muted">{contact.email ?? "-"}</td>
                  <td>
                    {contact.category ? (
                      <Badge tone="primary">
                        {CATEGORY_LABELS[contact.category]}
                      </Badge>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="max-w-56 truncate text-muted" title={contact.memo ?? ""}>
                    {contact.memo ?? "-"}
                  </td>
                  <td>
                    {canModify(contact) ? (
                      <span className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(contact)}
                          aria-label={`${contact.name} 수정`}
                          className="rounded-sm p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(contact)}
                          aria-label={`${contact.name} 삭제`}
                          className="rounded-sm p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    ) : (
                      <span className="text-caption">
                        {contact.creator?.name ?? "-"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={creating || !!editing}
        onClose={close}
        title={editing ? "연락처 수정" : "연락처 추가"}
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="이름" required htmlFor="c-name" error={errors.name}>
            <Input
              id="c-name"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              invalid={!!errors.name}
              disabled={pending}
            />
          </Field>
          <Field label="소속 회사" htmlFor="c-company">
            <Input
              id="c-company"
              value={values.company}
              onChange={(e) =>
                setValues((v) => ({ ...v, company: e.target.value }))
              }
              disabled={pending}
            />
          </Field>
          <Field label="담당 직책" htmlFor="c-role">
            <Input
              id="c-role"
              value={values.role}
              onChange={(e) => setValues((v) => ({ ...v, role: e.target.value }))}
              disabled={pending}
            />
          </Field>
          <Field label="카테고리" htmlFor="c-category">
            <Select
              id="c-category"
              value={values.category}
              onChange={(e) =>
                setValues((v) => ({ ...v, category: e.target.value }))
              }
              disabled={pending}
            >
              <option value="">선택 안 함</option>
              <option value="vendor">벤더</option>
              <option value="client">거래처</option>
              <option value="partner">파트너</option>
            </Select>
          </Field>
          <Field label="전화번호" htmlFor="c-phone">
            <Input
              id="c-phone"
              value={values.phone}
              onChange={(e) =>
                setValues((v) => ({ ...v, phone: e.target.value }))
              }
              disabled={pending}
            />
          </Field>
          <Field label="이메일" htmlFor="c-email">
            <Input
              id="c-email"
              type="email"
              value={values.email}
              onChange={(e) =>
                setValues((v) => ({ ...v, email: e.target.value }))
              }
              disabled={pending}
            />
          </Field>
          <Field label="메모" htmlFor="c-memo" className="md:col-span-2">
            <Textarea
              id="c-memo"
              value={values.memo}
              onChange={(e) => setValues((v) => ({ ...v, memo: e.target.value }))}
              disabled={pending}
            />
          </Field>
        </div>
        {message ? (
          <p className="mt-3 text-label text-danger">{message}</p>
        ) : null}
      </Modal>
    </div>
  );
}
