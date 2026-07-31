import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import type { MyOrgContext } from "@/features/directory/data";

/**
 * 모듈 패널 하단에 상주하는 '내 소속'.
 *
 * 로그인한 사람 본인의 조직 맥락(부서 › 팀, 리포팅 라인, 같은 팀 인원)이
 * 조직도 화면 어디에도 없어서, 자기 조직을 보려면 트리를 직접 펼쳐 찾아야 했다.
 */
export function MyOrgPanelWidget({
  me,
  context,
}: {
  me: {
    name: string;
    position: string | null;
    profileImageUrl: string | null;
  };
  context: MyOrgContext;
}) {
  const path = [context.departmentName, context.teamName].filter(Boolean);

  return (
    <div className="space-y-2.5">
      <p className="text-nano font-bold text-muted">내 소속</p>

      <div className="flex items-center gap-2">
        <Avatar name={me.name} src={me.profileImageUrl} size="medium" />
        <span className="min-w-0">
          <span className="block truncate text-body-sm font-bold text-ink">
            {me.name}
          </span>
          <span className="block truncate text-nano text-muted">
            {me.position ?? "직급 미지정"}
          </span>
        </span>
      </div>

      <p className="truncate text-nano text-muted">
        {path.length > 0 ? path.join(" › ") : "소속 미지정"}
      </p>

      {context.manager ? (
        <div className="flex items-center gap-2 rounded-sm bg-subtle px-2 py-1.5">
          <Avatar
            name={context.manager.name}
            src={context.manager.profile_image_url}
            size="small"
          />
          <span className="min-w-0 flex-1 truncate text-label text-ink">
            {context.manager.name}
          </span>
          <span className="shrink-0 text-nano text-muted">
            {context.managerRole}
          </span>
        </div>
      ) : (
        <p className="rounded-sm bg-subtle px-2 py-1.5 text-nano text-muted">
          담당 책임자가 지정되지 않았습니다
        </p>
      )}

      {context.teamId ? (
        <Link
          href={`/directory?tab=people&team=${context.teamId}`}
          className="flex items-center gap-1 rounded-sm px-2 py-1.5 text-label text-ink transition-colors duration-fast ease-standard hover:bg-subtle"
        >
          <span className="flex-1">같은 팀 {context.teamSize}명</span>
          <ChevronRight className="size-3.5 text-muted" aria-hidden />
        </Link>
      ) : context.departmentSize > 0 ? (
        <p className="px-2 text-nano text-muted">
          같은 부서 {context.departmentSize}명
        </p>
      ) : null}
    </div>
  );
}
