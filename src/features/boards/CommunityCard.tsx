import Link from "next/link";
import { MessagesSquare, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { JoinCommunityButton } from "./CommunityActions";
import type { CommunitySummary } from "./types";

/**
 * 동호회 목록 카드 (스펙 16 · 3.1)
 *
 * 카드 전체를 Link로 감싸지 않는다 — 가입 버튼이 그 안에 들어가면 a 안의
 * button이 되어 클릭이 두 동작으로 갈린다. 제목만 링크로 두고 버튼은 형제로 둔다.
 *
 * 훅이 없으므로 서버 컴포넌트로 그대로 렌더된다(가입 버튼만 클라이언트).
 */
export function CommunityCard({ community }: { community: CommunitySummary }) {
  /*
   * 지금 이 값은 항상 false다 — 유일한 호출부인 /community가
   * getCommunities()를 인자 없이(includeArchived=false) 부르기 때문이다.
   * 보관본까지 카드로 보이려면 그쪽을 getCommunities(true)로 바꿔야 한다.
   * 분기를 남겨 두는 이유는, 그때 가입 버튼을 함께 내리지 않으면 RLS가
   * 막는 버튼을 그리게 되기 때문이다.
   */
  const archived = !!community.archived_at;

  return (
    <div className="ab-card flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-body font-bold leading-snug">
          <Link
            href={`/community/${community.id}`}
            className="text-ink hover:underline"
          >
            {community.name}
          </Link>
        </h3>
        {/* 가입 여부는 상태 표시고, 미가입은 행동 유도다 — 배지와 버튼으로 가른다 */}
        {archived ? (
          <Badge tone="neutral">보관됨</Badge>
        ) : community.is_member ? (
          <Badge tone="primary">가입중</Badge>
        ) : null}
      </div>

      {community.description ? (
        <p className="line-clamp-2 whitespace-pre-line text-caption">
          {community.description}
        </p>
      ) : (
        <p className="text-caption">소개가 없습니다.</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-2">
        <span className="inline-flex items-center gap-1 text-caption tabular-nums">
          <UsersRound className="size-3.5" aria-hidden />
          회원 {community.member_count}명
        </span>
        <span className="inline-flex items-center gap-1 text-caption tabular-nums">
          <MessagesSquare className="size-3.5" aria-hidden />글{" "}
          {community.post_count}건
        </span>
        {community.created_by_name ? (
          <span className="truncate text-caption">
            개설 {community.created_by_name}
          </span>
        ) : null}

        {/*
          보관된 곳에는 가입할 수 없다 — 버튼 자체를 렌더하지 않는다.
          카드마다 반복되는 버튼이라 secondary로 내린다. 이 화면의 진한
          오렌지는 헤더의 '동호회 만들기' 하나뿐이다(디자인시스템 원칙 1).
        */}
        {!archived && !community.is_member ? (
          <span className="ml-auto">
            <JoinCommunityButton
              boardId={community.id}
              size="xsmall"
              variant="secondary"
            />
          </span>
        ) : null}
      </div>
    </div>
  );
}
