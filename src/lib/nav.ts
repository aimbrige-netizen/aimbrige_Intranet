import {
  Banknote,
  BookOpen,
  Boxes,
  Building2,
  Calendar,
  CalendarOff,
  CalendarPlus,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileCheck,
  FilePlus2,
  FileSignature,
  FileText,
  FolderKanban,
  FolderOpen,
  Gift,
  GitBranch,
  Home,
  IdCard,
  Inbox,
  Library,
  ListChecks,
  Mail,
  Megaphone,
  Network,
  NotebookPen,
  PackageOpen,
  ScrollText,
  Send,
  Settings,
  Shield,
  Stamp,
  Target,
  Users,
  UsersRound,
  Wallet,
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
 * 이제 레일에는 모듈만 두고, 모듈 내부는 사이드 패널이 받는다.
 *
 * ---------------------------------------------------------------------
 * 레일 정책 — 묶지 않는다 (daou-survey/01-shell.md)
 *
 * 종전에는 업무(일지·할일·목표·평가)·자산·복지·파일함(+위키)·게시판(+동호회)을
 * 한 칸에 묶어 11칸으로 줄였다. 근거는 "76px 레일에서 글자가 뭉개진다"였다.
 * 실측한 다우오피스는 같은 문제를 정반대로 푼다 — 모듈 24개를 하나도 묶지 않고
 * 전부 노출하고, 대신 **아이콘을 32px, 라벨을 14px로 키운 뒤 넘치면 스크롤**한다.
 * 레일 폭은 오히려 64px로 더 좁다.
 *
 * 묶음은 라벨을 읽기 쉽게 만들어 주지 않는다. "업무"라는 칸을 눌러 봐야
 * 그 안에 목표가 있는지 알 수 있으니, 뭉개진 글자 대신 한 번 더 클릭하는
 * 비용으로 바꾼 것뿐이다. 그래서 묶음을 전부 풀고 개별 모듈로 올린다.
 *
 * 다우오피스에 있고 우리에게 없는 것(AI·경비·차량일지·설문 등)은
 * 만들지 않는다. 우리 라우트가 실제로 있는 모듈만 올린다.
 * (메일은 12-mail.md, 인사·급여·계약 ESS 3종은 13-ess.md에서 신설돼
 * "없는 것" 목록에서 빠졌다 — 다우처럼 레일 뒤쪽, 복지 다음·시스템 앞.)
 * ---------------------------------------------------------------------
 * href는 기간 파라미터(period·cursor·from·to)를 싣지 않는다.
 *
 * "보던 구간을 들고 이동하면 편하지 않나"는 몇 번 나온 이야기라 결론을 적어 둔다.
 * 모듈마다 지원 단위 집합이 겹치지 않는다 — 근태 week|month, 결재 month|quarter|all,
 * 시스템 개요 month|year, 휴일 year 단독, 감사 로그는 기본이 custom, 게시판 week|month|all.
 * 목표·프로젝트·평가·조직도·캘린더·파일함·자산은 기간 개념 자체가 없다.
 * 지원하지 않는 단위가 실려 오면 parsePeriod는 **조용히** 기본 단위로 떨어뜨리므로
 * (lib/period의 pickUnit) 주소에는 period=quarter가 남고 화면은 주간을 그린다.
 * 지금처럼 파라미터 없이 이동해 '이번 주'가 열리는 쪽이 명백히 낫다.
 * 기간이 없는 모듈에는 아무 효과 없는 죽은 파라미터가 공유 링크에 그대로 실린다.
 *
 * 게시판·동호회는 cursor 없는 '최근 N' 롤링 윈도우라(features/boards/format.ts)
 * cursor를 넘기면 칩 라벨과 실제 구간이 어긋난다.
 *
 * 그리고 Sidebar의 즐겨찾기 판정이 favorites.target_path와 module.href를 문자열로
 * 그대로 비교한다 — href에 쿼리가 붙는 순간 별표가 항상 꺼지고 토글할 때마다
 * 새 경로가 쌓인다. (묶음을 풀면서도 기존 모듈 href는 하나도 바꾸지 않았다.
 * /worklog·/assets처럼 묶음 대표였던 주소가 그대로 개별 모듈의 주소가 됐고,
 * 하위 항목이던 /todos·/goals·/reviews·/community·/wiki·/welfare가 모듈로
 * 올라왔을 뿐이라 저장된 즐겨찾기 경로는 전부 그대로 유효하다.)
 * ---------------------------------------------------------------------
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
  /**
   * 데스크톱 ModulePanel에서 이 섹션을 그리지 않는다 — 패널 내용 전체를
   * PanelPortal로 그리는 "포털 전용 모듈"(메일)의 앵커 섹션용. 섹션이
   * 존재해야 hasPanel·ModulePanel 렌더 판정(패널 골격·본문 흰 시트)이
   * 서고 모바일 드로어(Sidebar)의 하위 항목도 이 섹션이 담당하므로,
   * 지우는 게 아니라 데스크톱 패널 렌더에서만 뺀다.
   */
  panelHidden?: boolean;
  items: NavChild[];
}

