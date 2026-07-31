"use client";

import { useState, useTransition } from "react";
import { Save, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { Callout } from "@/components/ui/Callout";
import { saveManagerReview, saveSelfReview } from "@/server/actions/reviews";

/**
 * 자기평가 · 팀장평가 입력 (스펙 12 · 3.2 · 3.3)
 *
 * 두 화면이 같은 구조라 한 컴포넌트로 둔다 — 다른 것은 "누구의 칸을 쓰는가"뿐이고,
 * 그 판정은 서버 액션과 DB 트리거가 한다. 여기서 갈라놓으면 저장·제출 규칙이
 * 두 벌이 되어 한쪽만 고치는 일이 생긴다.
 *
 * 임시저장과 제출을 나눈 이유: 평가는 한 번에 다 못 쓴다. 제출 버튼만 있으면
 * 쓰다 만 내용을 잃지 않으려고 미리 제출해버리게 되고, 제출은 되돌릴 수 없다.
 */
export function ReviewForm({
  cycleId,
  /** 팀장평가일 때만 준다 — 없으면 본인 자기평가 */
  targetEmployeeId,
  initialText,
  submittedAt,
  label,
  placeholder,
}: {
  cycleId: string;
  targetEmployeeId?: string;
  initialText: string | null;
  submittedAt: string | null;
  label: string;
  placeholder: string;
}) {
  const [text, setText] = useState(initialText ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (asSubmit: boolean) =>
    startTransition(async () => {
      const result = targetEmployeeId
        ? await saveManagerReview(cycleId, targetEmployeeId, text, asSubmit)
        : await saveSelfReview(cycleId, text, asSubmit);

      if (result.ok) {
        setMessage(null);
        setSaved(asSubmit ? "제출했습니다." : "임시저장했습니다.");
      } else {
        setSaved(null);
        setMessage(
          result.message ??
            Object.values(result.fieldErrors ?? {})[0] ??
            "처리하지 못했습니다.",
        );
      }
    });

  /*
   * 제출한 뒤에는 입력창을 읽기전용으로 두고 버튼을 없앤다.
   * 내용은 계속 보여야 한다 — 무엇을 제출했는지 확인할 수 없으면
   * 나중에 팀장평가를 받았을 때 맥락을 잃는다.
   */
  if (submittedAt) {
    return (
      <div className="space-y-2">
        <p className="whitespace-pre-wrap rounded-card border border-line bg-subtle p-3 text-body-sm text-ink">
          {initialText || "(내용 없음)"}
        </p>
        <p className="text-label text-muted">
          {submittedAt.slice(0, 10)} 제출 · 수정할 수 없습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {message ? (
        <Callout tone="warn" title="처리하지 못했습니다">
          {message}
        </Callout>
      ) : null}

      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(null);
        }}
        rows={10}
        placeholder={placeholder}
        aria-label={label}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-label text-muted">
          {saved ?? "제출하면 수정할 수 없습니다."}
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => submit(false)}
          >
            <Save className="size-4" />
            임시저장
          </Button>
          <Button
            disabled={pending || !text.trim()}
            onClick={() => submit(true)}
          >
            <Send className="size-4" />
            제출
          </Button>
        </div>
      </div>
    </div>
  );
}
