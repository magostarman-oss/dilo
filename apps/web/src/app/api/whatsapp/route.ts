import { after } from "next/server";
import { validSignature } from "@/server/whatsapp/cloud-api";
import { whatsAppFromEnv } from "@/server/whatsapp/setup";
import { incomingMessages, processMessage, verifyWebhook } from "@/server/whatsapp/webhook";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Meta checks the webhook address once, when it is set up in the WhatsApp dashboard. */
export function GET(request: Request): Response {
  const { status, body } = verifyWebhook(new URL(request.url).searchParams, process.env.WHATSAPP_VERIFY_TOKEN);
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

/** Incoming WhatsApp messages. Answered at once; DILO thinks and replies right after. */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!secret || !(await validSignature(raw, request.headers.get("x-hub-signature-256"), secret))) {
    console.error("[dilo] WhatsApp webhook rejected: missing or wrong signature (check WHATSAPP_APP_SECRET).");
    return new Response("forbidden", { status: 403 });
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const messages = incomingMessages(payload);
  const deps = messages.length ? whatsAppFromEnv() : null;
  if (messages.length && !deps) {
    console.error("[dilo] WhatsApp is not configured: set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and the Redis database.");
  } else if (deps) {
    // Meta wants a quick 200; understanding a message can take a few seconds.
    after(async () => {
      for (const message of messages) {
        await processMessage(message, deps).catch((err) => console.error("[dilo] whatsapp message failed:", err));
      }
    });
  }
  return new Response("ok", { status: 200 });
}
