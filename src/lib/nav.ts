import {
  Boxes,
  Building2,
  Calendar,
  CalendarOff,
  ClipboardList,
  Clock,
  FileCheck,
  FilePlus2,
  FolderOpen,
  GitBranch,
  Home,
  Inbox,
  Library,
  Megaphone,
  Network,
  ScrollText,
  Send,
  Settings,
  Shield,
  Star,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { RoleName } from "@/types/db";

/**
 * 네비게이션 정보구조 — 2뎁스.
 *
 * 예전 구조는 href 하나짜리 평면 리스트였다. "한 모듈이 여러 라우트를 갖는다"를
 * 표현할 수 없어서 관리자 기능 9개가 갈 곳을 잃고 전역 레일에 그대로 쏟아졌고
 * (system_admin 기준 16칸), 76px 폭에서 truncate되는 "근태"와 "근태관리"는
 * 사실상 구분이 불가능했다. 게시판·파일함은 아이콘까지 중복이었다.
 *
 * 더 나쁜 건 모듈 내부 이동이었다. 담을 그릇이 없으니 각 모듈이 하위 섹션을
 * 콘텐츠 영역에 우겨넣었고, 같은 목적에 서로 다른 UI 패턴이 11가지 쓰였다.
 *
 * 이제 레일에는 모듈만 두고, 모듈 내부는 사이드 패널이 받는다.
 */

export interface NavChild {
  key: string;
  label: string;
  href: string;
  icon?: LucideIcon;
  roles?: RoleName[];
  /** false면 '준비중' — 해당 스펙 작업 때 true로 바꾼다 */
  ready?: boolean;
  /**
   * 활성으로 간주할 추가 경로. 상세 페이지(/board/[id]/[postId])처럼
   * href로는 안 잡히는 하위 경로를 여기에 적는다.
   */
  prefixes?: string[];
}

export interface NavChildSection {
  key: string;
  title?: string;
  roles?: RoleName[];
  items: NavChild[];
}

export interface NavModule {
  key: string;
  /** 모듈 패널 제목 겸 전체 라벨 */
  label: string;
  /** 76px 레일용 짧은 라벨 (2~4자) */
  short?: string;
  href: string;
  icon: LucideIcon;
  ready: boolean;
  roles?: RoleName[];
  /**
   * 이 모듈에 속하는 모든 라우트 prefix.
   * /admin/attendance는 별도 모듈이 아니라 근태 모듈의 관리 화면이다 —
   * 예전엔 여기 있으면 레일의 '근태'가 꺼지고 '근태관리'가 켜져서,
   * 사용자는 근태 업무 중인데 시스템은 다른 모듈이라고 표시했다.
   */
  prefixes: string[];
  /** 모듈 패널 상단 주요 액션 */
  primaryAction?: {
    label: string;
    href: string;
    icon?: LucideIcon;
    roles?: RoleName[];
  };
  sections?: NavChildSection[];
}

/** 관리 섹션은 모듈마다 같은 모양이라 헬퍼로 묶는다 */
function adminSection(items: NavChild[]): NavChildSection {
  return {
    key: "admin",
    title: "관리",
    roles: ["system_admin"],
    items: items.map((i) => ({ ...i, roles: ["system_admin"] })),
  };
}

export const NAV_MODULES: NavModule[] = [
  {
    key: "home",
    label: "홈",
    href: "/",
    icon: Home,
    ready: true,
    // /profile은 별도 모듈이 아니라 홈의 하위 화면이다
    prefixes: ["/", "/profile"],
    sections: [
      {
        key: "shortcuts",
        items: [
          { key: "home-dash", label: "대시보드", href: "/", icon: Home },
          {
            key: "home-profile",
            label: "내 프로필",
            href: "/profile",
            icon: UsersRound,
          },
          {
            key: "home-favorites",
            label: "즐겨찾기 관리",
            href: "/profile#favorites",
            icon: Star,
          },
        ],
      },
    ],
  },
  {
    key: "directory",
    label: "조직도",
    href: "/directory",
    icon: Users,
    ready: true,
    prefixes: ["/directory", "/admin/employees", "/admin/roles"],
    sections: [
      {
        key: "main",
        items: [
          {
            key: "org-tree",
            label: "조직도",
            href: "/directory",
            icon: Network,
          },
          {
            key: "org-people",
            label: "임직원 목록",
            href: "/directory?tab=people",
            icon: Users,
          },
          {
            key: "org-external",
            label: "외부 연락처",
            href: "/directory?tab=external",
            icon: Building2,
          },
        ],
      },
      adminSection([
        {
          key: "admin-employees",
          label: "임직원 관리",
          href: "/admin/employees",
          icon: Building2,
        },
        {
          key: "admin-roles",
          label: "권한 관리",
          href: "/admin/roles",
          icon: Shield,
        },
      ]),
    ],
  },
  {
    key: "calendar",
    label: "캘린더",
    href: "/calendar",
    icon: Calendar,
    ready: true,
    prefixes: ["/calendar", "/admin/holidays", "/admin/resources"],
    sections: [
      {
        key: "main",
        items: [
          {
            key: "cal-month",
            label: "캘린더",
            href: "/calendar",
            icon: Calendar,
          },
          {
            key: "cal-resources",
            label: "리소스 예약",
            href: "/calendar?view=resources",
            icon: Boxes,
          },
        ],
      },
      adminSection([
        {
          key: "admin-holidays",
          label: "휴일 관리",
          href: "/admin/holidays",
          icon: CalendarOff,
        },
        {
          key: "admin-resources",
          label: "리소스 관리",
          href: "/admin/resources",
          icon: Boxes,
        },
      ]),
    ],
  },
  {
    key: "attendance",
    label: "근태",
    href: "/attendance",
    icon: Clock,
    ready: true,
    prefixes: ["/attendance", "/admin/attendance"],
    sections: [
      {
        key: "mine",
        title: "내 근태 관리",
        items: [
          {
            key: "att-me",
            label: "내 근태 현황",
            href: "/attendance",
            icon: Clock,
          },
        ],
      },
      {
        key: "team",
        title: "부서 근태 관리",
        roles: ["manager", "system_admin"],
        items: [
          {
            key: "att-approvals",
            label: "근태 승인함",
            href: "/attendance/approvals",
            icon: Inbox,
            roles: ["manager", "system_admin"],
          },
        ],
      },
      adminSection([
        {
          key: "admin-attendance",
          label: "전사 근태 관리",
          href: "/admin/attendance",
          icon: ClipboardList,
        },
      ]),
    ],
  },
  {
    key: "approval",
    label: "전자결재",
    short: "결재",
    href: "/approvals",
    icon: FileCheck,
    ready: true,
    prefixes: ["/approvals", "/admin/approval-lines"],
    primaryAction: { label: "새 기안", href: "/approvals/new", icon: FilePlus2 },
    sections: [
      {
        key: "main",
        items: [
          {
            key: "ap-mine",
            label: "내가 올린 문서",
            href: "/approvals",
            icon: Send,
          },
          {
            key: "ap-inbox",
            label: "내가 승인할 문서",
            href: "/approvals?tab=inbox",
            icon: Inbox,
          },
        ],
      },
      adminSection([
        {
          key: "admin-approval-lines",
          label: "결재라인 설정",
          href: "/admin/approval-lines",
          icon: GitBranch,
        },
      ]),
    ],
  },
  {
    key: "board",
    label: "게시판",
    href: "/board",
    icon: Megaphone,
    ready: true,
    prefixes: ["/board", "/admin/boards"],
    sections: [
      adminSection([
        {
          key: "admin-boards",
          label: "게시판 관리",
          href: "/admin/boards",
          icon: Settings,
        },
      ]),
    ],
  },
  {
    key: "drive",
    label: "파일함",
    href: "/files",
    icon: FolderOpen,
    ready: true,
    prefixes: ["/files", "/admin/files"],
    sections: [
      {
        key: "main",
        items: [
          {
            key: "files-me",
            label: "개인 파일함",
            href: "/files",
            icon: FolderOpen,
          },
          {
            key: "files-team",
            label: "팀 공유폴더",
            href: "/files/team",
            icon: UsersRound,
          },
          {
            key: "files-library",
            label: "사내 규정",
            href: "/files/library",
            icon: Library,
          },
        ],
      },
      adminSection([
        {
          key: "admin-files",
          label: "파일함 관리",
          href: "/admin/files",
          icon: Settings,
        },
      ]),
    ],
  },
  {
    key: "system",
    label: "시스템",
    href: "/admin",
    icon: Shield,
    ready: true,
    roles: ["system_admin"],
    // 다른 모듈이 가져간 /admin/* 는 제외되고 개요·감사로그만 남는다
    prefixes: ["/admin", "/admin/audit-logs"],
    sections: [
      {
        key: "main",
        roles: ["system_admin"],
        items: [
          {
            key: "admin-home",
            label: "시스템 개요",
            href: "/admin",
            icon: Shield,
            roles: ["system_admin"],
          },
          {
            key: "admin-audit",
            label: "감사 로그",
            href: "/admin/audit-logs",
            icon: ScrollText,
            roles: ["system_admin"],
          },
        ],
      },
    ],
  },
];

function allowed(roles: RoleName[] | undefined, role: RoleName) {
  return !roles || roles.includes(role);
}

/** 레일에 노출할 모듈 */
export function visibleModules(role: RoleName): NavModule[] {
  return NAV_MODULES.filter((m) => allowed(m.roles, role));
}

/**
 * 현재 경로가 속한 모듈.
 *
 * prefix가 가장 긴 것을 고른다 — "/admin"과 "/admin/attendance"가 둘 다
 * 매치될 때 더 구체적인 쪽(근태)이 이겨야 한다.
 * "/"는 모든 경로의 prefix라서 완전 일치일 때만 홈으로 본다.
 */
export function resolveModule(
  pathname: string,
  role: RoleName,
): NavModule | null {
  let best: { module: NavModule; length: number } | null = null;

  for (const mod of visibleModules(role)) {
    for (const prefix of mod.prefixes) {
      const hit =
        prefix === "/"
          ? pathname === "/"
          : pathname === prefix || pathname.startsWith(`${prefix}/`);
      if (!hit) continue;
      if (!best || prefix.length > best.length) {
        best = { module: mod, length: prefix.length };
      }
    }
  }

  return best?.module ?? null;
}

/** 역할에 맞는 하위 섹션만 걸러낸다 */
export function visibleChildSections(
  module: NavModule,
  role: RoleName,
): NavChildSection[] {
  return (module.sections ?? [])
    .filter((section) => allowed(section.roles, role))
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => allowed(item.roles, role)),
    }))
    .filter((section) => section.items.length > 0);
}

