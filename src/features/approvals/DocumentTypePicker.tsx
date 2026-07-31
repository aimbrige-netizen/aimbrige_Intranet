"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { OptionCardGrid } from "@/components/ui/OptionCardGrid";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_META, type DocumentType } from "./types";

export interface TypePickerMeta {
  /** 최종 승인자가 지정되지 않아 기안할 수 없는 유형 */
  blocked: boolean;
  approverName: string | null;
  /** 내가 이 유형으로 올린 문서 수 */
  count: number;
  /** 마지막 사용일 (YYYY-MM-DD) */
  lastUsed: string | null;
}

/**
 * 기안 유형 선택.
 *
 * 예전에는 제목 + 하드코딩된 설명 한 줄짜리 카드 5개라, 길이만 다른
 * 텍스트 덩어리를 읽어야 했다. 아이콘으로 스캔하게 만들고, 카드 하단에
 * "내가 몇 건 올렸는지 / 마지막이 언제인지 / 최종 승인자가 누구인지"라는
 * 실제 선택 근거를 붙인다.
 */
export function DocumentTypePicker({
  meta,
}: {
  meta: Record<DocumentType, TypePickerMeta>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<DocumentType | null>(null);
  const [, startTransition] = useTransition();

  const choose = (type: DocumentType) => {
    setSelected(type);
    startTransition(() => router.push(`/approvals/new/${type}`));
  };

  return (
    <OptionCardGrid
      columns={2}
      value={selected}
      onChange={choose}
      name="문서 유형"
      options={DOCUMENT_TYPES.map((type) => {
        const info = DOCUMENT_TYPE_META[type];
        const usage = meta[type];

        return {
          value: type,
          title: info.label,
          description: info.description,
          icon: info.icon,
          disabled: usage.blocked,
          disabledLabel: "결재선 미지정",
          meta: [
            usage.count > 0 ? `내 기안 ${usage.count}건` : "기안 이력 없음",
            usage.lastUsed ? `최근 ${usage.lastUsed.slice(5, 10)}` : null,
            usage.approverName
              ? `최종 승인 ${usage.approverName}`
              : "최종 승인자 미지정",
          ].filter((line): line is string => !!line),
        };
      })}
    />
  );
}
