"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { createBoard, deleteBoard } from "@/server/actions/boards";
import {
  BOARD_TYPE_LABELS,
  type BoardType,
  type BoardWithDepartment,
} from "./types";

/** 게시판 관리 (스펙 3.4) — 시스템 관리자 전용 */
export function BoardManager({
  boards,
  departments,
}: {
  boards: BoardWithDepartment[];
  departments: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [boardType, setBoardType] = useState<BoardType>("notice");
  const [departmentId, setDepartmentId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await createBoard({ name, boardType, departmentId });
      if (result.ok) {
        setOpen(false);
        setName("");
        setDepartmentId("");
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message ?? null);
    });
  };

  const remove = (board: BoardWithDepartment) => {
    if (!window.confirm(`"${board.name}" 게시판을 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      const result = await deleteBoard(board.id);
      if (!result.ok) {
        window.alert(result.message ?? "삭제하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-caption">게시판 {boards.length}개</p>
        <Button
          size="small"
          onClick={() => {
            setName("");
            setBoardType("notice");
            setDepartmentId("");
            setErrors({});
            setMessage(null);
            setOpen(true);
          }}
        >
          <Plus className="size-3.5" />
          게시판 추가
        </Button>
      </div>

      {boards.length === 0 ? (
        <EmptyState icon={Megaphone} title="게시판이 없습니다" />
      ) : (
        <div className="overflow-x-auto">
          <table className="ab-table min-w-[560px]">
            <thead>
              <tr>
                <th>이름</th>
                <th>타입</th>
                <th>소속 부서</th>
                <th className="w-20">관리</th>
              </tr>
            </thead>
            <tbody>
              {boards.map((board) => (
                <tr key={board.id}>
                  <td className="font-bold text-ink">{board.name}</td>
                  <td>
                    <Badge
                      tone={board.board_type === "notice" ? "primary" : "neutral"}
                    >
                      {BOARD_TYPE_LABELS[board.board_type]}
                    </Badge>
                  </td>
                  <td>{board.department?.name ?? "전사"}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => remove(board)}
                      disabled={pending}
                      aria-label={`${board.name} 삭제`}
                      className="rounded-sm p-1.5 text-muted transition-colors hover:bg-danger-light hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="게시판 추가"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              취소
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="이름" required htmlFor="b-name" error={errors.name}>
            <Input
              id="b-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
              invalid={!!errors.name}
              placeholder="예) 개발팀 공지"
            />
          </Field>

          <Field label="타입" required htmlFor="b-type">
            <Select
              id="b-type"
              value={boardType}
              onChange={(e) => setBoardType(e.target.value as BoardType)}
              disabled={pending}
              className="md:max-w-52"
            >
              <option value="notice">공지 (팀장 이상 작성)</option>
              <option value="discussion">자유게시판 (전체 작성)</option>
            </Select>
          </Field>

          {/* 부서 지정은 공지 타입만 (DB CHECK 제약과 동일) */}
          {boardType === "notice" ? (
            <Field
              label="소속 부서"
              htmlFor="b-dept"
              hint="선택하지 않으면 전사 공지가 됩니다."
            >
              <Select
                id="b-dept"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                disabled={pending}
              >
                <option value="">전사</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {message ? <p className="text-label text-danger">{message}</p> : null}
        </div>
      </Modal>
    </>
  );
}
