"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Building,
  Contact,
  Download,
  Handshake,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import {
  OptionCardGrid,
  type OptionCardItem,
} from "@/components/ui/OptionCardGrid";
import { TableToolbar, ToolbarSearch } from "@/components/ui/TableToolbar";
import {
  createExternalContact,
  deleteExternalContact,
  updateExternalContact,
} from "@/server/actions/contacts";
import { downloadCsv } from "@/lib/csv";
import { formatDate } from "@/lib/utils";
import type { ContactCategory, ExternalContactWithCreator } from "@/types/db";

const CATEGORY_LABELS: Record<ContactCategory, string> = {
  vendor: "벤더",
  client: "거래처",
  partner: "파트너",
};

const CATEGORY_META: Record<
  ContactCategory,
  { icon: typeof Briefcase; description: string }
> = {
  vendor: { icon: Briefcase, description: "물품·용역을 공급받는 업체" },
  client: { icon: Building, description: "우리가 납품·서비스하는 고객사" },
  partner: { icon: Handshake, description: "공동 사업·제휴 관계" },
};

type CategoryFilter = "all" | ContactCategory | "none";

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
 * 외부 연락처 (스펙 02 · 3.3)
 * 전체 임직원이 조회·등록 가능, 수정·삭제는 등록자 본인 또는 시스템 관리자만.
 *
 * 카테고리가 닫힌 드롭다운이라 어떤 분류가 있고 각각 몇 건인지 보이지 않았다.
 * 선택 카드로 바꿔 건수·최근 등록일을 열어 둔다.
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
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [pending, startTransition] = useTransition();

  const canModify = (contact: ExternalContactWithCreator) =>
    isSystemAdmin || contact.created_by === currentEmployeeId;

  const stats = useMemo(() => {
    const byCategory = new Map<string, { count: number; latest: string | null }>();
    contacts.forEach((contact) => {
      const key = contact.category ?? "none";
      const current = byCategory.get(key) ?? { count: 0, latest: null };
      current.count += 1;
      if (!current.latest || contact.created_at > current.latest) {
        current.latest = contact.created_at;
      }
      byCategory.set(key, current);
    });
    const latestAll = contacts.reduce<string | null>(
      (max, c) => (!max || c.created_at > max ? c.created_at : max),
      null,
    );
    byCategory.set("all", { count: contacts.length, latest: latestAll });
    return byCategory;
  }, [contacts]);

  /** 카드 하단 메타 — 건수와 최근 등록일을 닫아 두지 않는다 */
  const metaOf = (key: CategoryFilter) => {
    const entry = stats.get(key);
    return [
      `${entry?.count ?? 0}건`,
      entry?.latest ? `최근 ${formatDate(entry.latest)}` : "등록 없음",
    ];
  };

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (category !== "all") {
        const key = contact.category ?? "none";
        if (key !== category) return false;
      }
      if (!q) return true;
      return [contact.name, contact.company, contact.role, contact.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [contacts, category, keyword]);

  /** 화면에 보이는 그대로(현재 분류·검색어)를 내려받는다 */
  const exportCsv = () =>
    downloadCsv(
      "외부연락처",
      [
        "이름",
        "소속 회사",
        "직책",
        "분류",
        "전화번호",
        "이메일",
        "메모",
        "등록자",
        "등록일",
      ],
      filtered.map((contact) => [
        contact.name,
        contact.company ?? "",
        contact.role ?? "",
        contact.category ? CATEGORY_LABELS[contact.category] : "미분류",
        contact.phone ?? "",
        contact.email ?? "",
        contact.memo ?? "",
        contact.creator?.name ?? "",
        formatDate(contact.created_at),
      ]),
    );

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

  const filterOptions: OptionCardItem<CategoryFilter>[] = [
    {
      value: "all",
      title: "전체",
      description: "등록된 모든 외부 연락처",
      icon: Contact,
      meta: metaOf("all"),
    },
    ...(Object.keys(CATEGORY_LABELS) as ContactCategory[]).map((key) => ({
      value: key,
      title: CATEGORY_LABELS[key],
      description: CATEGORY_META[key].description,
      icon: CATEGORY_META[key].icon,
      meta: metaOf(key),
    })),
  ];

  if ((stats.get("none")?.count ?? 0) > 0) {
    filterOptions.push({
      value: "none",
      title: "미분류",
      description: "분류가 지정되지 않은 연락처",
      icon: Contact,
      meta: metaOf("none"),
    });
  }

  return (
    <div className="space-y-5">
      <OptionCardGrid
        columns={4}
        name="연락처 분류"
        value={category}
        onChange={setCategory}
        options={filterOptions}
      />

      <div>
        <TableToolbar
          search={
            <ToolbarSearch
              value={keyword}
              onChange={setKeyword}
              placeholder="이름·회사·이메일 검색"
              ariaLabel="외부 연락처 검색"
            />
          }
          count={`${filtered.length}건 / 전체 ${contacts.length}건`}
          actions={
            <>
              <Button
                size="small"
                variant="secondary"
                disabled={filtered.length === 0}
                title={`현재 필터에 걸린 ${filtered.length}건을 CSV로 내려받습니다`}
                onClick={exportCsv}
              >
                <Download className="size-3.5" aria-hidden />
                내보내기
                {filtered.length > 0 ? (
                  <span className="tabular-nums opacity-70">
                    {filtered.length}
                  </span>
                ) : null}
              </Button>
              <Button size="small" onClick={openCreate}>
                <Plus className="size-3.5" aria-hidden />
                연락처 추가
              </Button>
            </>
          }
        />

        <div className="ab-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="ab-table ab-table--compact min-w-[860px]">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>소속 회사</th>
                  <th>직책</th>
                  <th>분류</th>
                  <th>전화번호</th>
                  <th>이메일</th>
                  <th>메모</th>
                  <th>등록</th>
                  <th className="w-20">관리</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <TableEmptyRow
                    colSpan={9}
                    icon={Contact}
                    title={
                      contacts.length === 0
                        ? "등록된 외부 연락처가 없습니다"
                        : "이 조건에 맞는 연락처가 없습니다"
                    }
                    description="벤더·거래처·파트너 연락처를 등록하면 전 직원이 함께 볼 수 있습니다."
                    action={
                      <Button size="small" onClick={openCreate}>
                        연락처 추가
                      </Button>
                    }
                  />
                ) : (
                  filtered.map((contact) => (
                    <tr key={contact.id}>
                      <td className="font-bold text-ink">{contact.name}</td>
                      <td>{contact.company ?? "-"}</td>
                      <td>{contact.role ?? "-"}</td>
                      <td>
                        {contact.category ? (
                          <Badge tone="info">
                            {CATEGORY_LABELS[contact.category]}
                          </Badge>
                        ) : (
                          <span className="text-caption">미분류</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-muted">
                        {contact.phone ?? "-"}
                      </td>
                      <td className="text-muted">{contact.email ?? "-"}</td>
                      <td
                        className="max-w-56 truncate text-muted"
                        title={contact.memo ?? ""}
                      >
                        {contact.memo ?? "-"}
                      </td>
                      <td className="whitespace-nowrap text-caption">
                        {contact.creator?.name ?? "-"}
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
                              className="rounded-sm p-1.5 text-muted transition-colors hover:bg-danger-light hover:text-danger"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </span>
                        ) : (
                          <span className="text-caption">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

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
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="이름" required htmlFor="c-name" error={errors.name}>
              <Input
                id="c-name"
                value={values.name}
                onChange={(e) =>
                  setValues((v) => ({ ...v, name: e.target.value }))
                }
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
                onChange={(e) =>
                  setValues((v) => ({ ...v, role: e.target.value }))
                }
                disabled={pending}
              />
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
          </div>

          <div>
            <p className="mb-1.5 text-label font-bold text-ink">분류</p>
            <OptionCardGrid<ContactCategory>
              columns={3}
              name="연락처 분류 선택"
              value={(values.category || null) as ContactCategory | null}
              onChange={(next) =>
                setValues((v) => ({
                  ...v,
                  // 같은 카드를 다시 누르면 분류 없음으로 되돌린다
                  category: v.category === next ? "" : next,
                }))
              }
              options={(Object.keys(CATEGORY_LABELS) as ContactCategory[]).map(
                (key) => ({
                  value: key,
                  title: CATEGORY_LABELS[key],
                  description: CATEGORY_META[key].description,
                  icon: CATEGORY_META[key].icon,
                  meta: [`${stats.get(key)?.count ?? 0}건 등록됨`],
                }),
              )}
            />
          </div>

          <Field label="메모" htmlFor="c-memo">
            <Textarea
              id="c-memo"
              value={values.memo}
              onChange={(e) =>
                setValues((v) => ({ ...v, memo: e.target.value }))
              }
              disabled={pending}
            />
          </Field>
        </div>

        {message ? <p className="mt-3 text-label text-danger">{message}</p> : null}
      </Modal>
    </div>
  );
}
