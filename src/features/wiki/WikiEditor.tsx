"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Eye, Pencil, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Callout } from "@/components/ui/Callout";
import { Card, CardBody } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Markdown } from "@/features/wiki/Markdown";
import { deleteWikiPage, saveWikiPage } from "@/server/actions/wiki";

export interface ParentOption {
  id: string;
  /** "상위 > 하위" 형태의 경로. 같은 제목이 여러 개일 때 구분된다 */
  path: string;
}

/**
 * 문서 편집 (스펙 14 · 3.3)
 *
 * 편집/미리보기를 탭으로 나눈다. 좌우 분할은 220px 남짓한 폭에서 마크다운
 * 원문과 결과를 둘 다 못 읽게 만든다 — 노트북 화면에서는 특히.
 *
 * 저장 후에는 문서 보기로 보낸다. 편집 화면에 남으면 "저장이 됐나"를
 * 확인하려고 한 번 더 누르게 되고, 그때마다 수정 이력이 한 줄씩 늘어난다.
 */
export function WikiEditor({
  pageId,
  initialTitle,
  initialContent,
  initialParentId,
  parents,
  canDelete,
}: {
  pageId?: string;
  initialTitle: string;
  initialContent: string;
  initialParentId: string | null;
  parents: ParentOption[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [parentId, setParentId] = useState(initialParentId ?? "");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await saveWikiPage({
        pageId,
        title,
        content,
        parentId: parentId || null,
      });
      if (result.ok && result.pageId) {
        router.push(`/wiki/${result.pageId}`);
        router.refresh();
      } else {
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message ?? null);
      }
    });

  /*
   * 확인을 한 번 받는다. 문서를 지우면 그 문서의 수정 이력도 함께 사라지고
   * (revisions는 cascade), 되돌릴 방법이 없다. 코드베이스의 다른 삭제 20곳이
   * 전부 confirm을 거치는데 위키만 즉시 지우면 관례가 갈린다.
   */
  const remove = () => {
    if (
      !pageId ||
      !window.confirm(
        `"${initialTitle}" 문서를 삭제할까요?

수정 이력도 함께 사라지고 되돌릴 수 없습니다.
하위 문서는 최상위로 올라옵니다.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteWikiPage(pageId);
      // 성공하면 서버가 /wiki로 보낸다. 여기 오면 실패한 것이다
      setMessage(result.message ?? "삭제하지 못했습니다.");
    });
  };

  return (
    <div className="space-y-4">
      {message ? (
        <Callout tone="warn" title="저장하지 못했습니다">
          {message}
        </Callout>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_280px]">
        <Field label="제목" required htmlFor="wiki-title" error={errors.title}>
          <Input
            id="wiki-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예) 신규 입사자 온보딩 절차"
            invalid={Boolean(errors.title)}
          />
        </Field>
        <Field
          label="상위 문서"
          htmlFor="wiki-parent"
          error={errors.parentId}
          hint="비워두면 최상위 문서가 됩니다."
        >
          <Select
            id="wiki-parent"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">(최상위)</option>
            {parents.map((option) => (
              <option key={option.id} value={option.id}>
                {option.path}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-label font-bold text-ink">본문</span>
          <SegmentedControl
            options={[
              { value: "edit", label: "편집", icon: Pencil },
              { value: "preview", label: "미리보기", icon: Eye },
            ]}
            value={tab}
            onChange={(value) => setTab(value as "edit" | "preview")}
          />
        </div>

        {tab === "edit" ? (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={22}
            aria-label="본문"
            placeholder={"# 제목\n\n본문을 적습니다. **굵게**, `코드`, [링크](/wiki)를 쓸 수 있습니다.\n\n- 목록\n- 항목"}
            className="font-mono text-micro"
          />
        ) : (
          <Card className="min-h-[28rem]">
            <CardBody>
              <Markdown text={content} />
            </CardBody>
          </Card>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
        {/*
          삭제는 관리자만, 그리고 이미 있는 문서에만. 새 문서 화면에 지울 것이
          없는 삭제 버튼을 두면 무엇을 지우는 버튼인지 헷갈린다.
        */}
        {canDelete && pageId ? (
          <Button variant="danger" disabled={pending} onClick={remove}>
            <Trash2 className="size-4" />
            문서 삭제
          </Button>
        ) : (
          <span />
        )}

        <div className="flex gap-2">
          <Button variant="ghost" disabled={pending} onClick={() => router.back()}>
            취소
          </Button>
          <Button disabled={pending || !title.trim()} onClick={save}>
            <Save className="size-4" />
            {pending ? "저장 중…" : "저장"}
          </Button>
        </div>
      </div>
    </div>
  );
}
