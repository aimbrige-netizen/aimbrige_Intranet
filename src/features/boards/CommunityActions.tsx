"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import {
  archiveCommunity,
  createCommunity,
  deleteBoard,
  joinCommunity,
  leaveCommunity,
  unarchiveCommunity,
} from "@/server/actions/boards";

/**
 * 동호회 개설 (스펙 16 · 3.1) — 전 임직원.
 *
 * 관리자 전용 '게시판 추가'(BoardManager)와 경로가 다르다. 여기서 boards에
 * 직접 INSERT하면 개설자 가입이 다른 문장으로 갈라져 "멤버 0명이라 아무도
 * 글을 못 쓰는 동호회"가 생길 수 있다 — 그래서 create_community() RPC만 쓴다.
 * 이름 중복·길이 검증도 그 함수가 하고, 메시지를 그대로 보여준다.
 */
export function CreateCommunityButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openModal = () => {
    setName("");
    setDescription("");
    setErrors({});
    setMessage(null);
    setOpen(true);
  };

  const submit = () => {
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await createCommunity({ name, description });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message ?? null);
        return;
      }
      setOpen(false);
      // 만든 사람은 이미 멤버다 — 바로 글을 쓸 수 있는 자리로 보낸다
      router.push(`/community/${result.boardId}`);
    });
  };

  return (
    <>
      <Button onClick={openModal}>
        <Plus className="size-4" />
        동호회 만들기
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="동호회 만들기"
        description="만든 사람이 첫 회원이 됩니다. 가입은 누구나 자유롭게 할 수 있습니다."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              취소
            </Button>
            <Button onClick={submit} disabled={pending || !name.trim()}>
              {pending ? "만드는 중…" : "만들기"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="이름" required htmlFor="c-name" error={errors.name}>
            <Input
              id="c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
              invalid={!!errors.name}
              maxLength={60}
              placeholder="예) 러닝크루"
            />
          </Field>

          <Field
            label="소개"
            htmlFor="c-desc"
            error={errors.description}
            hint="어떤 모임인지 한두 줄로 적어 주세요. 목록 카드에 그대로 보입니다."
          >
            <Textarea
              id="c-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={pending}
              invalid={!!errors.description}
              maxLength={500}
              className="min-h-24"
            />
          </Field>

          {message ? <p className="text-label text-danger">{message}</p> : null}
        </div>
      </Modal>
    </>
  );
}

/**
 * 가입 (스펙 16 · 3.2)
 *
 * 이미 가입했거나 보관된 동호회에서는 아예 렌더하지 않는다 — 호출부가
 * 판단한다. 눌러도 안 되는 버튼을 disabled로 두지 않는 것이 이 프로젝트의 규약.
 */
export function JoinCommunityButton({
  boardId,
  size = "small",
  variant = "primary",
}: {
  boardId: string;
  size?: "xsmall" | "small" | "medium";
  /**
   * 상세 화면에서는 가입이 그 화면의 주요 액션이라 primary가 맞지만, 목록
   * 카드에서는 카드 수만큼 반복돼 진한 오렌지가 N개가 된다(원칙 1 위반).
   * 목록 쪽 호출부가 secondary로 내린다 — AssetActions의 '대여 신청'과 같다.
   */
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const join = () => {
    startTransition(async () => {
      const result = await joinCommunity(boardId);
      if (!result.ok) {
        window.alert(result.message ?? "가입하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <Button size={size} variant={variant} onClick={join} disabled={pending}>
      <UserPlus className="size-3.5" />
      {pending ? "가입 중…" : "가입"}
    </Button>
  );
}

/** 탈퇴 (스펙 16 · 3.2) — 보관된 동호회에서도 나갈 수 있다 */
export function LeaveCommunityButton({ boardId }: { boardId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const leave = () => {
    if (!window.confirm("이 동호회에서 탈퇴하시겠습니까?")) return;
    startTransition(async () => {
      const result = await leaveCommunity(boardId);
      if (!result.ok) {
        window.alert(result.message ?? "탈퇴하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <Button size="small" variant="secondary" onClick={leave} disabled={pending}>
      <LogOut className="size-3.5" />
      {pending ? "탈퇴 중…" : "탈퇴"}
    </Button>
  );
}

/**
 * 관리자용 보관 / 보관 해제 / 삭제 (스펙 16 · 3.3)
 *
 * 삭제는 글이 0건일 때만 열어 준다 — deleteBoard()가 글 있는 게시판을
 * 거부하는 원칙은 그대로 두고, 부적절한 동호회는 보관으로 내린다.
 */
export function CommunityAdminActions({
  boardId,
  archived,
  postCount,
}: {
  boardId: string;
  archived: boolean;
  postCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (
    action: () => Promise<{ ok: boolean; message?: string }>,
    confirmText?: string,
  ) => {
    if (confirmText && !window.confirm(confirmText)) return;
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        window.alert(result.message ?? "처리하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {archived ? (
        <Button
          size="xsmall"
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => unarchiveCommunity(boardId))}
        >
          복구
        </Button>
      ) : (
        <Button
          size="xsmall"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(
              () => archiveCommunity(boardId),
              "이 동호회를 보관하시겠습니까? 글은 지워지지 않고 목록에서만 사라집니다.",
            )
          }
        >
          보관
        </Button>
      )}

      {/* 글이 남아 있으면 삭제 경로 자체를 보여주지 않는다 */}
      {postCount === 0 ? (
        <Button
          size="xsmall"
          variant="ghost"
          disabled={pending}
          className="!text-danger hover:!bg-danger-light"
          onClick={() =>
            run(
              () => deleteBoard(boardId),
              "이 동호회를 완전히 삭제하시겠습니까? 되돌릴 수 없습니다.",
            )
          }
        >
          삭제
        </Button>
      ) : null}
    </div>
  );
}
