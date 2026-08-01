import type { Metadata } from "next";
import { UsersRound } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { CreateCommunityButton } from "@/features/boards/CommunityActions";
import { CommunityCard } from "@/features/boards/CommunityCard";
import { getCommunities } from "@/features/boards/data";
import { requireSessionEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "동호회" };

/**
 * 동호회 목록 (스펙 16 · 3.1)
 *
 * 보관된 동호회는 여기 나오지 않는다 — 다만 글의 URL은 살아 있어서
 * 사내 문서에 남은 링크는 계속 열린다(상세 화면이 보관 상태를 알려 준다).
 */
export default async function CommunityPage() {
  await requireSessionEmployee();
  const communities = await getCommunities();

  const joined = communities.filter((c) => c.is_member).length;

  return (
    <>
      <PageHeader
        title="동호회"
        description="사내 소모임입니다. 누구나 만들 수 있고, 가입한 회원이 글을 씁니다."
        meta={
          <>
            <span>전체 {communities.length}개</span>
            <span>·</span>
            <span>내가 가입 {joined}개</span>
          </>
        }
        actions={<CreateCommunityButton />}
      />

      {communities.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={UsersRound}
              title="아직 만들어진 동호회가 없습니다"
              description="관심사가 맞는 사람을 모으려면 먼저 하나 만들어 보세요. 만든 사람이 첫 회원이 됩니다."
            />
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {communities.map((community) => (
            <CommunityCard key={community.id} community={community} />
          ))}
        </div>
      )}
    </>
  );
}