export interface NavModule {
  key: string;
  /** 모듈 패널 제목 겸 전체 라벨 */
  label: string;
  /**
   * 64px 레일용 짧은 라벨.
   * 14px / letter-spacing -0.02em 기준 한글 4자(≈56px)까지가 레일 안쪽 폭이다.
   * 5자 이상인 라벨만 여기서 줄인다.
   */
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
    /*
     * 홈은 패널이 없다 — 원본 홈도 레일에서 바로 3열 대시보드가 시작된다.
     * 내 프로필·즐겨찾기 관리는 상단바 아바타 메뉴와 프로필 화면이 담당한다.
     * sections를 비워 두면 AppShell이 본문을 pl-rail(64px)로 당긴다.
     */
  },
  {
    /*
     * 사내 메일 (12-mail.md) — 다우 레일에서 메일은 최상단 그룹이라
     * 홈 바로 다음, 조직도 앞에 둔다.
     *
     * 패널 내용(메일쓰기 버튼·메일함 트리·빠른검색·용량 게이지)은 nav가 아니라
     * MailPanel(features/mail/MailPanel.tsx)이 포털로 그린다 — 캘린더의
     * CalendarPanelFilters와 같은 구조다. 메일함 활성 판정이 ?box=/?filter=
     * 쿼리 조합이라 정적 sections로는 다 표현할 수 없다.
     *
     * 그런데 패널 렌더 판정(hasPanel과 ModulePanel의 null 반환)은 둘 다
     * sections·primaryAction 기반이다. 캘린더는 정적 sections가 있어서
     * ModulePanel이 서고, 포털은 그 슬롯에 꽂힌다(CalendarPanelFilters 상단
     * 주석). 메일도 같은 방식이 필요해서 최소 정적 섹션(받은메일함) 하나를
     * 앵커로 둔다 — 이게 없으면 ModulePanel이 null을 반환해 포털 슬롯 자체가
     * 없고, AppShell의 본문 들여쓰기·흰 시트도 꺼진다. 모바일 드로어의 하위
     * 항목(Sidebar)도 이 섹션이 담당한다.
     *
     * primaryAction으로 앵커를 삼지 않는 이유: MailPanel이 "메일쓰기" 버튼을
     * 16/600 예외 문법(12-mail.md 패널 1 — 모듈 공통 14/400과 다른 유일한
     * 예외)으로 직접 그린다. primaryAction을 두면 공통 문법 버튼이 바로 위에
     * 하나 더 생긴다.
     *
     * MailPanel의 "메일함" 섹션에도 받은메일함 행이 있으므로 이 앵커 섹션은
     * panelHidden으로 데스크톱 패널 렌더에서 뺀다 — 안 그러면 포털(위)과
     * 앵커(아래)에 같은 행이 두 번 보인다. hasPanel 판정과 모바일 드로어에는
     * 그대로 산다(NavChildSection.panelHidden 주석 참고).
     */
    key: "mail",
    label: "메일",
    href: "/mail",
    icon: Mail,
    ready: true,
    prefixes: ["/mail"],
    sections: [
      {
        key: "main",
        panelHidden: true,
        items: [
          {
            key: "mail-inbox",
            label: "받은메일함",
            href: "/mail",
            icon: Inbox,
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
    /*
     * 09-calendar.md 패널 — "일정등록" 주요 버튼(모듈 공통 문법 212×48).
     * ?new=1은 calendar/page.tsx가 이미 받는 규약이다(마운트 직후 작성 모달).
     * 모듈 href(/calendar)는 그대로라 즐겨찾기 문자열 판정에 영향 없다 —
     * primaryAction은 favoritableItems에 들어가지 않는다.
     */
    primaryAction: {
      label: "일정등록",
      href: "/calendar?new=1",
      icon: CalendarPlus,
    },
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
    key: "worklog",
    label: "업무일지",
    href: "/worklog",
    icon: NotebookPen,
    ready: true,
    prefixes: ["/worklog"],
    sections: [
      {
        key: "main",
        items: [
          {
            key: "worklog-mine",
            label: "업무일지",
            href: "/worklog",
            icon: NotebookPen,
          },
        ],
      },
    ],
  },
  {
    key: "todo",
    label: "할일",
    href: "/todos",
    icon: ListChecks,
    ready: true,
    prefixes: ["/todos"],
    sections: [
      {
        key: "main",
        items: [
          {
            key: "todo-mine",
            label: "내 할일",
            href: "/todos",
            icon: ListChecks,
          },
        ],
      },
    ],
  },
  {
    key: "goal",
    label: "목표",
    href: "/goals",
    icon: Target,
    ready: true,
    prefixes: ["/goals"],
    sections: [
      {
        key: "main",
        items: [
          { key: "goal-mine", label: "목표", href: "/goals", icon: Target },
        ],
      },
    ],
  },
  {
    key: "review",
    label: "평가",
    href: "/reviews",
    icon: ClipboardCheck,
    ready: true,
    prefixes: ["/reviews", "/admin/reviews"],
    sections: [
      {
        key: "main",
        items: [
          {
            key: "review-mine",
            label: "내 평가",
            href: "/reviews",
            icon: ClipboardCheck,
          },
        ],
      },
      adminSection([
        {
          key: "admin-reviews",
          label: "평가 사이클 관리",
          href: "/admin/reviews",
          icon: ClipboardList,
        },
      ]),
    ],
  },
  {
    key: "project",
    label: "프로젝트",
    href: "/projects",
    icon: FolderKanban,
    ready: true,
    prefixes: ["/projects"],
    primaryAction: {
      label: "새 프로젝트",
      href: "/projects/new",
      icon: FilePlus2,
      roles: ["manager", "system_admin"],
    },
    sections: [
      {
        key: "main",
        items: [
          {
            key: "project-list",
            label: "프로젝트 목록",
            href: "/projects",
            icon: FolderKanban,
            prefixes: ["/projects"],
          },
        ],
      },
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
        title: "결재하기",
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
      {
        key: "main",
        items: [
          {
            /*
             * prefixes를 두지 않는다. /board/:id에는 이미 board/layout.tsx가
             * 꽂아 준 게시판 항목이 활성으로 서 있어서, 여기까지 활성이 되면
             * 한 패널에서 두 곳이 동시에 강조된다. /board는 첫 게시판으로
             * 리다이렉트하는 입구라 정확히 그 경로에서만 활성이면 된다.
             */
            key: "board-list",
            label: "게시판",
            href: "/board",
            icon: Megaphone,
          },
        ],
      },
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
    /*
     * 동호회는 "가입이 필요한 게시판"이라 게시판 모듈 안에 두고 있었다(스펙 16 · 1장).
     * 데이터 모델은 그 말이 맞지만 이용자에게는 공지·자유게시판과 다른 목적지다 —
     * 레일을 묶지 않는 정책으로 바꾸면서 개별 모듈로 올린다.
     * 라우트(/community/*)와 board_type 구분은 그대로다.
     */
    key: "community",
    label: "동호회",
    href: "/community",
    icon: UsersRound,
    ready: true,
    prefixes: ["/community", "/admin/community"],
    sections: [
      {
        key: "main",
        items: [
          {
            key: "community-list",
            label: "동호회",
            href: "/community",
            icon: UsersRound,
            prefixes: ["/community"],
          },
        ],
      },
      adminSection([
        {
          key: "admin-community",
          label: "동호회 관리",
          href: "/admin/community",
          icon: UsersRound,
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
    /*
     * 위키는 파일함 모듈 안에 있었다. "사내 문서를 찾는다"는 같은 행동이라는
     * 이유였는데, 스펙 14 · 5장이 나눠 둔 대로 위키는 텍스트 협업 문서고
     * 파일함은 실제 파일이다. 편집 흐름이 완전히 다르므로 레일에 따로 세운다.
     */
    key: "wiki",
    label: "위키",
    href: "/wiki",
    icon: BookOpen,
    ready: true,
    prefixes: ["/wiki"],
    primaryAction: { label: "새 문서", href: "/wiki/new", icon: FilePlus2 },
    sections: [
      {
        key: "main",
        items: [
          { key: "wiki-list", label: "위키 문서", href: "/wiki", icon: BookOpen },
        ],
      },
    ],
  },
  {
    key: "asset",
    label: "자산",
    href: "/assets",
    icon: Boxes,
    ready: true,
    prefixes: ["/assets", "/admin/assets"],
    sections: [
      {
        key: "main",
        items: [
          { key: "assets-list", label: "자산 목록", href: "/assets", icon: Boxes },
          {
            key: "assets-my",
            label: "내 대여 현황",
            href: "/assets/my-loans",
            icon: PackageOpen,
          },
        ],
      },
      adminSection([
        {
          key: "admin-assets",
          label: "자산 관리",
          href: "/admin/assets",
          icon: Settings,
        },
      ]),
    ],
  },
  {
    key: "welfare",
    label: "복지포인트",
    short: "복지",
    href: "/welfare",
    icon: Gift,
    ready: true,
    prefixes: ["/welfare", "/admin/welfare"],
    sections: [
      {
        key: "main",
        items: [
          {
            key: "welfare-mine",
            label: "복지포인트",
            href: "/welfare",
            icon: Gift,
          },
        ],
      },
      adminSection([
        {
          key: "admin-welfare",
          label: "복지포인트 관리",
          href: "/admin/welfare",
          icon: Gift,
        },
      ]),
    ],
  },
  {
    /*
     * ESS 3종 (13-ess.md) — 인사·급여·계약. 다우 ESS는 별도 서브앱이지만
     * 우리는 기존 셸에 모듈 3개로 얹는다. 레일 순서는 다우처럼 뒤쪽 —
     * 복지포인트 다음, 시스템 앞.
     *
     * /hr의 인사카드 탭(?tab=appointments·projects·contracts)은 패널 항목이
     * 아니다 — 항목은 '내 인사정보'(/hr)와 '증명서 발급 신청'
     * (/hr?tab=certificates) 둘뿐이고, 탭 파라미터 규약은 /directory?tab=과
     * 같아서 isChildActive가 그대로 동작한다.
     */
    key: "hr",
    label: "인사",
    href: "/hr",
    icon: IdCard,
    ready: true,
    prefixes: ["/hr", "/admin/hr"],
    sections: [
      {
        key: "main",
        items: [
          {
            key: "hr-card",
            label: "내 인사정보",
            href: "/hr",
            icon: IdCard,
          },
          {
            key: "hr-certificates",
            label: "증명서 발급 신청",
            href: "/hr?tab=certificates",
            icon: FileText,
          },
        ],
      },
      adminSection([
        {
          key: "admin-hr",
          label: "증명서 발급 관리",
          href: "/admin/hr",
          icon: Stamp,
        },
      ]),
    ],
  },
  {
    /*
     * 급여 화면(/payroll·/admin/payroll)은 담당 A의 라우트다 — nav는 이
     * 파일의 유일 수정자(담당 B)가 세 모듈을 한 번에 올린다(13-ess.md).
     * payroll_* 데이터는 본인 + system_admin만 본다(프로젝트 보안 규약 5) —
     * 그래서 이 모듈에는 manager용 섹션이 없다.
     */
    key: "payroll",
    label: "급여",
    href: "/payroll",
    icon: Wallet,
    ready: true,
    prefixes: ["/payroll", "/admin/payroll"],
    sections: [
      {
        key: "main",
        items: [
          {
            key: "payroll-mine",
            label: "내 급여",
            href: "/payroll",
            icon: Wallet,
          },
        ],
      },
      adminSection([
        {
          key: "admin-payroll",
          label: "급여 관리",
          href: "/admin/payroll",
          icon: Banknote,
        },
      ]),
    ],
  },
  {
    /* 계약 화면(/contracts·/admin/contracts)도 담당 A의 라우트다 */
    key: "contracts",
    label: "계약",
    href: "/contracts",
    icon: FileSignature,
    ready: true,
    prefixes: ["/contracts", "/admin/contracts"],
    sections: [
      {
        key: "main",
        items: [
          {
            key: "contracts-mine",
            label: "내 계약서",
            href: "/contracts",
            icon: FileSignature,
          },
        ],
      },
      adminSection([
        {
          key: "admin-contracts",
          label: "계약 관리",
          href: "/admin/contracts",
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
    /*
     * 다른 모듈이 가져간 /admin/* 는 제외되고 개요·감사로그만 남는다.
     * resolveModule이 "가장 긴 prefix"를 고르기 때문에 /admin/employees는
     * 조직도(15자)가 시스템(6자)을 이긴다 — 이 배열에 하위 경로를 나열하지 않는다.
     */
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

/** 역할 검사까지 끝낸 패널 주요 액션 — 이 역할이 볼 수 없으면 null */
export function visiblePrimaryAction(
  module: NavModule,
  role: RoleName,
): NonNullable<NavModule["primaryAction"]> | null {
  const action = module.primaryAction;
  return action && allowed(action.roles, role) ? action : null;
}

/**
 * 이 역할에게 패널을 그릴 내용이 있는가.
 *
 * AppShell의 본문 들여쓰기(pl-shell/pl-rail)와 ModulePanel의 렌더 여부는
 * 반드시 같은 답을 봐야 한다. 서로 다른 판정을 들고 있으면 — 예전 AppShell은
 * 역할 필터 없이 원시 sections/primaryAction만 봤다 — 섹션 전체가 역할
 * 제한인 모듈에서 일반 직원 화면이 "패널은 없는데 본문만 324px 들여쓰기"가
 * 되어 260px 죽은 여백이 생긴다. 두 쪽 다 이 함수(또는 정확히 같은 원시
 * 함수 조합: visibleChildSections + visiblePrimaryAction)만 쓴다.
 */
export function hasPanel(module: NavModule, role: RoleName): boolean {
  return (
    visibleChildSections(module, role).length > 0 ||
    !!visiblePrimaryAction(module, role)
  );
}

/**
 * 즐겨찾기로 추가 가능한 항목 — 모듈과 하위 화면 전부.
 *
 * 묶음을 풀면서 모듈 href와 첫 하위 항목 href가 같아진 모듈이 늘었다
 * (할일 = /todos = "내 할일"). 같은 주소가 목록에 두 번 뜨면 하나는 별이
 * 켜지고 하나는 꺼진 것처럼 보이므로(즐겨찾기 판정이 target_path 문자열 비교다)
 * href 기준으로 접는다. 모듈이 먼저 오니 짧은 라벨이 살아남는다.
 */
export function favoritableItems(
  role: RoleName,
): { key: string; label: string; href: string }[] {
  const out: { key: string; label: string; href: string }[] = [];
  const seen = new Set<string>();
  const push = (item: { key: string; label: string; href: string }) => {
    if (seen.has(item.href)) return;
    seen.add(item.href);
    out.push(item);
  };

  for (const mod of visibleModules(role)) {
    if (!mod.ready) continue;
    push({ key: mod.key, label: mod.label, href: mod.href });
    for (const section of visibleChildSections(mod, role)) {
      for (const item of section.items) {
        if (item.ready === false) continue;
        push({
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

  /*
   * 쿼리로 갈리는 탭(/directory?tab=people)은 해당 파라미터까지 일치해야 한다.
   * box·filter는 메일함/빠른검색 구분자다(12-mail.md — /mail?box=sent,
   * /mail?filter=unread). 여기 없으면 쿼리 없는 "/mail" 항목(받은메일함)이
   * 보낸메일함·빠른검색 화면에서도 활성으로 남는다.
   */
  if (!itemQuery) {
    const params = new URLSearchParams(search);
    return (
      !params.has("tab") &&
      !params.has("view") &&
      !params.has("box") &&
      !params.has("filter")
    );
  }

  const want = new URLSearchParams(itemQuery);
  const have = new URLSearchParams(search);
  let matched = true;
  want.forEach((value, key) => {
    if (have.get(key) !== value) matched = false;
  });
  return matched;
}