/** 즐겨찾기로 추가 가능한 항목 — 모듈과 하위 화면 전부 */
export function favoritableItems(
  role: RoleName,
): { key: string; label: string; href: string }[] {
  const out: { key: string; label: string; href: string }[] = [];
  for (const mod of visibleModules(role)) {
    if (!mod.ready) continue;
    out.push({ key: mod.key, label: mod.label, href: mod.href });
    for (const section of visibleChildSections(mod, role)) {
      for (const item of section.items) {
        if (item.ready === false) continue;
        out.push({
          key: item.key,
          label: `${mod.label} · ${item.label}`,
          href: item.href,
        });
      }
    }
  }
  return out;
}

/** 하위 항목의 활성 판정 — 쿼리스트링까지 본다 */
export function isChildActive(
  item: NavChild,
  pathname: string,
  search: string,
) {
  const [itemPath, itemQuery] = item.href.split("?");

  if (item.prefixes?.some((p) => pathname.startsWith(p))) return true;
  if (pathname !== itemPath) return false;

  // 쿼리로 갈리는 탭(/directory?tab=people)은 해당 파라미터까지 일치해야 한다
  if (!itemQuery) {
    const params = new URLSearchParams(search);
    return !params.has("tab") && !params.has("view");
  }

  const want = new URLSearchParams(itemQuery);
  const have = new URLSearchParams(search);
  let matched = true;
  want.forEach((value, key) => {
    if (have.get(key) !== value) matched = false;
  });
  return matched;
}
