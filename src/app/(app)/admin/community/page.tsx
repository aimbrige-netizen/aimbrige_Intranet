import type { Metadata } from "next";
import Link from "next/link";
import { UsersRound } from "lucide-react";
import { SectionHeader } from "@/components/ui/Card";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import { CommunityAdminActions } from "@/features/boards/CommunityActions";
import { getCommunities } from "@/features/boards/data";
import { requireSystemAdmin } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "동호회 관리" };

/**
 * 동호회 관리 (스펙 16 · 3.3) — 시스템 관리자 전용
 *
 * 개설은 /community에서 전 임직원이 하므로 여기에 등록 화면은 없다.
 * 여기서 하는 일은 부적절한 동호회를 내리는 것 하나다.
 *
 * 내리는 방식이 삭제가 아니라 보관인 이유: deleteBoard()는 글이 1건이라도
 * 있으면 거부한다(cascade로 글까지 날아가는 사고 방지). 그 원칙을 깨지 않고
 * 즉시 목록에서 감추려면 보관이 필요하다. 글은 남고 URL도 살아 있다.
 */
export default async function AdminCommunityPage() {
  await requireSystemAdmin();
  const communities = await getCommunities(true);

  const archived = communities.filter((c) => c.archived_at).length;

  return (
    <>
      {/*
        콘텐츠 제목 "동호회 관리" 20/500 — PageHeader급 밴드 없음(확립 문법).
        종전 메타(전체·운영·보관 개수)는 섹션 제목·설명이 나눠 든다.
      */}
      <h1 className="mb-5 text-title-l text-ink">
        동호회 관리
      </h1>

      <section>
        <SectionHeader
          title={`전체 동호회 (총${communities.length}개)`}
          description={`운영 중 ${communities.length - archived}개 · 보관 ${archived}개 — 보관하면 목록에서 사라지고 새 글·댓글·가입을 받지 않습니다. 이미 올라온 글과 그 링크는 그대로 남습니다.`}
        />
        {/* 08 흰 시트: md+에서는 표를 시트에 직접, md 미만은 canvas 위 카드 유지 */}
        <div className="ab-card overflow-hidden md:rounded-none md:border-0">
        <div className="overflow-x-auto">
          <table className="ab-table ab-table--compact min-w-[760px]">
            <thead>
              <tr>
                <th>동호회</th>
                <th className="w-24">상태</th>
                <th className="w-20 !text-right">회원</th>
                <th className="w-20 !text-right">글</th>
                <th className="w-28">개설자</th>
                <th className="w-28">개설일</th>
                <th className="w-32">관리</th>
              </tr>
            </thead>
            <tbody>
              {communities.length === 0 ? (
                <TableEmptyRow
                  colSpan={7}
                  icon={UsersRound}
                  title="아직 만들어진 동호회가 없습니다"
                  description="동호회는 임직원이 직접 개설합니다. 여기에는 개설된 뒤에 나타납니다."
                />
              ) : (
                communities.map((community) => (
                  <tr key={community.id}>
                    <td>
                      <Link
                        href={`/community/${community.id}`}
                        className="font-bold text-ink hover:underline"
                      >
                        {community.name}
                      </Link>
                      {community.description ? (
                        <span className="mt-0.5 block truncate text-caption">
                          {community.description}
                        </span>
                      ) : null}
                    </td>
                    {/*
                      색 절제 — 거의 전 행이 "운영 중"이라 초록 배지가 상시
                      깔리면 색이 말을 잃는다. 예외 상태(보관)만 흐리게 가른다.
                    */}
                    <td>
                      {community.archived_at ? (
                        <span className="text-muted">보관</span>
                      ) : (
                        <span className="text-ink">운영 중</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">
                      {community.member_count}
                    </td>
                    <td className="text-right tabular-nums">
                      {community.post_count}
                    </td>
                    <td className="truncate">
                      {community.created_by_name ?? "-"}
                    </td>
                    <td className="whitespace-nowrap tabular-nums text-caption">
                      {formatDate(community.created_at)}
                    </td>
                    <td>
                      <CommunityAdminActions
                        boardId={community.id}
                        archived={!!community.archived_at}
                        postCount={community.post_count}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        </div>
      </section>
    </>
  );
}
