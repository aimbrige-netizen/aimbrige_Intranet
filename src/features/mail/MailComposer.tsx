"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Save, Send, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormRow, Input, Textarea } from "@/components/ui/Field";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  registerMailAttachment,
  removeMailAttachment,
  saveMailDraft,
  sendMail,
} from "@/server/actions/mail";
import { formatMailSize } from "@/features/mail/MailList";
import type { MailAttachment } from "@/types/db";

/**
 * 메일쓰기 (daou-survey/12-mail.md 쓰기 실측 — 전체 화면 라우트).
 *
 * 필드: 받는사람 / 참조(임직원 멀티셀렉트) / 제목 / 첨부 / 본문.
 * 예약 발송은 1차 제외(구현 결정). 항목이 많은 폼이라 결재(ApprovalForm)와
 * 같은 라벨-옆-인풋 표 문법(ab-form-grid)을 쓴다.
 *
 * ── 첨부 흐름 (게시판 첨부 문법 재사용 — mail 전용 버킷) ──────────────
 * 스토리지 경로 규칙 `<auth uid>/<메일 id>/<시각>-<파일명>`에 메일 id가
 * 필요해서, 첨부가 있으면 **먼저 임시저장으로 id를 만든 뒤** 올린다.
 * 업로드 → registerMailAttachment(서버가 실제 객체 크기로 quota 검사) →
 * 실패 시 방금 올린 파일을 바로 치운다(PostAttachmentField와 같은 순서).
 * 발송은 그 draft를 send_mail()이 같은 id로 승격하므로 첨부가 따라간다.
 */

export interface MailRecipientOption {
  id: string;
  name: string;
  email: string;
  position: string | null;
  /** "부서 · 팀" 라벨 — 페이지가 조직도 데이터로 만들어 넘긴다 */
  group?: string | null;
}

export interface MailComposeInitial {
  /** 임시보관을 이어 쓰는 경우의 문서 id */
  draftId?: string;
  /** employees.id 배열 — 옵션에 없는 id(퇴사자 등)는 조용히 떨군다 */
  to?: string[];
  cc?: string[];
  subject?: string;
  body?: string;
  /** 임시보관에 이미 등록된 첨부 — 목록·삭제만 여기서 다룬다 */
  attachments?: MailAttachment[];
}

/** 마이그레이션 28 버킷 제약과 같은 값 — 서버에서 거절당하기 전에 안내한다 */
const MAIL_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const MAIL_ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/zip",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/x-hwp",
  "application/haansofthwp",
  "application/vnd.hancom.hwp",
];
const ACCEPT = MAIL_ATTACHMENT_MIME_TYPES.join(",");

