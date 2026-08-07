"use client";

import { useState, useTransition } from "react";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Callout } from "@/components/ui/Callout";
import { Select } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { createAsset, setAssetStatus } from "@/server/actions/assets";
import {
  ASSET_STATUS_LABELS,
  MANUAL_ASSET_STATUSES,
  type AssetStatus,
} from "@/features/assets/types";

/** 자산 등록 (스펙 13 · 3.3) */
export function AssetCreateForm() {
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const submit = () =>
    startTransition(async () => {
      const result = await createAsset({ name, assetType, serialNumber });
      if (result.ok) {
        // 2026-08-07 UI/UX 감사: 등록해도 성공 피드백이 전혀 없었다
        toast(`${name} 자산을 등록했습니다.`);
        setName("");
        setAssetType("");
        setSerialNumber("");
        setErrors({});
        setMessage(null);
      } else {
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message ?? null);
      }
    });

  return (
    <div className="space-y-3">
      {message ? (
        <Callout tone="warn" title="자산을 등록하지 못했습니다">
          {message}
        </Callout>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_200px_auto] md:items-end">
        <Field label="자산명" required htmlFor="asset-name" error={errors.name}>
          <Input
            id="asset-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="MacBook Pro 14 M4"
            invalid={Boolean(errors.name)}
          />
        </Field>
        <Field label="종류" htmlFor="asset-type" error={errors.assetType}>
          <Input
            id="asset-type"
            value={assetType}
            onChange={(e) => setAssetType(e.target.value)}
            placeholder="노트북"
          />
        </Field>
        <Field
          label="시리얼번호"
          htmlFor="asset-serial"
          error={errors.serialNumber}
          hint="같은 번호는 등록할 수 없습니다."
        >
          <Input
            id="asset-serial"
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
          />
        </Field>
        <Button disabled={pending || !name.trim()} onClick={submit}>
          <PackagePlus className="size-4" />
          등록
        </Button>
      </div>
    </div>
  );
}

/**
 * 상태 변경 (수리중·폐기 표시).
 *
 * '대여중'은 목록에 없다. 그건 승인 함수가 대여 행과 함께 만드는 상태라,
 * 손으로 지정하면 대여 기록 없는 '대여중' 자산이 생긴다 — 사용자 칸은 비고,
 * 아무도 새로 신청할 수 없고, 반납 확인으로 되돌릴 대여 행도 없다.
 *
 * 대여 중인 자산은 서버가 따로 막는다 — 반납 확인 없이 상태만 바꾸면
 * 자산 상태와 대여 이력이 어긋난다.
 */
export function AssetStatusSelect({
  assetId,
  status,
}: {
  assetId: string;
  status: AssetStatus;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-end gap-2">
      {message ? <span className="text-label text-warn-ink">{message}</span> : null}
      <Select
        aria-label="자산 상태"
        className="h-8 w-32 px-2 py-1 text-label"
        value={status}
        disabled={pending}
        onChange={(e) =>
          startTransition(async () => {
            const result = await setAssetStatus(assetId, e.target.value);
            setMessage(result.ok ? null : (result.message ?? "변경하지 못했습니다."));
          })
        }
      >
        {/* 대여중이면 현재 값을 보여줘야 하니 옵션에 넣되 고를 수는 없게 한다 */}
        {status === "loaned" ? (
          <option value="loaned" disabled>
            {ASSET_STATUS_LABELS.loaned}
          </option>
        ) : null}
        {MANUAL_ASSET_STATUSES.map((value) => (
          <option key={value} value={value}>
            {ASSET_STATUS_LABELS[value]}
          </option>
        ))}
      </Select>
    </div>
  );
}
