import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Callout } from "@/components/ui/Callout";
import {
  DocumentTypePicker,
  type TypePickerMeta,
} from "@/features/approvals/DocumentTypePicker";
import { requireSessionEmployee } from "@/lib/auth/session";
import {
  getApprovalLineConfigs,
  getMyTypeUsage,
} from "@/features/approvals/data";
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_META,
  type DocumentType,
} from "@/features/approvals/types";

export const metadata: Metadata = { title: "새 기안" };

export default async function NewApprovalPage() {
  const me = await requireSessionEmployee();
  const [configs, usage] = await Promise.all([
    getApprovalLineConfigs(),
    getMyTypeUsage(me.id),
  ]);

  const configByType = new Map(configs.map((c) => [c.document_type, c]));

  const meta = Object.fromEntries(
    DOCUMENT_TYPES.map((type) => {
      const config = configByType.get(type);
      return [
        type,
        {
          blocked: !config?.step2_approver_id,
          approverName: config?.approver
            ? `${config.approver.name}${config.approver.position ? ` ${config.approver.position}` : ""}`
            : null,
          count: usage[type].count,
          lastUsed: usage[type].lastUsed?.slice(0, 10) ?? null,
        } satisfies TypePickerMeta,
      ];
    }),
  ) as Record<DocumentType, TypePickerMeta>;

  const blocked = DOCUMENT_TYPES.filter((type) => meta[type].blocked);

  return (
    <>
      <PageHeader
        title="새 기안"
        description="작성할 문서 유형을 선택하면 해당 양식으로 이동합니다."
        meta={
          <>
            <span>기안자 {me.name}</span>
            <span>·</span>
            <span>{me.department?.name ?? "부서 미지정"}</span>
            {me.position ? (
              <>
                <span>·</span>
                <span>{me.position}</span>
              </>
            ) : null}
          </>
        }
      />

      {blocked.length > 0 ? (
        <Callout
          tone="warn"
          title={`결재선이 지정되지 않은 유형 ${blocked.length}개`}
          className="mb-4"
        >
          {blocked.map((type) => DOCUMENT_TYPE_META[type].label).join(" · ")}{" "}
          은(는) 최종 승인자가 지정되어야 기안할 수 있습니다.
        </Callout>
      ) : null}

      <DocumentTypePicker meta={meta} />
    </>
  );
}
