"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { createClient } from "@/lib/supabase/client";
import { updateMyProfile } from "@/server/actions/profile";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp"];

/**
 * 본인이 수정 가능한 항목만 다룬다 (스펙 3.7)
 * 프로필 사진은 Supabase Storage의 avatars 버킷 `<auth uid>/` 폴더에 올린다.
 */
export function ProfileEditForm({
  authUserId,
  name,
  initial,
}: {
  authUserId: string | null;
  name: string;
  initial: {
    phone: string;
    emergency_contact: string;
    profile_image_url: string | null;
  };
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [phone, setPhone] = useState(initial.phone);
  const [emergencyContact, setEmergencyContact] = useState(
    initial.emergency_contact,
  );
  const [imageUrl, setImageUrl] = useState(initial.profile_image_url);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  const upload = async (file: File) => {
    if (!authUserId) {
      setMessage({
        tone: "error",
        text: "로그인 계정 연결 정보가 없습니다. 다시 로그인해 주세요.",
      });
      return;
    }
    if (!ALLOWED.includes(file.type)) {
      setMessage({ tone: "error", text: "PNG · JPG · WebP 파일만 올릴 수 있습니다." });
      return;
    }
    if (file.size > MAX_BYTES) {
      setMessage({ tone: "error", text: "2MB 이하 이미지만 올릴 수 있습니다." });
      return;
    }

    setUploading(true);
    setMessage(null);

    const supabase = createClient();
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "png";
    // 같은 경로를 upsert해 이전 파일이 쌓이지 않게 한다
    const path = `${authUserId}/avatar.${extension}`;

    const { error } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (error) {
      setUploading(false);
      setMessage({ tone: "error", text: `업로드 실패: ${error.message}` });
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(path);

    // 캐시된 이전 이미지가 보이지 않도록 버전 쿼리를 붙인다
    setImageUrl(`${publicUrl}?v=${Date.now()}`);
    setUploading(false);
    setMessage({
      tone: "ok",
      text: "이미지를 올렸습니다. 저장을 눌러 반영하세요.",
    });
  };

  const save = () => {
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await updateMyProfile({
        phone,
        emergency_contact: emergencyContact,
        profile_image_url: imageUrl,
      });
      if (result.ok) {
        setMessage({ tone: "ok", text: "저장했습니다." });
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      if (result.message) setMessage({ tone: "error", text: result.message });
    });
  };

  const busy = pending || uploading;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={name} src={imageUrl} size="xl" />
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <Upload className="size-3.5" />
              {uploading ? "올리는 중…" : "사진 변경"}
            </Button>
            {imageUrl ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setImageUrl(null)}
                disabled={busy}
              >
                <Trash2 className="size-3.5" />
                사진 삭제
              </Button>
            ) : null}
          </div>
          <p className="text-caption">PNG · JPG · WebP, 2MB 이하</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={ALLOWED.join(",")}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="휴대폰번호" htmlFor="phone" error={errors.phone}>
          <Input
            id="phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="010-0000-0000"
            invalid={!!errors.phone}
            disabled={busy}
          />
        </Field>

        <Field
          label="비상연락처"
          htmlFor="emergency_contact"
          error={errors.emergency_contact}
          hint="관계와 연락처를 함께 적어주세요. 예) 배우자 010-0000-0000"
        >
          <Input
            id="emergency_contact"
            value={emergencyContact}
            onChange={(event) => setEmergencyContact(event.target.value)}
            invalid={!!errors.emergency_contact}
            disabled={busy}
          />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-3">
        {message ? (
          <p
            className={`mr-auto text-label ${
              message.tone === "ok" ? "text-success" : "text-danger"
            }`}
          >
            {message.text}
          </p>
        ) : null}
        <Button onClick={save} disabled={busy}>
          {pending ? "저장 중…" : "저장"}
        </Button>
      </div>
    </div>
  );
}