export function MailComposer({
  options,
  initial,
  authUserId,
}: {
  options: MailRecipientOption[];
  initial?: MailComposeInitial;
  /** 스토리지 경로 1세그먼트 — 세션 임직원의 auth uid (compose 페이지가 넘긴다) */
  authUserId: string | null;
}) {
  const router = useRouter();
  const byId = useMemo(
    () => new Map(options.map((o) => [o.id, o])),
    [options],
  );

  const [to, setTo] = useState<MailRecipientOption[]>(() =>
    (initial?.to ?? [])
      .map((id) => byId.get(id))
      .filter((o): o is MailRecipientOption => !!o),
  );
  const [cc, setCc] = useState<MailRecipientOption[]>(() =>
    (initial?.cc ?? [])
      .map((id) => byId.get(id))
      .filter((o): o is MailRecipientOption => !!o),
  );
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  /** 이어 쓰는 임시보관 id. 첨부가 처음 등록될 때도 여기로 승격된다 */
  const [draftId, setDraftId] = useState<string | null>(
    initial?.draftId ?? null,
  );
  /** 이미 스토리지에 올라가 등록까지 끝난 첨부 */
  const [saved, setSaved] = useState<MailAttachment[]>(
    initial?.attachments ?? [],
  );
  /** 아직 안 올라간 대기 파일 — 보내기/임시저장 때 올린다 */
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  /** 받는사람↔참조 중복 선택 방지용 — 두 필드가 서로의 선택을 제외한다 */
  const chosen = useMemo(
    () => new Set([...to, ...cc].map((o) => o.id)),
    [to, cc],
  );

  const draftInput = (finalSubject = subject) => ({
    draftId,
    subject: finalSubject,
    body,
    to: to.map((o) => o.id),
    cc: cc.map((o) => o.id),
  });

  /**
   * 대기 파일 업로드. 임시저장 id가 이미 있어야 한다(경로 규칙).
   * 성공한 파일은 대기열에서 빠지고 saved로 옮겨진다. 첫 실패에서 멈추고
   * 실패 문장을 돌려준다 — 남은 파일은 대기열에 남아 다시 시도할 수 있다.
   */
  const uploadQueued = async (messageId: string): Promise<string | null> => {
    if (files.length === 0) return null;
    if (!authUserId) return "세션 정보를 확인할 수 없습니다. 다시 로그인해 주세요.";

    const supabase = createClient();
    const remaining = [...files];

    for (const file of [...remaining]) {
      // 같은 이름을 다시 올려도 덮어쓰지 않도록 시각을 접두사로 붙인다
      const safeName = file.name.replace(/[^\w.\-가-힣 ]/g, "_");
      const path = `${authUserId}/${messageId}/${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("mail-attachments")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        setFiles(remaining);
        return `${file.name}: 업로드 실패 — ${uploadError.message}`;
      }

      const registered = await registerMailAttachment(
        messageId,
        path,
        file.name,
      );
      if (!registered.ok || !registered.attachment) {
        // 등록에 실패한 파일은 아무 데서도 참조되지 않는다 — 바로 치운다
        await supabase.storage.from("mail-attachments").remove([path]);
        setFiles(remaining);
        return `${file.name}: ${registered.message ?? "첨부 등록에 실패했습니다."}`;
      }

      remaining.splice(remaining.indexOf(file), 1);
      const attachment = registered.attachment;
      setSaved((prev) => [...prev, attachment]);
    }

    setFiles(remaining);
    return null;
  };

  const send = () => {
    setErrors({});
    setMessage(null);
    setNotice(null);
    if (to.length === 0) {
      setErrors({ to: "받는사람을 한 명 이상 선택하세요." });
      return;
    }
    /*
     * 서버(send_mail RPC·zod)는 제목을 강제한다 — 다우처럼 확인만 받고
     * 빈 제목으로 보내는 대신, 확인 후 "(제목 없음)"으로 채워 보낸다.
     */
    let finalSubject = subject.trim();
    if (!finalSubject) {
      if (!window.confirm("제목 없이 보낼까요?")) return;
      finalSubject = "(제목 없음)";
    }

    startTransition(async () => {
      let messageId = draftId;

      // 첨부 경로에 메일 id가 필요하다 — 대기 파일이 있으면 먼저 임시저장
      if (files.length > 0 && !messageId) {
        const created = await saveMailDraft(draftInput(finalSubject));
        if (!created.ok || !created.draftId) {
          setMessage(created.message ?? "임시저장에 실패해 발송을 멈췄습니다.");
          if (created.fieldErrors) setErrors(created.fieldErrors);
          return;
        }
        messageId = created.draftId;
        setDraftId(messageId);
      }

      if (messageId && files.length > 0) {
        const uploadFailure = await uploadQueued(messageId);
        if (uploadFailure) {
          setMessage(`${uploadFailure} — 메일은 임시보관함에 남아 있습니다.`);
          return;
        }
      }

      const result = await sendMail({
        subject: finalSubject,
        body,
        to: to.map((o) => o.id),
        cc: cc.map((o) => o.id),
        draftId: messageId,
      });
      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        setMessage(result.message ?? "발송에 실패했습니다.");
        return;
      }

      router.push("/mail?box=sent");
      router.refresh();
    });
  };

  const saveDraft = () => {
    setErrors({});
    setMessage(null);
    setNotice(null);
    // 임시저장은 검증하지 않는다 — 반쯤 쓴 메일을 저장 못 하면 기능이 성립 안 한다
    startTransition(async () => {
      const result = await saveMailDraft(draftInput());
      if (!result.ok || !result.draftId) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        setMessage(result.message ?? "임시저장에 실패했습니다.");
        return;
      }
      setDraftId(result.draftId);

      const uploadFailure = await uploadQueued(result.draftId);
      if (uploadFailure) {
        setMessage(uploadFailure);
        return;
      }

      setNotice("임시보관함에 저장되었습니다. 이어서 편집할 수 있습니다.");
      router.refresh();
    });
  };

  /** 이미 등록된 첨부 삭제 — 메타 행과 스토리지 파일을 액션이 함께 정리한다 */
  const removeSaved = (attachment: MailAttachment) => {
    startTransition(async () => {
      const result = await removeMailAttachment(
        attachment.id,
        attachment.message_id,
      );
      if (!result.ok) {
        setMessage(result.message ?? "첨부를 삭제하지 못했습니다.");
        return;
      }
      setSaved((prev) => prev.filter((item) => item.id !== attachment.id));
    });
  };

  const addFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    const rejected = picked.find(
      (file) =>
        !MAIL_ATTACHMENT_MIME_TYPES.includes(file.type) ||
        file.size > MAIL_ATTACHMENT_MAX_BYTES,
    );
    if (rejected) {
      setMessage(
        `${rejected.name}: 허용된 형식(이미지·문서·압축)과 10MB 이하만 첨부할 수 있습니다.`,
      );
    }
    const accepted = picked.filter(
      (file) =>
        MAIL_ATTACHMENT_MIME_TYPES.includes(file.type) &&
        file.size <= MAIL_ATTACHMENT_MAX_BYTES,
    );
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
    // 같은 파일을 지웠다 다시 붙일 수 있게 입력값은 비운다
    e.target.value = "";
  };

  return (
    <div>
      {/* 상단 버튼 — 실측: 보내기 h-32 · radius 8 · primary. 예약은 1차 제외 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          size="small"
          onClick={send}
          disabled={pending}
          className="rounded-sm"
        >
          <Send className="size-3.5" aria-hidden />
          {pending ? "처리 중…" : "보내기"}
        </Button>
        <Button
          size="small"
          variant="secondary"
          onClick={saveDraft}
          disabled={pending}
          className="rounded-sm"
        >
          <Save className="size-3.5" aria-hidden />
          임시저장
        </Button>
        {message ? (
          <span className="text-label text-danger">{message}</span>
        ) : notice ? (
          <span className="text-label text-success-ink">{notice}</span>
        ) : null}
      </div>

      <div className="ab-form-grid">
        <FormRow label="받는사람" required htmlFor="mail-to" error={errors.to}>
          <RecipientField
            id="mail-to"
            placeholder="이름·이메일로 임직원 검색"
            selected={to}
            excluded={chosen}
            options={options}
            onAdd={(o) => setTo((prev) => [...prev, o])}
            onRemove={(id) => setTo((prev) => prev.filter((o) => o.id !== id))}
          />
        </FormRow>

        <FormRow label="참조" htmlFor="mail-cc" error={errors.cc}>
          <RecipientField
            id="mail-cc"
            placeholder="참조로 받을 임직원"
            selected={cc}
            excluded={chosen}
            options={options}
            onAdd={(o) => setCc((prev) => [...prev, o])}
            onRemove={(id) => setCc((prev) => prev.filter((o) => o.id !== id))}
          />
        </FormRow>

        <FormRow label="제목" htmlFor="mail-subject" error={errors.subject}>
          <Input
            id="mail-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="제목"
          />
        </FormRow>

        <FormRow
          label="첨부"
          hint="이미지·문서·압축, 건당 10MB. 보내기/임시저장 때 함께 올라갑니다."
        >
          <div className="space-y-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT}
              onChange={addFiles}
              className="sr-only"
              aria-label="첨부 파일 선택"
            />
            <Button
              size="small"
              variant="secondary"
              onClick={() => fileRef.current?.click()}
              disabled={pending}
            >
              <Paperclip className="size-3.5" aria-hidden />
              파일 첨부
            </Button>
            {saved.length > 0 || files.length > 0 ? (
              <ul className="space-y-1.5">
                {saved.map((attachment) => (
                  <AttachmentItem
                    key={attachment.id}
                    name={attachment.name}
                    sizeBytes={attachment.size}
                    disabled={pending}
                    onRemove={() => removeSaved(attachment)}
                  />
                ))}
                {files.map((file, index) => (
                  <AttachmentItem
                    key={`${file.name}-${index}`}
                    name={file.name}
                    sizeBytes={file.size}
                    queued
                    disabled={pending}
                    onRemove={() =>
                      setFiles((prev) => prev.filter((_, i) => i !== index))
                    }
                  />
                ))}
              </ul>
            ) : null}
          </div>
        </FormRow>

        <FormRow label="본문" htmlFor="mail-body" error={errors.body}>
          <Textarea
            id="mail-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="내용을 입력하세요"
            className="min-h-96"
          />
        </FormRow>
      </div>
    </div>
  );
}

/** 첨부 행 — 등록된 것과 대기 중인 것을 한 목록에 그린다 */
function AttachmentItem({
  name,
  sizeBytes,
  queued,
  disabled,
  onRemove,
}: {
  name: string;
  sizeBytes: number;
  queued?: boolean;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex max-w-md items-center justify-between gap-3 rounded-card border border-line px-3 py-2">
      <span className="min-w-0 truncate text-body-sm text-ink">{name}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {queued ? (
          <span className="text-micro text-muted">대기</span>
        ) : null}
        <span className="text-micro tabular-nums text-muted">
          {formatMailSize(sizeBytes)}
        </span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`${name} 제거`}
          className="grid size-5 place-items-center rounded-sm text-muted transition-colors duration-fast ease-standard hover:bg-line hover:text-ink disabled:opacity-50"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </span>
    </li>
  );
}

/**
 * 임직원 멀티셀렉트 — 조직도 데이터 기반 자동완성.
 *
 * 별도 프리미티브가 없어 인풋 문법(Field CONTROL_BASE 축)을 그대로 입고
 * 칩 + 드롭다운만 얹는다. 키보드: Enter = 첫 후보 선택, 빈 입력에서
 * Backspace = 마지막 칩 제거, Escape = 후보 닫기.
 */
function RecipientField({
  id,
  placeholder,
  selected,
  excluded,
  options,
  onAdd,
  onRemove,
}: {
  id: string;
  placeholder: string;
  selected: MailRecipientOption[];
  /** 양쪽 필드(받는사람·참조)에 이미 선택된 id — 후보에서 제외 */
  excluded: Set<string>;
  options: MailRecipientOption[];
  onAdd: (option: MailRecipientOption) => void;
  onRemove: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = options.filter((o) => !excluded.has(o.id));
    const hit = q
      ? pool.filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            o.email.toLowerCase().includes(q) ||
            (o.position ?? "").toLowerCase().includes(q) ||
            (o.group ?? "").toLowerCase().includes(q),
        )
      : pool;
    return hit.slice(0, 8);
  }, [query, options, excluded]);

  const pick = (option: MailRecipientOption) => {
    onAdd(option);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && matches.length > 0) pick(matches[0]);
    } else if (e.key === "Backspace" && query === "" && selected.length > 0) {
      onRemove(selected[selected.length - 1].id);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <div
        className={cn(
          "flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-card border border-line-strong bg-surface px-2.5 py-1.5",
          "transition-colors duration-fast ease-standard focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
        )}
      >
        {selected.map((option) => (
          <span
            key={option.id}
            className="inline-flex h-7 items-center gap-0.5 rounded-sm bg-subtle pl-2 pr-0.5 text-label text-ink"
          >
            {option.name}
            {option.position ? (
              <span className="text-muted">&nbsp;{option.position}</span>
            ) : null}
            <button
              type="button"
              onClick={() => onRemove(option.id)}
              aria-label={`${option.name} 제외`}
              className="grid size-5 place-items-center rounded-sm text-muted transition-colors duration-fast ease-standard hover:bg-line hover:text-ink"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={selected.length === 0 ? placeholder : undefined}
          autoComplete="off"
          className="h-7 min-w-32 flex-1 bg-transparent text-body-sm text-ink outline-none placeholder:text-muted"
        />
      </div>

      {open && matches.length > 0 ? (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-line bg-surface py-1 shadow-pop">
          {matches.map((option) => (
            <li key={option.id}>
              {/*
                onMouseDown + preventDefault — click을 기다리면 input blur가
                먼저 닿아 드롭다운이 닫힌 채로 클릭이 허공에 떨어진다.
              */}
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(option);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-fast ease-standard hover:bg-subtle"
              >
                <span className="shrink-0 text-body-sm text-ink">
                  {option.name}
                  {option.position ? (
                    <span className="text-muted"> {option.position}</span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-right text-micro text-muted">
                  {[option.group, option.email].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
