import type { EngineProvider } from "../handlers";
import type { WhatsAppApi } from "./cloud-api";
import { chat, type ChatCalendar } from "./conversation";
import type { ServerKv } from "./kv";
import type { Transcriber } from "./transcribe";

/**
 * Meta's webhook for DILO on WhatsApp, independent of the web framework.
 * Meta calls GET once to verify the address, then POSTs every incoming message.
 */

/** The verification handshake: echo the challenge when the token matches. */
export function verifyWebhook(params: URLSearchParams, verifyToken: string | undefined): { status: number; body: string } {
  const ok = !!verifyToken && params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === verifyToken;
  return ok ? { status: 200, body: params.get("hub.challenge") ?? "" } : { status: 403, body: "forbidden" };
}

/** One incoming WhatsApp message, as much of it as DILO reads. */
export interface IncomingMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type?: string; voice?: boolean };
}

interface WebhookPayload {
  object?: string;
  entry?: { changes?: { field?: string; value?: { messages?: IncomingMessage[] } }[] }[];
}

/** The user messages in a webhook call. Status updates (sent, delivered, read) carry none. */
export function incomingMessages(payload: unknown): IncomingMessage[] {
  const p = payload as WebhookPayload | null;
  if (p?.object !== "whatsapp_business_account") return [];
  return (p.entry ?? []).flatMap((e) =>
    (e.changes ?? []).flatMap((c) => (c.field === "messages" ? (c.value?.messages ?? []) : [])),
  );
}

export interface WebhookDeps {
  getEngine: EngineProvider;
  kv: ServerKv;
  whatsapp: WhatsAppApi;
  transcribe: Transcriber | null;
  timezone: string;
  /** Phone numbers allowed to use DILO (international format, digits only), or "all". */
  allowed: string[] | "all";
  calendar?: ChatCalendar | null;
  now?: () => Date;
}

const NOT_ALLOWED = "Ciao! DILO è ancora in prova privata, presto sarà aperto a tutti.";
const NO_VOICE = "Per ora non riesco ad ascoltare i vocali: scrivimi pure il messaggio.";
const UNSUPPORTED = "Per ora capisco messaggi scritti e vocali.";
const VOICE_FAILED = "Non sono riuscito ad ascoltare il vocale. Me lo riscrivi o lo rimandi?";
const EMPTY_VOICE = "Nel vocale non ho sentito niente. Me lo rimandi?";
const FAILED = "Qualcosa è andato storto. Riprova tra poco.";

/** Handles one message end to end: read or listen, understand, remember, reply. */
export async function processMessage(message: IncomingMessage, deps: WebhookDeps): Promise<void> {
  const from = message.from.replace(/\D/g, "");
  // Meta retries a webhook it thinks failed: each message is handled once.
  if (!(await deps.kv.claim(`dilo:wa:seen:${message.id}`, 24 * 60 * 60))) return;
  const reply = (text: string) => deps.whatsapp.sendText(from, text);

  if (deps.allowed !== "all" && !deps.allowed.includes(from)) return reply(NOT_ALLOWED);

  let text: string;
  let heardVoice = false;
  if (message.type === "text" && message.text?.body.trim()) {
    text = message.text.body;
  } else if (message.type === "audio" && message.audio) {
    if (!deps.transcribe) return reply(NO_VOICE);
    try {
      const media = await deps.whatsapp.downloadMedia(message.audio.id);
      text = await deps.transcribe(media.data, message.audio.mime_type || media.mimeType);
    } catch (err) {
      console.error("[dilo] voice note failed:", err);
      return reply(VOICE_FAILED);
    }
    if (!text) return reply(EMPTY_VOICE);
    heardVoice = true;
  } else {
    return reply(UNSUPPORTED);
  }

  let answer: string;
  try {
    answer = await chat(from, text, { getEngine: deps.getEngine, kv: deps.kv, timezone: deps.timezone, calendar: deps.calendar, now: deps.now });
  } catch (err) {
    console.error("[dilo] whatsapp chat failed:", err);
    answer = FAILED;
  }
  // With a voice note, show what DILO heard, so a misheard word is easy to spot.
  await reply(heardVoice ? `🎙️ «${text}»\n\n${answer}` : answer);
}

/**
 * "+39 333 123 4567, 39347..." → ["393331234567", "39347..."]; "*" lets anyone in.
 * Nothing set lets nobody in, so a fresh deployment never spends the API key for strangers.
 */
export function parseAllowed(value: string | undefined): string[] | "all" {
  if (value?.trim() === "*") return "all";
  return (value ?? "")
    .split(/[,;]/)
    .map((n) => n.replace(/\D/g, ""))
    .filter(Boolean);
}
