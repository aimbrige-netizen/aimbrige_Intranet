import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { AUTH_ERRORS, isAuthErrorCode } from "@/lib/auth/errors";
import { allowedEmailDomains } from "@/lib/env";

export const metadata: Metadata = { title: "로그인" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  const errorCode = isAuthErrorCode(searchParams.error)
    ? searchParams.error
    : null;
  const error = errorCode ? AUTH_ERRORS[errorCode] : null;

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-pick bg-primary text-body font-bold text-white">
            AB
          </span>
          <h1 className="text-h1 text-ink">에임브릿지 인트라넷</h1>
          <p className="mt-1.5 text-caption">
            회사 Google 계정({allowedEmailDomains.map((d) => `@${d}`).join(", ")})
            으로 로그인하세요
          </p>
        </div>

        {error ? (
          <div
            role="alert"
            className="mb-4 flex gap-2.5 rounded-card border border-danger/30 bg-danger/10 px-4 py-3"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            <div>
              <p className="text-body font-bold text-danger">{error.title}</p>
              <p className="mt-0.5 text-label text-ink/80">{error.message}</p>
            </div>
          </div>
        ) : null}

        <div className="ab-card p-6">
          <GoogleSignInButton next={searchParams.next} />
          <p className="mt-4 text-center text-label leading-relaxed text-muted">
            별도 회원가입 없이 회사 계정으로 바로 이용합니다.
            <br />
            계정 등록·권한 문의는 시스템 관리자에게 연락하세요.
          </p>
        </div>
      </div>
    </div>
  );
}
