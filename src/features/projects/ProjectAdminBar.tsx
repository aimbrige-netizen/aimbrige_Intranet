"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import {
  setProjectStatus,
  updateProject,
  type ProjectActionResult,
} from "@/server/actions/projects";
import type { OwnerOption } from "./data";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProjectDetail,
  type ProjectStatus,
  type ProjectTeam,
} from "./types";

/**
 * 상세 상단의 담당자·관리자 전용 조작 (스펙 10 · 3.3)
 *
 * 상태 변경 드롭다운과 기본 정보 수정. 권한이 없으면 이 컴포넌트를 아예
 * 렌더하지 않는다 — disabled로 남겨 두면 "언젠가 눌릴 수 있는 버튼"으로 읽힌다.
 *
 * 완료로 넘길 때만 결과 요약을 함께 받는다. 스펙이 둘을 한 동작으로 묶어 뒀고,
 * 나중에 채우겠다고 비워 두면 "무엇을 해서 끝났는지"가 영원히 비어 있게 된다.
 */
interface InfoDraft {
  name: string;
  teamId: string;
  ownerId: string;
  startDate: string;
  endDate: string;
  description: string;
}

export function ProjectAdminBar({
  project,
  teams,
  owners,
  canTransferOwner,
}: {
  project: ProjectDetail;
  teams: ProjectTeam[];
  owners: OwnerOption[];
  /** 담당자 이관은 시스템 관리자만 — RLS의 with check가 같은 기준으로 막는다 */
  canTransferOwner: boolean;
}) {
  const router = useRouter();

  const [info, setInfo] = useState<InfoDraft | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const messageOf = (result: ProjectActionResult) =>
    result.message ??
    Object.values(result.fieldErrors ?? {})[0] ??
    "처리하지 못했습니다.";

  const openInfo = () => {
    setFieldErrors({});
    setError(null);
    setInfo({
      name: project.name,
      teamId: project.team_id ?? "",
      ownerId: project.owner_id ?? "",
      startDate: project.start_date ?? "",
      endDate: project.end_date ?? "",
      description: project.description ?? "",
    });
  };

  const changeStatus = (next: ProjectStatus) => {
    if (next === project.status) return;

    if (next === "completed") {
      setFieldErrors({});
      setError(null);
      setCompleting(project.result_summary ?? "");
      return;
    }

    startTransition(async () => {
      const result = await setProjectStatus(project.id, next);
      if (!result.ok) {
        setError(messageOf(result));
        return;
      }
      setError(null);
      router.refresh();
    });
  };

  const complete = (event: React.FormEvent) => {
    event.preventDefault();
    if (completing === null) return;
    const summary = completing;

    startTransition(async () => {
      const result = await setProjectStatus(project.id, "completed", summary);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setError(result.fieldErrors ? null : messageOf(result));
        return;
      }
      setFieldErrors({});
      setError(null);
      setCompleting(null);
      router.refresh();
    });
  };

  const saveInfo = (event: React.FormEvent) => {
    event.preventDefault();
    if (!info) return;

    startTransition(async () => {
      const result = await updateProject(project.id, info);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setError(result.fieldErrors ? null : messageOf(result));
        return;
      }
      setFieldErrors({});
      setError(null);
      setInfo(null);
      router.refresh();
    });
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-label text-muted">상태</span>
        <Select
          value={project.status}
          onChange={(e) => changeStatus(e.target.value as ProjectStatus)}
          disabled={pending}
          aria-label="프로젝트 상태"
          className="h-10 w-32 py-0"
        >
          {PROJECT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PROJECT_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          onClick={openInfo}
          disabled={pending}
          className="ml-auto"
        >
          <SlidersHorizontal className="size-4" />
          정보 수정
        </Button>
      </div>

      {error ? (
        <Callout tone="danger" title="처리하지 못했습니다" className="mb-4">
          {error}
        </Callout>
      ) : null}

      <Modal
        open={completing !== null}
        onClose={() => setCompleting(null)}
        title="프로젝트 완료 처리"
        description="무엇을 해서 끝났는지 남겨 두면 다음 프로젝트가 그 기록에서 출발합니다."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setCompleting(null)}
              disabled={pending}
            >
              취소
            </Button>
            <Button type="submit" form="project-complete-form" disabled={pending}>
              완료로 변경
            </Button>
          </>
        }
      >
        <form
          id="project-complete-form"
          onSubmit={complete}
          className="space-y-4"
        >
          <Field
            label="결과 요약"
            required
            htmlFor="complete-summary"
            error={fieldErrors.resultSummary}
            hint="완료 후에도 결과·산출물 탭에서 보완할 수 있습니다."
          >
            <Textarea
              id="complete-summary"
              value={completing ?? ""}
              onChange={(e) => setCompleting(e.target.value)}
              placeholder="산출물, 남은 과제, 인수인계할 내용을 적어 둡니다."
              maxLength={4000}
              invalid={!!fieldErrors.resultSummary}
              disabled={pending}
              className="min-h-28"
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={info !== null}
        onClose={() => setInfo(null)}
        title="프로젝트 정보 수정"
        description="상태는 위 드롭다운에서, 마일스톤은 마일스톤 탭에서 바꿉니다."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setInfo(null)}
              disabled={pending}
            >
              취소
            </Button>
            <Button type="submit" form="project-info-form" disabled={pending}>
              저장
            </Button>
          </>
        }
      >
        <form id="project-info-form" onSubmit={saveInfo} className="space-y-4">
          <Field
            label="프로젝트명"
            required
            htmlFor="edit-name"
            error={fieldErrors.name}
          >
            <Input
              id="edit-name"
              value={info?.name ?? ""}
              onChange={(e) =>
                setInfo((d) => (d ? { ...d, name: e.target.value } : d))
              }
              maxLength={120}
              invalid={!!fieldErrors.name}
              disabled={pending}
            />
          </Field>

          <Field label="담당팀" htmlFor="edit-team" error={fieldErrors.teamId}>
            <Select
              id="edit-team"
              value={info?.teamId ?? ""}
              onChange={(e) =>
                setInfo((d) => (d ? { ...d, teamId: e.target.value } : d))
              }
              invalid={!!fieldErrors.teamId}
              disabled={pending}
            >
              <option value="">팀 미지정</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="담당자"
            htmlFor="edit-owner"
            error={fieldErrors.ownerId}
            hint={
              canTransferOwner
                ? "담당자와 시스템 관리자만 이 프로젝트를 고칠 수 있습니다."
                : "담당자를 다른 사람으로 넘기는 것은 시스템 관리자만 할 수 있습니다."
            }
          >
            <Select
              id="edit-owner"
              value={info?.ownerId ?? ""}
              onChange={(e) =>
                setInfo((d) => (d ? { ...d, ownerId: e.target.value } : d))
              }
              invalid={!!fieldErrors.ownerId}
              disabled={pending || !canTransferOwner}
            >
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                  {owner.position ? ` ${owner.position}` : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="기간"
            htmlFor="edit-start"
            error={fieldErrors.startDate ?? fieldErrors.endDate}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="edit-start"
                type="date"
                value={info?.startDate ?? ""}
                onChange={(e) =>
                  setInfo((d) => (d ? { ...d, startDate: e.target.value } : d))
                }
                invalid={!!fieldErrors.startDate}
                disabled={pending}
                className="w-auto"
                aria-label="시작일"
              />
              <span className="text-muted">~</span>
              <Input
                type="date"
                value={info?.endDate ?? ""}
                min={info?.startDate || undefined}
                onChange={(e) =>
                  setInfo((d) => (d ? { ...d, endDate: e.target.value } : d))
                }
                invalid={!!fieldErrors.endDate}
                disabled={pending}
                className="w-auto"
                aria-label="종료일"
              />
            </div>
          </Field>

          <Field
            label="설명"
            htmlFor="edit-description"
            error={fieldErrors.description}
          >
            <Textarea
              id="edit-description"
              value={info?.description ?? ""}
              onChange={(e) =>
                setInfo((d) => (d ? { ...d, description: e.target.value } : d))
              }
              maxLength={4000}
              invalid={!!fieldErrors.description}
              disabled={pending}
            />
          </Field>
        </form>
      </Modal>
    </>
  );
}
