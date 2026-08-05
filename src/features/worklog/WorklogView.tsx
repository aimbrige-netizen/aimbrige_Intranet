"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NotebookPen, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SectionHeader } from "@/components/ui/Card";
import { DayStrip, type StripDay } from "@/components/ui/ChipStrip";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { TableEmptyRow } from "@/components/ui/EmptyState";
import {
  createWorkLog,
  deleteWorkLog,
  updateWorkLog,
} from "@/server/actions/worklog";
import {
  toSeoulTime,
  WEEKDAY_LABELS,
  weekdayOf,
} from "@/features/calendar/date";
import {
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from "@/features/projects/types";
import { cn } from "@/lib/utils";
import type { ProjectOption, WorkLog, WorklogStripDay } from "./types";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 태깅 드롭다운의 그룹 순서 — 취소는 조회 단계에서 이미 빠진다 */
const SELECT_GROUP_ORDER = [
  "in_progress",
  "planning",
  "on_hold",
  "completed",
] as const satisfies readonly ProjectStatus[];

interface Props {
  logs: WorkLog[];
  /** 태깅 드롭다운에 올릴 프로젝트 (status <> 'cancelled') */
  projects: ProjectOption[];
  /** 표에서 이름을 찾을 때 쓰는 사전 — 취소된 프로젝트도 들어 있다 */
  projectNames: Record<string, string>;
  /** 주간일 때만 7칸. 월간이면 null이고 스트립을 그리지 않는다 */
  strip: WorklogStripDay[] | null;
  /** 본인 화면인가 — 팀원 것을 볼 때는 편집 UI를 아예 렌더하지 않는다 */
  canEdit: boolean;
  today: string;
  /** 입력창의 초기 날짜 — 기간에 오늘이 없으면 그 기간의 마지막 날 */
  defaultDate: string;
  periodLabel: string;
  /** 빈 상태 문구에 쓰는 소유자 표현 ("아직" / "김담당님은 아직") */
  ownerLabel: string;
}

/**
 * 업무일지 본문.
 *
 * 기록 추가·수정을 모달이 아니라 인라인으로 둔 이유:
 * 이 화면은 매일 한 번씩 같은 동작(오늘 한 일 적기)을 반복하는 자리다.
 * 모달로 만들면 "열기 → 적기 → 저장 → 닫기"가 매일 반복되고, 그 사이
 * 방금 본 주간 스트립과 지난 기록이 화면에서 사라져 무엇을 아직 안 썼는지
 * 참조할 수 없게 된다. 신청서(연차·초과근무)처럼 가끔 쓰는 폼과 달리
 * 여기서는 입력창이 늘 펼쳐져 있는 편이 클릭도, 맥락도 덜 잃는다.
 * 수정도 같은 이유로 그 행 자리에서 펼친다 — 원문이 눈앞에 있어야 고친다.
 */
export function WorklogView({
  logs,
  projects,
  projectNames,
  strip,
  canEdit,
  today,
  defaultDate,
  periodLabel,
  ownerLabel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [date, setDate] = useState(defaultDate);
  const [content, setContent] = useState("");
  const [projectId, setProjectId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editProjectId, setEditProjectId] = useState("");
  const [editMessage, setEditMessage] = useState<string | null>(null);

  const composerRef = useRef<HTMLTextAreaElement>(null);

  const byDate = useMemo(() => {
    const map = new Map<string, WorkLog[]>();
    logs.forEach((log) => {
      const list = map.get(log.log_date);
      if (list) list.push(log);
      else map.set(log.log_date, [log]);
    });
    return map;
  }, [logs]);

  const grouped = useMemo(
    () => Array.from(byDate.entries()).sort((a, b) => b[0].localeCompare(a[0])),
    [byDate],
  );

  const columnCount = canEdit ? 5 : 4;

  const focusComposer = () => {
    composerRef.current?.focus();
    composerRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const submit = () => {
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await createWorkLog({
        logDate: date,
        content,
        projectId: projectId || null,
      });
      if (result.ok) {
        setContent("");
        setProjectId("");
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message ?? null);
    });
  };

  const startEdit = (log: WorkLog) => {
    setEditingId(log.id);
    setEditContent(log.content);
    setEditProjectId(log.project_id ?? "");
    setEditMessage(null);
  };

  const saveEdit = (id: string) => {
    setEditMessage(null);
    startTransition(async () => {
      const result = await updateWorkLog(id, {
        content: editContent,
        projectId: editProjectId || null,
      });
      if (result.ok) {
        setEditingId(null);
        router.refresh();
        return;
      }
      setEditMessage(
        result.fieldErrors?.content ??
          result.message ??
          "수정하지 못했습니다.",
      );
    });
  };

  const remove = (log: WorkLog) => {
    if (!window.confirm(`${log.log_date} 기록을 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      const result = await deleteWorkLog(log.id);
      if (!result.ok) {
        window.alert(result.message ?? "삭제하지 못했습니다.");
        return;
      }
      router.refresh();
    });
  };

  const stripDays: StripDay[] | null = strip
    ? strip.map((day) => {
        const dayLogs = byDate.get(day.date) ?? [];
        const preview = dayLogs[0]?.content.replace(/\s+/g, " ").trim();
        return {
          date: day.date,
          holiday: day.holiday ?? undefined,
          // 주말에 남긴 기록까지 흐리게 만들면 그 날 쓴 사실이 지워진다
          muted: day.muted && dayLogs.length === 0,
          selected: canEdit ? day.date === date : day.date === today,
          onSelect: day.selectable ? setDate : undefined,
          chips: dayLogs.length
            ? [
                {
                  lines: [`${dayLogs.length}건`, { text: preview, dim: true }],
                  tone: "success" as const,
                  title: preview,
                },
              ]
            : undefined,
        };
      })
    : null;

  const validDate = YMD.test(date);
  const composerDateLabel = !validDate
    ? "날짜를 선택하세요"
    : date === today
      ? `오늘 ${today} (${WEEKDAY_LABELS[weekdayOf(today)]})`
      : `${date} (${WEEKDAY_LABELS[weekdayOf(date)]})`;

  return (
    <>
      {/*
        08 흰 시트: md+에서는 본문 전체가 흰 면이라 .ab-card가 흰 면 위
        이중 테두리가 된다 — 섹션 제목 + 직접 배치로 해체(10-modules2).
        md 미만은 회청 canvas 위 카드 문법이 그대로라 카드 면을 유지한다.
        (이 화면의 세 섹션 모두 같은 패턴 — CalendarBoard와 동일)
      */}
      {stripDays ? (
        <section className="mb-5">
          <SectionHeader
            title={`${periodLabel} 기록`}
            description={
              canEdit
                ? "날짜를 누르면 그 날짜로 기록합니다"
                : "하루에 남긴 기록 수"
            }
          />
          <div className="ab-card px-4 py-3 md:rounded-none md:border-0 md:p-0">
            <DayStrip days={stripDays} />
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <section className="mb-5">
          <SectionHeader
            title="기록 추가"
            description={`${composerDateLabel} · 하루에 여러 건을 남길 수 있습니다`}
          />
          <div className="ab-card px-4 py-3 md:rounded-none md:border-0 md:p-0">
            <div className="grid gap-4 md:grid-cols-[13rem_1fr] md:items-start">
              <div className="space-y-3">
                <Field label="날짜" htmlFor="wl-date" error={errors.logDate}>
                  <Input
                    id="wl-date"
                    type="date"
                    value={date}
                    max={today}
                    disabled={pending}
                    invalid={!!errors.logDate}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </Field>
                <Field
                  label="프로젝트"
                  htmlFor="wl-project"
                  error={errors.projectId}
                >
                  <ProjectSelect
                    id="wl-project"
                    projects={projects}
                    value={projectId}
                    disabled={pending}
                    onChange={setProjectId}
                  />
                </Field>
              </div>

              <div className="space-y-2">
                <Field label="내용" htmlFor="wl-content" error={errors.content}>
                  <Textarea
                    id="wl-content"
                    ref={composerRef}
                    rows={4}
                    value={content}
                    disabled={pending}
                    invalid={!!errors.content}
                    placeholder="오늘 한 일을 자유롭게 적어 주세요."
                    onChange={(event) => setContent(event.target.value)}
                  />
                </Field>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {message ? (
                    <p className="mr-auto text-label text-danger">{message}</p>
                  ) : null}
                  <Button onClick={submit} disabled={pending}>
                    {pending ? "저장 중…" : "기록 저장"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section>
        <SectionHeader
          title={`${periodLabel} 업무일지`}
          description={`${logs.length}건 · 기록한 날 ${grouped.length}일`}
        />
        <div className="ab-card md:rounded-none md:border-0">
          <div className="overflow-x-auto">
            {/* --compact는 규칙 없는 클래스 — 화면을 손대는 사이클에 정리(Table.tsx 주석) */}
            <table className="ab-table min-w-[720px]">
              <thead>
                <tr>
                  <th className="w-28">날짜</th>
                  <th>내용</th>
                  <th className="w-40">프로젝트</th>
                  <th className="w-20">기록 시각</th>
                  {canEdit ? <th className="w-20">관리</th> : null}
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <TableEmptyRow
                    colSpan={columnCount}
                    icon={NotebookPen}
                    title={`${ownerLabel} 이 기간에 남긴 기록이 없습니다`}
                    description={
                      canEdit
                        ? "한 줄이어도 남겨 두면 평가·회고 때 그대로 근거가 됩니다."
                        : "이 기간에는 작성된 업무일지가 없습니다."
                    }
                    action={
                      canEdit ? (
                        // 이 화면의 오렌지 면은 위 입력창의 '기록 저장' 하나다
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={focusComposer}
                        >
                          기록 작성하기
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  grouped.flatMap(([logDate, dayLogs]) =>
                    dayLogs.map((log, index) => {
                      const weekday = weekdayOf(logDate);
                      const dateCell = (
                        <td className="whitespace-nowrap align-top tabular-nums">
                          {index === 0 ? (
                            <span
                              className={cn(
                                weekday === 0
                                  ? "text-danger"
                                  : weekday === 6
                                    ? "text-info"
                                    : undefined,
                              )}
                            >
                              {logDate.slice(5)} ({WEEKDAY_LABELS[weekday]})
                            </span>
                          ) : null}
                        </td>
                      );

                      if (canEdit && editingId === log.id) {
                        return (
                          <tr key={log.id}>
                            {dateCell}
                            <td colSpan={columnCount - 1}>
                              <div className="space-y-2">
                                <Textarea
                                  rows={3}
                                  value={editContent}
                                  disabled={pending}
                                  aria-label="업무일지 내용 수정"
                                  onChange={(event) =>
                                    setEditContent(event.target.value)
                                  }
                                />
                                <div className="flex flex-wrap items-center gap-2">
                                  <ProjectSelect
                                    projects={projects}
                                    value={editProjectId}
                                    disabled={pending}
                                    onChange={setEditProjectId}
                                    className="max-w-56"
                                    ariaLabel="프로젝트 태깅 수정"
                                  />
                                  <Button
                                    size="small"
                                    variant="secondary"
                                    disabled={pending}
                                    onClick={() => saveEdit(log.id)}
                                  >
                                    저장
                                  </Button>
                                  <Button
                                    size="small"
                                    variant="ghost"
                                    disabled={pending}
                                    onClick={() => setEditingId(null)}
                                  >
                                    취소
                                  </Button>
                                  {editMessage ? (
                                    <p className="text-label text-danger">
                                      {editMessage}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={log.id}>
                          {dateCell}
                          <td className="whitespace-pre-wrap align-top text-ink">
                            {log.content}
                          </td>
                          <td className="align-top">
                            <ProjectCell
                              projectId={log.project_id}
                              name={
                                log.project_id
                                  ? (projectNames[log.project_id] ?? null)
                                  : null
                              }
                            />
                          </td>
                          <td className="whitespace-nowrap align-top tabular-nums text-caption">
                            {toSeoulTime(log.created_at)}
                          </td>
                          {canEdit ? (
                            <td className="align-top">
                              <span className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => startEdit(log)}
                                  disabled={pending}
                                  aria-label={`${log.log_date} 기록 수정`}
                                  className="rounded-sm p-1.5 text-muted transition-colors hover:bg-line hover:text-ink disabled:opacity-50"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => remove(log)}
                                  disabled={pending}
                                  aria-label={`${log.log_date} 기록 삭제`}
                                  className="rounded-sm p-1.5 text-muted transition-colors hover:bg-danger-light hover:text-danger disabled:opacity-50"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </span>
                            </td>
                          ) : null}
                        </tr>
                      );
                    }),
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * 표의 프로젝트 칸.
 *
 * 이름을 아는 프로젝트만 링크로 만든다. 이름을 못 찾았다는 건 그 프로젝트가
 * 사라졌거나 조회가 실패했다는 뜻이라, 링크를 걸면 없는 화면으로 보내게 된다.
 * 그렇다고 칸을 비우지는 않는다 — 태깅했다는 사실 자체는 남은 정보다.
 *
 * 색 절제(07 표 문법 — 순수 텍스트 셀): 프로젝트명은 상태가 아니라서 행마다
 * 반복되던 정보 틴트 배지를 걷고, 표의 다른 링크와 같은 문법(먹색 +
 * hover 시안·밑줄)으로 간다. 결재 홈 제목 링크와 같은 단.
 */
function ProjectCell({
  projectId,
  name,
}: {
  projectId: string | null;
  name: string | null;
}) {
  if (!projectId) return <span className="text-caption">-</span>;
  if (!name) return <span className="text-muted">연결된 프로젝트</span>;

  return (
    <Link
      href={`/projects/${projectId}`}
      className="inline-block max-w-full truncate text-ink hover:text-primary hover:underline"
      title={`${name} 프로젝트 열기`}
    >
      {name}
    </Link>
  );
}

/**
 * 프로젝트 태깅 드롭다운.
 *
 * 목록이 0건이어도 숨기지 않는다 — 셀렉트가 사라지면 "업무일지에 프로젝트를
 * 달 수 있다"는 사실 자체가 화면에서 지워진다. 대신 고를 것이 없다는 사실을
 * 옵션 자리에 그대로 쓴다.
 */
function ProjectSelect({
  id,
  projects,
  value,
  disabled,
  onChange,
  className,
  ariaLabel,
}: {
  id?: string;
  projects: ProjectOption[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const empty = projects.length === 0;

  /*
   * 상태별로 묶는다. 조회는 이름순 한 덩어리로 오는데, 오늘 쓴 일지를 다는 곳은
   * 대개 굴러가는 프로젝트라 완료·보류가 이름순으로 사이사이 끼면 찾기 어렵다.
   * 그룹 순서는 "지금 하는 것 → 앞으로 할 것 → 멈춘 것 → 끝난 것".
   * (취소는 조회에서 이미 빠져 있다)
   */
  const groups = SELECT_GROUP_ORDER.map((status) => ({
    status,
    items: projects.filter((project) => project.status === status),
  })).filter((group) => group.items.length > 0);

  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled || empty}
      className={className}
      onChange={(event) => onChange(event.target.value)}
    >
      {empty ? (
        <option value="">등록된 프로젝트가 없습니다</option>
      ) : (
        <>
          <option value="">프로젝트 없음</option>
          {groups.map((group) => (
            <optgroup
              key={group.status}
              label={PROJECT_STATUS_LABELS[group.status]}
            >
              {group.items.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </optgroup>
          ))}
        </>
      )}
    </Select>
  );
}
