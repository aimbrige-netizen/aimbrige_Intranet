"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { ExternalLink, Library, Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export interface LibraryRow {
  id: string;
  driveFileId: string;
  displayName: string;
  category: string | null;
  description: string | null;
  webViewLink: string | null;
}

/**
 * 사내 규정 라이브러리 (스펙 3.3)
 * 실제 Drive 파일명이 아니라 관리자가 등록한 표시이름으로 보여준다.
 */
export function LibraryList({ documents }: { documents: LibraryRow[] }) {
  const [keyword, setKeyword] = useState("");
  const deferred = useDeferredValue(keyword);

  const grouped = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    const filtered = q
      ? documents.filter(
          (d) =>
            d.displayName.toLowerCase().includes(q) ||
            (d.description ?? "").toLowerCase().includes(q),
        )
      : documents;

    const map = new Map<string, LibraryRow[]>();
    filtered.forEach((doc) => {
      const key = doc.category ?? "기타";
      map.set(key, [...(map.get(key) ?? []), doc]);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [documents, deferred]);

  const total = grouped.reduce((sum, [, items]) => sum + items.length, 0);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 md:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="문서 이름 검색"
            aria-label="문서 검색"
            className="h-9 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-body placeholder:text-muted focus:border-primary"
          />
        </div>
        <span className="text-caption">{total}건</span>
      </div>

      {total === 0 ? (
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
                  ? "시스템 관리자가 파일함 관리에서 계약서·사규·복지제도 문서를 등록할 수 있습니다."
                  : undefined
              }
            />
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([category, items]) => (
            <Card key={category}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {category}
                    <Badge tone="neutral">{items.length}</Badge>
                  </span>
                }
              />
              <CardBody className="p-0">
                <ul className="divide-y divide-line">
                  {items.map((doc) => (
                    <li key={doc.id}>
                      <a
                        href={
                          doc.webViewLink ??
                          `https://drive.google.com/file/d/${doc.driveFileId}/view`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-canvas"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body text-ink">
                            {doc.displayName}
                          </span>
                          {doc.description ? (
                            <span className="block truncate text-caption">
                              {doc.description}
                            </span>
                          ) : null}
                        </span>
                        <ExternalLink
                          className="size-3.5 shrink-0 text-muted"
                          aria-hidden
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
