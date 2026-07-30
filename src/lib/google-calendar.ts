import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Google Calendar 단방향 동기화 (스펙 02 · 5장)
 *
 * MVP 범위는 "인트라넷 → 구글" 한 방향뿐이다. 구글에서 만든 일정을 인트라넷으로
 * 가져오는 진짜 양방향 동기화는 웹훅/폴링이 필요해 Phase 2 이후로 미룬다.
 *
 * 토큰 처리 방식:
 *   Supabase Auth의 Google provider_token을 그대로 쓴다. 이 토큰은 세션에만 담겨 있고
 *   1시간 뒤 만료되며, refresh token을 우리 DB에 저장하지 않는다.
 *   → 오래 로그인해 둔 사용자는 동기화가 실패할 수 있다. 이때 일정 저장 자체는
 *     성공시키고 동기화만 건너뛴다(캘린더가 인트라넷의 원본이므로).
 *   refresh token을 보관하는 방식은 유출 시 사용자 캘린더 전체가 노출되므로,
 *   필요해지면 별도 보안 검토 후 도입한다.
 */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export interface GoogleSyncInput {
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
}

/**
 * 세션에 남아 있는 Google access token (없으면 null)
 *
 * provider_token은 OAuth 콜백 직후 세션에 담기고, 액세스 토큰이 갱신되면(약 1시간)
 * 사라진다. 즉 오래 로그인해 둔 사용자는 이 값이 없어 동기화가 조용히 건너뛰어진다.
 * 왜 안 됐는지 추적할 수 있게 사유를 로그로 남긴다.
 */
async function getProviderToken(): Promise<string | null> {
  const supabase = createServerSupabase();
  const { data } = await supabase.auth.getSession();

  if (!data.session) {
    console.warn("[google-calendar] 세션이 없어 동기화를 건너뜁니다.");
    return null;
  }
  if (!data.session.provider_token) {
    console.warn(
      "[google-calendar] provider_token이 없어 동기화를 건너뜁니다. " +
        "캘린더 스코프를 켠 뒤 다시 로그인했는지, 로그인 후 1시간이 지나지 않았는지 확인하세요.",
    );
    return null;
  }
  return data.session.provider_token;
}

function toGoogleTime(iso: string, allDay: boolean) {
  if (allDay) {
    // 종일 일정은 서울 기준 날짜만 보낸다
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
    return { date: ymd };
  }
  return { dateTime: new Date(iso).toISOString(), timeZone: "Asia/Seoul" };
}

/**
 * 구글 캘린더에 이벤트를 만든다.
 * 실패해도 예외를 던지지 않고 null을 돌려준다 — 동기화 실패가 일정 저장을 막으면 안 된다.
 */
export async function createGoogleEvent(
  input: GoogleSyncInput,
): Promise<string | null> {
  const token = await getProviderToken();
  if (!token) return null;

  try {
    const response = await fetch(CALENDAR_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: input.title,
        description: input.description ?? undefined,
        start: toGoogleTime(input.startAt, input.allDay),
        end: toGoogleTime(input.endAt, input.allDay),
      }),
    });

    if (!response.ok) {
      console.error(
        "[google-calendar] 이벤트 생성 실패",
        response.status,
        await response.text(),
      );
      return null;
    }

    const created = (await response.json()) as { id?: string };
    return created.id ?? null;
  } catch (error) {
    console.error("[google-calendar] 이벤트 생성 중 예외", error);
    return null;
  }
}

export async function updateGoogleEvent(
  eventId: string,
  input: GoogleSyncInput,
): Promise<void> {
  const token = await getProviderToken();
  if (!token) return;

  try {
    const response = await fetch(`${CALENDAR_API}/${eventId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: input.title,
        description: input.description ?? undefined,
        start: toGoogleTime(input.startAt, input.allDay),
        end: toGoogleTime(input.endAt, input.allDay),
      }),
    });
    if (!response.ok) {
      console.error("[google-calendar] 이벤트 수정 실패", response.status);
    }
  } catch (error) {
    console.error("[google-calendar] 이벤트 수정 중 예외", error);
  }
}

export async function deleteGoogleEvent(eventId: string): Promise<void> {
  const token = await getProviderToken();
  if (!token) return;

  try {
    await fetch(`${CALENDAR_API}/${eventId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    console.error("[google-calendar] 이벤트 삭제 중 예외", error);
  }
}
