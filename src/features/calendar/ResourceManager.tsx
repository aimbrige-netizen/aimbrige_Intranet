"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { createResource, updateResource } from "@/server/actions/calendar";
import type { Resource, ResourceType } from "@/types/db";

const TYPE_LABELS: Record<ResourceType, string> = {
  meeting_room: "회의실",
  vehicle: "차량",
  equipment: "비품",
};

interface FormValues {
  name: string;
  type: ResourceType;
  capacity: string;
  location: string;
  isActive: boolean;
}

const emptyForm = (): FormValues => ({
  name: "",
  type: "meeting_room",
  capacity: "",
  location: "",
  isActive: true,
});

/**
 * 리소스 관리 (스펙 02 · 3.7) — 시스템 관리자 전용
 * 삭제는 지원하지 않는다. 과거 예약 이력을 보존해야 하므로 비활성화로만 처리한다.
 */
export function ResourceManager({ resources }: { resources: Resource[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Resource | null>(null);
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openCreate = () => {
    setValues(emptyForm());
    setErrors({});
    setMessage(null);
    setCreating(true);
  };

  const openEdit = (resource: Resource) => {
    setValues({
      name: resource.name,
      type: resource.type,
      capacity: resource.capacity ? String(resource.capacity) : "",
      location: resource.location ?? "",
      isActive: resource.is_active,
    });
    setErrors({});
    setMessage(null);
    setEditing(resource);
  };

  const close = () => {
    setCreating(false);
    setEditing(null);
  };

  const submit = () => {
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = editing
        ? await updateResource(editing.id, values)
        : await createResource(values);
      if (result.ok) {
        close();
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message ?? null);
    });
  };

  const toggleActive = (resource: Resource) => {
    startTransition(async () => {
      const result = await updateResource(resource.id, {
        name: resource.name,
        type: resource.type,
        capacity: resource.capacity ?? "",
        location: resource.location ?? "",
        isActive: !resource.is_active,
      });
      if (!result.ok) {
        window.alert(result.message ?? "변경하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-caption">
          예약 가능 리소스 {resources.filter((r) => r.is_active).length}개 / 전체{" "}
          {resources.length}개
        </p>
        <Button size="small" onClick={openCreate}>
          <Plus className="size-3.5" />
          리소스 추가
        </Button>
      </div>

      {resources.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="등록된 리소스가 없습니다"
          description="회의실·차량·공용비품을 등록하면 임직원이 캘린더에서 예약할 수 있습니다."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="ab-table min-w-[720px]">
            <thead>
              <tr>
                <th>이름</th>
                <th>종류</th>
                <th>정원·용량</th>
                <th>위치</th>
                <th>상태</th>
                <th className="w-40">관리</th>
              </tr>
            </thead>
            <tbody>
              {resources.map((resource) => (
                <tr key={resource.id}>
                  <td className="font-bold text-ink">{resource.name}</td>
                  <td>{TYPE_LABELS[resource.type]}</td>
                  <td>{resource.capacity ? `${resource.capacity}인` : "-"}</td>
                  <td>{resource.location ?? "-"}</td>
                  <td>
                    <Badge tone={resource.is_active ? "success" : "neutral"}>
                      {resource.is_active ? "활성" : "비활성"}
                    </Badge>
                  </td>
                  <td>
                    <span className="flex gap-1.5">
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() => openEdit(resource)}
                        disabled={pending}
                      >
                        <Pencil className="size-3" />
                        수정
                      </Button>
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={() => toggleActive(resource)}
                        disabled={pending}
                      >
                        {resource.is_active ? "비활성화" : "활성화"}
                      </Button>
                    </span>
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
        title={editing ? "리소스 수정" : "리소스 추가"}
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
          <Field label="이름" required htmlFor="r-name" error={errors.name}>
            <Input
              id="r-name"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              invalid={!!errors.name}
              disabled={pending}
              placeholder="대회의실"
            />
          </Field>

          <Field label="종류" required htmlFor="r-type" error={errors.type}>
            <Select
              id="r-type"
              value={values.type}
              onChange={(e) =>
                setValues((v) => ({ ...v, type: e.target.value as ResourceType }))
              }
              disabled={pending}
              className="md:max-w-52"
            >
              <option value="meeting_room">회의실</option>
              <option value="vehicle">차량</option>
              <option value="equipment">비품</option>
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="정원·용량" htmlFor="r-capacity">
              <Input
                id="r-capacity"
                type="number"
                min={1}
                value={values.capacity}
                onChange={(e) =>
                  setValues((v) => ({ ...v, capacity: e.target.value }))
                }
                disabled={pending}
                placeholder="10"
              />
            </Field>
            <Field label="위치" htmlFor="r-location">
              <Input
                id="r-location"
                value={values.location}
                onChange={(e) =>
                  setValues((v) => ({ ...v, location: e.target.value }))
                }
                disabled={pending}
                placeholder="3층"
              />
            </Field>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-body text-ink">
            <input
              type="checkbox"
              checked={values.isActive}
              onChange={(e) =>
                setValues((v) => ({ ...v, isActive: e.target.checked }))
              }
              disabled={pending}
              className="size-4 accent-primary"
            />
            예약 가능(활성)
          </label>

          {message ? <p className="text-label text-danger">{message}</p> : null}
        </div>
      </Modal>
    </>
  );
}
