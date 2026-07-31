"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { FieldError, FormRow, Input, Select, Textarea } from "@/components/ui/Field";
import { createProject } from "@/server/actions/projects";
import type { OwnerOption } from "./data";
import type { ProjectTeam } from "./types";

/**
 * 새 프로젝트 등록 폼 (스펙 10 · 3.2)
 *
 * 항목이 많은 등록 서식이라 디자인시스템 원칙대로 라벨-옆-인풋 표 형태를 쓴다
 * (기안 작성 폼과 같은 골격).
 *
 * 초기 마일스톤은 프로젝트가 생긴 뒤에야 붙일 수 있는데, 그 순서를 등록자가
 * 신경 쓰지 않도록 한 화면에서 받아 서버 액션이 두 번에 나눠 넣는다.
 */
interface MilestoneDraft {
  title: string;
  dueDate: string;
}

export function ProjectForm({
  teams,
  owners,
  defaultOwnerId,
  defaultTeamId,
}: {
  teams: ProjectTeam[];
  owners: OwnerOption[];
  /** 담당자 기본값은 본인 (스펙 3.2) */
  defaultOwnerId: string;
  defaultTeamId: string | null;
}) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState(defaultTeamId ?? "");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([
    { title: "", dueDate: "" },
  ]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  /** 프로젝트는 만들어졌지만 마일스톤이 실패한 경우 — 다시 제출하면 중복이 된다 */
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const patchMilestone = (index: number, patch: Partial<MilestoneDraft>) => {
    setMilestones((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (createdId) return;

    const payload = {
      name,
      teamId,
      ownerId,
      startDate,
      endDate,
      description,
      // 제목이 빈 줄은 "아직 안 적은 칸"이지 오류가 아니다 — 조용히 뺀다
      milestones: milestones
        .filter((m) => m.title.trim())
        .map((m) => ({ title: m.title, dueDate: m.dueDate })),
    };

    startTransition(async () => {
      const result = await createProject(payload);

      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setMessage(
          result.fieldErrors
            ? null
            : (result.message ?? "프로젝트를 등록하지 못했습니다."),
        );
        return;
      }

      setErrors({});
      if (result.message && result.projectId) {
        // 등록 자체는 됐다. 사실대로 알리고 상세로 갈 길을 남긴다
        setCreatedId(result.projectId);
        setMessage(result.message);
        return;
      }
      router.replace(`/projects/${result.projectId}`);
      router.refresh();
    });
  };

  /*
   * 서버는 milestones.1.title 처럼 인덱스가 붙은 키로 오류를 준다.
   * 특정 인덱스만 확인하면 두 번째 이후 줄의 오류가 화면에 전혀 안 나타나
   * 제출이 조용히 실패한 것처럼 보인다 (기안 폼의 경비 항목과 같은 문제).
   */
  const perMilestone = Object.entries(errors)
    .filter(([key]) => key.startsWith("milestones."))
    .map(([key, text]) => {
      const index = Number(key.split(".")[1]);
      return Number.isFinite(index) ? `${index + 1}번 항목: ${text}` : text;
    })
    .join(" / ");
  const milestoneError = errors.milestones ?? (perMilestone || undefined);

  return (
    <form onSubmit={submit} className="space-y-5">
      {message ? (
        <Callout
          tone={createdId ? "warn" : "danger"}
          title={
            createdId
              ? "프로젝트는 등록됐습니다"
              : "프로젝트를 등록하지 못했습니다"
          }
          action={
            createdId ? (
              <LinkButton
                href={`/projects/${createdId}`}
                size="small"
                variant="secondary"
              >
                프로젝트 열기
              </LinkButton>
            ) : undefined
          }
        >
          {message}
        </Callout>
      ) : null}

      <div className="ab-form-grid">
        <FormRow label="프로젝트명" required htmlFor="project-name" error={errors.name}>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예) 사내 인트라넷 구축"
            maxLength={120}
            invalid={!!errors.name}
            disabled={pending || !!createdId}
            autoFocus
          />
        </FormRow>

        <FormRow label="담당팀" htmlFor="project-team" error={errors.teamId}>
          <Select
            id="project-team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            invalid={!!errors.teamId}
            disabled={pending || !!createdId}
          >
            <option value="">팀 미지정</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
        </FormRow>

        <FormRow
          label="담당자"
          htmlFor="project-owner"
          error={errors.ownerId}
          hint="담당자와 시스템 관리자만 이 프로젝트를 고칠 수 있습니다."
        >
          <Select
            id="project-owner"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            invalid={!!errors.ownerId}
            disabled={pending || !!createdId}
          >
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
                {owner.position ? ` ${owner.position}` : ""}
              </option>
            ))}
          </Select>
        </FormRow>

        <FormRow
          label="기간"
          htmlFor="project-start"
          error={errors.startDate ?? errors.endDate}
          hint="비워 두면 기간 미정으로 남습니다. 종료일이 지나면 목록에서 지연으로 잡힙니다."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="project-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              invalid={!!errors.startDate}
              disabled={pending || !!createdId}
              className="w-auto"
              aria-label="시작일"
            />
            <span className="text-muted">~</span>
            <Input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              invalid={!!errors.endDate}
              disabled={pending || !!createdId}
              className="w-auto"
              aria-label="종료일"
            />
          </div>
        </FormRow>

        <FormRow
          label="설명"
          htmlFor="project-description"
          error={errors.description}
        >
          <Textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="무엇을 어디까지 하는 프로젝트인지 적어 두면 나중에 판단하기 쉽습니다."
            maxLength={4000}
            invalid={!!errors.description}
            disabled={pending || !!createdId}
          />
        </FormRow>
      </div>

      <Card>
        <CardHeader
          title="초기 마일스톤"
          description="진행률은 완료한 마일스톤 수 / 전체 수로 계산합니다. 지금 비워 둬도 상세에서 언제든 추가할 수 있습니다."
          density="compact"
          action={
            <Button
              size="xsmall"
              variant="secondary"
              onClick={() =>
                setMilestones((rows) => [...rows, { title: "", dueDate: "" }])
              }
              disabled={pending || !!createdId || milestones.length >= 30}
            >
              <Plus className="size-3.5" />
              추가
            </Button>
          }
        />
        <CardBody density="compact">
          <ul className="space-y-2">
            {milestones.map((milestone, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <span className="w-6 shrink-0 text-label tabular-nums text-muted">
                  {index + 1}
                </span>
                <Input
                  value={milestone.title}
                  onChange={(e) =>
                    patchMilestone(index, { title: e.target.value })
                  }
                  placeholder="예) 요구사항 정리 완료"
                  maxLength={120}
                  disabled={pending || !!createdId}
                  className="min-w-48 flex-1"
                  aria-label={`${index + 1}번 마일스톤 제목`}
                />
                <Input
                  type="date"
                  value={milestone.dueDate}
                  onChange={(e) =>
                    patchMilestone(index, { dueDate: e.target.value })
                  }
                  disabled={pending || !!createdId}
                  className="w-auto"
                  aria-label={`${index + 1}번 마일스톤 목표일`}
                />
                <button
                  type="button"
                  onClick={() =>
                    setMilestones((rows) =>
                      rows.length === 1
                        ? [{ title: "", dueDate: "" }]
                        : rows.filter((_, i) => i !== index),
                    )
                  }
                  disabled={pending || !!createdId}
                  aria-label={`${index + 1}번 마일스톤 빼기`}
                  className="shrink-0 rounded-sm p-1.5 text-muted transition-colors duration-fast ease-standard hover:bg-danger-light hover:text-danger disabled:opacity-40"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <FieldError>{milestoneError}</FieldError>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-caption">
          등록하면 기획중 상태로 시작합니다. 상태는 상세에서 바꿉니다.
        </span>
        <Button type="submit" disabled={pending || !!createdId}>
          {pending ? "등록 중…" : "프로젝트 등록"}
        </Button>
      </div>
    </form>
  );
}
