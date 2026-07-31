import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { ApprovalLineEditor } from "@/features/approvals/ApprovalLineEditor";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { getApprovalLineConfigs } from "@/features/approvals/data";

export const metadata: Metadata = { title: "결재라인 설정" };

export default async function ApprovalLinesPage() {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const [configs, { data: employees }] = await Promise.all([
    getApprovalLineConfigs(),
    supabase
      .from("employees")
      .select("id, name, position")
      .eq("employment_status", "active")
      .order("name"),
  ]);

  const unset = configs.filter((c) => !c.step2_approver_id).length;

  return (
    <>
      <PageHeader
        title="결재라인 설정"
        description="문서유형별 최종 승인자를 지정합니다. 1차 검토는 기안자 팀의 팀장으로 규칙 고정입니다."
      />

      {unset > 0 ? (
        <div className="mb-4 flex gap-2.5 rounded-card border border-danger/30 bg-danger-light px-4 py-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <p className="text-body text-ink">
            최종 승인자가 지정되지 않은 유형이 <strong>{unset}개</strong> 있습니다.
            해당 유형은 임직원이 기안 자체를 할 수 없으니 먼저 지정해 주세요.
          </p>
        </div>
      ) : null}

      <Card>
        <CardBody>
          <ApprovalLineEditor
            rows={configs.map((c) => ({
              documentType: c.document_type,
              approverId: c.step2_approver_id,
              approverName: c.approver?.name ?? null,
            }))}
            employees={
              (employees ?? []) as {
                id: string;
                name: string;
                position: string | null;
              }[]
            }
          />
        </CardBody>
      </Card>
    </>
  );
}
