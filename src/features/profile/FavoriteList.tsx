"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { removeFavoriteById } from "@/server/actions/favorites";
import type { Favorite } from "@/types/db";

/** 즐겨찾기 관리 — 목록 표시 + 개별 삭제 (스펙 3.7) */
export function FavoriteList({
  favorites,
}: {
  favorites: Pick<Favorite, "id" | "label" | "target_path">[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (favorites.length === 0) {
    return (
      <EmptyState
        icon={Star}
        title="즐겨찾기가 비어 있습니다"
        description="사이드바 메뉴를 우클릭하거나 ⋮ 메뉴에서 추가할 수 있습니다."
        compact
      />
    );
  }

  const remove = (id: string) => {
    startTransition(async () => {
      await removeFavoriteById(id);
      router.refresh();
    });
  };

  return (
    <ul className="divide-y divide-line">
      {favorites.map((favorite) => (
        <li
          key={favorite.id}
          className="flex items-center justify-between gap-3 py-2.5"
        >
          <Link
            href={favorite.target_path}
            className="flex min-w-0 items-center gap-2 hover:underline"
          >
            <Star className="size-4 shrink-0 fill-warn text-warn" aria-hidden />
            <span className="truncate text-body text-ink">{favorite.label}</span>
            <span className="shrink-0 text-caption">{favorite.target_path}</span>
          </Link>
          <button
            type="button"
            onClick={() => remove(favorite.id)}
            disabled={pending}
            className="shrink-0 rounded-sm p-1.5 text-muted transition-colors hover:bg-danger-light hover:text-danger disabled:opacity-50"
            aria-label={`${favorite.label} 즐겨찾기 삭제`}
          >
            <Trash2 className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}
