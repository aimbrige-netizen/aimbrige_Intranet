"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Network, List, Contact, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { OrgTree } from "@/features/directory/OrgTree";
import { OrgEditor } from "@/features/directory/OrgEditor";
import { EmployeeListView } from "@/features/directory/EmployeeListView";
import { ExternalContacts } from "@/features/directory/ExternalContacts";
import type { Department, ExternalContactWithCreator, Team } from "@/types/db";
import type { DirectoryEmployee } from "@/features/directory/data";

type TabKey = "org" | "list" | "external";

const TABS: { key: TabKey; label: string; icon: typeof Network }[] = [
  { key: "org", label: "조직도 뷰", icon: Network },
  { key: "list", label: "목록 뷰", icon: List },
  { key: "external", label: "외부연락처", icon: Contact },
];

/** 조직도/디렉토리 상단 탭 (스펙 02 · 3.1, 3.3) */
export function DirectoryTabs({
  activeTab,
  employees,
  departments,
  teams,
  contacts,
  currentEmployeeId,
  isSystemAdmin,
  includeInactive,
}: {
  activeTab: TabKey;
  employees: DirectoryEmployee[];
  departments: Department[];
  teams: Team[];
  contacts: ExternalContactWithCreator[];
  currentEmployeeId: string;
  isSystemAdmin: boolean;
  includeInactive: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [editMode, setEditMode] = useState(false);

  const setParam = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(patch).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    const search = params.toString();
    router.push(search ? `/directory?${search}` : "/directory");
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          className="inline-flex rounded-lg border border-line bg-surface p-0.5"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() =>
                  setParam({ tab: tab.key === "org" ? null : tab.key })
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-body transition-colors",
                  selected
                    ? "bg-primary text-white"
                    : "text-muted hover:bg-canvas hover:text-ink",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* 편집 모드는 시스템 관리자에게만 노출 (스펙 3.1) */}
        {activeTab === "org" && isSystemAdmin ? (
          <Button
            size="sm"
            variant={editMode ? "primary" : "secondary"}
            onClick={() => setEditMode((v) => !v)}
          >
            <Pencil className="size-3.5" />
            {editMode ? "편집 종료" : "편집 모드"}
          </Button>
        ) : null}
      </div>

      {activeTab === "org" ? (
        <div className="space-y-4">
          {editMode ? (
            <Card>
              <CardBody>
                <OrgEditor
                  departments={departments}
                  teams={teams}
                  managerOptions={employees.map((e) => ({
                    id: e.id,
                    name: e.name,
                  }))}
                />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardBody>
              <OrgTree
                departments={departments}
                teams={teams}
                employees={employees}
              />
            </CardBody>
          </Card>
        </div>
      ) : null}

      {activeTab === "list" ? (
        <Card>
          <CardBody>
            <EmployeeListView
              employees={employees}
              departments={departments}
              teams={teams}
              canToggleInactive={isSystemAdmin}
              includeInactive={includeInactive}
              onToggleInactive={(next) =>
                setParam({ inactive: next ? "1" : null })
              }
            />
          </CardBody>
        </Card>
      ) : null}

      {activeTab === "external" ? (
        <Card>
          <CardBody>
            <ExternalContacts
              contacts={contacts}
              currentEmployeeId={currentEmployeeId}
              isSystemAdmin={isSystemAdmin}
            />
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
