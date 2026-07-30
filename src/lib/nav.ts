import {
  Boxes,
  Building2,
  Calendar,
  CalendarOff,
  ClipboardList,
  Clock,
  FileCheck,
  FolderOpen,
  GitBranch,
  House,
  Megaphone,
  ScrollText,
  Shield,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { RoleName } from "@/types/db";

export interface NavItem {
  key: string;
  label: string;
  /** 76px 레일에 들어갈 짧은 라벨. 없으면 label을 그대로 쓴다 */
  short?: string;
  href: string;
  icon: LucideIcon;
  /** false면 '준비중' 처리 — 해당 모듈 스펙 작업 때 true로 바꾼다 */
  ready: boolean;
  /** 지정된 역할만 노출. 비우면 전체 */
  roles?: RoleName[];
  /** 어느 스펙에서 구현되는지 (준비중 안내에 사용) */
  spec?: string;
}

export interface NavSection {
  key: string;
  title?: string;
  items: NavItem[];
  roles?: RoleName[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    key: "main",
    items: [
      { key: "home", label: "홈", href: "/", icon: House, ready: true },
      {
        key: "org",
        label: "조직도",
        href: "/directory",
        icon: Users,
        ready: true,
      },
      {
        key: "calendar",
        label: "캘린더",
        href: "/calendar",
        icon: Calendar,
        ready: true,
      },
      {
        key: "attendance",
        label: "근태",
        href: "/attendance",
        icon: Clock,
        ready: true,
      },
      {
        key: "approval",
        label: "전자결재",
        short: "결재",
        href: "/approvals",
        icon: FileCheck,
        ready: true,
      },
      {
        key: "board",
        label: "게시판",
        href: "/board",
        icon: Megaphone,
        ready: false,
        spec: "스펙 05 게시판·공지사항",
      },
      {
        key: "drive",
        label: "파일함",
        href: "/drive",
        icon: FolderOpen,
        ready: false,
        spec: "스펙 06 개인 파일함",
      },
    ],
  },
  {
    key: "admin",
    title: "관리자",
    roles: ["system_admin"],
    items: [
      {
        key: "admin-employees",
        label: "임직원 관리",
        short: "임직원",
        href: "/admin/employees",
        icon: Building2,
        ready: true,
        roles: ["system_admin"],
      },
      {
        key: "admin-roles",
        label: "권한관리",
        short: "권한",
        href: "/admin/roles",
        icon: Shield,
        ready: true,
        roles: ["system_admin"],
      },
      {
        key: "admin-resources",
        label: "리소스 관리",
        short: "리소스",
        href: "/admin/resources",
        icon: Boxes,
        ready: true,
        roles: ["system_admin"],
      },
      {
        key: "admin-holidays",
        label: "휴일 관리",
        short: "휴일",
        href: "/admin/holidays",
        icon: CalendarOff,
        ready: true,
        roles: ["system_admin"],
      },
      {
        key: "admin-attendance",
        label: "근태 관리",
        short: "근태관리",
        href: "/admin/attendance",
        icon: ClipboardList,
        ready: true,
        roles: ["system_admin"],
      },
      {
        key: "admin-approval-lines",
        label: "결재라인 설정",
        short: "결재라인",
        href: "/admin/approval-lines",
        icon: GitBranch,
        ready: true,
        roles: ["system_admin"],
      },
      {
        key: "admin-audit",
        label: "감사 로그",
        short: "감사로그",
        href: "/admin/audit-logs",
        icon: ScrollText,
        ready: true,
        roles: ["system_admin"],
      },
    ],
  },
];

/** 역할에 맞는 메뉴만 걸러낸다 */
export function visibleSections(role: RoleName): NavSection[] {
  return NAV_SECTIONS.filter(
    (section) => !section.roles || section.roles.includes(role),
  ).map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.roles || item.roles.includes(role),
    ),
  }));
}

/** 즐겨찾기로 추가 가능한 메뉴(준비된 것만) */
export function favoritableItems(role: RoleName): NavItem[] {
  return visibleSections(role)
    .flatMap((section) => section.items)
    .filter((item) => item.ready);
}
