import "server-only";
import { GoogleCalendarApi } from "@dilo/actions";
import { getEngine } from "../engine";
import { cloudApiFromEnv } from "./cloud-api";
import type { ChatCalendar } from "./conversation";
import { accessToken, connectLink, googleOAuthFromEnv } from "./google";
import { kvFromEnv, type ServerKv } from "./kv";
import { transcriberFromEnv } from "./transcribe";
import { parseAllowed, type WebhookDeps } from "./webhook";

/** Everything DILO on WhatsApp needs, from the server's environment. Null when WhatsApp is not set up. */
export function whatsAppFromEnv(): WebhookDeps | null {
  const kv = kvFromEnv();
  const whatsapp = cloudApiFromEnv();
  if (!kv || !whatsapp) return null;
  return {
    getEngine,
    kv,
    whatsapp,
    transcribe: transcriberFromEnv(),
    timezone: process.env.DILO_TIMEZONE || "Europe/Rome",
    allowed: parseAllowed(process.env.WHATSAPP_ALLOWED_NUMBERS),
    calendar: calendarFromEnv(kv),
  };
}

/** Each number's Google Calendar, reached with the refresh token kept for it. */
export function calendarFromEnv(kv: ServerKv): ChatCalendar | null {
  const google = googleOAuthFromEnv();
  if (!google) return null;
  return {
    async open(userId) {
      const token = await accessToken(google, kv, userId);
      return token ? new GoogleCalendarApi(() => token) : null;
    },
    connectLink: (userId) => connectLink(google, userId),
  };
}
