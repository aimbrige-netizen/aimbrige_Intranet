import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { requireSessionEmployee } from "@/lib/auth/session";
import { getApprovalLineConfigs } from "@/features/approvals/data";
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_META,
} from "@/features/approvals/types";

export const metadata: Metadata = { title: "새 기안" };

export default async function NewApprovalPage() {
  await requireSessionEmployee();
  const configs = await getApprovalLineConfigs();
  const blocked = new Set(
    configs.filter((c) => !c.step2_approver_id).map((c) => c.document_type),
  );

  return (
    <>
      <Link
        href="/approvals"
        className="mb-3 inline-flex items-center gap-1 text-label text-primary hover:underline"
      >
        <ChevronLeft className="size-3.5" />
        결재함
      </Link>

      <PageHeader
        title="새 기안"
        description="작성할 문서 유형을 선택하세요."
      />

      {blocked.size > 0 ? (
        <div className="mb-4 flex gap-2.5 rounded-card border border-warn/40 bg-warn/10 px-4 py-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <p className="text-body text-ink">
            최종 승인자가 지정되지 않은 유형이 {blocked.size}개 있어 기안할 수 없습니다.
            시스템 관리자가 결재라인 설정에서 지정해야 합니다.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {DOCUMENT_TYPES.map((type) => {
          const meta = DOCUMENT_TYPE_META[type];
          const isBlocked = blocked.has(type);

          return (
            <Card key={type} className={isBlocked ? "opacity-60" : undefined}>
              <CardBody>
                {isBlocked ? (
                  <div>
                    <p className="text-h2 text-ink">{meta.label}</p>
                    <p className="mt-1 text-caption">{meta.description}</p>
                    <p className="mt-3 text-label text-danger">
                      최종 승인자 미지정 — 기안 불가
                    </p>
                  </div>
                ) : (
                  <Link href={`/approvals/new/${type}`} className="group block">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-h2 text-ink group-hover:text-primary">
                          {meta.label}
                        </p>
                        <p className="mt-1 text-caption">{meta.description}</p>
                      </div>
                      <ChevronRight
                        className="mt-1 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                        aria-hidden
                      />
                    </div>
                  </Link>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </>
  );
}
