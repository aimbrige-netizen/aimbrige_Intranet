import Link from "next/link";
import { FolderOpen, Library, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/files", label: "개인 파일함", icon: FolderOpen },
  { href: "/files/team", label: "팀 공유폴더", icon: Users },
  { href: "/files/library", label: "사내 규정", icon: Library },
] as const;

export function FileTabs({ active }: { active: string }) {
  return (
    <div className="mb-4 inline-flex rounded-lg border border-line bg-surface p-0.5">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const selected = active === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-body transition-colors",
              selected
                ? "bg-primary text-white"
                : "text-muted hover:bg-canvas hover:text-ink",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
