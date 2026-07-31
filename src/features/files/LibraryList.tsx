"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { CalendarClock, ExternalLink, FolderTree, Library } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card, CardBody, SectionHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
import {
  FilterChip,
  TableToolbar,
  ToolbarSearch,
} from "@/components/ui/TableToolbar";
import { FILE_KINDS, kindOf, relativeDay } from "@/features/files/format";
import { formatDate } from "@/lib/utils";

export interface LibraryRow {
  id: string;
  driveFileId: string;
  displayName: string;
  category: string | null;
  description: string | null;
  webViewLink: string | null;
  /** Drive에서 읽어온 값들 — 연결이 끊기면 null이 된다 */
  mimeType: string | null;
  modifiedTime: string | null;
  /** 라이브러리에 등록된 날짜 (DB) */
  registeredAt: string | null;
}

const RECENT_DAYS = 30;
const OTHER = "기타";

function isRecent(row: LibraryRow, now: number): boolean {
  const stamp = row.modifiedTime ?? row.registeredAt;
  if (!stamp) return false;
  const time = new Date(stamp).getTime();
  if (Number.isNaN(time)) return false;
  return now - time <= RECENT_DAYS * 86_400_000;
}

/**
 * 사내 규정 라이브러리.
 *
 * 예전에는 카테고리 카드 안의 세로 목록이라 한 문서가 담는 정보가
 * 제목 한 줄 + 잘린 설명 한 줄이 전부였다. "어느 게 최신이고 무슨 형식인지"를
 * 판단할 근거가 없어서, 결국 전부 열어봐야 했다.
 */
export function LibraryList({
  documents,
  canManage = false,
}: {
  documents: LibraryRow[];
  canManage?: boolean;
}) {
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const deferred = useDeferredValue(keyword);
  const now = Date.now();

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    documents.forEach((doc) => {
      const key = doc.category ?? OTHER;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], "ko"),
    );
  }, [documents]);

  const filtered = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    return documents.filter((doc) => {
      if (category && (doc.category ?? OTHER) !== category) return false;
      if (!q) return true;
      return (
        doc.displayName.toLowerCase().includes(q) ||
        (doc.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [documents, deferred, category]);

  const grouped = useMemo(() => {
    const map = new Map<string, LibraryRow[]>();
    filtered.forEach((doc) => {
      const key = doc.category ?? OTHER;
      map.set(key, [...(map.get(key) ?? []), doc]);
    });
    return Array.from(map.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], "ko"),
    );
  }, [filtered]);

  const recentCount = documents.filter((doc) => isRecent(doc, now)).length;
  const latest = documents.reduce<string | null>((acc, doc) => {
    const stamp = doc.modifiedTime ?? doc.registeredAt;
    if (!stamp) return acc;
    return !acc || stamp > acc ? stamp : acc;
  }, null);

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard
          label="표시 중 문서"
          value={filtered.length}
          unit="건"
          denominator={documents.length}
          denominatorUnit="건"
          tone="neutral"
          icon={Library}
          max={documents.length || 1}
          meterValue={filtered.length}
          sub={category ? `${category} 카테고리` : "전체 카테고리"}
        />
        <StatCard
          label="카테고리"
          value={categories.length}
          unit="개"
          denominator={documents.length}
          denominatorUnit="건"
          tone="neutral"
          icon={FolderTree}
          sub={
            categories.length
              ? categories
                  .map(([name, count]) => `${name} ${count}`)
                  .slice(0, 3)
                  .join(" · ")
              : "등록된 카테고리가 없습니다"
          }
        />
        <StatCard
          label={`최근 ${RECENT_DAYS}일 개정`}
          value={recentCount}
          unit="건"
          denominator={documents.length}
          denominatorUnit="건"
          tone="informative"
          icon={CalendarClock}
          max={documents.length || 1}
          meterValue={recentCount}
          state={documents.length === 0 ? "empty" : "ok"}
          sub={latest ? `마지막 개정 ${formatDate(latest)}` : undefined}
        />
      </div>

      <TableToolbar
        search={
          <ToolbarSearch
            value={keyword}
            onChange={setKeyword}
            placeholder="문서 이름·설명 검색"
          />
        }
        filters={
          <>
            <FilterChip
              active={category === null}
              count={documents.length}
              onClick={() => setCategory(null)}
            >
              전체
            </FilterChip>
            {categories.map(([name, count]) => (
              <FilterChip
                key={name}
                active={category === name}
                count={count}
                onClick={() => setCategory(category === name ? null : name)}
              >
                {name}
              </FilterChip>
            ))}
          </>
        }
        count={`${filtered.length}건`}
      />

      {grouped.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={Library}
              title={
                documents.length === 0
                  ? "등록된 문서가 없습니다"
                  : "검색 결과가 없습니다"
              }
              description={
                documents.length === 0
                  ? "계약서 템플릿·사규·복지제도 문서를 등록하면 여기에 모입니다."
                  : "검색어나 카테고리 필터를 지우면 전체가 다시 보입니다."
              }
              action={
                documents.length === 0 ? (
                  canManage ? (
                    <LinkButton href="/admin/files" size="small">
                      문서 등록
                    </LinkButton>
                  ) : null
                ) : (
                  <LinkButton href="/files/library" size="small" variant="secondary">
                    필터 지우기
                  </LinkButton>
                )
              }
            />
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([name, items]) => (
            <section key={name}>
              <SectionHeader
                title={
                  <span className="flex items-center gap-2">
                    {name}
                    <Badge tone="neutral">{items.length}</Badge>
                  </span>
                }
              />
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {items.map((doc) => (
                  <DocumentCard key={doc.id} doc={doc} recent={isRecent(doc, now)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function DocumentCard({ doc, recent }: { doc: LibraryRow; recent: boolean }) {
  const kind = kindOf(doc.mimeType);
  const meta = FILE_KINDS[kind];
  const Icon = meta.icon;
  const revised = doc.modifiedTime ?? doc.registeredAt;

  return (
    <a
      href={
        doc.webViewLink ??
        `https://drive.google.com/file/d/${doc.driveFileId}/view`
      }
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col rounded-card border border-line bg-surface p-4 transition-colors duration-fast ease-standard hover:border-line-strong"
    >
      <span className="flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-subtle text-muted">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-1.5">
            <span className="min-w-0 flex-1 text-body-sm font-bold leading-snug text-ink">
              {doc.displayName}
            </span>
            {recent ? <Badge tone="info">최근 개정</Badge> : null}
          </span>
          {doc.description ? (
            <span className="mt-1 block text-label leading-relaxed text-muted">
              {doc.description}
            </span>
          ) : null}
        </span>
        <ExternalLink className="size-3.5 shrink-0 text-muted" aria-hidden />
      </span>

      <span className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-2.5 text-nano text-muted">
        <span>{meta.label}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">
          {revised ? `최종 개정 ${formatDate(revised)}` : "개정일 확인 불가"}
        </span>
        {revised ? (
          <>
            <span aria-hidden>·</span>
            <span>{relativeDay(revised)}</span>
          </>
        ) : null}
      </span>
    </a>
  );
}
