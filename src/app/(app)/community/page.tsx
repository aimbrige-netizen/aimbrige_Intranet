import type { Metadata } from "next";
import { UsersRound } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
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
        /*
          md+ 흰 시트에서는 빈 상태를 시트에 직접, md 미만은 canvas 위라
          faint 문구가 뜨지 않게 카드 면을 유지한다 (LibraryList와 동일).
        */
        <div className="ab-card p-4 md:rounded-none md:border-0 md:p-0">
          <EmptyState
            icon={UsersRound}
            title="아직 만들어진 동호회가 없습니다"
            description="관심사가 맞는 사람을 모으려면 먼저 하나 만들어 보세요. 만든 사람이 첫 회원이 됩니다."
          />
        </div>
      ) : (
        /*
          동호회 카드 그리드의 .ab-card 테두리는 유지한다(스윕 판단):
          이중선은 "카드 안 카드"에서 나는데 이 그리드는 시트 위 1겹이고,
          테두리를 걷으면 흰 시트 위 흰 칸이라 카드 경계 자체가 사라진다.
        */
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {communities.map((community) => (
            <CommunityCard key={community.id} community={community} />
          ))}
        </div>
      )}
    </>
  );
}
