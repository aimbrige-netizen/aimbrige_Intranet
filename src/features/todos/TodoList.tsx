"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GripVertical,
  ListChecks,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Field";
import { FilterChip, TableToolbar } from "@/components/ui/TableToolbar";
import {
  createTodo,
  deleteTodo,
  reorderTodos,
  setTodoCompleted,
  type TodoActionResult,
} from "@/server/actions/todos";
import { cn } from "@/lib/utils";
import { completedYmd, DUE_TEXT_CLASS, dueMeta } from "./format";
import { TODO_FILTER_LABELS, type Todo, type TodoFilter } from "./types";

/**
 * 할일 체크리스트 (스펙 09 · 3.2)
 *
 * 매일 여러 번 쓰는 화면이라 추가 입력을 목록 맨 위에 상시 노출한다.
 * 모달을 열게 하면 "생각난 김에 한 줄" 이 세 번의 클릭이 된다.
 *
 * 순서 변경은 드래그와 위/아래 버튼 두 경로를 모두 준다.
 * 드래그만 있으면 키보드·보조기술 사용자에게는 순서를 바꿀 수단이 아예 없다.
 */
export function TodoList({ todos, today }: { todos: Todo[]; today: string }) {
  const router = useRouter();

  /*
   * 서버 값을 그대로 두고 낙관적으로 먼저 그린다. 체크와 드래그는 응답을
   * 기다리는 동안 화면이 멈추면 조작감이 무너진다. 액션이 끝나면 refresh로
   * 서버 값이 다시 내려와 이 상태를 덮는다(아래 useEffect).
   */
  const [rows, setRows] = useState<Todo[]>(todos);
  useEffect(() => setRows(todos), [todos]);

  const [filter, setFilter] = useState<TodoFilter>("all");
  const [doneOpen, setDoneOpen] = useState(false);
  const [content, setContent] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** 순서 변경 결과를 스크린리더에 알린다 — 드래그는 시각 피드백뿐이다 */
  const [notice, setNotice] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const inputRef = useRef<HTMLInputElement>(null);

  const openRows = rows.filter((r) => !r.is_completed);
  const doneRows = rows.filter((r) => r.is_completed);

  const messageOf = (result: TodoActionResult) =>
    result.message ??
    Object.values(result.fieldErrors ?? {})[0] ??
    "처리하지 못했습니다.";

  /** 액션 하나를 실행하고 서버 값으로 다시 맞춘다 */
  const run = (fn: () => Promise<TodoActionResult>) => {
    startTransition(async () => {
      const result = await fn();
      // 실패해도 refresh한다 — 낙관적으로 그린 화면을 서버 값으로 되돌린다
      setError(result.ok ? null : messageOf(result));
      router.refresh();
    });
  };

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    // 저장 중 엔터를 두 번 치면 같은 줄이 두 개 생긴다
    if (pending) return;

    const text = content.trim();
    if (!text) {
      setError("할 일을 입력하세요.");
      inputRef.current?.focus();
      return;
    }

    startTransition(async () => {
      const result = await createTodo({ content: text, dueDate: due });
      if (!result.ok) {
        setError(messageOf(result));
        return;
      }
      setError(null);
      setContent("");
      setDue("");
      inputRef.current?.focus();
      router.refresh();
    });
  };

  const toggle = (todo: Todo) => {
    const next = !todo.is_completed;
    // 완료 표시와 완료 시각은 DB에서도 화면에서도 항상 짝으로 움직인다
    setRows((prev) =>
      prev.map((r) =>
        r.id === todo.id
          ? {
              ...r,
              is_completed: next,
              completed_at: next ? new Date().toISOString() : null,
            }
          : r,
      ),
    );
    if (next) setNotice(`완료 처리했습니다 — ${todo.content}`);
    run(() => setTodoCompleted(todo.id, next));
  };

  const remove = (todo: Todo) => {
    if (!window.confirm(`"${todo.content}"을(를) 삭제하시겠습니까?`)) return;
    setRows((prev) => prev.filter((r) => r.id !== todo.id));
    run(() => deleteTodo(todo.id));
  };

  /** 바뀐 순서를 화면에 먼저 반영하고 서버에 전체 순서를 보낸다 */
  const commitOrder = (nextOpen: Todo[]) => {
    setRows([...nextOpen, ...doneRows]);
    run(() => reorderTodos(nextOpen.map((r) => r.id)));
  };

  const moveTo = (from: number, to: number) => {
    if (from === to || to < 0 || to >= openRows.length) return;
    const next = [...openRows];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setNotice(`${item.content} — ${to + 1}번째로 옮겼습니다`);
    commitOrder(next);
  };

  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const from = openRows.findIndex((r) => r.id === dragId);
    const to = openRows.findIndex((r) => r.id === targetId);
    if (from < 0 || to < 0) return;
    moveTo(from, to);
  };

  const showOpen = filter !== "done";
  // 완료가 한 건도 없으면 '완료 0건' 접기 버튼 자체를 두지 않는다
  const showDone =
    filter === "done" || (filter === "all" && doneRows.length > 0);
  const doneExpanded = filter === "done" || doneOpen;
  const shown =
    filter === "all"
      ? openRows.length + (doneExpanded ? doneRows.length : 0)
      : filter === "open"
        ? openRows.length
        : doneRows.length;

  return (
    <>
      <TableToolbar
        filters={
          <>
            {(["all", "open", "done"] as const).map((key) => (
              <FilterChip
                key={key}
                active={filter === key}
                count={
                  key === "all"
                    ? rows.length
                    : key === "open"
                      ? openRows.length
                      : doneRows.length
                }
                onClick={() => setFilter(key)}
              >
                {TODO_FILTER_LABELS[key]}
              </FilterChip>
            ))}
          </>
        }
        count={`${shown}건 표시`}
      />

      {error ? (
        <Callout tone="danger" title="처리하지 못했습니다" className="mb-4">
          {error}
        </Callout>
      ) : null}

      {/*
        08 흰 시트: md+에서 카드 테두리는 흰 면 위 이중선 — 입력 밴드와
        행 구분선이 이미 구조를 그리므로 목록을 시트에 직접 놓는다(10-modules2).
        md 미만은 canvas 위 카드 문법 유지.
      */}
      <Card className="overflow-hidden md:rounded-none md:border-0">
        {/* 상시 노출 입력 — 엔터 한 번으로 추가된다 */}
        <form
          onSubmit={add}
          className="flex flex-wrap items-center gap-2 border-b border-line bg-subtle px-3 py-2.5"
        >
          {/*
            입력창은 저장 중에도 잠그지 않는다. 다른 행을 체크한 순간
            여기가 disabled로 바뀌면 치고 있던 글자가 사라진다.
          */}
          <Input
            ref={inputRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="할 일을 입력하고 Enter"
            aria-label="할 일 내용"
            maxLength={300}
            className="h-9 min-w-48 flex-1 py-0"
          />
          <Input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="마감일 (선택)"
            className="h-9 w-40 py-0"
          />
          <Button type="submit" size="small" disabled={pending}>
            <Plus className="size-4" />
            추가
          </Button>
        </form>

        {showOpen ? (
          openRows.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title={
                rows.length === 0
                  ? "아직 등록한 할일이 없습니다"
                  : "미완료 할일이 없습니다"
              }
              description="위 입력창에 한 줄 적고 Enter를 누르면 바로 목록에 올라갑니다. 마감일은 선택입니다."
              action={
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => inputRef.current?.focus()}
                >
                  할 일 적기
                </Button>
              }
              compact
              className="py-8"
            />
          ) : (
            <ul>
              {openRows.map((todo, index) => (
                <li
                  key={todo.id}
                  draggable={!pending}
                  onDragStart={(e) => {
                    setDragId(todo.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overId !== todo.id) setOverId(todo.id);
                  }}
                  onDragLeave={() => setOverId(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropOn(todo.id);
                    setDragId(null);
                    setOverId(null);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  className={cn(
                    "group flex items-center gap-2 border-b border-line px-3 py-2 transition-colors duration-fast ease-standard last:border-b-0 hover:bg-subtle",
                    dragId === todo.id && "opacity-50",
                    overId === todo.id &&
                      dragId !== todo.id &&
                      "bg-primary-light",
                  )}
                >
                  <GripVertical
                    className="size-4 shrink-0 cursor-grab text-line-strong"
                    aria-hidden
                  />
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => toggle(todo)}
                    disabled={pending}
                    aria-label={`완료 처리 — ${todo.content}`}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 flex-1 truncate text-body-sm text-ink">
                    {todo.content}
                  </span>
                  {todo.due_date ? <DueLabel due={todo.due_date} today={today} /> : null}
                  <span className="flex shrink-0 items-center gap-2">
                    <RowButton
                      label="위로 이동"
                      icon={ChevronUp}
                      disabled={pending || index === 0}
                      onClick={() => moveTo(index, index - 1)}
                    />
                    <RowButton
                      label="아래로 이동"
                      icon={ChevronDown}
                      disabled={pending || index === openRows.length - 1}
                      onClick={() => moveTo(index, index + 1)}
                    />
                    <RowButton
                      label="삭제"
                      icon={X}
                      danger
                      disabled={pending}
                      onClick={() => remove(todo)}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {showDone ? (
          <div className={cn(showOpen && openRows.length > 0 && "border-t border-line")}>
            {filter === "all" ? (
              <button
                type="button"
                onClick={() => setDoneOpen((v) => !v)}
                aria-expanded={doneOpen}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-label text-muted transition-colors duration-fast ease-standard hover:bg-subtle hover:text-ink"
              >
                {doneOpen ? (
                  <ChevronDown className="size-3.5" aria-hidden />
                ) : (
                  <ChevronRight className="size-3.5" aria-hidden />
                )}
                완료 <span className="tabular-nums">{doneRows.length}</span>건
              </button>
            ) : null}

            {doneExpanded ? (
              doneRows.length === 0 ? (
                <EmptyState
                  icon={ListChecks}
                  title="완료한 할일이 없습니다"
                  description="체크 상자를 누르면 완료 시각과 함께 이곳으로 내려옵니다."
                  action={
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => setFilter("open")}
                    >
                      미완료 보기
                    </Button>
                  }
                  compact
                  className="py-8"
                />
              ) : (
                <ul className={cn(filter === "all" && "border-t border-line")}>
                  {doneRows.map((todo) => (
                    <li
                      key={todo.id}
                      className="flex items-center gap-2 border-b border-line px-3 py-2 transition-colors duration-fast ease-standard last:border-b-0 hover:bg-subtle"
                    >
                      <span className="size-4 shrink-0" aria-hidden />
                      <input
                        type="checkbox"
                        checked
                        onChange={() => toggle(todo)}
                        disabled={pending}
                        aria-label={`완료 해제 — ${todo.content}`}
                        className="size-4 shrink-0 accent-primary"
                      />
                      <span className="min-w-0 flex-1 truncate text-body-sm text-muted line-through">
                        {todo.content}
                      </span>
                      <span className="shrink-0 text-nano tabular-nums text-muted">
                        {/* completed_at은 UTC라 그냥 자르면 밤에 끝낸 일이 전날이 된다 */}
                        {completedYmd(todo)?.slice(5) ?? "완료"} 완료
                      </span>
                      <RowButton
                        label="삭제"
                        icon={X}
                        danger
                        disabled={pending}
                        onClick={() => remove(todo)}
                      />
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        ) : null}
      </Card>

      <p className="sr-only" role="status" aria-live="polite">
        {notice}
      </p>
    </>
  );
}

/** 마감일 — 지난 것만 warn, 오늘은 정보, 나머지는 중립 */
function DueLabel({ due, today }: { due: string; today: string }) {
  const meta = dueMeta(due, today);
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap text-nano tabular-nums",
        DUE_TEXT_CLASS[meta.tone],
      )}
      title={`마감 ${due}`}
    >
      {meta.label} · {meta.dLabel}
    </span>
  );
}

function RowButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  icon: typeof ChevronUp;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        // 2026-08-07 UI/UX 감사: p-1(22px 히트영역)→p-2.5(44px)로 확대, 시각적 아이콘 크기는 유지
        "rounded-sm p-2.5 text-muted transition-colors duration-fast ease-standard disabled:opacity-30",
        danger
          ? "hover:bg-danger-light hover:text-danger"
          : "hover:bg-line hover:text-ink",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}
