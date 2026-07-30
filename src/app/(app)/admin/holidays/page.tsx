import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { HolidayManager } from "@/features/calendar/HolidayManager";
import { requireSystemAdmin } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Holiday } from "@/types/db";

export const metadata: Metadata = { title: "휴일 관리" };

export default async function HolidaysPage() {
  await requireSystemAdmin();
  const supabase = createServerSupabase();

  const { data } = await supabase
    .from("holidays")
    .select("*")
    .order("date", { ascending: true });

  return (
    <>
      <PageHeader
        title="휴일 관리"
        description="캘린더의 빨간날 표시와 근태 모듈의 근무일 산정이 이 목록을 기준으로 동작합니다."
      />

      <div className="mb-4 rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-body text-ink">
        설날·추석·부처님오신날은 음력 기반이고 대체공휴일·임시공휴일은 정부 고시로
        정해져서 자동 계산이 불가능합니다. <strong>2026년은 미리 등록해 두었고</strong>,
        2027년 이후와 창립기념일 같은 회사 휴무일은 여기서 직접 추가하세요.
      </div>

      <Card>
        <CardBody>
          <HolidayManager holidays={(data ?? []) as Holiday[]} />
        </CardBody>
      </Card>
    </>
  );
}
