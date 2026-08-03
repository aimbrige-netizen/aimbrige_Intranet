import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionHeader } from "@/components/ui/Card";
import {
  CertAdminTable,
  type CertAdminRow,
} from "@/features/ess/CertRequests";
import {
  getCertificateQueue,
  type CertificateAdminItem,
} from "@/features/ess/data";
import { requireSystemAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "증명서 발급 관리" };

/**
 * 증명서 발급 처리 (13-ess.md — /admin/hr) — 시스템 관리자 전용.
 *
 * 발급은 상태 전환뿐이다(PDF 양식은 스펙 08 대기). 반려는 사유가 필수고
 * 그 문장이 신청자 화면에 그대로 보인다 — "왜 안 되는지"를 관리자가
 * 한 번만 적으면 신청자가 다시 묻지 않아도 된다.
 *
 * 조회는 담당 A의 getCertificateQueue다(마이그레이션 30 컬럼 기준 ·
 * 소프트 실패) — 여기서는 표가 쓰는 평평한 행으로 펴기만 한다.
 */
export default async function AdminHrPage() {
  await requireSystemAdmin();

  const items = await getCertificateQueue();

  const flat = items.map(toAdminRow);
  const pending = flat.filter((row) => row.status === "requested");
  const processed = flat.filter((row) => row.status !== "requested");

  return (
    <>
      <PageHeader
        title="증명서 발급 관리"
        description="임직원의 재직·경력증명서 신청을 발급하거나 반려합니다."
        meta={
          <>
            <span>처리 대기 {pending.length}건</span>
            <span>전체 {flat.length}건</span>
          </>
        }
      />

      <div className="space-y-5">
        <section>
          <SectionHeader title="처리 대기" description={`${pending.length}건`} />
          <CertAdminTable rows={pending} />
        </section>

        <section>
          <SectionHeader
            title="처리 내역"
            description={`발급·반려 ${processed.length}건`}
          />
          <CertAdminTable rows={processed} />
        </section>
      </div>
    </>
  );
}

/** embed된 신청자 정보를 표가 쓰는 평평한 행으로 편다 */
function toAdminRow(item: CertificateAdminItem): CertAdminRow {
  return {
    id: item.id,
    kind: item.certType,
    purpose: item.purpose,
    status: item.status,
    rejection_reason: item.rejectReason,
    created_at: item.requestedAt,
    processed_at: item.processedAt,
    /* 퇴사자 정리로 FK가 비면 이름 자리를 비워두지 않는다 */
    employee_name: item.employeeName ?? "(퇴사자)",
    department_name: item.departmentName,
    position: item.position,
  };
}
